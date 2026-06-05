import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import env from '../../config/env.js';
import asyncHandler from '../../lib/async-handler.js';
import { clientCanAccessProject } from '../../lib/client-project-access.js';
import { hasModuleRole } from '../../lib/module-roles.js';
import { optimizeImageForReport } from '../../lib/stored-image.js';
import {
  hasTransientUploadAccess,
  normalizeRelativeUploadPath,
  rememberTransientUploadAccess
} from '../../lib/transient-upload-access.js';
import { RDO_INTERNAL_ROLES, requireAuth, requireModuleRole } from '../../middleware/auth.js';
import prisma from '../../lib/prisma.js';
import { normalizeReportUploadReference } from '../../lib/report-upload-attachments.js';
import { canClientSeeReportForAccess } from './reports.js';
import { isRdoDraftPayload } from './drafts.js';

const router = Router();
const requireRdoInternal = requireModuleRole(...RDO_INTERNAL_ROLES);
export { normalizeRelativeUploadPath };

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

function jpegFileName(fileName) {
  const baseName = path.basename(String(fileName || 'imagem'), path.extname(String(fileName || '')));
  return `${safePathLocal(baseName) || 'imagem'}.jpg`;
}

function isHeicUpload(fileName, mimeType) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  return ext === '.heic' || ext === '.heif' || mime === 'image/heic' || mime === 'image/heif';
}

async function normalizeUploadedImage(data, bytes) {
  const extension = path.extname(data.fileName) || '';
  const optimized = await optimizeImageForReport(bytes, {
    extension,
    mimeType: data.mimeType
  }).catch(error => {
    console.warn('Falha ao otimizar imagem enviada.', {
      fileName: data.fileName,
      mimeType: data.mimeType,
      error: error?.message || error
    });
    return null;
  });

  if (!optimized) {
    if (isHeicUpload(data.fileName, data.mimeType)) {
      const error = new Error('Não foi possível converter a imagem HEIC. Envie outra imagem ou tente novamente.');
      error.statusCode = 400;
      throw error;
    }
    const error = new Error('Formato de imagem inválido. Envie uma imagem PNG, JPG, WebP ou HEIC válida.');
    error.statusCode = 400;
    throw error;
  }

  return {
    fileName: jpegFileName(data.fileName),
    mimeType: optimized.mimeType,
    extension: '.jpg',
    bytes: optimized.bytes
  };
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

function collaboratorHasAuthorizedProjectLink(auth, project) {
  return Array.isArray(project?.authorizedUsers)
    && project.authorizedUsers.some(link => link.userId === auth.user?.id);
}

function collaboratorCanAccessReportProject(auth, project) {
  return !!(
    project?.isActive
    && !project.deletedAt
    && !project.managerOnly
    && (
      project.visibleToCollaborators
      || collaboratorHasAuthorizedProjectLink(auth, project)
    )
  );
}

export function canAccessReport(auth, report) {
  if (!hasModuleRole(auth.user, ['rdo:manager', 'rdo:coordinator', 'rdo:collaborator', 'rdo:client'])) return false;
  if (report?.deletedAt) return false;
  if (report?.project?.deletedAt) return false;
  if (auth.user.role === 'MANAGER') return true;
  if (report.project?.managerOnly) return false;
  if (auth.user.role === 'COORDINATOR') return true;
  if (auth.user.role === 'CLIENT') return clientCanAccessProject(auth, report.project);
  if (auth.user.role === 'COLLABORATOR' && !collaboratorCanAccessReportProject(auth, report.project)) return false;
  if (report.createdByUserId === auth.user.id) return true;
  const collabId = auth.rawUser?.collaboratorId;
  if (collabId && report.project?.operatorId === collabId) return true;
  if (collaboratorHasAuthorizedProjectLink(auth, report.project)) return true;
  if (collabId && Array.isArray(report.collaborators)) {
    return report.collaborators.some(rc => rc.collaboratorId === collabId);
  }
  return false;
}

async function canAccessStoredUploadReport(auth, report) {
  if (!canAccessReport(auth, report)) return false;
  if (auth.user.role === 'CLIENT') return canClientSeeReportForAccess(report);
  return true;
}

function encodedUploadPath(normalizedPath) {
  return normalizedPath
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function uploadStoragePathCandidates(normalizedPath) {
  const cleanPath = normalizeRelativeUploadPath(normalizedPath);
  if (!cleanPath) return [];
  const encodedPath = encodedUploadPath(cleanPath);
  return [...new Set([
    cleanPath,
    encodedPath,
    `/relatorios/${cleanPath}`,
    `/relatorios/${encodedPath}`,
    `/uploads/${cleanPath}`,
    `/uploads/${encodedPath}`,
    `/api/uploads/file/${cleanPath}`,
    `/api/uploads/file/${encodedPath}`,
    `/api/rdo/uploads/file/${cleanPath}`,
    `/api/rdo/uploads/file/${encodedPath}`
  ])];
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uploadReferencePath(value) {
  if (typeof value === 'string') return normalizeReportUploadReference(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return normalizeReportUploadReference(
    value.url || value.storagePath || value.path || value.publicUrl || value.href || value.src || ''
  );
}

function collectDraftUploadPathsFromList(items, paths) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const normalizedPath = uploadReferencePath(item);
    if (normalizedPath) paths.add(normalizedPath);
  }
}

function draftUploadReferencePaths(payload) {
  const paths = new Set();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return paths;

  collectDraftUploadPathsFromList(payload.generalUploads, paths);

  const services = Array.isArray(payload.services) ? payload.services : [];
  for (const service of services) {
    if (!service || typeof service !== 'object' || Array.isArray(service)) continue;
    const data = service.data && typeof service.data === 'object' && !Array.isArray(service.data)
      ? service.data
      : service.extraData && typeof service.extraData === 'object' && !Array.isArray(service.extraData)
        ? service.extraData
        : service;
    const groups = Array.isArray(data.__uploads__) ? data.__uploads__ : [];
    for (const group of groups) {
      if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
      collectDraftUploadPathsFromList(group.files, paths);
    }
  }

  return paths;
}

function projectFolderName(project) {
  const code = stringValue(project?.code);
  const name = stringValue(project?.name);
  if (!code || !name) return '';
  return safePathLocal(`Missão ${code} - ${name}`);
}

function isProjectScopedDraftPath(normalizedPath, project) {
  const folder = projectFolderName(project);
  if (!folder) return false;
  if (normalizedPath === folder || normalizedPath.startsWith(`${folder}/`)) return true;

  const code = safePathLocal(stringValue(project?.code));
  const firstFolder = normalizedPath.split('/').filter(Boolean)[0] || '';
  return Boolean(code && firstFolder.startsWith(`Missão ${code} - `));
}

async function candidateReportIdsForUpload(normalizedPath) {
  const candidates = uploadStoragePathCandidates(normalizedPath);
  if (!candidates.length) return [];
  const ids = new Set();

  const attachments = await prisma.reportAttachment.findMany({
    where: {
      storagePath: { in: candidates }
    },
    select: {
      reportId: true,
      reportService: {
        select: {
          reportId: true
        }
      }
    }
  });

  for (const attachment of attachments) {
    if (attachment.reportId) ids.add(attachment.reportId);
    if (attachment.reportService?.reportId) ids.add(attachment.reportService.reportId);
  }

  return [...ids];
}

async function canAccessDraftUpload(auth, normalizedPath) {
  const drafts = await prisma.reportDraft.findMany({
    where: { userId: auth.user.id },
    select: {
      id: true,
      userId: true,
      payload: true,
      project: {
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          deletedAt: true,
          managerOnly: true,
          visibleToCollaborators: true,
          authorizedUsers: {
            select: {
              userId: true
            }
          }
        }
      }
    }
  });

  for (const draft of drafts) {
    if (!isRdoDraftPayload(draft.payload) || !draft.project) continue;
    if (!isProjectScopedDraftPath(normalizedPath, draft.project)) continue;
    if (!draftUploadReferencePaths(draft.payload).has(normalizedPath)) continue;
    if (!canAccessReport(auth, {
      id: draft.id,
      deletedAt: null,
      createdByUserId: draft.userId,
      project: draft.project,
      collaborators: []
    })) continue;
    return true;
  }

  return false;
}

export async function authorizeStoredFile(req, normalizedPath) {
  if (hasTransientUploadAccess(normalizedPath, req.auth)) return true;
  if (!hasModuleRole(req.auth.user, ['rdo:manager', 'rdo:coordinator', 'rdo:collaborator', 'rdo:client'])) return false;

  const candidateIds = await candidateReportIdsForUpload(normalizedPath);
  if (candidateIds.length) {
    const reports = await prisma.report.findMany({
      where: { id: { in: candidateIds }, deletedAt: null, project: { deletedAt: null } },
      include: {
        project: { include: { authorizedUsers: true } },
        collaborators: true,
        attachments: true,
        services: {
          include: {
            attachments: true
          }
        }
      }
    });

    for (const report of reports) {
      if (!(await canAccessStoredUploadReport(req.auth, report))) continue;
      return true;
    }

    return false;
  }

  return hasModuleRole(req.auth.user, RDO_INTERNAL_ROLES) && await canAccessDraftUpload(req.auth, normalizedPath);
}

router.get('/file/*', requireAuth, asyncHandler(async (req, res) => {
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

  const uploadedBytes = Buffer.from(match[2], 'base64');
  const normalizedImage = await normalizeUploadedImage(data, uploadedBytes);
  const safeName = `${Date.now()}-${randomUUID()}${normalizedImage.extension}`;

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
  await fs.writeFile(targetPath, normalizedImage.bytes);

  // URL relativa ao diretório de relatórios
  const relativePath = path.relative(env.reportsDir, targetPath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/');
  rememberTransientUploadAccess(normalizeRelativeUploadPath(relativePath), req.auth.user.id);

  res.status(201).json({
    label: data.label,
    fileName: normalizedImage.fileName,
    mimeType: normalizedImage.mimeType,
    url: `/relatorios/${relativePath}`
  });
}));

export default router;
