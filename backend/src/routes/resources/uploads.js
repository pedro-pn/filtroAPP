import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import env from '../../config/env.js';
import asyncHandler from '../../lib/async-handler.js';
import { hashToken, publicUser } from '../../lib/auth.js';
import { clientCanAccessProject } from '../../lib/client-project-access.js';
import { hasModuleRole } from '../../lib/module-roles.js';
import { RDO_INTERNAL_ROLES, requireAuth, requireModuleRole } from '../../middleware/auth.js';
import prisma from '../../lib/prisma.js';

const router = Router();
const requireRdoInternal = requireModuleRole(...RDO_INTERNAL_ROLES);
const TRANSIENT_UPLOAD_ACCESS_MS = 30 * 60 * 1000;
const transientUploadAccess = new Map();

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

function cleanupTransientUploadAccess(now = Date.now()) {
  for (const [key, grant] of transientUploadAccess) {
    if (!grant || grant.expiresAt <= now) transientUploadAccess.delete(key);
  }
}

function rememberTransientUploadAccess(normalizedPath, userId) {
  if (!normalizedPath || !userId) return;
  cleanupTransientUploadAccess();
  transientUploadAccess.set(normalizedPath, {
    userId,
    expiresAt: Date.now() + TRANSIENT_UPLOAD_ACCESS_MS
  });
}

function hasTransientUploadAccess(normalizedPath, auth) {
  cleanupTransientUploadAccess();
  const grant = transientUploadAccess.get(normalizedPath);
  return !!(grant && grant.userId === auth.user.id && grant.expiresAt > Date.now());
}

export function normalizeRelativeUploadPath(rawPath) {
  const normalizedPath = String(rawPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(part => safeDecode(part))
    .join('/');
  return normalizedPath || '';
}

export function resolveStoredFilePath(rawPath) {
  const normalizedPath = normalizeRelativeUploadPath(rawPath).split('/').join(path.sep);
  if (!normalizedPath) return null;

  const roots = fileRoots();
  for (const root of roots) {
    const targetPath = path.resolve(root, normalizedPath);
    if (isInside(root, targetPath) && fsSync.existsSync(targetPath) && fsSync.statSync(targetPath).isFile()) {
      return targetPath;
    }
  }

  return null;
}

function normalizeUploadReference(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:')) return '';

  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return '';
    }
  }

  if (pathname.startsWith('/api/uploads/file/')) {
    return normalizeRelativeUploadPath(pathname.slice('/api/uploads/file/'.length));
  }
  if (pathname.startsWith('/api/rdo/uploads/file/')) {
    return normalizeRelativeUploadPath(pathname.slice('/api/rdo/uploads/file/'.length));
  }
  if (pathname.startsWith('/relatorios/')) {
    return normalizeRelativeUploadPath(pathname.slice('/relatorios/'.length));
  }
  if (pathname.startsWith('/uploads/')) {
    return normalizeRelativeUploadPath(pathname.slice('/uploads/'.length));
  }
  if (pathname.startsWith('relatorios/')) {
    return normalizeRelativeUploadPath(pathname.slice('relatorios/'.length));
  }
  if (pathname.startsWith('uploads/')) {
    return normalizeRelativeUploadPath(pathname.slice('uploads/'.length));
  }
  if (pathname.includes('/')) {
    return normalizeRelativeUploadPath(pathname);
  }
  return '';
}

function valueReferencesUpload(value, normalizedPath) {
  if (!value) return false;
  if (typeof value === 'string') {
    return normalizeUploadReference(value) === normalizedPath;
  }
  if (Array.isArray(value)) {
    return value.some(item => valueReferencesUpload(item, normalizedPath));
  }
  if (typeof value === 'object') {
    for (const key of ['url', 'path', 'storagePath']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const raw = String(value[key] || '').trim();
        if (normalizeUploadReference(raw) === normalizedPath) return true;
        if (normalizeRelativeUploadPath(raw) === normalizedPath) return true;
      }
    }
    return Object.values(value).some(item => valueReferencesUpload(item, normalizedPath));
  }
  return false;
}

export function canAccessReport(auth, report) {
  if (!hasModuleRole(auth.user, ['rdo:manager', 'rdo:coordinator', 'rdo:collaborator', 'rdo:client'])) return false;
  if (report?.deletedAt || report?.project?.deletedAt) return false;
  if (auth.user.role === 'MANAGER') return true;
  if (report.project?.managerOnly) return false;
  if (auth.user.role === 'COORDINATOR') return true;
  if (auth.user.role === 'CLIENT') return clientCanAccessProject(auth, report.project);
  if (report.createdByUserId === auth.user.id) return true;
  const collabId = auth.rawUser?.collaboratorId;
  if (collabId && report.project?.operatorId === collabId) return true;
  if (collabId && Array.isArray(report.collaborators)) {
    return report.collaborators.some(rc => rc.collaboratorId === collabId);
  }
  return false;
}

async function candidateReportIdsForUpload(normalizedPath) {
  const searchTerm = normalizedPath.split('/').filter(Boolean).pop() || normalizedPath;
  const searchTerms = [...new Set([
    searchTerm,
    encodeURIComponent(searchTerm)
  ].filter(Boolean))];
  const ids = new Set();

  for (const term of searchTerms) {
    const like = `%${term}%`;
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT id
      FROM (
        SELECT r.id
        FROM "Report" r
        WHERE r."specialConditions"::text ILIKE ${like}
        UNION
        SELECT s."reportId" AS id
        FROM "ReportService" s
        WHERE s."extraData"::text ILIKE ${like}
        UNION
        SELECT a."reportId" AS id
        FROM "ReportAttachment" a
        WHERE a."reportId" IS NOT NULL AND a."storagePath" ILIKE ${like}
        UNION
        SELECT s."reportId" AS id
        FROM "ReportAttachment" a
        JOIN "ReportService" s ON s.id = a."reportServiceId"
        WHERE a."reportServiceId" IS NOT NULL AND a."storagePath" ILIKE ${like}
      ) matches
      WHERE id IS NOT NULL
      LIMIT 100
    `;
    for (const row of rows) {
      if (row.id) ids.add(row.id);
      if (ids.size >= 100) break;
    }
    if (ids.size >= 100) break;
  }

  return [...ids];
}

export async function authorizeStoredFile(req, normalizedPath) {
  if (hasTransientUploadAccess(normalizedPath, req.auth)) return true;
  if (!hasModuleRole(req.auth.user, ['rdo:manager', 'rdo:coordinator', 'rdo:collaborator', 'rdo:client'])) return false;

  const drafts = await prisma.reportDraft.findMany({
    where: { userId: req.auth.user.id },
    select: { payload: true }
  });
  if (drafts.some(draft => valueReferencesUpload(draft.payload, normalizedPath))) return true;

  const candidateIds = await candidateReportIdsForUpload(normalizedPath);
  if (!candidateIds.length) return false;

  const reports = await prisma.report.findMany({
    where: { id: { in: candidateIds }, deletedAt: null, project: { deletedAt: null } },
    include: {
      project: true,
      collaborators: true,
      attachments: true,
      services: {
        include: {
          attachments: true
        }
      }
    }
  });

  return reports.some(report => {
    if (!canAccessReport(req.auth, report)) return false;
    if (valueReferencesUpload(report.specialConditions, normalizedPath)) return true;
    if (valueReferencesUpload(report.attachments, normalizedPath)) return true;
    return (report.services || []).some(service => (
      valueReferencesUpload(service.extraData, normalizedPath)
      || valueReferencesUpload(service.attachments, normalizedPath)
    ));
  });
}

async function authenticateFileRequest(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Acesso negado.' });

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          collaborator: true,
          moduleRoles: true
        }
      }
    }
  });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }

  req.auth = { token, sessionId: session.id, user: publicUser(session.user), rawUser: session.user };
  return next();
}

router.get('/file/*', asyncHandler(authenticateFileRequest), asyncHandler(async (req, res) => {
  const normalizedPath = normalizeRelativeUploadPath(req.params[0]);
  const targetPath = resolveStoredFilePath(normalizedPath);
  if (!targetPath) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
  if (!(await authorizeStoredFile(req, normalizedPath))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este arquivo.' });
  }

  return res.sendFile(targetPath);
}));

router.use(requireAuth);

router.post('/', requireRdoInternal, asyncHandler(async (req, res) => {
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
  rememberTransientUploadAccess(normalizeRelativeUploadPath(relativePath), req.auth.user.id);

  res.status(201).json({
    label: data.label,
    fileName: data.fileName,
    mimeType: data.mimeType,
    url: `/relatorios/${relativePath}`
  });
}));

export default router;
