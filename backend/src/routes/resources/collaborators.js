import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { ensureCollaboratorSignatureDataUrl, isSignatureDataUrl, normalizeSignatureValue } from '../../lib/signature-image.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const schema = z.object({
  code: z.string().trim().min(1).optional(),
  name: z.string().min(1),
  role: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')).transform(v => v || null),
  signatureImage: z.string().optional().or(z.literal('')).transform(v => v || null),
  isActive: z.boolean().default(true)
});

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
  const items = await prisma.collaborator.findMany({ orderBy: { name: 'asc' } });
  const normalized = [];
  for (const item of items) {
    normalized.push(await ensureCollaboratorSignatureDataUrl(prisma, item));
  }
  res.json(normalized);
}));

router.post('/', requireManager, asyncHandler(async (req, res) => {
  const parsed = schema.parse(req.body);
  const code = parsed.code || await generateCollaboratorCode();
  const data = await normalizeCollaboratorInput({ ...parsed, code });
  const existing = await prisma.collaborator.findUnique({ where: { code } });
  if (existing && !existing.isActive) {
    const item = await prisma.collaborator.update({
      where: { id: existing.id },
      data: { ...data, isActive: true }
    });
    return res.status(200).json(item);
  }
  if (existing) {
    return res.status(409).json({ error: 'Já existe um colaborador com esse identificador interno.' });
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
