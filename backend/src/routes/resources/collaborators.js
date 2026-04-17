import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { ensureCollaboratorSignatureDataUrl, isSignatureDataUrl, normalizeSignatureValue } from '../../lib/signature-image.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')).transform(v => v || null),
  signatureImage: z.string().optional().or(z.literal('')).transform(v => v || null),
  isActive: z.boolean().default(true)
});

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
  const items = await prisma.collaborator.findMany({ orderBy: { name: 'asc' } });
  const normalized = [];
  for (const item of items) {
    normalized.push(await ensureCollaboratorSignatureDataUrl(prisma, item));
  }
  res.json(normalized);
}));

router.post('/', requireManager, asyncHandler(async (req, res) => {
  const data = await normalizeCollaboratorInput(schema.parse(req.body));
  const existing = await prisma.collaborator.findUnique({ where: { code: data.code } });
  if (existing && !existing.isActive) {
    const item = await prisma.collaborator.update({
      where: { id: existing.id },
      data: { ...data, isActive: true }
    });
    return res.status(200).json(item);
  }
  const item = await prisma.collaborator.create({ data });
  res.status(201).json(item);
}));

router.put('/:id', requireManager, asyncHandler(async (req, res) => {
  const data = await normalizeCollaboratorInput(schema.partial().parse(req.body));
  const item = await prisma.collaborator.update({ where: { id: req.params.id }, data });
  res.json(item);
}));

router.delete('/:id', requireManager, asyncHandler(async (req, res) => {
  await prisma.collaborator.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.status(204).end();
}));

export default router;
