import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import prisma from '../prisma.js';
import { commercialTransaction, lockCommercialProject, contributionWhere } from '../acompanhamento/commercial-contributions.js';
import { resolveManagedDocumentPath } from '../documents/storage.js';
import { fetchCommercialProposal } from './commercial-proposal-sync.js';
import { queueCommercialReceipt } from './commercialapp-receipts.js';

const failure = code => Object.assign(new Error(code), { code });

// Directed reconciliation: verify existing files without reimporting any business data.
export async function prepareStoredCommercialReceipt(projectId, options = {}) {
  const database = options.database || prisma;
  const project = await database.project.findUnique({ where: { id: projectId }, include: { workflow: true } });
  const state = project?.commercialProposalSync;
  if (!project?.isActive || project.deletedAt || project.workflow?.stage === 'FINISHED' || state?.status !== 'SYNCED') {
    return { status: 'SKIPPED' };
  }
  const { bundle } = await fetchCommercialProposal(project, state, options);
  const proposal = await database.commercialAppProposal.findUnique({ where: { externalId: bundle.proposalId } });
  if (proposal?.projectId !== projectId) throw failure('COMERCIALAPP_RECEIPT_PROPOSAL_MISSING');
  const verified = [];
  for (const document of bundle.documents) {
    const prefix = `${bundle.proposalCode}:${bundle.revisionNumber}:${document.id}`;
    const version = await database.projectDocumentVersion.findFirst({ where: {
      document: { projectId }, source: 'SYSTEM',
      externalId: `comercialapp:${bundle.proposalCode}:${document.kind === 'COMERCIAL' ? 'COMMERCIAL_PROPOSAL' : 'TECHNICAL_PROPOSAL'}`,
      sourceVersion: { in: [prefix, `${prefix}:${document.generationId}`] }, sha256: document.sha256
    } });
    const filePath = version && resolveManagedDocumentPath(version.storagePath, { rootDir: options.rootDir, requiredPrefix: 'Projetos/' });
    if (!filePath) throw failure('COMERCIALAPP_RECEIPT_FILE_MISSING');
    const bytes = await readFile(filePath);
    if (bytes.length !== document.byteSize || createHash('sha256').update(bytes).digest('hex') !== document.sha256) {
      throw failure('COMERCIALAPP_RECEIPT_FILE_INVALID');
    }
    verified.push({ id: version.id, sha256: version.sha256, storagePath: version.storagePath });
  }
  return commercialTransaction(async tx => {
    const current = await lockCommercialProject(tx, projectId);
    const workflow = await tx.projectWorkflow.findUnique({ where: { projectId } });
    if (workflow?.stage === 'FINISHED') return { status: 'SKIPPED' };
    if (JSON.stringify(current.commercialProposalSync) !== JSON.stringify(state)) {
      throw failure('COMERCIALAPP_RECEIPT_STATE_CHANGED');
    }
    for (const file of verified) {
      if (!await tx.projectDocumentVersion.findFirst({ where: { ...file, document: { projectId } } })) {
        throw failure('COMERCIALAPP_RECEIPT_STATE_CHANGED');
      }
    }
    const existing = await tx.commercialAppReceipt.findFirst({ where: { projectId, externalId: bundle.proposalId } });
    if (existing) return { status: 'EXISTS', eventId: existing.eventId };
    const budget = await tx.projectBudget.findUnique({ where: { projectId_version: { projectId, version: 1 } } });
    const additional = bundle.proposalKind === 'ADDITIONAL' ? await tx.projectAdditionalProposal.findUnique({
      where: contributionWhere(projectId, 'COMERCIAL_APP', bundle.proposalCode)
    }) : null;
    const selected = bundle.proposalKind === 'ADDITIONAL'
      ? additional?.active && additional.commercialAppProposalId === bundle.proposalId
      : budget?.source === 'COMERCIAL_APP' && budget.commercialAppProposalId === bundle.proposalId;
    const scopeStatus = current.commercialScopeImport?.status === 'MANUAL_OVERRIDE' ? 'MANUAL_PRESERVED'
      : state.scopeStatus || 'NEEDS_REVIEW';
    const details = { projectId, bundle, budgetStatus: selected ? 'SELECTED' : 'STAGED', scopeStatus };
    if (!options.apply) return { status: 'VERIFIED', proposalCode: bundle.proposalCode,
      revisionNumber: bundle.revisionNumber, budgetStatus: details.budgetStatus, scopeStatus };
    const receipt = await queueCommercialReceipt(tx, details);
    return { status: 'QUEUED', eventId: receipt.eventId };
  }, database);
}
