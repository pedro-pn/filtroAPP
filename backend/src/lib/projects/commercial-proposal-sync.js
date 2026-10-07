import { createHash } from 'node:crypto';
import { z } from 'zod';

import env from '../../config/env.js';
import prisma from '../prisma.js';
import { syncCommercialAppScope } from '../acompanhamento/commercialapp-scope.js';
import { parseProjectDocumentUpload, storeProjectDocumentFile, removeProjectDocumentFile } from '../efetivo/project-workflow/documents.js';
import { runTrackedJob } from '../jobs/runner.js';
import { clearProjectDerivedCaches } from '../resource-list-cache.js';

const MAX_PDF_BYTES = 10_000_000;
const MAX_JSON_BYTES = 10_000_000;
const DOCUMENT_TYPES = { COMERCIAL: 'COMMERCIAL_PROPOSAL', TECNICA: 'TECHNICAL_PROPOSAL' };
const bundleSchema = z.object({
  contractVersion: z.literal(1), proposalId: z.string().min(1).max(100),
  proposalCode: z.string().regex(/^\d{1,40}$/), revisionNumber: z.number().int().min(0),
  clientCnpj: z.string(), projectId: z.string().nullable(), sourceUpdatedAt: z.iso.datetime({ offset: true }),
  scope: z.unknown(), costBreakdown: z.unknown(), proposalSnapshot: z.unknown(),
  documents: z.array(z.object({
    id: z.string().min(1).max(100), kind: z.enum(['COMERCIAL', 'TECNICA']),
    generationId: z.string().min(1).max(100), fileName: z.string().min(1).max(255),
    mimeType: z.literal('application/pdf'), byteSize: z.number().int().positive().max(MAX_PDF_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  })).length(2)
});

function syncError(code) { return Object.assign(new Error(code), { code }); }
const cnpj = value => String(value || '').replace(/\D/g, '');

export function commercialAppConnection({ apiUrl = env.comercialAppApiUrl, token = env.comercialAppServiceToken, production = env.nodeEnv === 'production' } = {}) {
  if (!apiUrl || !token) throw syncError('COMERCIALAPP_NOT_CONFIGURED');
  let base;
  try { base = new URL(apiUrl); } catch { throw syncError('COMERCIALAPP_URL_INVALID'); }
  const local = !production && base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash ||
      base.pathname !== '/' || !(base.protocol === 'https:' || local)) throw syncError('COMERCIALAPP_URL_INVALID');
  return { origin: base.origin, token };
}

export async function readLimitedCommercialResponse(response, maximumBytes) {
  if (!response.ok) {
    await response.body?.cancel();
    throw syncError(`COMERCIALAPP_HTTP_${response.status}`);
  }
  if (Number(response.headers.get('content-length')) > maximumBytes) {
    await response.body?.cancel();
    throw syncError('COMERCIALAPP_RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw syncError('COMERCIALAPP_EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximumBytes) {
        await reader.cancel();
        throw syncError('COMERCIALAPP_RESPONSE_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function fetchCommercialProposal(project, state, options = {}) {
  const connection = commercialAppConnection(options);
  const transport = options.transport || fetch;
  const base = `${connection.origin}/api/integrations/filtroapp/propostas/${encodeURIComponent(state.proposalCode)}/revisoes/${state.revisionNumber}`;
  const get = url => transport(url, {
    headers: { Authorization: `Bearer ${connection.token}` },
    redirect: 'error', signal: AbortSignal.timeout(15_000)
  });
  const body = await readLimitedCommercialResponse(await get(base), MAX_JSON_BYTES);
  let bundle;
  try { bundle = bundleSchema.parse(JSON.parse(body.toString('utf8'))); }
  catch { throw syncError('COMERCIALAPP_CONTRACT_INVALID'); }
  if (bundle.proposalCode !== state.proposalCode || bundle.revisionNumber !== state.revisionNumber ||
      bundle.projectId && bundle.projectId !== project.id ||
      !cnpj(project.clientCnpj) || cnpj(bundle.clientCnpj) !== cnpj(project.clientCnpj) ||
      new Set(bundle.documents.map(document => document.kind)).size !== 2 ||
      new Set(bundle.documents.map(document => document.id)).size !== 2 ||
      new Set(bundle.documents.map(document => document.generationId)).size !== 1) {
    throw syncError('COMERCIALAPP_IDENTITY_MISMATCH');
  }
  const files = [];
  for (const document of bundle.documents) {
    const response = await get(`${base}/documentos/${encodeURIComponent(document.id)}`);
    const bytes = await readLimitedCommercialResponse(response, MAX_PDF_BYTES);
    if (bytes.length !== document.byteSize || createHash('sha256').update(bytes).digest('hex') !== document.sha256 ||
        !/^application\/pdf(?:\s*;|$)/i.test(response.headers.get('content-type') || '') ||
        bytes.subarray(0, 5).toString() !== '%PDF-') throw syncError('COMERCIALAPP_DOCUMENT_INVALID');
    const parsed = parseProjectDocumentUpload(document.fileName, `data:application/pdf;base64,${bytes.toString('base64')}`);
    files.push({ document, parsed });
  }
  return { bundle, files };
}

async function saveProposalDocument(tx, project, bundle, file) {
  const type = DOCUMENT_TYPES[file.document.kind];
  const externalId = `comercialapp:${type}`;
  const sourceVersion = `${bundle.proposalCode}:${bundle.revisionNumber}:${file.document.id}`;
  let document = await tx.projectDocument.findFirst({
    where: { projectId: project.id, type, versions: { some: { source: 'SYSTEM', externalId } } },
    include: { versions: { orderBy: { sequence: 'desc' } } }
  });
  const title = `Proposta ${file.document.kind === 'COMERCIAL' ? 'comercial' : 'técnica'} ${bundle.proposalCode} — Rev. ${bundle.revisionNumber}`;
  if (!document) document = await tx.projectDocument.create({
    data: { projectId: project.id, type, title, acceptanceMode: 'NONE', requirementStage: 'HANDOVER' }
  });
  const existing = document.versions?.find(version => version.source === 'SYSTEM' && version.sourceVersion === sourceVersion);
  if (existing) {
    if (existing.sha256 !== file.parsed.sha256) throw syncError('COMERCIALAPP_DOCUMENT_CONFLICT');
    if (document.currentVersionId !== existing.id) await tx.projectDocument.update({
      where: { id: document.id },
      data: { title, currentVersionId: existing.id, archivedAt: null, archivedByUserId: null, version: { increment: 1 } }
    });
    return { documentId: document.id, versionId: existing.id, usedFile: false };
  }
  const version = await tx.projectDocumentVersion.create({ data: {
    documentId: document.id, sequence: (document.versions?.[0]?.sequence || 0) + 1,
    versionLabel: `${bundle.proposalCode} Rev. ${bundle.revisionNumber}`,
    source: 'SYSTEM', contentKind: 'MANAGED_FILE', externalId, sourceVersion,
    sourceUpdatedAt: new Date(bundle.sourceUpdatedAt), lastSyncedAt: new Date(),
    originalFileName: file.parsed.originalFileName, mimeType: file.parsed.mimeType,
    fileSizeBytes: file.parsed.bytes.length, storagePath: file.storagePath, sha256: file.parsed.sha256,
    acceptanceStatus: 'NOT_REQUIRED'
  } });
  await tx.projectDocument.update({
    where: { id: document.id },
    data: { title, currentVersionId: version.id, archivedAt: null, archivedByUserId: null, version: { increment: 1 } }
  });
  return { documentId: document.id, versionId: version.id, usedFile: true };
}

export async function syncCommercialProposal(projectId, options = {}) {
  const database = options.database || prisma;
  const project = await database.project.findUnique({ where: { id: projectId }, include: { workflow: true } });
  const state = project?.commercialProposalSync;
  if (!project?.isActive || project.deletedAt || project.workflow?.stage === 'FINISHED' ||
      !state?.requestId || state.status === 'SYNCED') return { status: 'SKIPPED' };
  const staged = [];
  const usedFiles = new Set();
  try {
    const { bundle, files } = await fetchCommercialProposal(project, state, options);
    for (const file of files) {
      const storagePath = await storeProjectDocumentFile(project, DOCUMENT_TYPES[file.document.kind], file.parsed, {
        rootDir: options.rootDir, writeManagedDocumentFile: options.writeManagedDocumentFile
      });
      staged.push({ ...file, storagePath });
    }
    const result = await database.$transaction(async tx => {
      // Trava o projeto e não aplica respostas de uma revisão que já foi substituída.
      const claim = await tx.project.updateMany({
        where: { id: project.id, isActive: true, deletedAt: null, commercialProposalSync: { equals: state } },
        data: { commercialProposalSync: { ...state, status: 'APPLYING' } }
      });
      if (claim.count !== 1) return { status: 'SUPERSEDED' };
      const current = await tx.project.findUnique({ where: { id: project.id }, include: { workflow: true } });
      if (current.workflow?.stage === 'FINISHED') throw syncError('PROJECT_FINISHED');
      const saved = [];
      for (const file of staged) saved.push(await saveProposalDocument(tx, current, bundle, file));
      const scope = await syncCommercialAppScope(tx, project.id, { externalId: bundle.proposalId, snapshot: bundle });
      const now = new Date();
      await tx.project.update({ where: { id: project.id }, data: {
        commercialProposalSync: { ...state, status: 'SYNCED', errorCode: null, syncedAt: now.toISOString(),
          documentIds: saved.map(item => item.documentId), scopeStatus: scope.status, scopeIssues: scope.issues },
        commercialProposalSyncNextAttemptAt: null
      } });
      if (current.workflow) await tx.projectWorkflowEvent.create({ data: {
        projectId: project.id, actorUserId: null, action: 'COMMERCIALAPP_PROPOSAL_SYNCED',
        data: { proposalCode: bundle.proposalCode, revisionNumber: bundle.revisionNumber,
          documentIds: saved.map(item => item.documentId), scopeStatus: scope.status }
      } });
      return { status: 'SYNCED', scope, saved };
    }, { isolationLevel: 'Serializable', timeout: 15_000 });
    if (result.status === 'SYNCED') {
      result.saved.forEach((saved, index) => { if (saved.usedFile) usedFiles.add(staged[index].storagePath); });
      clearProjectDerivedCaches();
    }
    return result;
  } catch (error) {
    const attempts = (state.attempts || 0) + 1;
    const nextAttemptAt = new Date(Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(attempts - 1, 6)));
    const errorCode = /^COMERCIALAPP_[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'COMERCIALAPP_SYNC_FAILED';
    await database.project.updateMany({
      where: { id: project.id, commercialProposalSync: { equals: state } },
      data: { commercialProposalSync: { ...state, status: 'ERROR', attempts, errorCode }, commercialProposalSyncNextAttemptAt: nextAttemptAt }
    });
    return { status: 'ERROR', errorCode };
  } finally {
    for (const file of staged) if (!usedFiles.has(file.storagePath)) {
      await removeProjectDocumentFile(file.storagePath, options).catch(error => {
        console.error('Falha ao remover arquivo de proposta não utilizado.', error.code || 'FILE_CLEANUP_FAILED');
      });
    }
  }
}

export async function processCommercialProposalSyncs(options = {}) {
  const database = options.database || prisma;
  commercialAppConnection(options);
  const due = await database.project.findMany({
    where: { isActive: true, deletedAt: null, commercialProposalSyncNextAttemptAt: { lte: new Date() },
      OR: [{ workflow: { is: null } }, { workflow: { is: { stage: { not: 'FINISHED' } } } }] },
    select: { id: true }, orderBy: [{ commercialProposalSyncNextAttemptAt: 'asc' }, { id: 'asc' }], take: 2
  });
  const results = [];
  for (const project of due) results.push(await syncCommercialProposal(project.id, options));
  return results;
}

export function startCommercialProposalSyncJob() {
  if (!env.comercialAppApiUrl || !env.comercialAppServiceToken) return;
  const run = () => runTrackedJob('commercialapp-proposal-sync', () => processCommercialProposalSyncs(), {
    lockTtlMs: 5 * 60_000, recordSkipped: false
  }).catch(error => console.error('Falha na busca de propostas do ComercialAPP.', error.code || 'COMERCIALAPP_SYNC_FAILED'));
  void run();
  const timer = setInterval(run, 60_000);
  timer.unref();
}
