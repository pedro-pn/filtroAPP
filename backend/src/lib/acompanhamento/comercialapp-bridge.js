import { createHash } from 'node:crypto';
import { z } from 'zod';
import prisma from '../prisma.js';
import { clearProjectDerivedCaches } from '../resource-list-cache.js';
import { commercialProposalNature, syncCommercialAppScope } from './commercialapp-scope.js';
import { commercialProposalSyncData } from '../projects/commercial-proposal-sync-state.js';
import { CommercialAppBridgeError, commercialTransaction, lockCommercialProject, selectContribution, validateContributionParent, contributionWhere, assertPrincipalContributionCompatibility } from './commercial-contributions.js';
export { CommercialAppBridgeError } from './commercial-contributions.js';

const decimal = z.number().finite().min(0).max(999999999999.99);
const nonnegative = z.number().finite().min(0);
const estimateSummarySchema = z.object({
  schemaVersion: z.literal(1),
  hours: z.object({ normal: nonnegative, overtime: nonnegative, total: nonnegative }),
  workload: z.object({
    personDays: nonnegative,
    peakHeadcount: nonnegative,
    phases: z.array(z.object({
      name: z.string(), durationDays: nonnegative, workingDays: nonnegative,
      headcount: nonnegative, normalHours: nonnegative, overtimeHours: nonnegative,
      totalHours: nonnegative
    })).max(200)
  }),
  costs: z.object({
    labor: nonnegative, indirect: nonnegative, materials: nonnegative, inputs: nonnegative,
    filters: nonnegative, effluent: nonnegative, mobilization: nonnegative,
    demobilization: nonnegative, referralBonus: nonnegative,
    direct: nonnegative, overhead: nonnegative,
    total: nonnegative, taxesAtEstimatePrice: nonnegative,
    commissionAtEstimatePrice: nonnegative,
    representativeCommissionAtEstimatePrice: nonnegative,
    commercialExpenseAtEstimatePrice: nonnegative
  })
}).superRefine((summary, context) => {
  if (Math.abs(summary.hours.normal + summary.hours.overtime - summary.hours.total) > 0.02) {
    context.addIssue({ code: 'custom', path: ['hours'], message: 'Total de horas diverge das horas normais e extras.' });
  }
});
const payloadSchema = z.object({
  contractVersion: z.union([z.literal(1), z.literal(3)]),
  proposalKind: z.literal('ADDITIONAL').optional(),
  parentProposalCode: z.string().min(1).max(40).optional(),
  additionalProposalId: z.string().min(1).max(100).optional(),
  sourceProposalId: z.string().min(1).nullable().optional(),
  sourceRevisionNumber: z.number().int().min(0).nullable().optional(),
  contributionKey: z.string().optional(),
  budgetOperation: z.literal('UPSERT_ADDITIONAL_CONTRIBUTION').optional(),
  prismaProjectId: z.string().min(1).nullable().optional(),
  documents: z.array(z.object({
    id: z.string().min(1), kind: z.enum(['COMERCIAL', 'TECNICA']),
    fileName: z.string().min(1), byteSize: z.number().int().positive().max(10_000_000),
    generationId: z.string().min(1).optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
  }).passthrough()).min(1).max(2).optional(),
  documentsReference: z.object({ proposalCode: z.string(), revisionNumber: z.number().int().min(0) }).optional(),
  eventId: z.string().uuid(),
  source: z.literal('COMERCIAL_APP'),
  proposalId: z.string().min(1),
  proposalCode: z.string().min(1).max(40),
  revisionNumber: z.number().int().min(0),
  projectId: z.string().min(1),
  nectarOpportunityId: z.string().nullable(),
  approvedAt: z.iso.datetime(),
  client: z.object({ name: z.string().min(1), cnpj: z.string(),
    contact: z.string(), email: z.string() }),
  title: z.string(), site: z.string(),
  scope: z.unknown(),
  salePrice: decimal,
  plannedTotalCost: decimal.nullable(),
  expectedMargin: z.number().finite().nullable(),
  costBreakdown: z.unknown(),
  estimateSummary: estimateSummarySchema.nullable().optional(),
  proposalSnapshot: z.unknown()
}).superRefine((data, context) => {
  if (data.contractVersion === 3) {
    if (data.proposalKind !== 'ADDITIONAL' || !data.parentProposalCode || !data.additionalProposalId ||
        data.contributionKey !== `COMERCIAL_APP:${data.proposalCode}` ||
        data.budgetOperation !== 'UPSERT_ADDITIONAL_CONTRIBUTION' ||
        data.parentProposalCode === data.proposalCode || data.sourceRevisionNumber === undefined ||
        data.sourceProposalId === undefined) {
      context.addIssue({ code: 'custom', message: 'Identidade de contribuição adicional inválida.' });
    }
  } else if (data.proposalKind || data.parentProposalCode || data.additionalProposalId || data.contributionKey || data.budgetOperation) {
    context.addIssue({ code: 'custom', message: 'Adicionais exigem contrato 3.' });
  }
  const expectedDocumentKinds = ['equipment_rental', 'equipment_sale'].includes(commercialProposalNature(data)) ? ['COMERCIAL'] : ['COMERCIAL', 'TECNICA'];
  if (data.documents && (data.documents.length !== expectedDocumentKinds.length
      || !expectedDocumentKinds.every(kind => data.documents.some(row => row.kind === kind))
      || new Set(data.documents.map(row => row.id)).size !== expectedDocumentKinds.length)) {
    context.addIssue({ code: 'custom', message: 'Documentos precisam corresponder aos tipos exigidos pela natureza da proposta.' });
  }
  if (data.documentsReference && (data.documentsReference.proposalCode !== data.proposalCode ||
      data.documentsReference.revisionNumber !== data.revisionNumber)) {
    context.addIssue({ code: 'custom', message: 'Referência dos documentos diverge da revisão.' });
  }
  if (data.estimateSummary && (data.plannedTotalCost === null ||
    Math.abs(data.estimateSummary.costs.total - data.plannedTotalCost) > 0.02)) {
    context.addIssue({ code: 'custom', path: ['estimateSummary', 'costs', 'total'],
      message: 'O custo total calculado difere do custo previsto da proposta.' });
  }
});

export const commercialAppPayloadSchema = payloadSchema.superRefine((data, context) => {
  if (data.contractVersion === 3 && (!data.documents || !data.documentsReference)) {
    context.addIssue({ code: 'custom', message: 'Push adicional exige documentos e referência da revisão.' });
  }
});

// Uma consulta pode anteceder a aprovação no CRM e não representa uma entrega.
export const commercialAppQueryPayloadSchema = payloadSchema.safeExtend({
  eventId: z.string().uuid().optional(),
  approvedAt: z.iso.datetime().nullable()
});

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
function hash(value) { return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex'); }

function withoutEstimateSummary(value) {
  const { estimateSummary: _estimateSummary, eventId: _eventId, approvedAt: _approvedAt,
    nectarOpportunityId: _nectarOpportunityId, documents: _documents, documentsReference: _documentsReference, ...base } = value;
  return base;
}

function proposalSnapshotHash(value) {
  const { eventId: _eventId, approvedAt: _approvedAt,
    nectarOpportunityId: _nectarOpportunityId, documents: _documents,
    documentsReference: _documentsReference, ...immutable } = value;
  return hash({ ...immutable, estimateSummary: value.estimateSummary ?? null });
}

export function canUpgradeLegacyProposal(existing, data, { sameEvent = false } = {}) {
  if (!existing?.snapshot || existing.snapshot.contractVersion === 3 || data.contractVersion === 3 || sameEvent &&
    (existing.snapshot.eventId !== data.eventId || existing.snapshot.approvedAt !== data.approvedAt)) return false;
  const old = withoutEstimateSummary(existing.snapshot);
  const next = withoutEstimateSummary(data);
  const legacyScope = old.proposalSnapshot?.scope ?? old.proposalSnapshot?.technicalServices ?? [];
  const updatedScope = old.proposalSnapshot?.scopeItems ?? legacyScope;
  const scopeHash = value => hash(value ?? null);
  const scopeUpgrade = scopeHash(old.scope) === scopeHash(legacyScope)
    && scopeHash(data.scope) === scopeHash(updatedScope)
    && scopeHash(old.scope) !== scopeHash(data.scope);
  const summaryUpgrade = existing.snapshot.estimateSummary == null && Boolean(data.estimateSummary);
  if (!scopeUpgrade && !summaryUpgrade) return false;
  if (scopeUpgrade) old.scope = updatedScope;
  return hash(old) === hash(next) &&
    (!existing.snapshot.estimateSummary || hash(existing.snapshot.estimateSummary) === hash(data.estimateSummary));
}

function budgetFields(proposal) {
  const sale = Number(proposal.salePrice);
  const cost = proposal.plannedTotalCost == null ? null : Number(proposal.plannedTotalCost);
  return {
    source: 'COMERCIAL_APP', sourceProposalCodBd: null,
    commercialAppProposalId: proposal.externalId,
    commercialAppRevision: proposal.revisionNumber,
    serviceModality: null, taxes: null, plannedDays: null,
    mobilizationLeadDays: null,
    salePrice: sale, plannedTotalCost: cost,
    expectedProfit: cost == null ? null : sale - cost,
    expectedMargin: proposal.expectedMargin,
    isComplete: true, selectionStatus: 'CHOSEN',
    approvedAt: proposal.approvedAt
  };
}

async function storeCommercialAppProposal(tx, data) {
  const existing = await tx.commercialAppProposal.findUnique({ where: { externalId: data.proposalId } });
  const revision = await tx.commercialAppProposal.findUnique({ where: {
    proposalCode_revisionNumber: { proposalCode: data.proposalCode, revisionNumber: data.revisionNumber }
  } });
  if (revision && revision.externalId !== data.proposalId) {
    throw new CommercialAppBridgeError(409, 'Número/revisão já armazenados com outra identidade.');
  }
  if (data.proposalKind === 'ADDITIONAL') {
    const sibling = await tx.commercialAppProposal.findFirst({ where: { OR: [
      { proposalCode: data.proposalCode }, { additionalProposalId: data.additionalProposalId }
    ] } });
    if (sibling && (sibling.additionalProposalId !== data.additionalProposalId ||
        sibling.parentProposalCode !== data.parentProposalCode || sibling.projectId !== data.projectId ||
        sibling.proposalCode !== data.proposalCode || sibling.clientCnpj.replace(/\D/g, '') !== data.client.cnpj.replace(/\D/g, '') ||
        sibling.sourceProposalId !== data.sourceProposalId || sibling.sourceRevisionNumber !== data.sourceRevisionNumber ||
        sibling.prismaProjectId && data.prismaProjectId && sibling.prismaProjectId !== data.prismaProjectId)) {
      throw new CommercialAppBridgeError(409, 'A identidade estável do adicional diverge das revisões recebidas.');
    }
  }
  if (existing && (existing.projectId !== data.projectId ||
      proposalSnapshotHash(existing.snapshot) !== proposalSnapshotHash(data) && !canUpgradeLegacyProposal(existing, data))) {
    throw new CommercialAppBridgeError(409, 'Proposta e revisão já recebidas com conteúdo ou projeto diferente.');
  }
  if (existing?.snapshot?.documents && data.documents) {
    for (const document of data.documents) {
      const old = existing.snapshot.documents.find(row => row.kind === document.kind);
      if (!old || ['id', 'byteSize', 'generationId', 'sha256'].some(key =>
        old[key] != null && document[key] != null && old[key] !== document[key])) {
        throw new CommercialAppBridgeError(409, 'Documentos da revisão já recebidos com conteúdo incompatível.');
      }
    }
  }
  const documents = data.documents?.map(document => ({
    ...existing?.snapshot?.documents?.find(row => row.id === document.id), ...document
  })) ?? existing?.snapshot?.documents;
  const snapshot = { ...data, ...(documents ? { documents } : {}),
    approvedAt: data.approvedAt ?? existing?.snapshot?.approvedAt ?? null,
    nectarOpportunityId: data.nectarOpportunityId ?? existing?.nectarOpportunityId ?? null,
    ...(data.eventId || !existing?.snapshot?.eventId ? {} : { eventId: existing.snapshot.eventId })
  };
  const fields = {
    externalId: data.proposalId, proposalCode: data.proposalCode,
    revisionNumber: data.revisionNumber, projectId: data.projectId,
    proposalKind: data.proposalKind ?? 'MAIN', parentProposalCode: data.parentProposalCode ?? null,
    additionalProposalId: data.additionalProposalId ?? null, sourceProposalId: data.sourceProposalId ?? null,
    sourceRevisionNumber: data.sourceRevisionNumber ?? null, prismaProjectId: data.prismaProjectId ?? null,
    nectarOpportunityId: snapshot.nectarOpportunityId,
    approvedAt: snapshot.approvedAt ? new Date(snapshot.approvedAt) : null,
    clientName: data.client.name, clientCnpj: data.client.cnpj, title: data.title, site: data.site,
    salePrice: data.salePrice, plannedTotalCost: data.plannedTotalCost,
    expectedMargin: data.expectedMargin, snapshot, snapshotHash: proposalSnapshotHash(snapshot)
  };
  return existing
    ? tx.commercialAppProposal.update({ where: { id: existing.id }, data: fields })
    : tx.commercialAppProposal.create({ data: fields });
}

export async function storeQueriedCommercialAppProposal(tx, project, bundle) {
  if (bundle.projectId && bundle.projectId !== project.id) {
    throw new CommercialAppBridgeError(422, 'A consulta aponta para outro projeto do FiltroAPP.');
  }
  const data = commercialAppQueryPayloadSchema.parse({ ...bundle, projectId: project.id });
  const proposal = await storeCommercialAppProposal(tx, data);
  if (data.proposalKind === 'ADDITIONAL') {
    await validateContributionParent(tx, project, proposal, 'COMERCIAL_APP', { staged: true });
    const selection = await tx.projectAdditionalProposal.findUnique({
      where: contributionWhere(project.id, 'COMERCIAL_APP', proposal.proposalCode)
    });
    const selected = selection?.active && selection.commercialAppProposalId === proposal.externalId;
    return { proposal, budgetStatus: selected ? 'SELECTED' : 'STAGED', scopeAllowed: Boolean(selected) };
  }
  const budget = await tx.projectBudget.findUnique({
    where: { projectId_version: { projectId: project.id, version: 1 } }
  });
  const previous = budget?.source === 'COMERCIAL_APP' && budget.commercialAppProposalId
    ? await tx.commercialAppProposal.findUnique({ where: { externalId: budget.commercialAppProposalId } }) : null;
  const selected = budget?.source === 'COMERCIAL_APP' && budget.commercialAppProposalId === proposal.externalId;
  const advanceAutomaticRevision = previous?.proposalCode === proposal.proposalCode
    && previous.revisionNumber < proposal.revisionNumber && !budget.selectedByUserId && !budget.selectedAt;
  if ((!budget && (!project.commercialProposalCode || project.commercialProposalCode === proposal.proposalCode))
      || advanceAutomaticRevision) {
    await tx.projectBudget.upsert({
      where: { projectId_version: { projectId: project.id, version: 1 } },
      create: { projectId: project.id, version: 1, ...budgetFields(proposal) },
      update: budgetFields(proposal)
    });
    await tx.project.update({ where: { id: project.id }, data: { commercialProposalCode: proposal.proposalCode } });
    await tx.commercialAppProposal.updateMany({
      where: { projectId: project.id, proposalKind: 'MAIN', selectionStatus: 'SELECTED', id: { not: proposal.id } },
      data: { selectionStatus: 'STAGED' }
    });
    await tx.commercialAppProposal.update({ where: { id: proposal.id },
      data: { selectionStatus: 'SELECTED', selectedAt: new Date() } });
    return { proposal, budgetStatus: 'SELECTED', scopeAllowed: true };
  }
  if (selected && !budget.approvedAt && proposal.approvedAt) {
    await tx.projectBudget.update({ where: { id: budget.id }, data: { approvedAt: proposal.approvedAt } });
  }
  const accessProposal = budget?.source === 'ACCESS_IMPORT' && budget.sourceProposalCodBd != null
    ? await tx.commercialProposal.findUnique({ where: { codBd: budget.sourceProposalCodBd },
      select: { codProp: true, nRev: true } }) : null;
  return { proposal, budgetStatus: selected ? 'SELECTED' : 'STAGED',
    scopeAllowed: selected || Boolean(accessProposal && String(accessProposal.codProp) === proposal.proposalCode
      && accessProposal.nRev === proposal.revisionNumber) };
}

export async function receiveCommercialAppProposal(raw) {
  const data = commercialAppPayloadSchema.parse(raw);
  if (commercialProposalNature(data) === 'equipment_sale') throw new CommercialAppBridgeError(422, 'Venda de equipamentos não integra o acompanhamento operacional.');
  if (data.proposalKind === 'ADDITIONAL') return receiveAdditionalProposal(data, raw);
  const deliveryHash = hash(data);
  const snapshotHash = proposalSnapshotHash(data);
  let result;
  try {
    result = await commercialTransaction(async tx => {
      await lockCommercialProject(tx, data.projectId);
      const delivered = await tx.commercialAppDelivery.findUnique({ where: { eventId: data.eventId } });
      if (delivered) {
        const existing = await tx.commercialAppProposal.findUnique({ where: { externalId: data.proposalId } });
        if (delivered.externalId !== data.proposalId || !existing) {
          throw new CommercialAppBridgeError(409, 'ID de evento reutilizado com outro conteúdo.');
        }
        let current = existing;
        if (delivered.snapshotHash !== deliveryHash) {
          if (!canUpgradeLegacyProposal(existing, data, { sameEvent: true })) {
            throw new CommercialAppBridgeError(409, 'ID de evento reutilizado com outro conteúdo.');
          }
          await tx.commercialAppProposal.update({ where: { id: existing.id },
            data: { snapshot: data, snapshotHash } });
          await tx.commercialAppDelivery.update({ where: { eventId: data.eventId },
            data: { snapshotHash: deliveryHash } });
          current = { ...existing, snapshot: data };
        }
        const budget = await tx.projectBudget.findUnique({
          where: { projectId_version: { projectId: existing.projectId, version: 1 } }
        });
        const selected = budget?.source === 'COMERCIAL_APP'
          && budget.commercialAppProposalId === existing.externalId;
        const scopeImport = selected ? await syncCommercialAppScope(tx, existing.projectId, current) : null;
        return { duplicate: true, budgetStatus: selected ? 'SELECTED' : 'STAGED',
          projectId: existing?.projectId, scopeImport };
      }
      const project = await tx.project.findFirst({
        where: { id: data.projectId, deletedAt: null, isActive: true }
      });
      if (!project) throw new CommercialAppBridgeError(422, 'Projeto informado pelo CRM não existe no FiltroAPP.');
      const proposal = await storeCommercialAppProposal(tx, data);
      const budget = await tx.projectBudget.findUnique({
        where: { projectId_version: { projectId: data.projectId, version: 1 } }
      });
      let selected = budget?.source === 'COMERCIAL_APP'
        && budget.commercialAppProposalId === proposal.externalId;
      if (!budget && (!project.commercialProposalCode || project.commercialProposalCode === data.proposalCode)) {
        await tx.projectBudget.create({ data: {
          projectId: data.projectId, version: 1, ...budgetFields(proposal)
        } });
        await tx.project.update({ where: { id: data.projectId },
          data: { commercialProposalCode: data.proposalCode, ...commercialProposalSyncData(
            { proposalCode: data.proposalCode, revisionNumber: data.revisionNumber }, project.commercialProposalSync
          ) } });
        await tx.commercialAppProposal.update({ where: { id: proposal.id },
          data: { selectionStatus: 'SELECTED', selectedAt: new Date() } });
        selected = true;
      }
      if (selected && !budget?.approvedAt && proposal.approvedAt && budget) {
        await tx.projectBudget.update({ where: { id: budget.id }, data: { approvedAt: proposal.approvedAt } });
      }
      const scopeImport = selected ? await syncCommercialAppScope(tx, data.projectId, proposal) : null;
      await tx.commercialAppDelivery.create({ data: {
        eventId: data.eventId, externalId: data.proposalId, snapshotHash: deliveryHash
      } });
      return { duplicate: false, budgetStatus: selected ? 'SELECTED' : 'STAGED',
        projectId: data.projectId, proposalId: proposal.id, scopeImport };
    });
  } catch (error) {
    if (error.code === 'P2002') throw new CommercialAppBridgeError(409, 'Entrega concorrente ou revisão já existente.');
    throw error;
  }
  if (result.budgetStatus === 'SELECTED') clearProjectDerivedCaches();
  return result;
}

export async function listCommercialAppRevisions(projectId) {
  const rows = await prisma.commercialAppProposal.findMany({
    where: { projectId }, orderBy: [{ proposalCode: 'asc' }, { revisionNumber: 'desc' }],
    select: { id: true, externalId: true, proposalCode: true, revisionNumber: true,
      proposalKind: true, parentProposalCode: true, additionalProposalId: true, snapshot: true,
      title: true, clientName: true, salePrice: true, plannedTotalCost: true,
      selectionStatus: true, approvedAt: true, receivedAt: true }
  });
  const selections = await prisma.projectAdditionalProposal.findMany({ where: { projectId, source: 'COMERCIAL_APP' } });
  return rows.map(({ snapshot, ...row }) => {
    const selection = selections.find(item => item.proposalCode === row.proposalCode);
    return { ...row, selectionVersion: selection?.selectionVersion ?? 0,
      metricInclusion: selection?.metricInclusion ?? {}, scopeImport: selection?.scopeImport ?? null,
      documents: snapshot.documents ?? [], estimateSummary: snapshot.estimateSummary ?? null };
  });
}

export async function selectCommercialAppRevision(projectId, externalId, userId,
  { replaceLegacy = false, ...options } = {}) {
  const result = await commercialTransaction(async tx => {
    const lockedProject = await lockCommercialProject(tx, projectId);
    const proposal = await tx.commercialAppProposal.findFirst({ where: { projectId, externalId } });
    if (!proposal) throw new CommercialAppBridgeError(404, 'Revisão do ComercialAPP não encontrada para este projeto.');
    if (proposal.proposalKind === 'ADDITIONAL') {
      return selectContribution(tx, lockedProject, proposal, 'COMERCIAL_APP', { ...options, userId });
    }
    await assertPrincipalContributionCompatibility(tx, projectId, proposal.proposalCode);
    const budget = await tx.projectBudget.findUnique({
      where: { projectId_version: { projectId, version: 1 } }
    });
    if (budget && budget.source !== 'COMERCIAL_APP' && !replaceLegacy) {
      throw new CommercialAppBridgeError(409, 'O orçamento atual vem do Access. Confirme a troca de origem para selecionar o ComercialAPP.');
    }
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { commercialProposalSync: true } });
    const syncData = commercialProposalSyncData(
      { proposalCode: proposal.proposalCode, revisionNumber: proposal.revisionNumber }, project.commercialProposalSync,
      { force: budget?.commercialAppProposalId !== externalId && project.commercialProposalSync?.status === 'SYNCED' }
    );
    if (budget?.source === 'COMERCIAL_APP' && budget.commercialAppProposalId === externalId) {
      if (Object.keys(syncData).length) await tx.project.update({ where: { id: projectId }, data: syncData });
      return { budgetStatus: 'SELECTED', duplicate: true,
        scopeImport: await syncCommercialAppScope(tx, projectId, proposal) };
    }
    await tx.commercialAppProposal.updateMany({ where: { projectId, proposalKind: 'MAIN', selectionStatus: 'SELECTED' },
      data: { selectionStatus: 'STAGED' } });
    await tx.projectBudget.upsert({
      where: { projectId_version: { projectId, version: 1 } },
      create: { projectId, version: 1, ...budgetFields(proposal), selectedByUserId: userId,
        selectedAt: new Date() },
      update: { ...budgetFields(proposal), selectedByUserId: userId, selectedAt: new Date() }
    });
    await tx.project.update({ where: { id: projectId },
      data: { commercialProposalCode: proposal.proposalCode, ...syncData } });
    await tx.commercialAppProposal.update({ where: { id: proposal.id },
      data: { selectionStatus: 'SELECTED', selectedAt: new Date() } });
    const scopeImport = await syncCommercialAppScope(tx, projectId, proposal);
    return { budgetStatus: 'SELECTED', duplicate: false, scopeImport };
  });
  clearProjectDerivedCaches();
  return result;
}

async function receiveAdditionalProposal(data, raw) {
  const result = await commercialTransaction(async tx => {
    const delivered = await tx.commercialAppDelivery.findUnique({ where: { eventId: data.eventId } });
    if (delivered) {
      if (delivered.snapshotHash !== hash(raw) || delivered.externalId !== data.proposalId) {
        throw new CommercialAppBridgeError(409, 'ID de evento reutilizado com outro conteúdo.');
      }
      if (delivered.acknowledgement?.budgetStatus === 'STAGED') {
        const selected = await tx.projectAdditionalProposal.findUnique({
          where: contributionWhere(data.projectId, 'COMERCIAL_APP', data.proposalCode)
        });
        if (selected?.active && selected.commercialAppProposalId === data.proposalId) {
          const acknowledgement = { ...delivered.acknowledgement, budgetStatus: 'SELECTED' };
          await tx.commercialAppDelivery.update({ where: { eventId: data.eventId }, data: { acknowledgement } });
          return { ...acknowledgement, duplicate: true };
        }
      }
      return { ...delivered.acknowledgement, duplicate: true };
    }
    const project = await lockCommercialProject(tx, data.projectId);
    const proposal = await storeCommercialAppProposal(tx, data);
    const selection = await selectContribution(tx, project, proposal, 'COMERCIAL_APP', { automatic: true });
    const acknowledgement = { contractVersion: 3, budgetStatus: selection.budgetStatus,
      proposalId: data.proposalId, projectId: data.projectId, parentProposalCode: data.parentProposalCode,
      contributionKey: data.contributionKey, budgetOperation: data.budgetOperation };
    await tx.commercialAppDelivery.create({ data: { eventId: data.eventId, externalId: data.proposalId,
      snapshotHash: hash(raw), acknowledgement } });
    return { ...acknowledgement, duplicate: false };
  });
  if (!result.duplicate && result.budgetStatus === 'SELECTED') clearProjectDerivedCaches();
  return result;
}
