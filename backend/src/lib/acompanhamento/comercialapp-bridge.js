import { createHash } from 'node:crypto';
import { z } from 'zod';
import prisma from '../prisma.js';
import { clearProjectDerivedCaches } from '../resource-list-cache.js';
import { syncCommercialAppScope } from './commercialapp-scope.js';
import { commercialProposalSyncData } from '../projects/commercial-proposal-sync-state.js';

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
export const commercialAppPayloadSchema = z.object({
  contractVersion: z.literal(1),
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
  if (data.estimateSummary && (data.plannedTotalCost === null ||
    Math.abs(data.estimateSummary.costs.total - data.plannedTotalCost) > 0.02)) {
    context.addIssue({ code: 'custom', path: ['estimateSummary', 'costs', 'total'],
      message: 'O custo total calculado difere do custo previsto da proposta.' });
  }
});

// Uma consulta pode anteceder a aprovação no CRM e não representa uma entrega.
export const commercialAppQueryPayloadSchema = commercialAppPayloadSchema.safeExtend({
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
    nectarOpportunityId: _nectarOpportunityId, ...base } = value;
  return base;
}

function proposalSnapshotHash(value) {
  const { eventId: _eventId, approvedAt: _approvedAt,
    nectarOpportunityId: _nectarOpportunityId, ...immutable } = value;
  return hash({ ...immutable, estimateSummary: value.estimateSummary ?? null });
}

export function canUpgradeLegacyProposal(existing, data, { sameEvent = false } = {}) {
  if (!existing?.snapshot || sameEvent &&
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

export class CommercialAppBridgeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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
  if (existing && (existing.projectId !== data.projectId ||
      proposalSnapshotHash(existing.snapshot) !== proposalSnapshotHash(data) && !canUpgradeLegacyProposal(existing, data))) {
    throw new CommercialAppBridgeError(409, 'Proposta e revisão já recebidas com conteúdo ou projeto diferente.');
  }
  const snapshot = { ...data,
    approvedAt: data.approvedAt ?? existing?.snapshot?.approvedAt ?? null,
    nectarOpportunityId: data.nectarOpportunityId ?? existing?.nectarOpportunityId ?? null,
    ...(data.eventId || !existing?.snapshot?.eventId ? {} : { eventId: existing.snapshot.eventId })
  };
  const fields = {
    externalId: data.proposalId, proposalCode: data.proposalCode,
    revisionNumber: data.revisionNumber, projectId: data.projectId,
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
  const data = commercialAppQueryPayloadSchema.parse({ ...bundle, projectId: project.id });
  const proposal = await storeCommercialAppProposal(tx, data);
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
      where: { projectId: project.id, selectionStatus: 'SELECTED', id: { not: proposal.id } },
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
  const deliveryHash = hash(data);
  const snapshotHash = proposalSnapshotHash(data);
  let result;
  try {
    result = await prisma.$transaction(async tx => {
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
  return prisma.commercialAppProposal.findMany({
    where: { projectId }, orderBy: [{ proposalCode: 'asc' }, { revisionNumber: 'desc' }],
    select: { id: true, externalId: true, proposalCode: true, revisionNumber: true,
      title: true, clientName: true, salePrice: true, plannedTotalCost: true,
      selectionStatus: true, approvedAt: true, receivedAt: true }
  });
}

export async function selectCommercialAppRevision(projectId, externalId, userId,
  { replaceLegacy = false } = {}) {
  const result = await prisma.$transaction(async tx => {
    const proposal = await tx.commercialAppProposal.findFirst({ where: { projectId, externalId } });
    if (!proposal) throw new CommercialAppBridgeError(404, 'Revisão do ComercialAPP não encontrada para este projeto.');
    const budget = await tx.projectBudget.findUnique({
      where: { projectId_version: { projectId, version: 1 } }
    });
    if (budget && budget.source !== 'COMERCIAL_APP' && !replaceLegacy) {
      throw new CommercialAppBridgeError(409, 'O orçamento atual vem do Access. Confirme a troca de origem para selecionar o ComercialAPP.');
    }
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { commercialProposalSync: true } });
    const syncData = commercialProposalSyncData(
      { proposalCode: proposal.proposalCode, revisionNumber: proposal.revisionNumber }, project.commercialProposalSync
    );
    if (budget?.source === 'COMERCIAL_APP' && budget.commercialAppProposalId === externalId) {
      if (Object.keys(syncData).length) await tx.project.update({ where: { id: projectId }, data: syncData });
      return { budgetStatus: 'SELECTED', duplicate: true,
        scopeImport: await syncCommercialAppScope(tx, projectId, proposal) };
    }
    await tx.commercialAppProposal.updateMany({ where: { projectId, selectionStatus: 'SELECTED' },
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
