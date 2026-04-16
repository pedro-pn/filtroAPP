import { Router } from 'express';
import { ReportType } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { ensureClientAccountForProject } from '../../lib/client-account.js';
import { normalizeCnpj } from '../../lib/cnpj.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireManager } from '../../middleware/auth.js';

const router = Router();
const emailSchema = z.string().trim().email();

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  isActive: z.boolean().default(true),
  visibleToCollaborators: z.boolean().default(true),
  clientName: z.string().min(1),
  clientCnpj: z.string().min(1),
  clientEmailPrimary: z.union([emailSchema, z.literal('')]).default(''),
  clientEmailCc: z.array(emailSchema).default([]),
  contractCode: z.string().min(1),
  location: z.string().min(1),
  workdayHours: z.string().min(1).default('09:00'),
  weekendWorkdayHours: z.string().min(1).default('08:00'),
  includesSaturday: z.boolean().default(false),
  includesSunday: z.boolean().default(false),
  operatorId: z.string().nullable().optional(),
  reportSequences: z.array(z.object({
    reportType: z.nativeEnum(ReportType),
    nextNumber: z.number().int().nonnegative()
  })).default([])
});

function normalizeProjectInput(data) {
  const normalizedCnpj = normalizeCnpj(data.clientCnpj);
  if (!normalizedCnpj || normalizedCnpj.length !== 14) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ['clientCnpj'],
      message: 'CNPJ invalido. Informe 14 digitos.'
    }]);
  }

  const primary = String(data.clientEmailPrimary || '').trim().toLowerCase();
  const clientEmailCc = Array.from(new Set((data.clientEmailCc || [])
    .map(email => String(email || '').trim().toLowerCase())
    .filter(Boolean)
    .filter(email => email !== primary)));

  return {
    ...data,
    clientCnpj: normalizedCnpj,
    clientEmailPrimary: primary,
    clientEmailCc
  };
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const activeParam = req.query.active;
  const where = {};
  if (req.auth.user.role === 'MANAGER') {
    if (activeParam === 'true') where.isActive = true;
    if (activeParam === 'false') where.isActive = false;
  } else if (req.auth.user.role === 'CLIENT') {
    where.isActive = true;
    where.clientCnpj = req.auth.user.username;
  } else {
    const collaboratorId = req.auth.user.collaboratorId;
    where.isActive = true;
    where.visibleToCollaborators = true;
    where.operatorId = collaboratorId || '__NO_MATCH__';
  }

  const items = await prisma.project.findMany({
    where,
    include: {
      operator: true,
      reportSequences: true
    },
    orderBy: { name: 'asc' }
  });
  res.json(items);
}));

router.post('/', requireAuth, requireManager, asyncHandler(async (req, res) => {
  const data = normalizeProjectInput(schema.parse(req.body));
  const { reportSequences, ...projectData } = data;
  const item = await prisma.$transaction(async tx => {
    const created = await tx.project.create({
      data: {
        ...projectData,
        reportSequences: {
          create: reportSequences
        }
      },
      include: {
        operator: true,
        reportSequences: true
      }
    });
    await ensureClientAccountForProject(tx, created);
    return created;
  });
  res.status(201).json(item);
}));

router.put('/:id', requireAuth, requireManager, asyncHandler(async (req, res) => {
  const parsed = schema.partial().parse(req.body);
  let data = parsed;
  if (parsed.clientCnpj !== undefined || parsed.clientEmailPrimary !== undefined || parsed.clientEmailCc !== undefined) {
    const existingProject = await prisma.project.findUniqueOrThrow({
      where: { id: req.params.id },
      select: {
        clientCnpj: true,
        clientEmailPrimary: true,
        clientEmailCc: true
      }
    });
    data = normalizeProjectInput({
      ...parsed,
      clientCnpj: parsed.clientCnpj ?? existingProject.clientCnpj,
      clientEmailPrimary: parsed.clientEmailPrimary ?? existingProject.clientEmailPrimary,
      clientEmailCc: parsed.clientEmailCc ?? existingProject.clientEmailCc
    });
  }
  const { reportSequences, ...projectData } = data;

  const item = await prisma.$transaction(async tx => {
    const previousProject = await tx.project.findUniqueOrThrow({
      where: { id: req.params.id },
      select: {
        clientCnpj: true,
        clientEmailPrimary: true
      }
    });
    if (reportSequences) {
      await tx.projectReportSeq.deleteMany({ where: { projectId: req.params.id } });
    }

    const updated = await tx.project.update({
      where: { id: req.params.id },
      data: {
        ...projectData,
        ...(reportSequences
          ? {
              reportSequences: {
                create: reportSequences
              }
            }
          : {})
      },
      include: {
        operator: true,
        reportSequences: true
      }
    });
    await ensureClientAccountForProject(tx, updated, { previousProject });
    return updated;
  });

  res.json(item);
}));

router.delete('/:id', requireAuth, requireManager, asyncHandler(async (req, res) => {
  await prisma.project.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
