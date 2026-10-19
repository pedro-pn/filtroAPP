import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import prisma from '../prisma.js';
import { clearProjectDerivedCaches } from '../resource-list-cache.js';
import { normalizeAdditionalMetricInclusion } from '../../../../shared/modules/additional-proposal-metrics.js';
import { syncCommercialAppScope } from './commercialapp-scope.js';

export class CommercialAppBridgeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const conflict = message => new CommercialAppBridgeError(409, message);
const digits = value => String(value || '').replace(/\D/g, '');
export const contributionWhere = (projectId, source, proposalCode) => ({
  projectId_source_proposalCode: { projectId, source, proposalCode: String(proposalCode) }
});

// Todas as seleções, entregas e aplicações de consulta serializam no mesmo projeto.
// A retentativa relê evento/versão depois de conflitos de serialização ou unicidade.
export async function commercialTransaction(operation, database = prisma) {
  for (let attempt = 0; ; attempt++) {
    try { return await database.$transaction(operation, { isolationLevel: 'Serializable', timeout: 30_000 }); }
    catch (error) {
      const code = error.code || error.cause?.originalCode || error.meta?.driverAdapterError?.cause?.originalCode;
      if (!['P2034', 'P2002', '40001'].includes(code)) throw error;
      if (attempt >= 7) throw conflict('Outra alteração comercial está em andamento. Atualize e tente novamente.');
      await delay(25 * 2 ** attempt + Math.floor(Math.random() * 25));
    }
  }
}
export async function lockCommercialProject(tx, projectId) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.project.findFirst({ where: { id: projectId, deletedAt: null, isActive: true } });
  if (!project) throw new CommercialAppBridgeError(422, 'Projeto informado não existe ou está inativo no FiltroAPP.');
  return project;
}

export async function validateContributionParent(tx, project, proposal, source, { staged = false } = {}) {
  const parentCode = String(source === 'COMERCIAL_APP' ? proposal.parentProposalCode : proposal.parentCodProp);
  const childCnpj = digits(proposal.clientCnpj);
  const projectCnpj = digits(project.clientCnpj);
  if (source === 'COMERCIAL_APP' ? childCnpj.length !== 14 || childCnpj !== projectCnpj
    : childCnpj && projectCnpj && childCnpj !== projectCnpj) {
    throw new CommercialAppBridgeError(422, 'Cliente/CNPJ do adicional não corresponde ao projeto.');
  }
  const budget = await tx.projectBudget.findUnique({ where: { projectId_version: { projectId: project.id, version: 1 } } });
  let main = null;
  if (budget?.source === 'COMERCIAL_APP' && budget.commercialAppProposalId) {
    const row = await tx.commercialAppProposal.findUnique({ where: { externalId: budget.commercialAppProposalId } });
    if (row && row.projectId !== project.id) throw new CommercialAppBridgeError(422, 'A principal selecionada pertence a outro projeto.');
    if (row && row.proposalKind !== 'ADDITIONAL') main = { code: row.proposalCode, cnpj: row.clientCnpj, prismaProjectId: row.prismaProjectId };
  } else if (budget?.source === 'ACCESS_IMPORT' && budget.sourceProposalCodBd != null) {
    const row = await tx.commercialProposal.findUnique({ where: { codBd: budget.sourceProposalCodBd } });
    if (row && row.parentCodProp == null) main = { code: String(row.codProp), cnpj: row.clientCnpj };
  }
  if (!main) {
    if (staged) return false;
    throw conflict('Selecione e resolva a proposta principal antes de adicionar esta contribuição.');
  }
  if (main.prismaProjectId && proposal.prismaProjectId && main.prismaProjectId !== proposal.prismaProjectId) {
    throw new CommercialAppBridgeError(422, 'Projeto Prisma do adicional diverge da proposta principal.');
  }
  if (main.code !== parentCode) throw new CommercialAppBridgeError(422, 'A mãe do adicional não corresponde à principal selecionada.');
  if (digits(main.cnpj) && childCnpj && digits(main.cnpj) !== childCnpj) {
    throw new CommercialAppBridgeError(422, 'Cliente/CNPJ do adicional não corresponde à proposta mãe.');
  }
  return true;
}

export async function queueContributionQuery(tx, projectId, reference, { selectionVersion = 0, externalId = null, documents } = {}) {
  const state = { ...reference, proposalKind: 'ADDITIONAL', ...(documents ? { documents } : {}), requestId: randomUUID(), selectionVersion, externalId,
    status: 'PENDING', requestedAt: new Date().toISOString(), attempts: 0 };
  return tx.commercialProposalSyncJob.upsert({
    where: { projectId_proposalCode: { projectId, proposalCode: reference.proposalCode } },
    create: { projectId, proposalCode: reference.proposalCode, state, nextAttemptAt: new Date() },
    update: { state, nextAttemptAt: new Date() }
  });
}

// Chamado dentro da mesma transação tanto pela gestão quanto pelo push aprovado.
export async function selectContribution(tx, project, proposal, source, {
  automatic = false, userId = null, expectedSelectionVersion, allowOlderRevision = false,
  reason = null, metricInclusion
} = {}) {
  if (!await validateContributionParent(tx, project, proposal, source, { staged: automatic })) {
    return { budgetStatus: 'STAGED', reason: 'PARENT_UNRESOLVED' };
  }
  const proposalCode = String(source === 'COMERCIAL_APP' ? proposal.proposalCode : proposal.codProp);
  const otherOrigin = await tx.projectAdditionalProposal.findFirst({ where: {
    projectId: project.id, proposalCode, active: true, source: { not: source }
  } });
  if (otherOrigin) throw conflict('Este adicional já compõe o projeto por outra origem. Remova essa contribuição explicitamente antes de trocar a origem.');
  const where = contributionWhere(project.id, source, proposalCode);
  const current = await tx.projectAdditionalProposal.findUnique({ where });
  if (!automatic && (source === 'COMERCIAL_APP' || expectedSelectionVersion !== undefined) &&
      expectedSelectionVersion !== (current?.selectionVersion ?? 0)) {
    throw conflict('A seleção mudou. Atualize a lista antes de selecionar esta revisão.');
  }
  const same = current && (source === 'COMERCIAL_APP'
    ? current.commercialAppProposalId === proposal.externalId : current.sourceProposalCodBd === proposal.codBd);
  const previous = !current ? null : source === 'COMERCIAL_APP'
    ? await tx.commercialAppProposal.findUnique({ where: { externalId: current.commercialAppProposalId } })
    : await tx.commercialProposal.findUnique({ where: { codBd: current.sourceProposalCodBd } });
  const revision = source === 'COMERCIAL_APP' ? proposal.revisionNumber : proposal.nRev;
  const previousRevision = source === 'COMERCIAL_APP' ? previous?.revisionNumber : previous?.nRev;
  const delayedAfterManual = current?.selectionOrigin === 'MANUAL' && !same && proposal.approvedAt &&
    new Date(proposal.approvedAt) <= current.selectedAt;
  const earlierApproval = previous?.approvedAt && proposal.approvedAt &&
    new Date(proposal.approvedAt) < new Date(previous.approvedAt);
  if (automatic && (current && !current.active || previousRevision > revision || delayedAfterManual || earlierApproval)) {
    return { budgetStatus: 'STAGED', reason: 'SELECTION_PRESERVED', selectionVersion: current.selectionVersion };
  }
  if (!automatic && previousRevision > revision && (!allowOlderRevision || !reason?.trim() ||
      expectedSelectionVersion !== current.selectionVersion)) {
    throw conflict('Selecionar uma revisão anterior exige comando explícito e motivo.');
  }
  const inclusion = normalizeAdditionalMetricInclusion(metricInclusion ?? current?.metricInclusion);
  if (same && current.active && (automatic || current.selectionOrigin === 'MANUAL') && JSON.stringify(inclusion) === JSON.stringify(normalizeAdditionalMetricInclusion(current.metricInclusion))) {
    return { budgetStatus: 'SELECTED', selectionVersion: current.selectionVersion, duplicate: true };
  }
  const version = (current?.selectionVersion ?? 0) + 1;
  const fields = { active: true, selectionVersion: version, selectionOrigin: automatic ? 'AUTOMATIC' : 'MANUAL', metricInclusion: inclusion,
    sourceProposalCodBd: source === 'ACCESS_IMPORT' ? proposal.codBd : null,
    codProp: source === 'ACCESS_IMPORT' ? proposal.codProp : null,
    commercialAppProposalId: source === 'COMERCIAL_APP' ? proposal.externalId : null,
    selectedByUserId: userId, selectedAt: new Date() };
  await tx.projectAdditionalProposal.upsert({ where,
    create: { projectId: project.id, source, proposalCode, ...fields }, update: fields });
  await tx.projectContributionEvent.create({ data: { projectId: project.id, source, proposalCode,
    selectionVersion: version, operation: current ? 'REPLACE' : 'SELECT', actorUserId: userId, reason,
    data: { previousExternalId: current?.commercialAppProposalId ?? null,
      previousCodBd: current?.sourceProposalCodBd ?? null, ...fields, selectedAt: fields.selectedAt.toISOString() } } });
  let scopeImport = null;
  if (source === 'COMERCIAL_APP') {
    await tx.commercialAppProposal.updateMany({ where: { projectId: project.id, proposalCode, proposalKind: 'ADDITIONAL' },
      data: { selectionStatus: 'STAGED' } });
    await tx.commercialAppProposal.update({ where: { id: proposal.id }, data: { selectionStatus: 'SELECTED', selectedAt: new Date() } });
    scopeImport = await syncCommercialAppScope(tx, project.id, proposal);
    await queueContributionQuery(tx, project.id, { proposalCode, revisionNumber: revision },
      { selectionVersion: version, externalId: proposal.externalId, documents: proposal.snapshot?.documents });
  }
  return { budgetStatus: 'SELECTED', selectionVersion: version, scopeImport };
}

export async function removeContribution(projectId, source, proposalCode, { userId, expectedSelectionVersion, reason } = {}) {
  const result = await commercialTransaction(async tx => {
    await lockCommercialProject(tx, projectId);
    const where = contributionWhere(projectId, source, proposalCode);
    const current = await tx.projectAdditionalProposal.findUnique({ where });
    if (!current) throw new CommercialAppBridgeError(404, 'Contribuição não encontrada.');
    if (!reason?.trim() || expectedSelectionVersion !== current.selectionVersion) {
      throw conflict('Remoção exige motivo e versão corrente da seleção.');
    }
    if (!current.active) return { ok: true, selectionVersion: current.selectionVersion };
    const version = current.selectionVersion + 1;
    await tx.projectAdditionalProposal.update({ where, data: { active: false, selectionVersion: version } });
    await tx.projectContributionEvent.create({ data: { projectId, source, proposalCode, selectionVersion: version,
      operation: 'REMOVE', actorUserId: userId, reason, data: { ...current, selectedAt: current.selectedAt.toISOString(),
        createdAt: current.createdAt.toISOString(), updatedAt: current.updatedAt.toISOString() } } });
    if (source === 'COMERCIAL_APP') {
      await tx.commercialAppProposal.updateMany({ where: { projectId, proposalCode, proposalKind: 'ADDITIONAL' }, data: { selectionStatus: 'STAGED' } });
      // Overrides e documentos permanecem no histórico; só o escopo automático sai da composição.
      if (current.scopeImport?.status !== 'MANUAL_OVERRIDE') {
        await tx.projectPlannedService.deleteMany({ where: { projectId, contributionKey: `${source}:${proposalCode}` } });
      }
      await tx.commercialProposalSyncJob.deleteMany({ where: { projectId, proposalCode } });
    }
    return { ok: true, selectionVersion: version };
  });
  clearProjectDerivedCaches();
  return result;
}

export async function resolveContributionScope(projectId, proposalCode, { expectedSelectionVersion, choice, reason, userId }) {
  const result = await commercialTransaction(async tx => {
    const project = await lockCommercialProject(tx, projectId);
    const where = contributionWhere(projectId, 'COMERCIAL_APP', proposalCode);
    const selection = await tx.projectAdditionalProposal.findUnique({ where });
    if (!selection?.active || selection.selectionVersion !== expectedSelectionVersion ||
        !['MANUAL', 'COMMERCIAL'].includes(choice) || !reason?.trim()) {
      throw conflict('A resolução exige contribuição ativa, versão corrente e motivo.');
    }
    const proposal = await tx.commercialAppProposal.findUnique({ where: { externalId: selection.commercialAppProposalId } });
    await validateContributionParent(tx, project, proposal, 'COMERCIAL_APP');
    const version = selection.selectionVersion + 1;
    await tx.projectAdditionalProposal.update({ where, data: { selectionVersion: version,
      scopeImport: choice === 'MANUAL' ? { ...selection.scopeImport, status: 'MANUAL_OVERRIDE',
        reviewedExternalId: proposal.externalId } : {} } });
    const scope = choice === 'COMMERCIAL'
      ? await syncCommercialAppScope(tx, projectId, proposal, { replaceEmpty: true })
      : { status: 'MANUAL_PRESERVED', issues: [] };
    await tx.projectContributionEvent.create({ data: { projectId, source: 'COMERCIAL_APP', proposalCode,
      selectionVersion: version, operation: 'RESOLVE_SCOPE', actorUserId: userId, reason,
      data: { choice, externalId: proposal.externalId, previousScopeImport: selection.scopeImport } } });
    await queueContributionQuery(tx, projectId, { proposalCode, revisionNumber: proposal.revisionNumber },
      { selectionVersion: version, externalId: proposal.externalId, documents: proposal.snapshot.documents });
    return { ...scope, selectionVersion: version };
  });
  clearProjectDerivedCaches();
  return result;
}

export async function assertPrincipalContributionCompatibility(tx, projectId, proposalCode) {
  const selections = await tx.projectAdditionalProposal.findMany({ where: { projectId, active: true } });
  for (const selection of selections) {
    const row = selection.source === 'COMERCIAL_APP'
      ? await tx.commercialAppProposal.findUnique({ where: { externalId: selection.commercialAppProposalId } })
      : await tx.commercialProposal.findUnique({ where: { codBd: selection.sourceProposalCodBd } });
    const parent = selection.source === 'COMERCIAL_APP' ? row?.parentProposalCode : row?.parentCodProp;
    if (parent != null && String(parent) !== String(proposalCode)) {
      throw conflict('A principal possui contribuições ativas de outra mãe. Remova ou substitua essas contribuições explicitamente antes de trocar a principal.');
    }
  }
}
