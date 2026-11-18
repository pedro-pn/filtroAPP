import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
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

export const collaboratorSchema = z.object({
  code: z.string().trim().min(1).optional(),
  name: z.string().min(1),
  role: z.string().min(1),
  email: optionalNullableEmail,
  signatureImage: optionalNullableString,
  signatureNoticeAccepted: z.literal(true).optional(),
  signatureNoticeVersion: z.string().trim().min(1).max(80).optional(),
  isActive: z.boolean().default(true)
});

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
  const normalized = await collaboratorsCache.get(async () => {
    const items = await prisma.collaborator.findMany({ orderBy: { name: 'asc' } });
    const result = [];
    for (const item of items) {
      result.push(await ensureCollaboratorSignatureDataUrl(prisma, item));
    }
    return result;
  });
  res.json(normalized);
}));

router.post('/', requireManager, asyncHandler(async (req, res) => {
  const parsed = collaboratorSchema.parse(req.body);
  const code = parsed.code || await generateCollaboratorCode();
  const data = await normalizeCollaboratorInput({ ...parsed, code });
  const existing = await prisma.collaborator.findUnique({ where: { code } });
  if (existing && existing.isActive) {
    return res.status(409).json({ error: 'Já existe um colaborador com esse identificador interno.' });
  }
  const notice = buildCollaboratorSignatureNoticeData(data, existing);
  if (existing && !existing.isActive) {
    const item = await prisma.$transaction(async tx => {
      const updated = await tx.collaborator.update({
        where: { id: existing.id },
        data: { ...notice.data, isActive: true }
      });
      if (notice.shouldLogNotice) {
        await tx.collaboratorSignatureNoticeLog.create({
          data: {
            collaboratorId: updated.id,
            userId: req.auth?.user?.id || null,
            noticeVersion: notice.noticeVersion
          }
        });
      }
      return updated;
    });
    collaboratorsCache.clear();
    return res.status(200).json(item);
  }
  const item = await prisma.$transaction(async tx => {
    const created = await tx.collaborator.create({ data: notice.data });
    if (notice.shouldLogNotice) {
      await tx.collaboratorSignatureNoticeLog.create({
        data: {
          collaboratorId: created.id,
          userId: req.auth?.user?.id || null,
          noticeVersion: notice.noticeVersion
        }
      });
    }
    return created;
  });
  collaboratorsCache.clear();
  res.status(201).json(item);
}));

router.put('/:id', requireManager, asyncHandler(async (req, res) => {
  const data = await normalizeCollaboratorInput(collaboratorSchema.partial().parse(req.body));
  const existing = await prisma.collaborator.findUniqueOrThrow({ where: { id: req.params.id } });
  const notice = buildCollaboratorSignatureNoticeData(data, existing);
  const item = await prisma.$transaction(async tx => {
    const updated = await tx.collaborator.update({ where: { id: req.params.id }, data: notice.data });
    if (notice.shouldLogNotice) {
      await tx.collaboratorSignatureNoticeLog.create({
        data: {
          collaboratorId: updated.id,
          userId: req.auth?.user?.id || null,
          noticeVersion: notice.noticeVersion
        }
      });
    }
    return updated;
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
