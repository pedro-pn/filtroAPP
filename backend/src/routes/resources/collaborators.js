import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import env from '../../config/env.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

function safePath(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

// Move a assinatura da raiz de uploads para Assinaturas/ e retorna a nova URL relativa,
// ou null se a imagem já está na pasta correta ou não foi encontrada.
async function moveSignatureFile(signatureImage, name) {
  if (!signatureImage || !name) return null;
  let urlBase = '';
  let fileName = signatureImage;
  try {
    if (/^https?:\/\//i.test(signatureImage)) {
      const u = new URL(signatureImage);
      // Já está em Assinaturas/ — nada a fazer
      if (u.pathname.startsWith('/relatorios/Assinaturas/') || u.pathname.startsWith('/uploads/Assinaturas/')) return null;
      urlBase = u.origin;
      if (u.pathname.startsWith('/relatorios/')) fileName = decodeURIComponent(u.pathname.slice('/relatorios/'.length));
      else if (u.pathname.startsWith('/uploads/')) fileName = decodeURIComponent(u.pathname.slice('/uploads/'.length));
    } else if (signatureImage.startsWith('/relatorios/')) {
      if (signatureImage.startsWith('/relatorios/Assinaturas/')) return null;
      fileName = decodeURIComponent(signatureImage.slice('/relatorios/'.length));
    } else if (signatureImage.startsWith('/uploads/')) {
      if (signatureImage.startsWith('/uploads/Assinaturas/')) return null;
      fileName = decodeURIComponent(signatureImage.slice('/uploads/'.length));
    }
  } catch { return null; }
  if (!fileName) return null;
  const srcPath = path.join(env.reportsDir, fileName);
  if (!fsSync.existsSync(srcPath)) return null;
  const ext = path.extname(srcPath) || '.png';
  const destName = `Assinatura - ${safePath(name)}${ext}`;
  const sigDir = path.join(env.reportsDir, 'Assinaturas');
  await fs.mkdir(sigDir, { recursive: true });
  const destPath = path.join(sigDir, destName);
  try {
    await fs.rename(srcPath, destPath);
    const relPath = `/relatorios/Assinaturas/${encodeURIComponent(destName)}`;
    return urlBase ? `${urlBase}${relPath}` : relPath;
  } catch { return null; }
}

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

router.get('/', requireInternalUser, asyncHandler(async (_req, res) => {
  const items = await prisma.collaborator.findMany({ orderBy: { name: 'asc' } });
  res.json(items);
}));

router.post('/', requireManager, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const existing = await prisma.collaborator.findUnique({ where: { code: data.code } });
  if (existing && !existing.isActive) {
    let item = await prisma.collaborator.update({ where: { id: existing.id }, data: { ...data, isActive: true } });
    const newUrl = await moveSignatureFile(item.signatureImage, item.name);
    if (newUrl) item = await prisma.collaborator.update({ where: { id: item.id }, data: { signatureImage: newUrl } });
    return res.status(200).json(item);
  }
  let item = await prisma.collaborator.create({ data });
  const newUrl = await moveSignatureFile(item.signatureImage, item.name);
  if (newUrl) item = await prisma.collaborator.update({ where: { id: item.id }, data: { signatureImage: newUrl } });
  res.status(201).json(item);
}));

router.put('/:id', requireManager, asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  let item = await prisma.collaborator.update({ where: { id: req.params.id }, data });
  if (data.signatureImage !== undefined) {
    const newUrl = await moveSignatureFile(item.signatureImage, item.name);
    if (newUrl) item = await prisma.collaborator.update({ where: { id: item.id }, data: { signatureImage: newUrl } });
  }
  res.json(item);
}));

router.delete('/:id', requireManager, asyncHandler(async (req, res) => {
  await prisma.collaborator.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.status(204).end();
}));

export default router;
