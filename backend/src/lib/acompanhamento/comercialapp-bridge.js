import { createHash } from 'node:crypto';
import { z } from 'zod';
import prisma from '../prisma.js';
import { clearProjectDerivedCaches } from '../resource-list-cache.js';

const decimal = z.number().finite().min(0).max(999999999999.99);
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
  proposalSnapshot: z.unknown()
});

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
function hash(value) { return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex'); }

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

export async function receiveCommercialAppProposal(raw) {
  const data = commercialAppPayloadSchema.parse(raw);
  const deliveryHash = hash(data);
  const { eventId: _eventId, approvedAt: _approvedAt, ...immutableSnapshot } = data;
  const snapshotHash = hash(immutableSnapshot);
  let result;
  try {
    result = await prisma.$transaction(async tx => {
      const delivered = await tx.commercialAppDelivery.findUnique({ where: { eventId: data.eventId } });
      if (delivered) {
        if (delivered.externalId !== data.proposalId || delivered.snapshotHash !== deliveryHash) {
          throw new CommercialAppBridgeError(409, 'ID de evento reutilizado com outro conteúdo.');
        }
        const existing = await tx.commercialAppProposal.findUnique({ where: { externalId: data.proposalId } });
        return { duplicate: true, budgetStatus: existing?.selectionStatus === 'SELECTED' ? 'SELECTED' : 'STAGED',
          projectId: existing?.projectId };
      }
      const project = await tx.project.findFirst({
        where: { id: data.projectId, deletedAt: null, isActive: true }
      });
      if (!project) throw new CommercialAppBridgeError(422, 'Projeto informado pelo CRM não existe no FiltroAPP.');
      const existing = await tx.commercialAppProposal.findUnique({ where: { externalId: data.proposalId } });
      if (existing && (existing.snapshotHash !== snapshotHash || existing.projectId !== data.projectId)) {
        throw new CommercialAppBridgeError(409, 'Proposta e revisão já recebidas com conteúdo ou projeto diferente.');
      }
      const proposal = existing || await tx.commercialAppProposal.create({ data: {
        externalId: data.proposalId, proposalCode: data.proposalCode,
        revisionNumber: data.revisionNumber, projectId: data.projectId,
        nectarOpportunityId: data.nectarOpportunityId,
        approvedAt: new Date(data.approvedAt), clientName: data.client.name,
        clientCnpj: data.client.cnpj, title: data.title, site: data.site,
        salePrice: data.salePrice, plannedTotalCost: data.plannedTotalCost,
        expectedMargin: data.expectedMargin, snapshot: data,
        snapshotHash
      } });
      const budget = await tx.projectBudget.findUnique({
        where: { projectId_version: { projectId: data.projectId, version: 1 } }
      });
      let selected = proposal.selectionStatus === 'SELECTED';
      if (!budget && (!project.commercialProposalCode || project.commercialProposalCode === data.proposalCode)) {
        await tx.projectBudget.create({ data: {
          projectId: data.projectId, version: 1, ...budgetFields(proposal)
        } });
        await tx.project.update({ where: { id: data.projectId },
          data: { commercialProposalCode: data.proposalCode } });
        await tx.commercialAppProposal.update({ where: { id: proposal.id },
          data: { selectionStatus: 'SELECTED', selectedAt: new Date() } });
        selected = true;
      }
      await tx.commercialAppDelivery.create({ data: {
        eventId: data.eventId, externalId: data.proposalId, snapshotHash: deliveryHash
      } });
      return { duplicate: false, budgetStatus: selected ? 'SELECTED' : 'STAGED',
        projectId: data.projectId, proposalId: proposal.id };
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
    if (budget?.commercialAppProposalId === externalId) return { budgetStatus: 'SELECTED', duplicate: true };
    await tx.commercialAppProposal.updateMany({ where: { projectId, selectionStatus: 'SELECTED' },
      data: { selectionStatus: 'STAGED' } });
    await tx.projectBudget.upsert({
      where: { projectId_version: { projectId, version: 1 } },
      create: { projectId, version: 1, ...budgetFields(proposal), selectedByUserId: userId,
        selectedAt: new Date() },
      update: { ...budgetFields(proposal), selectedByUserId: userId, selectedAt: new Date() }
    });
    await tx.project.update({ where: { id: projectId },
      data: { commercialProposalCode: proposal.proposalCode } });
    await tx.commercialAppProposal.update({ where: { id: proposal.id },
      data: { selectionStatus: 'SELECTED', selectedAt: new Date() } });
    return { budgetStatus: 'SELECTED', duplicate: false };
  });
  clearProjectDerivedCaches();
  return result;
}
