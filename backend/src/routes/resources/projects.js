import { Router } from 'express';
import { AccountType, ReportType, UserRole } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { ensureClientAccountForProject, ensureClientCcAccounts } from '../../lib/client-account.js';
import { clientProjectAccessWhereWithSigners } from '../../lib/client-project-access.js';
import { normalizeCnpj } from '../../lib/cnpj.js';
import { invalidateUnsignedInternalSignatureRound, signatureEvidenceFromRequest } from '../../lib/internal-report-signatures.js';
import { ModuleRoleCodes } from '../../lib/module-roles.js';
import prisma from '../../lib/prisma.js';
import { clearPendingProjectLegacyExternalSignatureState, shouldProvisionProjectClientAccounts } from '../../lib/project-visibility.js';
import { statisticsProjectsCache } from '../../lib/resource-list-cache.js';
import { RDO_ACCESS_ROLES, requireAuth, requireManager, requireModuleRole } from '../../middleware/auth.js';
import { reconcileProjectClientSignatureRequirements } from './reports.js';

const router = Router();
const requireRdoAccess = requireModuleRole(...RDO_ACCESS_ROLES);
const emailSchema = z.string().trim().email();

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  isActive: z.boolean().default(true),
  visibleToCollaborators: z.boolean().default(true),
  managerOnly: z.boolean().default(false),
  inhibitionServiceEnabled: z.boolean().default(false),
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
  authorizedUserIds: z.array(z.string()).default([]),
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
  const signerEmails = clientSigners.map(s => s.email);
  const allClientEmailCc = Array.from(new Set([...clientEmailCc, ...signerEmails]))
    .filter(email => email !== primary);

  return {
    ...data,
    visibleToCollaborators: data.managerOnly ? false : data.visibleToCollaborators,
    clientCnpj: normalizedCnpj,
    clientEmailPrimary: primary,
    clientEmailCc: allClientEmailCc,
    clientSigners
  };
}

function uniqueIds(values = []) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

async function assertAuthorizedProjectUsers(userIds, prismaClient = prisma) {
  const ids = uniqueIds(userIds);
  if (!ids.length) return ids;
  const users = await prismaClient.user.findMany({
    where: {
      id: { in: ids },
      isActive: true,
      role: UserRole.COLLABORATOR,
      accountType: { in: [AccountType.INTERNAL, AccountType.ADMIN] },
      moduleRoles: { some: { role: ModuleRoleCodes.RDO_COLLABORATOR } }
    },
    select: { id: true }
  });
  if (users.length === ids.length) return ids;
  throw new z.ZodError([{
    code: z.ZodIssueCode.custom,
    path: ['authorizedUserIds'],
    message: 'Selecione apenas usuários internos ativos com perfil de colaborador RDO.'
  }]);
}

export async function assertActiveClientSegment(slug, prismaClient = prisma) {
  if (!slug) return;
  const segment = await prismaClient.clientSegment.findFirst({
    where: { slug, isActive: true },
    select: { id: true }
  });
  if (segment) return;
  throw new z.ZodError([{
    code: z.ZodIssueCode.custom,
    path: ['clientSegment'],
    message: 'Segmento inválido ou inativo.'
  }]);
}

export async function removeProjectById(projectId, prismaClient = prisma, options = {}) {
  await prismaClient.$transaction(async tx => {
    const reports = await tx.report.findMany({
      where: { projectId },
      select: { id: true }
    });
    const reportIds = reports.map(report => report.id);

    if (reportIds.length > 0) {
      if (options.userId) {
        for (const reportId of reportIds) {
          await invalidateUnsignedInternalSignatureRound(tx, {
            reportId,
            userId: options.userId,
            evidence: options.evidence || null,
            description: 'Rodada de assinatura invalidada por exclusao do projeto.',
            invalidateSignedRound: true
          });
        }
      }
      await tx.project.update({
        where: { id: projectId },
        data: {
          isActive: false,
          deletedAt: new Date()
        }
      });
      await clearPendingProjectLegacyExternalSignatureState(tx, projectId);
      return;
    }

    const romaneioCount = await tx.romaneio.count({ where: { projectId } });
    if (romaneioCount > 0) {
      await tx.project.update({
        where: { id: projectId },
        data: {
          isActive: false,
          deletedAt: new Date()
        }
      });
      await clearPendingProjectLegacyExternalSignatureState(tx, projectId);
      return;
    }

    await tx.reportDraft.updateMany({
      where: { projectId },
      data: { projectId: null }
    });
    await tx.satisfactionSurvey.deleteMany({ where: { projectId } });
    await tx.projectReportSeq.deleteMany({ where: { projectId } });

    await tx.project.delete({ where: { id: projectId } });
  });
}

async function invalidateProjectInternalSignatureRounds(tx, projectId, {
  userId = null,
  evidence = {},
  description = 'Rodada de assinatura invalidada por alteracao de visibilidade do projeto.'
} = {}) {
  const reports = await tx.report.findMany({
    where: {
      projectId,
      reportType: ReportType.RDO,
      status: { in: ['APPROVED', 'SIGNED'] },
      versions: { some: { status: 'ACTIVE', finalDocumentHash: null } }
    },
    select: { id: true }
  });

  for (const report of reports) {
    await invalidateUnsignedInternalSignatureRound(tx, {
      reportId: report.id,
      userId,
      evidence,
      description,
      invalidateSignedRound: true
    });
  }
}

export const projectListInclude = {
  operator: true,
  authorizedUsers: {
    include: {
      user: {
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          role: true,
          accountType: true,
          isActive: true,
          collaboratorId: true,
          collaborator: true,
          moduleRoles: true
        }
      }
    }
  },
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
      expirationNotifiedAt: true,
      createdAt: true
    }
  }
};

export async function projectListWhereForAuth(auth, activeParam, prismaClient = prisma) {
  const where = { deletedAt: null };
  if (auth.user.role === 'MANAGER') {
    if (activeParam === 'true') where.isActive = true;
    if (activeParam === 'false') where.isActive = false;
  } else if (auth.user.role === 'COORDINATOR') {
    where.managerOnly = false;
    if (activeParam === 'true') where.isActive = true;
    if (activeParam === 'false') where.isActive = false;
  } else if (auth.user.role === 'CLIENT') {
    Object.assign(where, await clientProjectAccessWhereWithSigners(prismaClient, auth));
    if (activeParam === 'true') where.isActive = true;
    if (activeParam === 'false') where.isActive = false;
  } else {
    const collaboratorId = auth.user.collaboratorId;
    where.isActive = true;
    where.managerOnly = false;
    where.OR = [
      {
        visibleToCollaborators: true,
        operatorId: collaboratorId || '__NO_MATCH__'
      },
      {
        authorizedUsers: {
          some: { userId: auth.user.id }
        }
      }
    ];
  }
  return where;
}

router.get('/', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  const where = await projectListWhereForAuth(req.auth, req.query.active);

  const items = await prisma.project.findMany({
    where,
    include: projectListInclude,
    orderBy: { name: 'asc' }
  });
  res.json(items);
}));

router.post('/', requireAuth, requireRdoAccess, requireManager, asyncHandler(async (req, res) => {
  const data = normalizeProjectInput(schema.parse(req.body));
  await assertActiveClientSegment(data.clientSegment);
  const authorizedUserIds = await assertAuthorizedProjectUsers(data.authorizedUserIds);
  const { reportSequences, authorizedUserIds: _authorizedUserIds, ...projectData } = data;
  const item = await prisma.$transaction(async tx => {
    const created = await tx.project.create({
      data: {
        ...projectData,
        authorizedUsers: {
          create: authorizedUserIds.map(userId => ({ userId }))
        },
        reportSequences: {
          create: reportSequences
        }
      },
      include: {
        operator: true,
        authorizedUsers: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                name: true,
                email: true,
                role: true,
                accountType: true,
                isActive: true,
                collaboratorId: true,
                collaborator: true,
                moduleRoles: true
              }
            }
          }
        },
        reportSequences: true
      }
    });
    if (shouldProvisionProjectClientAccounts(created)) {
      await ensureClientAccountForProject(tx, created);
      await ensureClientCcAccounts(tx, created);
    }
    return created;
  });
  statisticsProjectsCache.clear();
  res.status(201).json(item);
}));

router.put('/:id', requireAuth, requireRdoAccess, requireManager, asyncHandler(async (req, res) => {
  const parsed = schema.partial().parse(req.body);
  const shouldReconcileClientSigners = parsed.clientEmailPrimary !== undefined || parsed.clientSigners !== undefined;
  const shouldUpdateProjectVisibility = parsed.managerOnly !== undefined || parsed.isActive !== undefined;
  const evidence = shouldReconcileClientSigners || shouldUpdateProjectVisibility ? signatureEvidenceFromRequest(req) : null;
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
  if (data.clientSegment !== undefined) {
    await assertActiveClientSegment(data.clientSegment);
  }
  const authorizedUserIds = data.authorizedUserIds !== undefined
    ? await assertAuthorizedProjectUsers(data.authorizedUserIds)
    : null;
  const { reportSequences, authorizedUserIds: _authorizedUserIds, ...projectData } = data;

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
    if (authorizedUserIds) {
      await tx.projectAuthorizedUser.deleteMany({ where: { projectId: req.params.id } });
    }

    const updated = await tx.project.update({
      where: { id: req.params.id },
      data: {
        ...projectData,
        ...(authorizedUserIds
          ? {
              authorizedUsers: {
                create: authorizedUserIds.map(userId => ({ userId }))
              }
            }
          : {}),
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
        authorizedUsers: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                name: true,
                email: true,
                role: true,
                accountType: true,
                isActive: true,
                collaboratorId: true,
                collaborator: true,
                moduleRoles: true
              }
            }
          }
        },
        reportSequences: true
      }
    });
    if (!shouldProvisionProjectClientAccounts(updated)) {
      await invalidateProjectInternalSignatureRounds(tx, updated.id, {
        userId: req.auth.user.id,
        evidence,
        description: 'Rodada de assinatura invalidada por projeto oculto ou inativo.'
      });
      await clearPendingProjectLegacyExternalSignatureState(tx, updated.id);
    } else {
      await ensureClientAccountForProject(tx, updated, { previousProject });
      await ensureClientCcAccounts(tx, { ...updated, id: req.params.id }, { previousProject });
    }
    return updated;
  });

  if (shouldReconcileClientSigners) {
    await reconcileProjectClientSignatureRequirements(item.id, {
      userId: req.auth.user.id,
      evidence
    });
  }

  statisticsProjectsCache.clear();
  res.json(item);
}));

router.delete('/:id', requireAuth, requireRdoAccess, requireManager, asyncHandler(async (req, res) => {
  await removeProjectById(req.params.id, prisma, {
    userId: req.auth.user.id,
    evidence: signatureEvidenceFromRequest(req)
  });
  statisticsProjectsCache.clear();
  res.status(204).end();
}));

export default router;
