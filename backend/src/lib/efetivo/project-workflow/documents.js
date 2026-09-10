import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { z } from 'zod';

import {
  PROJECT_DOCUMENT_TYPES,
  makeProjectDocumentSchemas
} from '../../../../../shared/schemas/project-documents.js';
import env from '../../../config/env.js';
import { createDocument as createSignatureDocument } from '../../assinaturas/document.js';
import {
  inlineContentDisposition,
  resolveManagedDocumentPath,
  safeDocumentPathPart,
  unlinkManagedDocumentFile,
  writeManagedDocumentFile
} from '../../documents/storage.js';
import { hasModuleRole } from '../../module-roles.js';
import { efetivoProjectWhere } from '../project-visibility.js';
import { conflictError, notFound, planningError } from '../planning/errors.js';
import { resolvePlanningDatabase } from '../planning/plan-context.js';

const PROJECT_DOCUMENT_PREFIX = 'Projetos/';
const schemas = makeProjectDocumentSchemas(z);
const TYPE_LABELS = Object.fromEntries(PROJECT_DOCUMENT_TYPES.map(item => [item.key, item.label]));
const ALL_TYPES = PROJECT_DOCUMENT_TYPES.map(item => item.key);
const COMMERCIAL_TYPES = ['COMMERCIAL_PROPOSAL', 'PURCHASE_ORDER', 'CONTRACT'];
const OPERATIONS_TYPES = ['TECHNICAL_PROPOSAL', 'DRAWING', 'SPECIFICATION', 'TECHNICAL_EVIDENCE'];
const SHARED_COMPLIANCE_TYPES = ['CLIENT_REQUIREMENT', 'CERTIFICATE'];
const MIME_BY_EXTENSION = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  dwg: ['application/acad', 'application/x-acad', 'application/autocad_dwg', 'application/dwg', 'application/x-dwg', 'image/vnd.dwg', 'application/octet-stream'],
  dxf: ['application/dxf', 'application/x-dxf', 'image/vnd.dxf', 'application/octet-stream', 'text/plain']
};
const PERSON = { select: { id: true, name: true } };
const SIGNATURE = {
  select: {
    id: true,
    status: true,
    originalFileName: true,
    finalStoragePath: true,
    completedAt: true,
    archivedAt: true,
    deletedAt: true
  }
};
const VERSION_INCLUDE = {
  createdBy: PERSON,
  acceptanceRecordedBy: PERSON,
  signatureDocument: SIGNATURE
};
const DOCUMENT_INCLUDE = {
  responsible: PERSON,
  createdBy: PERSON,
  updatedBy: PERSON,
  archivedBy: PERSON,
  currentVersion: { include: VERSION_INCLUDE }
};

function error(message, statusCode, code, issues = []) {
  return planningError(message, { statusCode, code, issues });
}

function dateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validExternalUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(String(value || '')).protocol); } catch { return false; }
}

function maxBytes(maxMb = env.projectDocumentMaxMb) {
  return maxMb * 1024 * 1024;
}

function extensionFor(fileName) {
  return path.extname(String(fileName || '')).slice(1).toLowerCase();
}

function assertZipOffice(bytes, extension) {
  let zip;
  try { zip = new AdmZip(bytes); } catch {
    throw error('O arquivo Office está corrompido ou não corresponde ao formato informado.', 415, 'PROJECT_DOCUMENT_TYPE_UNSUPPORTED');
  }
  const names = new Set(zip.getEntries().map(entry => entry.entryName));
  const required = extension === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
  if (!names.has('[Content_Types].xml') || !names.has(required)) {
    throw error('O conteúdo do arquivo não corresponde ao formato informado.', 415, 'PROJECT_DOCUMENT_TYPE_UNSUPPORTED');
  }
}

function assertBinarySignature(bytes, extension) {
  const prefix = bytes.subarray(0, 16);
  const text = bytes.subarray(0, Math.min(bytes.length, 4096)).toString('latin1');
  const valid = extension === 'pdf' ? prefix.subarray(0, 4).toString() === '%PDF'
    : extension === 'png' ? prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : ['jpg', 'jpeg'].includes(extension) ? prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff
    : extension === 'dwg' ? prefix.subarray(0, 4).toString() === 'AC10'
    : extension === 'dxf' ? /\bSECTION\b/i.test(text) && /\b(?:HEADER|ENTITIES)\b/i.test(text)
    : ['docx', 'xlsx'].includes(extension) ? prefix[0] === 0x50 && prefix[1] === 0x4b
    : false;
  if (!valid) {
    throw error('O conteúdo do arquivo não corresponde ao formato informado.', 415, 'PROJECT_DOCUMENT_TYPE_UNSUPPORTED');
  }
  if (extension === 'docx' || extension === 'xlsx') assertZipOffice(bytes, extension);
}

export function parseProjectDocumentUpload(fileName, dataUrl, { maximumMb = env.projectDocumentMaxMb } = {}) {
  const originalFileName = path.basename(String(fileName || '').trim());
  const extension = extensionFor(originalFileName);
  const allowedMimes = MIME_BY_EXTENSION[extension];
  const match = String(dataUrl || '').trim().match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!originalFileName || !allowedMimes || !match || match[2].length % 4 !== 0) {
    throw error('Envie PDF, DOCX, XLSX, PNG, JPEG, DWG ou DXF válido.', 415, 'PROJECT_DOCUMENT_TYPE_UNSUPPORTED');
  }
  const mimeType = match[1].toLowerCase();
  if (!allowedMimes.includes(mimeType)) {
    throw error('O tipo declarado não corresponde à extensão do arquivo.', 415, 'PROJECT_DOCUMENT_TYPE_UNSUPPORTED');
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw error('O arquivo enviado está vazio.', 415, 'PROJECT_DOCUMENT_TYPE_UNSUPPORTED');
  if (bytes.length > maxBytes(maximumMb)) {
    throw error(`O arquivo ultrapassa o limite de ${maximumMb} MB.`, 413, 'PROJECT_DOCUMENT_TOO_LARGE');
  }
  assertBinarySignature(bytes, extension);
  return {
    originalFileName,
    extension: extension === 'jpeg' ? 'jpg' : extension,
    mimeType: ['jpg', 'jpeg'].includes(extension) ? 'image/jpeg' : mimeType,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex')
  };
}

export function projectDocumentFolderParts(project, type) {
  return [
    'Projetos',
    safeDocumentPathPart(`${project.code}-${project.id}`),
    'Documentos',
    safeDocumentPathPart(type)
  ];
}

export function storeProjectDocumentFile(project, type, parsed, dependencies = {}) {
  const write = dependencies.writeManagedDocumentFile || writeManagedDocumentFile;
  return write({
    rootDir: dependencies.rootDir || env.uploadDir,
    folderParts: projectDocumentFolderParts(project, type),
    token: dependencies.token || randomUUID(),
    fileName: parsed.originalFileName,
    bytes: parsed.bytes,
    extension: parsed.extension
  });
}

export function resolveProjectDocumentStoragePath(storagePath, dependencies = {}) {
  return (dependencies.resolveManagedDocumentPath || resolveManagedDocumentPath)(storagePath, {
    rootDir: dependencies.rootDir || env.uploadDir,
    requiredPrefix: PROJECT_DOCUMENT_PREFIX
  });
}

export function removeProjectDocumentFile(storagePath, dependencies = {}) {
  return (dependencies.unlinkManagedDocumentFile || unlinkManagedDocumentFile)(storagePath, {
    rootDir: dependencies.rootDir || env.uploadDir,
    requiredPrefix: PROJECT_DOCUMENT_PREFIX
  });
}

export async function withProjectDocumentFileRollback(storagePath, operation, dependencies = {}) {
  try { return await operation(); } catch (failure) {
    if (storagePath) await removeProjectDocumentFile(storagePath, dependencies);
    throw failure;
  }
}

function contextIsManager(context) {
  return context.isManager === true || context.user?.accountType === 'ADMIN' || hasModuleRole(context.user, 'efetivo:manager');
}

function contextIsLeader(project, context) {
  return Boolean(context.actorUserId && project?.workflow?.leaderUserId === context.actorUserId);
}

export function allowedProjectDocumentTypes(project, context = {}) {
  if (contextIsManager(context) || contextIsLeader(project, context)) return [...ALL_TYPES];
  const types = new Set();
  if (hasModuleRole(context.user, 'efetivo:commercial')) COMMERCIAL_TYPES.forEach(type => types.add(type));
  if (hasModuleRole(context.user, 'efetivo:operations')) OPERATIONS_TYPES.forEach(type => types.add(type));
  if (hasModuleRole(context.user, ['efetivo:administrative', 'efetivo:qsms', 'efetivo:assets'])) {
    SHARED_COMPLIANCE_TYPES.forEach(type => types.add(type));
  }
  return [...types];
}

function canPrepareSignatures(project, context) {
  return (contextIsManager(context) || contextIsLeader(project, context))
    && (context.user?.accountType === 'ADMIN' || hasModuleRole(context.user, 'assinaturas:user'));
}

function assertTypePermission(project, type, context) {
  if (!allowedProjectDocumentTypes(project, context).includes(type)) {
    throw error('Você não possui responsabilidade para alterar este tipo de documento.', 403, 'PROJECT_DOCUMENT_FORBIDDEN');
  }
}

function assertProjectMutable(project) {
  if (project.workflow?.stage === 'FINISHED') {
    throw error('O projeto está encerrado. Reabra-o antes de alterar documentos.', 409, 'PROJECT_FINISHED');
  }
}

function documentSource(document) {
  return document?.currentVersion?.source || document?.versions?.[0]?.source || null;
}

function assertUserMutableDocument(document) {
  if (documentSource(document) === 'CRM') {
    throw error('Documentos recebidos do CRM são somente leitura no FiltroAPP.', 409, 'CRM_DOCUMENT_READ_ONLY');
  }
}

async function runTransaction(database, operation) {
  return database.$transaction ? database.$transaction(operation) : operation(database);
}

async function loadProject(database, projectId) {
  const project = await database.project.findFirst({
    where: { id: projectId, isActive: true, deletedAt: null, ...efetivoProjectWhere() },
    select: {
      id: true,
      code: true,
      name: true,
      workflow: { select: { projectId: true, stage: true, leaderUserId: true, version: true, mobilizationAuthorizedAt: true, mobilizationAuthorizationVersion: true } }
    }
  });
  if (!project) throw notFound('Projeto não encontrado ou indisponível no Efetivo.');
  return project;
}

async function loadDocument(database, projectId, documentId, { history = false } = {}) {
  const document = await database.projectDocument.findFirst({
    where: { id: documentId, projectId },
    include: {
      ...DOCUMENT_INCLUDE,
      ...(history ? { versions: { include: VERSION_INCLUDE, orderBy: { sequence: 'desc' } } } : {})
    }
  });
  if (!document) throw error('Documento do projeto não encontrado.', 404, 'PROJECT_DOCUMENT_NOT_FOUND');
  return document;
}

function assertExpectedVersion(document, expectedVersion) {
  if (document.version !== expectedVersion) {
    throw conflictError('O documento foi alterado por outra pessoa. Atualize os dados e tente novamente.', [], 'PROJECT_DOCUMENT_VERSION_CONFLICT');
  }
}

async function requireResponsible(database, responsibleUserId) {
  if (!responsibleUserId) return null;
  const user = await database.user.findFirst({ where: { id: responsibleUserId, isActive: true }, select: { id: true, name: true } });
  if (!user) throw error('Selecione um responsável ativo.', 400, 'PROJECT_DOCUMENT_RESPONSIBLE_INVALID');
  return user;
}

function acceptanceInitialStatus(mode) {
  return mode === 'NONE' ? 'NOT_REQUIRED' : 'PENDING';
}

function contentAccessible(version, dependencies = {}) {
  if (!version) return false;
  if (version.contentKind === 'EXTERNAL_REFERENCE') return validExternalUrl(version.externalUrl);
  return Boolean(version.storagePath && resolveProjectDocumentStoragePath(version.storagePath, dependencies));
}

export function projectDocumentReadiness(document, dependencies = {}) {
  const label = String(document?.title || TYPE_LABELS[document?.type] || 'Documento');
  if (document?.archivedAt) return { ready: false, reasonCode: 'ARCHIVED', reason: `${label} está arquivado.` };
  const version = document?.currentVersion;
  if (!version || version.documentId && version.documentId !== document.id) {
    return { ready: false, reasonCode: 'MISSING_VERSION', reason: `${label} não possui uma versão vigente.` };
  }
  if (!contentAccessible(version, dependencies)) {
    return { ready: false, reasonCode: 'CONTENT_UNAVAILABLE', reason: `${label} não possui um arquivo ou referência acessível.` };
  }
  if (document.acceptanceMode === 'SIGNATURE') {
    const signature = version.signatureDocument;
    if (!signature || signature.deletedAt || signature.status !== 'CONCLUIDO' || !signature.finalStoragePath) {
      return { ready: false, reasonCode: 'SIGNATURE_PENDING', reason: `${label} aguarda a conclusão da assinatura.` };
    }
  } else if (document.acceptanceMode !== 'NONE' && version.acceptanceStatus !== 'ACCEPTED') {
    const audience = document.acceptanceMode === 'CLIENT' ? 'do cliente' : 'interno';
    const rejected = version.acceptanceStatus === 'REJECTED' ? 'foi rejeitado e precisa de uma nova decisão' : `aguarda aceite ${audience}`;
    return { ready: false, reasonCode: version.acceptanceStatus === 'REJECTED' ? 'ACCEPTANCE_REJECTED' : 'ACCEPTANCE_PENDING', reason: `${label} ${rejected}.` };
  }
  return { ready: true, reasonCode: 'READY', reason: `${label} está disponível e pronto.` };
}

export function projectDocumentRequirements(documents = [], dependencies = {}) {
  return Object.fromEntries(['HANDOVER', 'MOBILIZATION', 'CLOSEOUT'].map(stage => {
    const required = documents
      .filter(document => !document.archivedAt && document.requirementStage === stage)
      .map(document => ({ documentId: document.id, title: document.title, ...projectDocumentReadiness(document, dependencies) }));
    const blockers = required
      .filter(item => !item.ready)
      .map(({ ready: _ready, ...item }) => item);
    return [stage, {
      ready: blockers.length === 0,
      readyCount: required.length - blockers.length,
      totalCount: required.length,
      blockers
    }];
  }));
}

function versionPermissions(document, project, context) {
  const mutable = project.workflow?.stage !== 'FINISHED' && documentSource(document) !== 'CRM';
  const typeAllowed = allowedProjectDocumentTypes(project, context).includes(document.type);
  const canMutate = mutable && typeAllowed;
  return {
    update: canMutate,
    addVersion: canMutate,
    recordAcceptance: canMutate && ['INTERNAL', 'CLIENT'].includes(document.acceptanceMode),
    prepareSignature: canMutate && document.acceptanceMode === 'SIGNATURE' && canPrepareSignatures(project, context)
      && document.currentVersion?.mimeType === 'application/pdf',
    archive: canMutate
  };
}

function publicSignature(signature, projectId, documentId, versionId) {
  if (!signature || signature.deletedAt) return null;
  return {
    id: signature.id,
    status: signature.status,
    completedAt: signature.completedAt,
    openUrl: `/assinaturas?doc=${encodeURIComponent(signature.id)}`,
    finalFileUrl: signature.status === 'CONCLUIDO'
      ? `/api/efetivo/project-workflow/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/signed-file`
      : null
  };
}

export function serializeProjectDocumentVersion(version, document, { includeExternalUrl = true } = {}) {
  if (!version) return null;
  return {
    id: version.id,
    sequence: version.sequence,
    versionLabel: version.versionLabel || null,
    source: version.source,
    contentKind: version.contentKind,
    originalFileName: version.originalFileName || null,
    mimeType: version.mimeType || null,
    fileSizeBytes: version.fileSizeBytes || null,
    sha256: version.sha256 || null,
    externalId: version.externalId || null,
    externalUrl: includeExternalUrl && validExternalUrl(version.externalUrl) ? version.externalUrl : null,
    sourceVersion: version.sourceVersion || null,
    sourceUpdatedAt: iso(version.sourceUpdatedAt),
    lastSyncedAt: iso(version.lastSyncedAt),
    signature: publicSignature(version.signatureDocument, document.projectId, document.id, version.id),
    acceptanceStatus: version.acceptanceStatus,
    acceptanceOccurredOn: dateKey(version.acceptanceOccurredOn),
    acceptanceReference: version.acceptanceReference || null,
    acceptanceNote: version.acceptanceNote || null,
    acceptanceRecordedAt: iso(version.acceptanceRecordedAt),
    acceptanceRecordedBy: version.acceptanceRecordedBy || null,
    createdAt: iso(version.createdAt),
    createdBy: version.createdBy || null,
    downloadUrl: version.contentKind === 'MANAGED_FILE'
      ? `/api/efetivo/project-workflow/${encodeURIComponent(document.projectId)}/documents/${encodeURIComponent(document.id)}/versions/${encodeURIComponent(version.id)}/file`
      : null
  };
}

export function serializeProjectDocument(document, project, context, dependencies = {}) {
  return {
    id: document.id,
    projectId: document.projectId,
    type: document.type,
    title: document.title,
    description: document.description || null,
    responsible: document.responsible || null,
    requirementStage: document.requirementStage || null,
    acceptanceMode: document.acceptanceMode,
    version: document.version,
    archivedAt: iso(document.archivedAt),
    archivedBy: document.archivedBy || null,
    createdAt: iso(document.createdAt),
    createdBy: document.createdBy || null,
    updatedAt: iso(document.updatedAt),
    updatedBy: document.updatedBy || null,
    currentVersion: serializeProjectDocumentVersion(document.currentVersion, document),
    ...(document.versions ? { versions: document.versions.map(version => serializeProjectDocumentVersion(version, document)) } : {}),
    readiness: projectDocumentReadiness(document, dependencies),
    permissions: versionPermissions(document, project, context)
  };
}

async function recordWorkflowEvent(tx, projectId, actorUserId, action, data) {
  if (!tx.projectWorkflowEvent?.create) return null;
  return tx.projectWorkflowEvent.create({ data: { projectId, actorUserId: actorUserId || null, action, data } });
}

async function documentWorkflowSideEffect(tx, project, context, action, data, affectsMobilization) {
  let workflowVersion = project.workflow?.version || null;
  let authorizationInvalidated = false;
  if (project.workflow && affectsMobilization) {
    authorizationInvalidated = Boolean(project.workflow.mobilizationAuthorizedAt);
    const updated = await tx.projectWorkflow.update({
      where: { projectId: project.id },
      data: {
        version: { increment: 1 },
        mobilizationAuthorizedAt: null,
        mobilizationAuthorizationVersion: null
      },
      select: { version: true }
    });
    workflowVersion = updated.version;
    if (authorizationInvalidated) {
      await recordWorkflowEvent(tx, project.id, context.actorUserId, 'MOBILIZATION_AUTHORIZATION_INVALIDATED', {
        reason: 'DOCUMENT_READINESS_CHANGED',
        ...data
      });
    }
  }
  await recordWorkflowEvent(tx, project.id, context.actorUserId, action, data);
  return { workflowVersion, authorizationInvalidated };
}

function affectsMobilization(before, after = before) {
  return before?.requirementStage === 'MOBILIZATION' || after?.requirementStage === 'MOBILIZATION';
}

export async function aggregateProjectOperationalDocuments(database, projectId) {
  if (!database.report?.findMany) return [];
  const rows = await database.report.findMany({
    where: { projectId, deletedAt: null },
    select: {
      id: true,
      reportType: true,
      sequenceNumber: true,
      status: true,
      reportDate: true,
      approvedAt: true,
      createdAt: true,
      clientReviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { action: true, createdAt: true } }
    },
    orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }]
  });
  return rows.map(report => ({
    id: `REPORT:${report.id}`,
    kind: ['RDO', 'RDO_MAINTENANCE', 'RDO_PRODUCTION'].includes(report.reportType) ? 'RDO' : 'TECHNICAL_REPORT',
    title: `${report.reportType}${report.sequenceNumber ? ` ${report.sequenceNumber}` : ''}`,
    status: report.status,
    issuedAt: iso(report.reportDate || report.createdAt),
    acceptedAt: report.clientReviews?.[0]?.action === 'APPROVED' ? iso(report.clientReviews[0].createdAt) : null,
    sourceRoute: `/rdo/relatorios/${encodeURIComponent(report.id)}`,
    downloadUrl: `/api/rdo/reports/${encodeURIComponent(report.id)}/pdf`
  }));
}

export async function listProjectDocuments(projectId, filters = {}, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const project = await loadProject(database, projectId);
  const documents = await database.projectDocument.findMany({
    where: { projectId, ...(filters.includeArchived ? {} : { archivedAt: null }) },
    include: {
      ...DOCUMENT_INCLUDE,
      ...(filters.includeHistory ? { versions: { include: VERSION_INCLUDE, orderBy: { sequence: 'desc' } } } : {})
    },
    orderBy: [{ archivedAt: 'asc' }, { type: 'asc' }, { title: 'asc' }]
  });
  return {
    documents: documents.map(document => serializeProjectDocument(document, project, context, dependencies)),
    requirements: projectDocumentRequirements(documents, dependencies),
    operationalDocuments: await aggregateProjectOperationalDocuments(database, projectId),
    projectReadOnly: project.workflow?.stage === 'FINISHED',
    allowedTypes: allowedProjectDocumentTypes(project, context)
  };
}

export async function createProjectDocument(projectId, input, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const project = await loadProject(database, projectId);
  assertProjectMutable(project);
  assertTypePermission(project, input.type, context);
  await requireResponsible(database, input.responsibleUserId);
  let storagePath = null;
  let parsed = null;
  if (input.initialVersion) {
    parsed = parseProjectDocumentUpload(input.initialVersion.fileName, input.initialVersion.dataUrl, dependencies);
    storagePath = await storeProjectDocumentFile(project, input.type, parsed, dependencies);
  }
  return withProjectDocumentFileRollback(storagePath, async () => runTransaction(database, async tx => {
    const document = await tx.projectDocument.create({
      data: {
        projectId,
        type: input.type,
        title: input.title,
        description: input.description || null,
        responsibleUserId: input.responsibleUserId || null,
        requirementStage: input.requirementStage || null,
        acceptanceMode: input.acceptanceMode,
        createdByUserId: context.actorUserId || null,
        updatedByUserId: context.actorUserId || null
      }
    });
    if (parsed && storagePath) {
      const version = await tx.projectDocumentVersion.create({
        data: {
          documentId: document.id,
          sequence: 1,
          versionLabel: input.initialVersion.versionLabel || null,
          source: 'MANUAL',
          contentKind: 'MANAGED_FILE',
          originalFileName: parsed.originalFileName,
          mimeType: parsed.mimeType,
          fileSizeBytes: parsed.bytes.length,
          storagePath,
          sha256: parsed.sha256,
          acceptanceStatus: acceptanceInitialStatus(input.acceptanceMode),
          createdByUserId: context.actorUserId || null
        }
      });
      await tx.projectDocument.update({ where: { id: document.id }, data: { currentVersionId: version.id } });
    }
    const sideEffect = await documentWorkflowSideEffect(tx, project, context, 'PROJECT_DOCUMENT_CREATED', {
      documentId: document.id,
      type: input.type,
      requirementStage: input.requirementStage || null
    }, input.requirementStage === 'MOBILIZATION');
    const saved = await loadDocument(tx, projectId, document.id, { history: true });
    return { document: serializeProjectDocument(saved, project, context, dependencies), ...sideEffect };
  }), dependencies);
}

export async function updateProjectDocument(projectId, documentId, input, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runTransaction(database, async tx => {
    const project = await loadProject(tx, projectId);
    assertProjectMutable(project);
    const document = await loadDocument(tx, projectId, documentId, { history: true });
    assertExpectedVersion(document, input.expectedVersion);
    assertUserMutableDocument(document);
    assertTypePermission(project, document.type, context);
    if (input.type && input.type !== document.type) assertTypePermission(project, input.type, context);
    if (Object.hasOwn(input, 'responsibleUserId')) await requireResponsible(tx, input.responsibleUserId);
    const data = { updatedByUserId: context.actorUserId || null, version: { increment: 1 } };
    for (const key of ['type', 'title', 'description', 'responsibleUserId', 'requirementStage', 'acceptanceMode']) {
      if (Object.hasOwn(input, key)) data[key] = input[key];
    }
    if (input.acceptanceMode && input.acceptanceMode !== document.acceptanceMode && document.currentVersionId) {
      await tx.projectDocumentVersion.update({
        where: { id: document.currentVersionId },
        data: {
          acceptanceStatus: acceptanceInitialStatus(input.acceptanceMode),
          acceptanceOccurredOn: null,
          acceptanceReference: null,
          acceptanceNote: null,
          acceptanceRecordedAt: null,
          acceptanceRecordedByUserId: null
        }
      });
    }
    await tx.projectDocument.update({ where: { id: documentId }, data });
    const after = { ...document, ...input };
    const sideEffect = await documentWorkflowSideEffect(tx, project, context, 'PROJECT_DOCUMENT_UPDATED', {
      documentId,
      before: { type: document.type, requirementStage: document.requirementStage, acceptanceMode: document.acceptanceMode },
      after: { type: after.type, requirementStage: after.requirementStage, acceptanceMode: after.acceptanceMode }
    }, affectsMobilization(document, after));
    const saved = await loadDocument(tx, projectId, documentId, { history: true });
    return { document: serializeProjectDocument(saved, project, context, dependencies), ...sideEffect };
  });
}

export async function addProjectDocumentVersion(projectId, documentId, input, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const project = await loadProject(database, projectId);
  assertProjectMutable(project);
  const document = await loadDocument(database, projectId, documentId, { history: true });
  assertExpectedVersion(document, input.expectedVersion);
  assertUserMutableDocument(document);
  assertTypePermission(project, document.type, context);
  const parsed = parseProjectDocumentUpload(input.fileName, input.dataUrl, dependencies);
  const storagePath = await storeProjectDocumentFile(project, document.type, parsed, dependencies);
  return withProjectDocumentFileRollback(storagePath, async () => runTransaction(database, async tx => {
    const locked = await loadDocument(tx, projectId, documentId, { history: true });
    assertExpectedVersion(locked, input.expectedVersion);
    const sequence = (locked.versions?.[0]?.sequence || 0) + 1;
    const version = await tx.projectDocumentVersion.create({
      data: {
        documentId,
        sequence,
        versionLabel: input.versionLabel || null,
        source: 'MANUAL',
        contentKind: 'MANAGED_FILE',
        originalFileName: parsed.originalFileName,
        mimeType: parsed.mimeType,
        fileSizeBytes: parsed.bytes.length,
        storagePath,
        sha256: parsed.sha256,
        acceptanceStatus: acceptanceInitialStatus(locked.acceptanceMode),
        createdByUserId: context.actorUserId || null
      }
    });
    await tx.projectDocument.update({
      where: { id: documentId },
      data: { currentVersionId: version.id, version: { increment: 1 }, updatedByUserId: context.actorUserId || null }
    });
    const sideEffect = await documentWorkflowSideEffect(tx, project, context, 'PROJECT_DOCUMENT_VERSION_ADDED', {
      documentId,
      versionId: version.id,
      sequence,
      previousVersionId: locked.currentVersionId || null
    }, locked.requirementStage === 'MOBILIZATION');
    const saved = await loadDocument(tx, projectId, documentId, { history: true });
    return { document: serializeProjectDocument(saved, project, context, dependencies), ...sideEffect };
  }), dependencies);
}

export async function listProjectDocumentVersions(projectId, documentId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const project = await loadProject(database, projectId);
  const document = await loadDocument(database, projectId, documentId, { history: true });
  return {
    versions: (document.versions || []).map(version => serializeProjectDocumentVersion(version, document)),
    permissions: versionPermissions(document, project, context)
  };
}

export async function resolveProjectDocumentFile(projectId, documentId, versionId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  await loadProject(database, projectId);
  const version = await database.projectDocumentVersion.findFirst({
    where: { id: versionId, documentId, document: { projectId } },
    include: { document: { select: { id: true, projectId: true } } }
  });
  if (!version || version.contentKind !== 'MANAGED_FILE') throw error('Arquivo não encontrado.', 404, 'PROJECT_DOCUMENT_NOT_FOUND');
  const targetPath = resolveProjectDocumentStoragePath(version.storagePath, dependencies);
  if (!targetPath) throw error('Arquivo não encontrado.', 404, 'PROJECT_DOCUMENT_NOT_FOUND');
  return {
    targetPath,
    mimeType: version.mimeType || 'application/octet-stream',
    fileName: version.originalFileName || 'documento',
    disposition: ['application/pdf', 'image/png', 'image/jpeg'].includes(version.mimeType) ? inlineContentDisposition(version.originalFileName || 'documento') : `attachment; filename="${safeDocumentPathPart(version.originalFileName || 'documento')}"`
  };
}

export async function resolveSignedProjectDocumentFile(projectId, documentId, versionId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  await loadProject(database, projectId);
  const version = await database.projectDocumentVersion.findFirst({
    where: { id: versionId, documentId, document: { projectId } },
    include: { signatureDocument: SIGNATURE }
  });
  const signature = version?.signatureDocument;
  if (!signature || signature.status !== 'CONCLUIDO' || signature.deletedAt) throw error('PDF assinado não encontrado.', 404, 'PROJECT_DOCUMENT_NOT_FOUND');
  const targetPath = resolveManagedDocumentPath(signature.finalStoragePath, {
    rootDir: dependencies.rootDir || env.uploadDir,
    requiredPrefix: 'Assinaturas/'
  });
  if (!targetPath) throw error('PDF assinado não encontrado.', 404, 'PROJECT_DOCUMENT_NOT_FOUND');
  return { targetPath, mimeType: 'application/pdf', fileName: `${version.originalFileName || 'documento'}-assinado.pdf`, disposition: inlineContentDisposition(`${version.originalFileName || 'documento'}-assinado.pdf`) };
}

export async function recordProjectDocumentAcceptance(projectId, documentId, input, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runTransaction(database, async tx => {
    const project = await loadProject(tx, projectId);
    assertProjectMutable(project);
    const document = await loadDocument(tx, projectId, documentId, { history: true });
    assertExpectedVersion(document, input.expectedVersion);
    assertUserMutableDocument(document);
    assertTypePermission(project, document.type, context);
    if (!['INTERNAL', 'CLIENT'].includes(document.acceptanceMode)) {
      throw error('Este documento não aceita decisão manual.', 409, 'PROJECT_DOCUMENT_ACCEPTANCE_NOT_ALLOWED');
    }
    if (input.versionId !== document.currentVersionId) {
      throw conflictError('O aceite deve ser registrado na versão vigente.', [], 'PROJECT_DOCUMENT_VERSION_CONFLICT');
    }
    await tx.projectDocumentVersion.update({
      where: { id: input.versionId },
      data: {
        acceptanceStatus: input.status,
        acceptanceOccurredOn: new Date(`${input.occurredOn}T00:00:00.000Z`),
        acceptanceReference: input.reference || null,
        acceptanceNote: input.note || null,
        acceptanceRecordedAt: dependencies.now || new Date(),
        acceptanceRecordedByUserId: context.actorUserId || null
      }
    });
    await tx.projectDocument.update({ where: { id: documentId }, data: { version: { increment: 1 }, updatedByUserId: context.actorUserId || null } });
    const sideEffect = await documentWorkflowSideEffect(tx, project, context, 'PROJECT_DOCUMENT_ACCEPTANCE_RECORDED', {
      documentId,
      versionId: input.versionId,
      status: input.status,
      occurredOn: input.occurredOn
    }, document.requirementStage === 'MOBILIZATION');
    const saved = await loadDocument(tx, projectId, documentId, { history: true });
    return { document: serializeProjectDocument(saved, project, context, dependencies), ...sideEffect };
  });
}

async function setArchived(projectId, documentId, input, context, archived, dependencies) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runTransaction(database, async tx => {
    const project = await loadProject(tx, projectId);
    assertProjectMutable(project);
    const document = await loadDocument(tx, projectId, documentId, { history: true });
    assertExpectedVersion(document, input.expectedVersion);
    assertUserMutableDocument(document);
    assertTypePermission(project, document.type, context);
    await tx.projectDocument.update({
      where: { id: documentId },
      data: {
        archivedAt: archived ? dependencies.now || new Date() : null,
        archivedByUserId: archived ? context.actorUserId || null : null,
        updatedByUserId: context.actorUserId || null,
        version: { increment: 1 }
      }
    });
    const sideEffect = await documentWorkflowSideEffect(tx, project, context, archived ? 'PROJECT_DOCUMENT_ARCHIVED' : 'PROJECT_DOCUMENT_RESTORED', { documentId }, document.requirementStage === 'MOBILIZATION');
    const saved = await loadDocument(tx, projectId, documentId, { history: true });
    return { document: serializeProjectDocument(saved, project, context, dependencies), ...sideEffect };
  });
}

export function archiveProjectDocument(projectId, documentId, input, context = {}, dependencies = {}) {
  return setArchived(projectId, documentId, input, context, true, dependencies);
}

export function restoreProjectDocument(projectId, documentId, input, context = {}, dependencies = {}) {
  return setArchived(projectId, documentId, input, context, false, dependencies);
}

export async function prepareProjectDocumentSignature(projectId, documentId, input, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runTransaction(database, async tx => {
    const project = await loadProject(tx, projectId);
    assertProjectMutable(project);
    const document = await loadDocument(tx, projectId, documentId, { history: true });
    assertExpectedVersion(document, input.expectedVersion);
    assertUserMutableDocument(document);
    assertTypePermission(project, document.type, context);
    if (!canPrepareSignatures(project, context)) throw error('Você não possui acesso para preparar assinaturas.', 403, 'PROJECT_DOCUMENT_FORBIDDEN');
    if (document.acceptanceMode !== 'SIGNATURE' || input.versionId !== document.currentVersionId || document.currentVersion?.mimeType !== 'application/pdf') {
      throw error('Somente a versão PDF vigente configurada para assinatura pode iniciar este fluxo.', 409, 'SIGNATURE_NOT_ELIGIBLE');
    }
    const linked = document.currentVersion.signatureDocument;
    if (linked && !linked.deletedAt && linked.status !== 'CANCELADO') {
      return { signatureDocumentId: linked.id, status: linked.status, openUrl: `/assinaturas?doc=${encodeURIComponent(linked.id)}` };
    }
    const targetPath = resolveProjectDocumentStoragePath(document.currentVersion.storagePath, dependencies);
    if (!targetPath) throw error('O PDF vigente não está acessível.', 404, 'PROJECT_DOCUMENT_NOT_FOUND');
    const bytes = await fs.readFile(targetPath);
    const create = dependencies.createSignatureDocument || createSignatureDocument;
    const signature = await create(tx, {
      ownerUserId: context.actorUserId,
      requesterNameSnapshot: context.user?.name || 'Usuário',
      fileName: document.currentVersion.originalFileName,
      pdfDataUrl: `data:application/pdf;base64,${bytes.toString('base64')}`,
      title: document.title
    }, dependencies.signatureDependencies || {});
    await tx.projectDocumentVersion.update({ where: { id: document.currentVersionId }, data: { signatureDocumentId: signature.id } });
    await tx.projectDocument.update({ where: { id: documentId }, data: { version: { increment: 1 }, updatedByUserId: context.actorUserId || null } });
    await documentWorkflowSideEffect(tx, project, context, 'PROJECT_DOCUMENT_SIGNATURE_PREPARED', { documentId, versionId: input.versionId, signatureDocumentId: signature.id }, document.requirementStage === 'MOBILIZATION');
    return { signatureDocumentId: signature.id, status: signature.status, openUrl: `/assinaturas?doc=${encodeURIComponent(signature.id)}` };
  });
}

function crmVersionOrder(left, right) {
  const leftTime = new Date(left.sourceUpdatedAt).getTime();
  const rightTime = new Date(right.sourceUpdatedAt).getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left.sourceVersion).localeCompare(String(right.sourceVersion), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

export async function upsertCrmProjectDocument(databaseInput, rawInput, dependencies = {}) {
  const input = schemas.crm.parse(rawInput);
  const database = await resolvePlanningDatabase(databaseInput || dependencies.database);
  const project = await loadProject(database, input.projectId);
  const now = dependencies.now || new Date();
  return runTransaction(database, async tx => {
    let document = await tx.projectDocument.findFirst({
      where: { projectId: input.projectId, type: input.type, versions: { some: { source: 'CRM', externalId: input.externalId } } },
      include: { ...DOCUMENT_INCLUDE, versions: { include: VERSION_INCLUDE, orderBy: { sequence: 'desc' } } }
    });
    const existing = document?.versions?.find(version => version.source === 'CRM' && version.externalId === input.externalId && version.sourceVersion === input.sourceVersion);
    if (existing) {
      await tx.projectDocumentVersion.update({ where: { id: existing.id }, data: { lastSyncedAt: now, externalUrl: input.externalUrl || existing.externalUrl } });
      await recordWorkflowEvent(tx, input.projectId, null, 'PROJECT_DOCUMENT_CRM_REPLAYED', { documentId: document.id, versionId: existing.id, externalId: input.externalId, sourceVersion: input.sourceVersion });
      return { outcome: 'REPLAYED', documentId: document.id, versionId: existing.id };
    }
    let createdDocument = false;
    if (!document) {
      document = await tx.projectDocument.create({
        data: {
          projectId: input.projectId,
          type: input.type,
          title: input.title,
          description: input.description || null,
          requirementStage: input.requirementStage || null,
          acceptanceMode: input.acceptanceMode
        },
        include: { ...DOCUMENT_INCLUDE, versions: { include: VERSION_INCLUDE, orderBy: { sequence: 'desc' } } }
      });
      document.versions = [];
      createdDocument = true;
    }
    const current = document.currentVersion;
    const candidate = { sourceUpdatedAt: input.sourceUpdatedAt, sourceVersion: input.sourceVersion };
    const shouldBecomeCurrent = !current || current.source !== 'CRM' || crmVersionOrder(candidate, current) > 0;
    const sequence = (document.versions?.[0]?.sequence || 0) + 1;
    const version = await tx.projectDocumentVersion.create({
      data: {
        documentId: document.id,
        sequence,
        versionLabel: input.versionLabel || null,
        source: 'CRM',
        contentKind: 'EXTERNAL_REFERENCE',
        externalId: input.externalId,
        externalUrl: input.externalUrl || null,
        sourceVersion: input.sourceVersion,
        sourceUpdatedAt: input.sourceUpdatedAt,
        lastSyncedAt: now,
        acceptanceStatus: acceptanceInitialStatus(document.acceptanceMode)
      }
    });
    if (shouldBecomeCurrent) {
      await tx.projectDocument.update({
        where: { id: document.id },
        data: { currentVersionId: version.id, title: input.title, description: input.description || null, version: { increment: 1 } }
      });
      await documentWorkflowSideEffect(tx, project, {}, createdDocument ? 'PROJECT_DOCUMENT_CRM_CREATED' : 'PROJECT_DOCUMENT_CRM_CURRENT_UPDATED', {
        documentId: document.id,
        versionId: version.id,
        externalId: input.externalId,
        sourceVersion: input.sourceVersion
      }, document.requirementStage === 'MOBILIZATION');
      return { outcome: createdDocument ? 'CREATED' : 'CURRENT_UPDATED', documentId: document.id, versionId: version.id };
    }
    await recordWorkflowEvent(tx, input.projectId, null, 'PROJECT_DOCUMENT_CRM_OLDER_IGNORED', { documentId: document.id, versionId: version.id, externalId: input.externalId, sourceVersion: input.sourceVersion });
    return { outcome: 'IGNORED_OLDER', documentId: document.id, versionId: version.id };
  });
}
