import { Router } from 'express';
import { ReportType } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { ensureClientAccountForProject, ensureClientCcAccounts } from '../../lib/client-account.js';
import { normalizeCnpj } from '../../lib/cnpj.js';
import prisma from '../../lib/prisma.js';
import { clearPendingProjectZapSignState, shouldProvisionProjectClientAccounts } from '../../lib/project-visibility.js';
import { requireAuth, requireManager } from '../../middleware/auth.js';

const router = Router();
const emailSchema = z.string().trim().email();

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  isActive: z.boolean().default(true),
  visibleToCollaborators: z.boolean().default(true),
  managerOnly: z.boolean().default(false),
  clientName: z.string().min(1),
  clientCnpj: z.string().min(1),
  clientEmailPrimary: z.union([emailSchema, z.literal('')]).default(''),
  clientEmailCc: z.array(emailSchema).default([]),
  clientSigners: z.array(z.object({
    name: z.string().min(1),
    email: emailSchema
  })).default([]),
  contractCode: z.string().min(1),
  location: z.string().min(1),
  workdayHours: z.string().min(1).default('09:00'),
  weekendWorkdayHours: z.string().min(1).default('08:00'),
  includesSaturday: z.boolean().default(false),
  includesSunday: z.boolean().default(false),
  operatorId: z.string().nullable().optional(),
  clientSegment: z.string().nullable().optional(),
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
      message: 'CNPJ inválido. Informe 14 dígitos.'
    }]);
  }

  const primary = String(data.clientEmailPrimary || '').trim().toLowerCase();
  const clientEmailCc = Array.from(new Set((data.clientEmailCc || [])
    .map(email => String(email || '').trim().toLowerCase())
    .filter(Boolean)
    .filter(email => email !== primary)));

  const seenSignerEmails = new Set();
  const clientSigners = (data.clientSigners || [])
    .map(s => ({ name: String(s.name || '').trim(), email: String(s.email || '').trim().toLowerCase() }))
    .filter(s => s.name && s.email && s.email !== primary)
    .filter(s => { if (seenSignerEmails.has(s.email)) return false; seenSignerEmails.add(s.email); return true; });

  return {
    ...data,
    visibleToCollaborators: data.managerOnly ? false : data.visibleToCollaborators,
    clientCnpj: normalizedCnpj,
    clientEmailPrimary: primary,
    clientEmailCc,
    clientSigners
  };
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const activeParam = req.query.active;
  const where = {};
  if (req.auth.user.role === 'MANAGER') {
    if (activeParam === 'true') where.isActive = true;
    if (activeParam === 'false') where.isActive = false;
  } else if (req.auth.user.role === 'COORDINATOR') {
    where.managerOnly = false;
    if (activeParam === 'true') where.isActive = true;
    if (activeParam === 'false') where.isActive = false;
  } else if (req.auth.user.role === 'CLIENT') {
    const userEmail = String(req.auth.user.email || '').trim().toLowerCase();
    where.managerOnly = false;
    if (activeParam === 'true') where.isActive = true;
    if (activeParam === 'false') where.isActive = false;
    where.OR = [
      { clientCnpj: req.auth.user.username },
      ...(userEmail ? [{ clientEmailPrimary: userEmail }] : []),
      ...(userEmail ? [{ clientEmailCc: { has: userEmail } }] : [])
    ];
  } else {
    const collaboratorId = req.auth.user.collaboratorId;
    where.isActive = true;
    where.visibleToCollaborators = true;
    where.managerOnly = false;
    where.operatorId = collaboratorId || '__NO_MATCH__';
  }

  const items = await prisma.project.findMany({
    where,
    include: {
      operator: true,
      reportSequences: true,
      surveys: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          projectId: true,
          emailTo: true,
          expiresAt: true,
          respondedAt: true,
          sentAt: true,
          lastReminderAt: true,
          reminderCount: true,
          reminderOptOutAt: true,
          createdAt: true
        }
      }
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
    if (shouldProvisionProjectClientAccounts(created)) {
      await ensureClientAccountForProject(tx, created);
      await ensureClientCcAccounts(tx, created);
    }
    return created;
  });
  res.status(201).json(item);
}));

router.put('/:id', requireAuth, requireManager, asyncHandler(async (req, res) => {
  const parsed = schema.partial().parse(req.body);
  let data = parsed;
  if (parsed.clientCnpj !== undefined || parsed.clientEmailPrimary !== undefined || parsed.clientEmailCc !== undefined || parsed.clientSigners !== undefined) {
    const existingProject = await prisma.project.findUniqueOrThrow({
      where: { id: req.params.id },
      select: {
        clientCnpj: true,
        clientEmailPrimary: true,
        clientEmailCc: true,
        clientSigners: true
      }
    });
    data = normalizeProjectInput({
      ...parsed,
      clientCnpj: parsed.clientCnpj ?? existingProject.clientCnpj,
      clientEmailPrimary: parsed.clientEmailPrimary ?? existingProject.clientEmailPrimary,
      clientEmailCc: parsed.clientEmailCc ?? existingProject.clientEmailCc,
      clientSigners: parsed.clientSigners ?? existingProject.clientSigners
    });
  }
  if (data.managerOnly === true) {
    data = { ...data, visibleToCollaborators: false };
  }
  const { reportSequences, ...projectData } = data;

  const item = await prisma.$transaction(async tx => {
    const previousProject = await tx.project.findUniqueOrThrow({
      where: { id: req.params.id },
      select: {
        clientCnpj: true,
        clientEmailPrimary: true,
        clientEmailCc: true,
        managerOnly: true
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
    if (!shouldProvisionProjectClientAccounts(updated)) {
      await clearPendingProjectZapSignState(tx, updated.id);
    } else {
      await ensureClientAccountForProject(tx, updated, { previousProject });
      await ensureClientCcAccounts(tx, { ...updated, id: req.params.id }, { previousProject });
    }
    return updated;
  });

  res.json(item);
}));

router.delete('/:id', requireAuth, requireManager, asyncHandler(async (req, res) => {
  await prisma.project.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
