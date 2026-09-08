import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import {
  listCollaboratorsWithCurrentJobRole,
  markFutureAllocationsForReplanning,
  requireCanonicalJobRole,
  withCurrentJobRole
} from '../../lib/collaborators/job-role-service.js';
import {
  collaboratorJobRoleHistoryInclude,
  synchronizeCurrentCollaboratorJobRole,
  validateCollaboratorRoleEffectiveDate
} from '../../lib/collaborators/job-role-history.js';
import prisma from '../../lib/prisma.js';
import { COLLABORATOR_SIGNATURE_NOTICE_VERSION } from '../../lib/privacy-consent.js';
import { collaboratorsCache } from '../../lib/resource-list-cache.js';
import { ensureCollaboratorSignatureDataUrl, isSignatureDataUrl, normalizeSignatureValue } from '../../lib/signature-image.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const optionalNullableEmail = z.union([z.string().trim().email(), z.literal(''), z.null()])
  .optional()
  .transform(value => value || null);
const optionalNullableString = z.union([z.string(), z.null()])
  .optional()
  .transform(value => value || null);
const optionalNullableDate = z.union([z.string().date(), z.literal(''), z.null()])
  .optional()
  .transform(value => value ? new Date(`${value}T00:00:00.000Z`) : null);
const optionalEffectiveDate = z.string().date().optional()
  .transform(value => value ? new Date(`${value}T00:00:00.000Z`) : undefined);

export const collaboratorSchema = z.object({
  code: z.string().trim().min(1).optional(),
  name: z.string().min(1),
  jobRoleId: z.string().trim().min(1),
  jobRoleEffectiveDate: optionalEffectiveDate,
  email: optionalNullableEmail,
  signatureImage: optionalNullableString,
  signatureNoticeAccepted: z.literal(true).optional(),
  signatureNoticeVersion: z.string().trim().min(1).max(80).optional(),
  terminationDate: optionalNullableDate,
  isActive: z.boolean().default(true)
});

const jobRoleHistorySchema = z.object({
  jobRoleId: z.string().trim().min(1),
  effectiveDate: z.string().date().transform(value => new Date(`${value}T00:00:00.000Z`)),
  note: z.string().trim().max(1000).nullable().optional()
});

const collaboratorWithRoleHistoryInclude = {
  jobRole: true,
  jobRoleHistory: {
    include: collaboratorJobRoleHistoryInclude,
    orderBy: { effectiveDate: 'desc' }
  }
};

async function collaboratorWithRoleHistory(database, collaboratorId) {
  const collaborator = await database.collaborator.findUniqueOrThrow({
    where: { id: collaboratorId },
    include: collaboratorWithRoleHistoryInclude
  });
  return withCurrentJobRole(collaborator);
}

async function saveRoleHistory(database, collaborator, input, historyId = null, options = {}) {
  await requireCanonicalJobRole(database, input.jobRoleId, { requireActive: options.allowInactive !== true });
  const effectiveDate = validateCollaboratorRoleEffectiveDate(collaborator, input.effectiveDate);
  const collision = await database.collaboratorJobRoleHistory.findFirst({
    where: {
      collaboratorId: collaborator.id,
      effectiveDate,
      ...(historyId ? { id: { not: historyId } } : {})
    },
    select: { id: true }
  });
  if (collision) {
    throw Object.assign(new Error('Já existe uma mudança de cargo nessa data.'), { status: 409, statusCode: 409 });
  }
  const data = {
    collaboratorId: collaborator.id,
    jobRoleId: input.jobRoleId,
    effectiveDate,
    note: String(input.note || '').trim() || null
  };
  if (historyId) {
    const existing = await database.collaboratorJobRoleHistory.findFirst({
      where: { id: historyId, collaboratorId: collaborator.id },
      select: { id: true }
    });
    if (!existing) throw Object.assign(new Error('Mudança de cargo não encontrada.'), { status: 404, statusCode: 404 });
    await database.collaboratorJobRoleHistory.update({ where: { id: historyId }, data });
  } else {
    await database.collaboratorJobRoleHistory.create({ data });
  }
  return synchronizeCurrentCollaboratorJobRole(database, collaborator.id);
}

export function buildCollaboratorSignatureNoticeData(input, existing = null, now = new Date()) {
  const {
    signatureNoticeAccepted,
    signatureNoticeVersion,
    ...data
  } = input;

  if (!Object.hasOwn(input, 'signatureImage')) {
    return { data, shouldLogNotice: false, noticeVersion: null };
  }

  if (!data.signatureImage) {
    return {
      data: {
        ...data,
        signatureNoticeAcceptedAt: null,
        signatureNoticeVersion: null
      },
      shouldLogNotice: false,
      noticeVersion: null
    };
  }

  const alreadyCurrent = Boolean(
    existing?.signatureImage === data.signatureImage &&
    existing?.signatureNoticeAcceptedAt &&
    existing?.signatureNoticeVersion === COLLABORATOR_SIGNATURE_NOTICE_VERSION
  );

  if (alreadyCurrent) {
    return { data, shouldLogNotice: false, noticeVersion: null };
  }

  if (signatureNoticeAccepted !== true || signatureNoticeVersion !== COLLABORATOR_SIGNATURE_NOTICE_VERSION) {
    const error = new Error('Aceite o aviso de privacidade da assinatura do colaborador.');
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }

  return {
    data: {
      ...data,
      signatureNoticeAcceptedAt: now,
      signatureNoticeVersion: COLLABORATOR_SIGNATURE_NOTICE_VERSION
    },
    shouldLogNotice: true,
    noticeVersion: COLLABORATOR_SIGNATURE_NOTICE_VERSION
  };
}

async function generateCollaboratorCode() {
  const prefix = 'COL-';
  const collaborators = await prisma.collaborator.findMany({
    select: { code: true },
    where: { code: { startsWith: prefix } }
  });
  const used = new Set(
    collaborators
      .map(item => Number.parseInt(String(item.code || '').slice(prefix.length), 10))
      .filter(Number.isFinite)
  );
  let next = 1;
  while (used.has(next)) next += 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

async function normalizeCollaboratorInput(data) {
  if (data.signatureImage === undefined) return data;
  if (!data.signatureImage) return { ...data, signatureImage: null };
  if (isSignatureDataUrl(data.signatureImage)) return data;
  const normalizedSignature = await normalizeSignatureValue(data.signatureImage);
  return {
    ...data,
    signatureImage: normalizedSignature || null
  };
}

router.get('/', requireInternalUser, asyncHandler(async (_req, res) => {
  const normalized = await collaboratorsCache.get(() => listCollaboratorsWithCurrentJobRole(
    prisma,
    item => ensureCollaboratorSignatureDataUrl(prisma, item)
  ));
  res.json(normalized);
}));

router.post('/', requireManager, asyncHandler(async (req, res) => {
  const parsed = collaboratorSchema.parse(req.body);
  const code = parsed.code || await generateCollaboratorCode();
  const { jobRoleEffectiveDate, ...collaboratorInput } = parsed;
  const data = await normalizeCollaboratorInput({ ...collaboratorInput, code });
  const existing = await prisma.collaborator.findUnique({ where: { code } });
  if (existing && existing.isActive) {
    return res.status(409).json({ error: 'Já existe um colaborador com esse identificador interno.' });
  }
  const notice = buildCollaboratorSignatureNoticeData(data, existing);
  if (existing && !existing.isActive) {
    const item = await prisma.$transaction(async tx => {
      await requireCanonicalJobRole(tx, notice.data.jobRoleId);
      const updated = await tx.collaborator.update({
        where: { id: existing.id },
        data: { ...notice.data, jobRoleId: existing.jobRoleId, isActive: true }
      });
      if (existing.jobRoleId !== notice.data.jobRoleId) {
        const effectiveDate = jobRoleEffectiveDate || new Date();
        const sameDate = await tx.collaboratorJobRoleHistory.findFirst({
          where: { collaboratorId: updated.id, effectiveDate: validateCollaboratorRoleEffectiveDate(updated, effectiveDate) },
          select: { id: true }
        });
        const synced = await saveRoleHistory(tx, updated, {
          jobRoleId: notice.data.jobRoleId,
          effectiveDate
        }, sameDate?.id || null);
        if (synced.changed) await markFutureAllocationsForReplanning(tx, updated.id, synced.collaborator.jobRoleId);
      }
      if (notice.shouldLogNotice) {
        await tx.collaboratorSignatureNoticeLog.create({
          data: {
            collaboratorId: updated.id,
            userId: req.auth?.user?.id || null,
            noticeVersion: notice.noticeVersion
          }
        });
      }
      return collaboratorWithRoleHistory(tx, updated.id);
    });
    collaboratorsCache.clear();
    return res.status(200).json(item);
  }
  const item = await prisma.$transaction(async tx => {
    await requireCanonicalJobRole(tx, notice.data.jobRoleId);
    const created = await tx.collaborator.create({ data: notice.data });
    await saveRoleHistory(tx, created, {
      jobRoleId: notice.data.jobRoleId,
      effectiveDate: jobRoleEffectiveDate || new Date()
    });
    if (notice.shouldLogNotice) {
      await tx.collaboratorSignatureNoticeLog.create({
        data: {
          collaboratorId: created.id,
          userId: req.auth?.user?.id || null,
          noticeVersion: notice.noticeVersion
        }
      });
    }
    return collaboratorWithRoleHistory(tx, created.id);
  });
  collaboratorsCache.clear();
  res.status(201).json(item);
}));

router.put('/:id', requireManager, asyncHandler(async (req, res) => {
  const parsed = collaboratorSchema.partial().parse(req.body);
  const { jobRoleEffectiveDate, ...collaboratorInput } = parsed;
  const data = await normalizeCollaboratorInput(collaboratorInput);
  const existing = await prisma.collaborator.findUniqueOrThrow({ where: { id: req.params.id } });
  const notice = buildCollaboratorSignatureNoticeData(data, existing);
  const item = await prisma.$transaction(async tx => {
    if (notice.data.jobRoleId) await requireCanonicalJobRole(tx, notice.data.jobRoleId);
    const requestedJobRoleId = notice.data.jobRoleId;
    const nonRoleData = { ...notice.data };
    delete nonRoleData.jobRoleId;
    const updated = await tx.collaborator.update({ where: { id: req.params.id }, data: nonRoleData });
    if (notice.data.jobRoleId && existing.jobRoleId !== notice.data.jobRoleId) {
      const effectiveDate = jobRoleEffectiveDate || new Date();
      const sameDate = await tx.collaboratorJobRoleHistory.findFirst({
        where: { collaboratorId: updated.id, effectiveDate: validateCollaboratorRoleEffectiveDate(updated, effectiveDate) },
        select: { id: true }
      });
      const synced = await saveRoleHistory(tx, updated, {
        jobRoleId: requestedJobRoleId,
        effectiveDate
      }, sameDate?.id || null);
      if (synced.changed) await markFutureAllocationsForReplanning(tx, updated.id, synced.collaborator.jobRoleId);
    }
    if (notice.shouldLogNotice) {
      await tx.collaboratorSignatureNoticeLog.create({
        data: {
          collaboratorId: updated.id,
          userId: req.auth?.user?.id || null,
          noticeVersion: notice.noticeVersion
        }
      });
    }
    return collaboratorWithRoleHistory(tx, updated.id);
  });
  collaboratorsCache.clear();
  res.json(item);
}));

router.put('/:id/job-role-history/:historyId', requireManager, asyncHandler(async (req, res) => {
  const input = jobRoleHistorySchema.parse(req.body);
  const item = await prisma.$transaction(async tx => {
    const collaborator = await tx.collaborator.findUniqueOrThrow({ where: { id: req.params.id } });
    const synced = await saveRoleHistory(tx, collaborator, input, req.params.historyId, { allowInactive: true });
    if (synced.changed) await markFutureAllocationsForReplanning(tx, collaborator.id, synced.collaborator.jobRoleId);
    return collaboratorWithRoleHistory(tx, collaborator.id);
  });
  collaboratorsCache.clear();
  res.json(item);
}));

router.delete('/:id/job-role-history/:historyId', requireManager, asyncHandler(async (req, res) => {
  const item = await prisma.$transaction(async tx => {
    const collaborator = await tx.collaborator.findUniqueOrThrow({ where: { id: req.params.id } });
    const history = await tx.collaboratorJobRoleHistory.findFirst({
      where: { id: req.params.historyId, collaboratorId: collaborator.id },
      select: { id: true }
    });
    if (!history) throw Object.assign(new Error('Mudança de cargo não encontrada.'), { status: 404, statusCode: 404 });
    const count = await tx.collaboratorJobRoleHistory.count({ where: { collaboratorId: collaborator.id } });
    if (count <= 1) {
      throw Object.assign(new Error('O único registro de cargo do colaborador não pode ser excluído.'), { status: 400, statusCode: 400 });
    }
    await tx.collaboratorJobRoleHistory.delete({ where: { id: history.id } });
    const synced = await synchronizeCurrentCollaboratorJobRole(tx, collaborator.id);
    if (synced.changed) await markFutureAllocationsForReplanning(tx, collaborator.id, synced.collaborator.jobRoleId);
    return collaboratorWithRoleHistory(tx, collaborator.id);
  });
  collaboratorsCache.clear();
  res.json(item);
}));

router.delete('/:id', requireManager, asyncHandler(async (req, res) => {
  await prisma.collaborator.update({ where: { id: req.params.id }, data: { isActive: false } });
  collaboratorsCache.clear();
  res.status(204).end();
}));

export default router;
