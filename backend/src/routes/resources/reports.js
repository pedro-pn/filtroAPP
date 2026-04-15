import { Router } from 'express';
import fs from 'node:fs/promises';
import { ReportStatus, ReportType } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { saveReportDocx, organizePhotos } from '../../lib/report-docx.js';
import { saveReportPdf } from '../../lib/report-pdf-from-docx.js';
import { saveRtpDocx, saveRtpPdf, organizeRtpPhotos } from '../../lib/report-rtp.js';
import { saveRlqDocx, saveRlqPdf, organizeRlqPhotos } from '../../lib/report-rlq.js';
import { calculateReportOvertime } from '../../lib/overtime.js';
import prisma from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

function contentDisposition(fileName) {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._\-]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const include = {
  project: {
    include: {
      operator: true
    }
  },
  createdBy: {
    include: {
      collaborator: true
    }
  },
  reviewedBy: {
    include: {
      collaborator: true
    }
  },
  collaborators: { include: { collaborator: true } },
  services: {
    include: {
      equipment: true,
      attachments: true
    }
  },
  attachments: true
};

function canAccessReport(auth, report) {
  if (auth.user.role === 'MANAGER') return true;
  if (report.createdByUserId === auth.user.id) return true;
  const collabId = auth.rawUser?.collaboratorId;
  if (collabId && Array.isArray(report.collaborators)) {
    return report.collaborators.some(rc => rc.collaboratorId === collabId);
  }
  return false;
}

const serviceSchema = z.object({
  serviceType: z.string().min(1),
  equipmentId: z.string().nullable().optional(),
  system: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  finalized: z.boolean().nullable().optional(),
  extraData: z.any().optional()
});

const schema = z.object({
  projectId: z.string().min(1),
  createdByUserId: z.string().min(1),
  reportType: z.nativeEnum(ReportType).default(ReportType.RDO),
  status: z.nativeEnum(ReportStatus).default(ReportStatus.PENDING),
  reportDate: z.string().min(1),
  arrivalTime: z.string().min(1),
  departureTime: z.string().min(1),
  lunchBreak: z.string().min(1),
  daytimeCount: z.number().int().nonnegative(),
  overtimeReason: z.string().optional().nullable(),
  dailyDescription: z.string().optional().nullable(),
  specialConditions: z.any().optional(),
  collaboratorIds: z.array(z.string()).default([]),
  services: z.array(serviceSchema).default([])
});

const updateSchema = schema.omit({
  createdByUserId: true,
  status: true
});

const statusSchema = z.object({
  status: z.nativeEnum(ReportStatus),
  reviewNotes: z.string().nullable().optional()
});

function uniqueIds(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function safePathLocal(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function applyUrlMap(obj, urlMap) {
  if (!urlMap || !urlMap.size) return obj;
  let json = JSON.stringify(obj);
  for (const [oldUrl, newUrl] of urlMap.entries()) {
    const escapedOld = JSON.stringify(oldUrl).slice(1, -1);
    const escapedNew = JSON.stringify(newUrl).slice(1, -1);
    json = json.split(escapedOld).join(escapedNew);
  }
  try { return JSON.parse(json); } catch { return obj; }
}

async function organizeAndPersist(report) {
  const projectFolderName = safePathLocal(`Missão ${report.project.code} - ${report.project.name}`);
  let urlMap;
  if (report.reportType === 'RTP') {
    urlMap = await organizeRtpPhotos(report, projectFolderName);
  } else if (report.reportType === 'RLQ') {
    urlMap = await organizeRlqPhotos(report, projectFolderName);
  } else {
    urlMap = await organizePhotos(report, projectFolderName);
  }
  if (urlMap && urlMap.size > 0) {
    const newSC = applyUrlMap(report.specialConditions, urlMap);
    await prisma.report.update({ where: { id: report.id }, data: { specialConditions: newSC } });

    // Para RTP/RLQ, também atualiza o extraData do serviço-fonte do RDO para que
    // re-edições do RDO não percam as URLs organizadas das fotos.
    const sourceServiceId = report.specialConditions?.serviceId;
    if (sourceServiceId && (report.reportType === 'RTP' || report.reportType === 'RLQ')) {
      try {
        const sourceService = await prisma.reportService.findUnique({
          where: { id: sourceServiceId },
          select: { id: true, extraData: true }
        });
        if (sourceService) {
          const newExtraData = applyUrlMap(sourceService.extraData, urlMap);
          await prisma.reportService.update({
            where: { id: sourceServiceId },
            data: { extraData: newExtraData }
          });
        }
      } catch { /* best effort */ }
    }
  }
}

function collectPendingDerivedTypes(services) {
  const derived = new Set();

  for (const service of services || []) {
    if (service.finalized !== true) continue;

    switch (service.serviceType) {
      case 'limpeza':
        derived.add(ReportType.RLQ);
        break;
      case 'pressao':
        derived.add(ReportType.RTP);
        break;
      case 'filtragem':
        derived.add(ReportType.RCP);
        break;
      case 'flushing':
        derived.add(ReportType.RCP);
        break;
      case 'mecanica':
        derived.add(ReportType.RLM);
        break;
      case 'inibicao':
        derived.add(ReportType.RLI);
        derived.add(ReportType.RLF);
        break;
      default:
        break;
    }
  }

  return Array.from(derived);
}

async function reserveSequence(tx, projectId, reportType) {
  const existing = await tx.projectReportSeq.findUnique({
    where: {
      projectId_reportType: {
        projectId,
        reportType
      }
    }
  });

  if (!existing) {
    await tx.projectReportSeq.create({
      data: {
        projectId,
        reportType,
        nextNumber: 2
      }
    });
    return 1;
  }

  const sequenceNumber = existing.nextNumber > 0 ? existing.nextNumber : 1;

  await tx.projectReportSeq.update({
    where: {
      projectId_reportType: {
        projectId,
        reportType
      }
    },
    data: {
      nextNumber: sequenceNumber + 1
    }
  });

  return sequenceNumber;
}

async function syncApprovedRtpReports(tx, report) {
  if (!report || report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED) {
    return;
  }

  const pressaoServices = (report.services || []).filter(
    service => service.serviceType === 'pressao' && service.finalized === true
  );

  if (!pressaoServices.length) {
    return;
  }

  const existingRtps = await tx.report.findMany({
    where: {
      projectId: report.projectId,
      reportType: ReportType.RTP
    },
    select: {
      id: true,
      sequenceNumber: true,
      specialConditions: true
    }
  });

  const existingByLinkKey = new Map();
  existingRtps.forEach(item => {
    const special = item.specialConditions || {};
    if (special.parentRdoId !== report.id) {
      return;
    }
    const linkKey = String(special.serviceLinkKey || special.serviceId || '').trim();
    if (linkKey) {
      existingByLinkKey.set(linkKey, item);
    }
  });

  for (const service of pressaoServices) {
    const fields = service.extraData || {};
    const serviceLinkKey = String(
      fields.__serviceLinkKey ||
      fields.__sourceServiceId ||
      service.id ||
      ''
    ).trim();

    const collabField =
      fields['Colaboradores do serviço'] ||
      fields['Colaboradores do serviÃ§o'] ||
      fields['Colaboradores do servico'];
    const collabIds = Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [];

    const manoField =
      fields['Manômetros utilizados'] ||
      fields['ManÃ´metros utilizados'] ||
      fields['Manometros utilizados'];
    const manoIds = Array.isArray(manoField?.ids) ? manoField.ids.filter(Boolean) : [];

    const uthField = fields['Unidade de Teste Hidrostático (UTH)'] ||
      fields['Unidade de Teste HidrostÃ¡tico (UTH)'] ||
      fields['Unidade de Teste Hidrostatico (UTH)'];
    const uthIds = Array.isArray(uthField?.ids) ? uthField.ids.filter(Boolean)
      : (uthField && typeof uthField === 'string' ? [uthField] : []);

    const [collaborators, manometers, uthUnits] = await Promise.all([
      collabIds.length ? tx.collaborator.findMany({ where: { id: { in: collabIds } } }) : Promise.resolve([]),
      manoIds.length ? tx.manometer.findMany({ where: { id: { in: manoIds } } }) : Promise.resolve([]),
      uthIds.length ? tx.unit.findMany({ where: { id: { in: uthIds } } }) : Promise.resolve([])
    ]);

    const daytimeIds = new Set((report.collaborators || []).map(link => link.collaboratorId).filter(Boolean));
    const nighttimeIds = new Set(
      (((report.specialConditions || {}).noturnoDetails || {}).collaboratorIds || []).filter(Boolean)
    );
    const resolvedCollaborators = collaborators.map(c => {
      const inDay = daytimeIds.has(c.id);
      const inNight = nighttimeIds.has(c.id);
      const shift = inDay && inNight ? 'Diurno e Noturno' : (inNight ? 'Noturno' : 'Diurno');
      return { id: c.id, name: c.name, role: c.role, shift };
    });
    const resolvedManometers = manometers.map(m => ({
      id: m.id,
      code: m.code,
      scale: m.scale,
      certCode: m.calibrationCertCode,
      calibratedAt: m.calibratedAt ? m.calibratedAt.toISOString().slice(0, 10) : '',
      expiresAt: m.expiresAt ? m.expiresAt.toISOString().slice(0, 10) : ''
    }));
    const resolvedUnits = uthUnits.map(u => u.code);

    const rtpPayload = {
      projectId: report.projectId,
      createdByUserId: report.createdByUserId,
      reviewedByUserId: report.reviewedByUserId,
      reportType: ReportType.RTP,
      status: ReportStatus.APPROVED,
      reportDate: report.reportDate,
      arrivalTime: service.startTime || report.arrivalTime,
      departureTime: service.endTime || report.departureTime,
      lunchBreak: report.lunchBreak,
      daytimeCount: resolvedCollaborators.length || report.daytimeCount,
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0,
      nighttimeOvertimeMinutes: 0,
      totalOvertimeMinutes: 0,
      approvedAt: report.approvedAt || new Date(),
      specialConditions: {
        parentRdoId: report.id,
        serviceId: service.id,
        serviceLinkKey: serviceLinkKey || String(service.id),
        serviceData: fields,
        resolvedCollaborators,
        resolvedManometers,
        resolvedUnits
      }
    };

    const existingRtp = serviceLinkKey ? existingByLinkKey.get(serviceLinkKey) : null;

    if (existingRtp) {
      await tx.reportCollaborator.deleteMany({ where: { reportId: existingRtp.id } });
      await tx.reportService.deleteMany({ where: { reportId: existingRtp.id } });
      await tx.report.update({
        where: { id: existingRtp.id },
        data: {
          ...rtpPayload,
          collaborators: {
            create: collabIds.map(id => ({ collaboratorId: id }))
          },
          services: {
            create: [{
              serviceType: service.serviceType,
              equipmentId: service.equipmentId || null,
              system: service.system || null,
              material: service.material || null,
              startTime: service.startTime || null,
              endTime: service.endTime || null,
              finalized: true,
              extraData: fields
            }]
          }
        }
      });
      continue;
    }

    const rtpSeq = await reserveSequence(tx, report.projectId, ReportType.RTP);

    await tx.report.create({
      data: {
        ...rtpPayload,
        sequenceNumber: rtpSeq,
        collaborators: {
          create: collabIds.map(id => ({ collaboratorId: id }))
        },
        services: {
          create: [{
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: true,
            extraData: fields
          }]
        }
      }
    });
  }
}

async function syncApprovedRlqReports(tx, report) {
  if (!report || report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED) {
    return;
  }

  const limpezaServices = (report.services || []).filter(
    service => service.serviceType === 'limpeza' && service.finalized === true
  );

  if (!limpezaServices.length) {
    return;
  }

  const existingRlqs = await tx.report.findMany({
    where: {
      projectId: report.projectId,
      reportType: ReportType.RLQ
    },
    select: {
      id: true,
      sequenceNumber: true,
      specialConditions: true
    }
  });

  const existingByLinkKey = new Map();
  existingRlqs.forEach(item => {
    const special = item.specialConditions || {};
    if (special.parentRdoId !== report.id) return;
    const linkKey = String(special.serviceLinkKey || special.serviceId || '').trim();
    if (linkKey) existingByLinkKey.set(linkKey, item);
  });

  for (const service of limpezaServices) {
    const fields = service.extraData || {};
    const serviceLinkKey = String(
      fields.__serviceLinkKey ||
      fields.__sourceServiceId ||
      service.id ||
      ''
    ).trim();

    const collabField =
      fields['Colaboradores do serviço'] ||
      fields['Colaboradores do serviÃ§o'] ||
      fields['Colaboradores do servico'];
    const collabIds = Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [];

    const ulqField =
      fields['Unidade de Limpeza Química'] ||
      fields['Unidade de Limpeza QuÃ­mica'] ||
      fields['Unidade de Limpeza Quimica'];
    const ulqIds = Array.isArray(ulqField?.ids) ? ulqField.ids.filter(Boolean)
      : (ulqField && typeof ulqField === 'string' ? [ulqField] : []);

    const [collaborators, ulqUnits] = await Promise.all([
      collabIds.length ? tx.collaborator.findMany({ where: { id: { in: collabIds } } }) : Promise.resolve([]),
      ulqIds.length ? tx.unit.findMany({ where: { id: { in: ulqIds } } }) : Promise.resolve([])
    ]);

    const daytimeIds = new Set((report.collaborators || []).map(link => link.collaboratorId).filter(Boolean));
    const nighttimeIds = new Set(
      (((report.specialConditions || {}).noturnoDetails || {}).collaboratorIds || []).filter(Boolean)
    );
    const resolvedCollaborators = collaborators.map(c => {
      const inDay = daytimeIds.has(c.id);
      const inNight = nighttimeIds.has(c.id);
      const shift = inDay && inNight ? 'Diurno e Noturno' : (inNight ? 'Noturno' : 'Diurno');
      return { id: c.id, name: c.name, role: c.role, shift };
    });
    const resolvedUnits = ulqUnits.map(u => u.code);

    const rlqPayload = {
      projectId: report.projectId,
      createdByUserId: report.createdByUserId,
      reviewedByUserId: report.reviewedByUserId,
      reportType: ReportType.RLQ,
      status: ReportStatus.APPROVED,
      reportDate: report.reportDate,
      arrivalTime: service.startTime || report.arrivalTime,
      departureTime: service.endTime || report.departureTime,
      lunchBreak: report.lunchBreak,
      daytimeCount: resolvedCollaborators.length || report.daytimeCount,
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0,
      nighttimeOvertimeMinutes: 0,
      totalOvertimeMinutes: 0,
      approvedAt: report.approvedAt || new Date(),
      specialConditions: {
        parentRdoId: report.id,
        serviceId: service.id,
        serviceLinkKey: serviceLinkKey || String(service.id),
        serviceData: fields,
        resolvedCollaborators,
        resolvedUnits
      }
    };

    const existingRlq = serviceLinkKey ? existingByLinkKey.get(serviceLinkKey) : null;

    if (existingRlq) {
      await tx.reportCollaborator.deleteMany({ where: { reportId: existingRlq.id } });
      await tx.reportService.deleteMany({ where: { reportId: existingRlq.id } });
      await tx.report.update({
        where: { id: existingRlq.id },
        data: {
          ...rlqPayload,
          collaborators: {
            create: collabIds.map(id => ({ collaboratorId: id }))
          },
          services: {
            create: [{
              serviceType: service.serviceType,
              equipmentId: service.equipmentId || null,
              system: service.system || null,
              material: service.material || null,
              startTime: service.startTime || null,
              endTime: service.endTime || null,
              finalized: true,
              extraData: fields
            }]
          }
        }
      });
      continue;
    }

    const rlqSeq = await reserveSequence(tx, report.projectId, ReportType.RLQ);

    await tx.report.create({
      data: {
        ...rlqPayload,
        sequenceNumber: rlqSeq,
        collaborators: {
          create: collabIds.map(id => ({ collaboratorId: id }))
        },
        services: {
          create: [{
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: true,
            extraData: fields
          }]
        }
      }
    });
  }
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const where = {};

  if (req.query.status) {
    where.status = req.query.status;
  }

  if (req.query.projectId) {
    where.projectId = String(req.query.projectId);
  }

  if (req.query.createdByUserId) {
    where.createdByUserId = String(req.query.createdByUserId);
  }

  if (req.query.mine === 'true') {
    const me = await prisma.user.findUnique({
      where: { id: req.auth.user.id },
      select: { collaboratorId: true }
    });
    const collabId = me?.collaboratorId;
    if (collabId) {
      where.OR = [
        { createdByUserId: req.auth.user.id },
        { collaborators: { some: { collaboratorId: collabId } } }
      ];
    } else {
      where.createdByUserId = req.auth.user.id;
    }
  }

  const items = await prisma.report.findMany({
    where,
    include,
    orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }]
  });
  res.json(items);
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });

  if (!canAccessReport(req.auth, item)) {
    return res.status(403).json({ error: 'Voce nao tem permissao para acessar este relatorio.' });
  }

  res.json(item);
}));

router.get('/:id/pdf', requireAuth, asyncHandler(async (req, res) => {
  const item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });

  if (!canAccessReport(req.auth, item)) {
    return res.status(403).json({ error: 'Voce nao tem permissao para acessar este relatorio.' });
  }

  let saved;
  if (item.reportType === 'RTP') saved = await saveRtpPdf(item);
  else if (item.reportType === 'RLQ') saved = await saveRlqPdf(item);
  else saved = await saveReportPdf(item);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(saved.fileName));
  res.send(await fs.readFile(saved.targetPath));
}));

router.get('/:id/docx', requireAuth, asyncHandler(async (req, res) => {
  const item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });

  if (!canAccessReport(req.auth, item)) {
    return res.status(403).json({ error: 'Voce nao tem permissao para acessar este relatorio.' });
  }

  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode baixar o DOCX.' });
  }

  let saved;
  if (item.reportType === 'RTP') saved = await saveRtpDocx(item);
  else if (item.reportType === 'RLQ') saved = await saveRlqDocx(item);
  else saved = await saveReportDocx(item);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', contentDisposition(saved.fileName));
  res.send(await fs.readFile(saved.targetPath));
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const collaboratorIds = uniqueIds(data.collaboratorIds);
  const pendingDerivedTypes = collectPendingDerivedTypes(data.services);
  const item = await prisma.$transaction(async tx => {
    const project = await tx.project.findUniqueOrThrow({
      where: { id: data.projectId }
    });
    const sequenceNumber = await reserveSequence(tx, data.projectId, data.reportType);
    const overtime = calculateReportOvertime(project, data);

    const created = await tx.report.create({
      data: {
        projectId: data.projectId,
        createdByUserId: data.createdByUserId,
        reportType: data.reportType,
        sequenceNumber,
        status: data.status,
        reportDate: new Date(data.reportDate),
        arrivalTime: data.arrivalTime,
        departureTime: data.departureTime,
        lunchBreak: data.lunchBreak,
        daytimeCount: data.daytimeCount,
        daytimeWorkedMinutes: overtime.daytimeWorkedMinutes,
        nighttimeWorkedMinutes: overtime.nighttimeWorkedMinutes,
        daytimeOvertimeMinutes: overtime.daytimeOvertimeMinutes,
        nighttimeOvertimeMinutes: overtime.nighttimeOvertimeMinutes,
        totalOvertimeMinutes: overtime.totalOvertimeMinutes,
        overtimeReason: data.overtimeReason || null,
        dailyDescription: data.dailyDescription || null,
        reviewedByUserId: data.status === ReportStatus.APPROVED ? req.auth.user.id : null,
        approvedAt: data.status === ReportStatus.APPROVED ? new Date() : null,
        specialConditions: {
          ...(data.specialConditions || {}),
          overtimeSummary: overtime
        },
        pendingDerivedTypes,
        collaborators: {
          create: collaboratorIds.map(collaboratorId => ({ collaboratorId }))
        },
        services: {
          create: data.services.map(service => ({
            serviceType: service.serviceType,
            equipmentId: null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: typeof service.finalized === 'boolean' ? service.finalized : null,
            extraData: service.extraData || {}
          }))
        }
      },
      include
    });

    await syncApprovedRtpReports(tx, created);
    await syncApprovedRlqReports(tx, created);
    return created;
  });
  await organizeAndPersist(item);
  if (item.reportType === 'RDO' && item.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: { projectId: item.projectId, reportType: { in: [ReportType.RTP, ReportType.RLQ] } },
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === item.id) await organizeAndPersist(d);
    }
  }
  res.status(201).json(item);
}));

router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const collaboratorIds = uniqueIds(data.collaboratorIds);
  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id }
  });

  if (req.auth.user.role !== 'MANAGER' && existing.createdByUserId !== req.auth.user.id) {
    return res.status(403).json({ error: 'Voce so pode editar relatorios criados por voce.' });
  }

  const item = await prisma.$transaction(async tx => {
    const project = await tx.project.findUniqueOrThrow({
      where: { id: data.projectId }
    });
    const overtime = calculateReportOvertime(project, data);
    await tx.reportCollaborator.deleteMany({ where: { reportId: req.params.id } });
    await tx.reportService.deleteMany({ where: { reportId: req.params.id } });

    const updated = await tx.report.update({
      where: { id: req.params.id },
      data: {
        projectId: data.projectId,
        reportType: data.reportType,
        reportDate: new Date(data.reportDate),
        arrivalTime: data.arrivalTime,
        departureTime: data.departureTime,
        lunchBreak: data.lunchBreak,
        daytimeCount: data.daytimeCount,
        daytimeWorkedMinutes: overtime.daytimeWorkedMinutes,
        nighttimeWorkedMinutes: overtime.nighttimeWorkedMinutes,
        daytimeOvertimeMinutes: overtime.daytimeOvertimeMinutes,
        nighttimeOvertimeMinutes: overtime.nighttimeOvertimeMinutes,
        totalOvertimeMinutes: overtime.totalOvertimeMinutes,
        overtimeReason: data.overtimeReason || null,
        dailyDescription: data.dailyDescription || null,
        specialConditions: {
          ...(data.specialConditions || {}),
          overtimeSummary: overtime
        },
        pendingDerivedTypes: collectPendingDerivedTypes(data.services),
        status: req.auth.user.role === 'MANAGER' ? existing.status : ReportStatus.PENDING,
        reviewNotes: req.auth.user.role === 'MANAGER' ? existing.reviewNotes : 'Editado pelo colaborador',
        reviewedByUserId: req.auth.user.role === 'MANAGER' ? existing.reviewedByUserId : null,
        returnedAt: req.auth.user.role === 'MANAGER' ? existing.returnedAt : null,
        approvedAt: req.auth.user.role === 'MANAGER' ? existing.approvedAt : null,
        collaborators: {
          create: collaboratorIds.map(collaboratorId => ({ collaboratorId }))
        },
        services: {
          create: data.services.map(service => ({
            serviceType: service.serviceType,
            equipmentId: null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: typeof service.finalized === 'boolean' ? service.finalized : null,
            extraData: service.extraData || {}
          }))
        }
      },
      include
    });

    await syncApprovedRtpReports(tx, updated);
    await syncApprovedRlqReports(tx, updated);
    return updated;
  });

  await organizeAndPersist(item);
  if (item.reportType === 'RDO' && item.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: { projectId: item.projectId, reportType: { in: [ReportType.RTP, ReportType.RLQ] } },
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === item.id) await organizeAndPersist(d);
    }
  }
  res.json(item);
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode excluir relatorios.' });
  }

  const item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    select: {
      id: true,
      projectId: true,
      reportType: true,
      specialConditions: true
    }
  });

  await prisma.$transaction(async tx => {
    const idsToDelete = [item.id];

    if (item.reportType === ReportType.RDO) {
      const derivedReports = await tx.report.findMany({
        where: {
          projectId: item.projectId,
          reportType: { in: [ReportType.RTP, ReportType.RLQ] }
        },
        select: {
          id: true,
          specialConditions: true
        }
      });

      derivedReports.forEach(report => {
        const special = report.specialConditions || {};
        if (special.parentRdoId === item.id) {
          idsToDelete.push(report.id);
        }
      });
    }

    await tx.report.deleteMany({
      where: {
        id: { in: Array.from(new Set(idsToDelete)) }
      }
    });
  });

  res.status(204).end();
}));

router.patch('/:id/status', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode revisar relatorios.' });
  }

  const data = statusSchema.parse(req.body);

  const item = await prisma.$transaction(async tx => {
    const previous = await tx.report.findUnique({ where: { id: req.params.id }, select: { status: true } });

    const updated = await tx.report.update({
      where: { id: req.params.id },
      data: {
        status: data.status,
        reviewNotes: data.reviewNotes || null,
        reviewedByUserId: req.auth.user.id,
        approvedAt: data.status === ReportStatus.APPROVED ? new Date() : null,
        returnedAt: data.status === ReportStatus.RETURNED ? new Date() : null
      },
      include
    });

    

    if (data.status === ReportStatus.APPROVED && previous?.status !== ReportStatus.APPROVED) {
      await syncApprovedRtpReports(tx, updated);
      await syncApprovedRlqReports(tx, updated);
    }

    return updated;
  });

  if (data.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: { projectId: item.projectId, reportType: { in: [ReportType.RTP, ReportType.RLQ] } },
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === item.id) await organizeAndPersist(d);
    }
  }
  res.json(item);
}));

export default router;
