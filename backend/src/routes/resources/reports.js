import { Router } from 'express';
import fs from 'node:fs/promises';
import { ReportStatus, ReportType } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { saveReportDocx } from '../../lib/report-docx.js';
import { saveReportPdf } from '../../lib/report-pdf-from-docx.js';
import { saveRtpDocx, saveRtpPdf } from '../../lib/report-rtp.js';
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

  const saved = item.reportType === 'RTP' ? await saveRtpPdf(item) : await saveReportPdf(item);
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

  const saved = item.reportType === 'RTP' ? await saveRtpDocx(item) : await saveReportDocx(item);
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

    return tx.report.create({
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
  });
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

    return tx.report.update({
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
  });

  res.json(item);
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

    // Auto-create RTP records for finalized pressao services when approving an RDO for the first time
    if (
      data.status === ReportStatus.APPROVED &&
      previous?.status !== ReportStatus.APPROVED &&
      updated.reportType === 'RDO'
    ) {
      const pressaoServices = (updated.services || []).filter(
        s => s.serviceType === 'pressao' && s.finalized === true
      );

      for (const service of pressaoServices) {
        const fields = service.extraData || {};

        const collabField = fields['Colaboradores do serviço'] || fields['Colaboradores do servico'];
        const collabIds = Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [];

        const manoField = fields['Manômetros utilizados'] || fields['Manometros utilizados'];
        const manoIds = Array.isArray(manoField?.ids) ? manoField.ids.filter(Boolean) : [];

        const uthField = fields['Unidade de Teste Hidrostático (UTH)'] ||
                         fields['Unidade de Teste Hidrostatico (UTH)'];
        const uthIds = Array.isArray(uthField?.ids) ? uthField.ids.filter(Boolean)
                     : (uthField && typeof uthField === 'string' ? [uthField] : []);

        const [collaborators, manometers, uthUnits] = await Promise.all([
          collabIds.length ? tx.collaborator.findMany({ where: { id: { in: collabIds } } }) : Promise.resolve([]),
          manoIds.length ? tx.manometer.findMany({ where: { id: { in: manoIds } } }) : Promise.resolve([]),
          uthIds.length ? tx.unit.findMany({ where: { id: { in: uthIds } } }) : Promise.resolve([])
        ]);

        const daytimeIds = new Set((updated.collaborators || []).map(link => link.collaboratorId).filter(Boolean));
        const nighttimeIds = new Set(
          (((updated.specialConditions || {}).noturnoDetails || {}).collaboratorIds || []).filter(Boolean)
        );
        const resolvedCollaborators = collaborators.map(c => {
          const inDay = daytimeIds.has(c.id);
          const inNight = nighttimeIds.has(c.id);
          const shift = inDay && inNight ? 'Diurno e Noturno' : (inNight ? 'Noturno' : 'Diurno');
          return { id: c.id, name: c.name, role: c.role, shift };
        });
        const resolvedManometers = manometers.map(m => ({
          id: m.id, code: m.code, scale: m.scale,
          certCode: m.calibrationCertCode,
          calibratedAt: m.calibratedAt ? m.calibratedAt.toISOString().slice(0, 10) : '',
          expiresAt: m.expiresAt ? m.expiresAt.toISOString().slice(0, 10) : ''
        }));
        const resolvedUnits = uthUnits.map(u => u.code);

        const rtpSeq = await reserveSequence(tx, updated.projectId, 'RTP');

        await tx.report.create({
          data: {
            projectId: updated.projectId,
            createdByUserId: updated.createdByUserId,
            reportType: 'RTP',
            sequenceNumber: rtpSeq,
            status: ReportStatus.APPROVED,
            reportDate: updated.reportDate,
            arrivalTime: service.startTime || updated.arrivalTime,
            departureTime: service.endTime || updated.departureTime,
            lunchBreak: updated.lunchBreak,
            daytimeCount: resolvedCollaborators.length || updated.daytimeCount,
            daytimeWorkedMinutes: 0,
            nighttimeWorkedMinutes: 0,
            daytimeOvertimeMinutes: 0,
            nighttimeOvertimeMinutes: 0,
            totalOvertimeMinutes: 0,
            approvedAt: new Date(),
            specialConditions: {
              parentRdoId: updated.id,
              serviceId: service.id,
              serviceData: fields,
              resolvedCollaborators,
              resolvedManometers,
              resolvedUnits
            },
            ...(collabIds.length ? {
              collaborators: { create: collabIds.map(id => ({ collaboratorId: id })) }
            } : {})
          }
        });
      }
    }

    return updated;
  });

  res.json(item);
}));

export default router;
