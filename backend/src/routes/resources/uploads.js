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
import {
  normalizeReportUploadReference,
  removeUploadReferenceDeep,
  syncReportUploadAttachments
} from '../../lib/report-upload-attachments.js';
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

// Resolve o projeto "dono" do arquivo a partir da 1ª pasta do caminho
// (Missão {code} - {name}). A autorização passa a ser por escopo de projeto, então
// uma linha ReportAttachment faltando nunca mais causa 403 na miniatura.
async function projectForUploadPath(normalizedPath) {
  const firstFolder = normalizeRelativeUploadPath(normalizedPath).split('/').filter(Boolean)[0] || '';
  const match = firstFolder.match(/^Missão (\S+) - /);
  const code = match ? match[1] : '';
  if (!code) return null;

  const project = await prisma.project.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      deletedAt: true,
      managerOnly: true,
      visibleToCollaborators: true,
      authorizedUsers: { select: { userId: true } }
    }
  });
  if (!project) return null;
  // Confirma que a pasta realmente corresponde a este projeto (evita colisões).
  if (projectFolderName(project) !== firstFolder) return null;
  return project;
}

function internalCanAccessProjectScope(auth, project) {
  if (!project || project.deletedAt) return false;
  if (auth.user.role === 'MANAGER') return true;
  if (project.managerOnly) return false;
  if (auth.user.role === 'COORDINATOR') return true;
  if (auth.user.role === 'COLLABORATOR') return collaboratorCanAccessReportProject(auth, project);
  return false;
}

// CLIENT continua restrito a relatório aprovado/visível: não enxerga foto de
// relatório pendente, mesmo que o arquivo esteja na pasta de um projeto que ele vê.
async function authorizeClientStoredFile(req, normalizedPath) {
  const candidateIds = await candidateReportIdsForUpload(normalizedPath);
  if (!candidateIds.length) return false;

  const reports = await prisma.report.findMany({
    where: { id: { in: candidateIds }, deletedAt: null, project: { deletedAt: null } },
    include: {
      project: { include: { authorizedUsers: true } },
      collaborators: true,
      attachments: true,
      services: { include: { attachments: true } }
    }
  });

  for (const report of reports) {
    if (await canAccessStoredUploadReport(req.auth, report)) return true;
  }
  return false;
}

export async function authorizeStoredFile(req, normalizedPath) {
  if (hasTransientUploadAccess(normalizedPath, req.auth)) return true;
  const user = req.auth.user;
  if (!hasModuleRole(user, ['rdo:manager', 'rdo:coordinator', 'rdo:collaborator', 'rdo:client'])) return false;

  if (user.role === 'CLIENT') {
    return authorizeClientStoredFile(req, normalizedPath);
  }

  // Usuário interno: autoriza por escopo de projeto.
  const project = await projectForUploadPath(normalizedPath);
  if (project && internalCanAccessProjectScope(req.auth, project)) return true;

  // Fallback para arquivos fora de pasta de projeto (legados) ou ainda em rascunho.
  return hasModuleRole(user, RDO_INTERNAL_ROLES) && await canAccessDraftUpload(req.auth, normalizedPath);
}

function wildcardFilePath(value) {
  return Array.isArray(value) ? value.join('/') : value;
}

router.get('/file/*filePath', requireAuth, asyncHandler(async (req, res) => {
  const normalizedPath = normalizeRelativeUploadPath(wildcardFilePath(req.params.filePath));
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

  // Caminho canônico (relativo ao diretório de relatórios, decodificado, com "/").
  // É a única forma de referência gravada no JSON — nunca muda, nunca quebra.
  const relativePath = path.relative(env.reportsDir, targetPath)
    .split(path.sep)
    .join('/');
  rememberTransientUploadAccess(normalizeRelativeUploadPath(relativePath), req.auth.user.id);

  res.status(201).json({
    label: data.label,
    fileName: normalizedImage.fileName,
    mimeType: normalizedImage.mimeType,
    url: relativePath
  });
}));

const deleteSchema = z
  .object({
    storagePath: z.string().min(1).optional(),
    url: z.string().min(1).optional()
  })
  .refine(data => data.storagePath || data.url, { message: 'Informe storagePath ou url.' });

// Exclusão GLOBAL de uma imagem: remove a referência de TODOS os relatórios,
// serviços e rascunhos que a usam, apaga as linhas de índice e o arquivo do disco.
router.delete('/file', requireRdoInternal, asyncHandler(async (req, res) => {
  const data = deleteSchema.parse(req.body || {});
  const target = normalizeReportUploadReference(data.storagePath || data.url || '');
  if (!target) {
    return res.status(400).json({ error: 'Referência de imagem inválida.' });
  }

  const project = await projectForUploadPath(target);
  const isManagerOrCoordinator = ['MANAGER', 'COORDINATOR'].includes(req.auth.user.role);
  if (!isManagerOrCoordinator && !(project && internalCanAccessProjectScope(req.auth, project))) {
    return res.status(403).json({ error: 'Você não tem permissão para excluir esta imagem.' });
  }

  const candidates = uploadStoragePathCandidates(target);
  const indexRows = await prisma.reportAttachment.findMany({
    where: { storagePath: { in: candidates } },
    select: { reportId: true, reportService: { select: { reportId: true } } }
  });
  const reportIds = new Set();
  for (const row of indexRows) {
    if (row.reportId) reportIds.add(row.reportId);
    if (row.reportService?.reportId) reportIds.add(row.reportService.reportId);
  }

  const affected = { reports: 0, services: 0, drafts: 0 };

  for (const reportId of reportIds) {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, specialConditions: true, services: { select: { id: true, extraData: true } } }
    });
    if (!report) continue;

    const newSC = removeUploadReferenceDeep(report.specialConditions, target);
    if (JSON.stringify(newSC) !== JSON.stringify(report.specialConditions)) {
      await prisma.report.update({ where: { id: reportId }, data: { specialConditions: newSC } });
      affected.reports += 1;
    }
    for (const service of report.services || []) {
      const newExtra = removeUploadReferenceDeep(service.extraData, target);
      if (JSON.stringify(newExtra) !== JSON.stringify(service.extraData)) {
        await prisma.reportService.update({ where: { id: service.id }, data: { extraData: newExtra } });
        affected.services += 1;
      }
    }
    await syncReportUploadAttachments(prisma, reportId);
  }

  const drafts = await prisma.reportDraft.findMany({ select: { id: true, payload: true } });
  for (const draft of drafts) {
    const newPayload = removeUploadReferenceDeep(draft.payload, target);
    if (JSON.stringify(newPayload) !== JSON.stringify(draft.payload)) {
      await prisma.reportDraft.update({ where: { id: draft.id }, data: { payload: newPayload } });
      affected.drafts += 1;
    }
  }

  // Defensivo: remove qualquer linha de índice remanescente e apaga o arquivo físico.
  await prisma.reportAttachment.deleteMany({ where: { storagePath: { in: candidates } } });
  const targetPath = resolveStoredFilePath(target);
  let fileDeleted = false;
  if (targetPath) {
    await fs.unlink(targetPath).catch(() => {});
    fileDeleted = true;
  }

  console.info('[uploads] imagem excluída globalmente', {
    userId: req.auth.user.id,
    role: req.auth.user.role,
    storagePath: target,
    affected,
    fileDeleted
  });

  return res.json({ storagePath: target, affected, fileDeleted });
}));

export default router;
