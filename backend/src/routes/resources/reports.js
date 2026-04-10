import { Router } from 'express';
import fs from 'node:fs/promises';
import { ReportStatus, ReportType } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { saveReportDocx } from '../../lib/report-docx.js';
import { saveReportPdf } from '../../lib/report-pdf-from-docx.js';
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
  return auth.user.role === 'MANAGER' || report.createdByUserId === auth.user.id;
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
    where.createdByUserId = req.auth.user.id;
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

  const saved = await saveReportPdf(item);
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

  const saved = await saveReportDocx(item);
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
  const item = await prisma.report.update({
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

  res.json(item);
}));

export default router;
