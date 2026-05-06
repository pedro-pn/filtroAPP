import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import env from '../../config/env.js';
import asyncHandler from '../../lib/async-handler.js';
import { hashToken } from '../../lib/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import prisma from '../../lib/prisma.js';

const router = Router();

const schema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  dataUrl: z.string().min(1),
  label: z.string().min(1),
  projectId: z.string().optional().nullable()
});

function safePathLocal(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map(item => path.resolve(item)))];
}

function fileRoots() {
  return uniquePaths([
    env.reportsDir,
    env.uploadDir,
    path.resolve(process.cwd(), 'Relatórios'),
    path.resolve(process.cwd(), 'uploads'),
    path.resolve(env.reportsDir, '..', 'uploads'),
    path.resolve(env.reportsDir, '..', 'Relatórios')
  ]);
}

function isInside(root, targetPath) {
  const relative = path.relative(root, targetPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function listFiles(root, maxEntries = 20000) {
  const stack = [root];
  const files = [];
  let visited = 0;

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fsSync.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visited += 1;
      if (visited > maxEntries) return files;
      const candidate = path.join(current, entry.name);
      if (entry.isFile()) files.push(candidate);
      if (entry.isDirectory()) stack.push(candidate);
    }
  }

  return files;
}

function findByBasename(root, basename) {
  return listFiles(root).find(candidate => path.basename(candidate) === basename) || null;
}

function compactKey(value) {
  return safeDecode(String(value || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/%[0-9a-f]{2}/gi, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

function scoreLegacyCandidate(candidate, normalizedPath) {
  const normalizedKey = compactKey(normalizedPath);
  const candidateKey = compactKey(candidate);
  const requestedParts = normalizedPath.split(path.sep).filter(Boolean);
  const requestedProject = requestedParts[0] || '';
  const requestedProjectKey = compactKey(requestedProject);
  const ext = path.extname(normalizedPath).toLowerCase();

  let score = 0;
  if (requestedProjectKey && candidateKey.includes(requestedProjectKey)) score += 80;
  if (candidateKey.includes(compactKey('Registros Fotográficos'))) score += 25;
  if (ext && path.extname(candidate).toLowerCase() === ext) score += 10;
  for (const part of requestedParts.slice(1, -1)) {
    const key = compactKey(part);
    if (key && candidateKey.includes(key)) score += 8;
  }
  if (normalizedKey && candidateKey.includes(normalizedKey)) score += 100;
  return score;
}

function resolveStoredFilePath(rawPath) {
  const normalizedPath = String(rawPath || '')
    .split('/')
    .filter(Boolean)
    .map(part => safeDecode(part))
    .join(path.sep);
  if (!normalizedPath) return null;

  const roots = fileRoots();
  for (const root of roots) {
    const targetPath = path.resolve(root, normalizedPath);
    if (isInside(root, targetPath) && fsSync.existsSync(targetPath) && fsSync.statSync(targetPath).isFile()) {
      return targetPath;
    }
  }

  const basename = path.basename(normalizedPath);
  if (!basename || basename === '.' || basename === path.sep) return null;
  for (const root of roots) {
    const found = findByBasename(root, basename);
    if (found && isInside(root, found)) return found;
  }

  let best = null;
  let bestScore = 0;
  for (const root of roots) {
    for (const candidate of listFiles(root)) {
      if (!isInside(root, candidate)) continue;
      const score = scoreLegacyCandidate(candidate, normalizedPath);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  if (best && bestScore >= 90) return best;

  return null;
}

async function authenticateFileRequest(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || String(req.query.token || '').trim();
  if (!token) return res.status(401).json({ error: 'Acesso negado.' });

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }

  req.auth = { token, sessionId: session.id, user: session.user, rawUser: session.user };
  return next();
}

router.get('/file/*', asyncHandler(authenticateFileRequest), asyncHandler(async (req, res) => {
  const targetPath = resolveStoredFilePath(req.params[0]);
  if (!targetPath) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }

  return res.sendFile(targetPath);
}));

router.use(requireAuth);

router.post('/', asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const match = data.dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Formato de imagem inválido.' });
  }

  const ext = path.extname(data.fileName) || '';
  const safeName = `${Date.now()}-${randomUUID()}${ext}`;

  let targetDir = env.reportsDir;

  // Se o projectId for informado, salva direto na pasta do projeto
  if (data.projectId) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: data.projectId },
        select: { code: true, name: true }
      });
      if (project) {
        const folderName = safePathLocal(`Missão ${project.code} - ${project.name}`);
        targetDir = path.join(env.reportsDir, folderName);
        await fs.mkdir(targetDir, { recursive: true });
      }
    } catch { /* fallback para pasta raiz */ }
  }

  const targetPath = path.join(targetDir, safeName);
  await fs.writeFile(targetPath, Buffer.from(match[2], 'base64'));

  // URL relativa ao diretório de relatórios
  const relativePath = path.relative(env.reportsDir, targetPath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/');

  res.status(201).json({
    label: data.label,
    fileName: data.fileName,
    mimeType: data.mimeType,
    url: `/relatorios/${relativePath}`
  });
}));

export default router;
