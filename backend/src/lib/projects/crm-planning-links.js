import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { projectIntakeSchema, receiveProjectIntake } from './project-intake.js';
import { commercialProposalReference } from './commercial-proposal-sync-state.js';
import { resolveClientSegment } from './client-segment.js';
import { applyProjectIntegrationDefaults } from './integration-defaults.js';

const conflict = (code, message) => new IntegrationApiError(409, code, message);
const namespace = input => ({ sourceSystem: input.sourceSystem, tenantId: input.tenantId, environment: input.environment });
const family = code => /^\d+$/.test(code || '') ? String(BigInt(code)) : code;
const pending = (existing, status, reason, targetProjectId = existing?.targetProjectId ?? null) => ({
  projectId: existing?.projectId ?? null, targetProjectId, projectLinkStatus: status, projectLinkReason: reason,
  convertedAt: existing?.convertedAt ?? null
});

export function validatePlanningTransition(existing, input) {
  if (!existing) return;
  const op = input.opportunity;
  const before = existing.snapshot?.opportunity;
  if (existing.planningRequested && !op.planningRequested && !op.planningDecision.reason) {
    throw new IntegrationApiError(422, 'WITHDRAWAL_REASON_REQUIRED', 'Retirar a sinalização exige motivo na decisão de planejamento.');
  }
  const consolidated = existing.projectId || existing.targetProjectId || existing.commercialStatus === 'WON';
  if (consolidated && existing.scopeKind !== 'UNCLASSIFIED' && existing.scopeKind !== op.scope.kind) {
    throw conflict('SCOPE_IDENTITY_CONFLICT', 'A classificação consolidada exige correção administrativa auditada.');
  }
  if (consolidated && before) {
    for (const key of ['primaryOpportunityExternalId', 'additionalProposalId']) {
      if (before.scope[key] && op.scope[key] && before.scope[key] !== op.scope[key]) throw conflict('SCOPE_IDENTITY_CONFLICT', 'A identidade do adicional ou da principal não pode ser trocada.');
    }
    const previousParent = before.scope.primaryProposal;
    const parent = op.scope.primaryProposal;
    if (previousParent && parent && (parent.system !== previousParent.system || parent.code !== previousParent.code)) {
      throw conflict('SCOPE_IDENTITY_CONFLICT', 'A proposta principal consolidada não pode ser trocada.');
    }
  }
  if (existing.projectId || existing.targetProjectId) {
    if (op.project?.filtroappProjectId && ![existing.projectId, existing.targetProjectId].includes(op.project.filtroappProjectId)) {
      throw conflict('PROJECT_REFERENCE_CONFLICT', 'O vínculo confirmado não pode ser remapeado por este evento.');
    }
    if (existing.prismaMissionId && op.project?.prismaMissionId && existing.prismaMissionId !== op.project.prismaMissionId) {
      throw conflict('PROJECT_REFERENCE_CONFLICT', 'A missão confirmada não pode ser remapeada por este evento.');
    }
  }
}

function validateProjectIdentity(project, op) {
  if (op.project?.number && op.project.number !== project.code) throw conflict('PROJECT_REFERENCE_CONFLICT', 'Número e identificador do projeto não correspondem.');
  if (op.client.taxId && project.clientCnpj?.replace(/\D/g, '') && op.client.taxId !== project.clientCnpj.replace(/\D/g, '')) {
    throw conflict('PROJECT_CLIENT_CONFLICT', 'O cliente informado não corresponde ao projeto confirmado.');
  }
  const expected = op.scope.kind === 'ADDITIONAL' ? op.scope.primaryProposal : op.proposal;
  const projectProposal = project.commercialProposalCode || commercialProposalReference(project.contractCode)?.proposalCode;
  if (expected && projectProposal && family(expected.code) !== family(projectProposal)) {
    throw conflict('PROJECT_PROPOSAL_CONFLICT', 'A referência à proposta principal não corresponde ao projeto.');
  }
}

export async function resolvePlanningProject(tx, input, existing, { allowCreate = true, now = new Date() } = {}) {
  const op = input.opportunity;
  const scope = namespace(input);
  if (op.scope.kind === 'UNCLASSIFIED') return pending(existing, 'NEEDS_REVIEW', 'SCOPE_UNCLASSIFIED');
  const ref = op.project;
  if (!ref) return pending(existing, existing?.projectId || existing?.targetProjectId ? 'NEEDS_REVIEW' : op.commercialStatus === 'WON' ? 'PENDING_DATA' : 'NOT_REQUESTED',
    existing?.projectId || existing?.targetProjectId ? 'PROJECT_REFERENCE_MISSING' : op.commercialStatus === 'WON' ? 'PROJECT_DATA_MISSING' : null);

  const mapping = ref.prismaMissionId ? await tx.crmProjectMapping.findUnique({ where: {
    sourceSystem_tenantId_environment_prismaMissionId: { ...scope, prismaMissionId: ref.prismaMissionId }
  } }) : null;
  if (mapping && ref.filtroappProjectId && mapping.projectId !== ref.filtroappProjectId) throw conflict('PROJECT_REFERENCE_CONFLICT', 'A missão já está mapeada a outro projeto.');
  if (mapping && ref.numberScope && mapping.numberScope && mapping.numberScope !== ref.numberScope) throw conflict('PROJECT_REFERENCE_CONFLICT', 'O escopo de numeração da missão diverge do vínculo confirmado.');
  let projectId = mapping?.projectId || ref.filtroappProjectId || existing?.projectId || existing?.targetProjectId;
  let project = projectId ? await tx.project.findUnique({ where: { id: projectId } }) : null;
  if (projectId && !project) throw conflict('PROJECT_REFERENCE_CONFLICT', 'Identificador de projeto informado não existe.');
  if (project && (!project.isActive || project.deletedAt)) return pending(existing, 'NEEDS_REVIEW', 'PROJECT_UNAVAILABLE', existing?.targetProjectId ?? null);
  if (project) validateProjectIdentity(project, op);
  if (op.scope.kind === 'ADDITIONAL' && op.scope.primaryOpportunityExternalId) {
    if (op.scope.primaryOpportunityExternalId === input.externalId) throw conflict('SCOPE_IDENTITY_CONFLICT', 'Uma oportunidade não pode ser seu próprio escopo principal.');
    const parent = await tx.crmOpportunity.findUnique({ where: { sourceSystem_tenantId_environment_externalId: {
      ...scope, externalId: op.scope.primaryOpportunityExternalId
    } } });
    if (parent && (parent.scopeKind === 'ADDITIONAL' ||
      (parent.prismaMissionId && ref.prismaMissionId && parent.prismaMissionId !== ref.prismaMissionId) ||
      (project && (parent.projectId || parent.targetProjectId) && ![parent.projectId, parent.targetProjectId].includes(project.id)))) {
      throw conflict('SCOPE_IDENTITY_CONFLICT', 'A oportunidade principal informada pertence a outro vínculo.');
    }
  }

  if (!project && op.scope.kind === 'PRIMARY' && op.commercialStatus === 'WON' && !op.sourceRecordDeleted && allowCreate) {
    if (!ref.prismaMissionId || !ref.number || !ref.numberScope || !op.client.name || !op.client.taxId || !op.location || !op.proposal?.acceptedAt) {
      return pending(existing, 'PENDING_DATA', 'PROJECT_DATA_MISSING');
    }
    const inputProject = { code: ref.number, name: op.title, clientName: op.client.name, clientCnpj: op.client.taxId,
      proposalCode: op.proposal.code, revision: op.proposal.revision, location: op.location,
      ...(op.client.segment ? { clientSegment: op.client.segment } : {}) };
    if (!projectIntakeSchema.safeParse(inputProject).success) return pending(existing, 'NEEDS_REVIEW', 'PROJECT_DATA_UNSUPPORTED');
    // Código sozinho não comprova identidade: o conector antigo precisa fornecer seu ID confirmado.
    if (await tx.project.findUnique({ where: { code: ref.number }, select: { id: true } })) return pending(existing, 'NEEDS_REVIEW', 'EXISTING_PROJECT_MAPPING_REQUIRED');
    // O orçamento chega pelo fluxo comercial; não selecionar Access só por coincidência de código.
    const received = await receiveProjectIntake(inputProject, tx, { inTransaction: true, selectAccessRevision: false });
    projectId = received.project.id;
    project = await tx.project.findUnique({ where: { id: projectId } });
  }
  if (!project) return pending(existing, op.commercialStatus === 'WON' || op.scope.kind === 'ADDITIONAL' ? 'PENDING_LINK' : 'NOT_REQUESTED', 'PROJECT_MAPPING_REQUIRED');
  if (op.scope.kind === 'ADDITIONAL' && !op.scope.primaryProposal) return pending(existing, 'PENDING_LINK', 'PRIMARY_PROPOSAL_REQUIRED', project.id);

  if (op.scope.kind === 'PRIMARY' && !op.sourceRecordDeleted && op.client.segment) {
    const clientSegment = await resolveClientSegment(tx, op.client.segment);
    if (clientSegment) await applyProjectIntegrationDefaults(tx, project.id, { clientSegment });
  }

  if (ref.prismaMissionId && !mapping) {
    const other = await tx.crmProjectMapping.findUnique({ where: { sourceSystem_tenantId_environment_projectId: { ...scope, projectId: project.id } } });
    if (other && other.prismaMissionId !== ref.prismaMissionId) throw conflict('PROJECT_REFERENCE_CONFLICT', 'Este projeto já corresponde a outra missão na origem.');
    await tx.crmProjectMapping.create({ data: { ...scope, prismaMissionId: ref.prismaMissionId, projectId: project.id, number: ref.number, numberScope: ref.numberScope } });
  }
  return { projectId: existing?.projectId || (op.commercialStatus === 'WON' ? project.id : null), targetProjectId: project.id,
    projectLinkStatus: 'LINKED', projectLinkReason: null,
    convertedAt: existing?.convertedAt || (op.commercialStatus === 'WON' ? now : null) };
}

export async function storePlanningLinkHistory(tx, previous, next) {
  if (previous && ['projectId', 'targetProjectId', 'projectLinkStatus', 'projectLinkReason'].every(key => (previous[key] ?? null) === (next[key] ?? null))) return;
  await tx.crmOpportunityLinkEvent.create({ data: { opportunityId: next.id, sourceVersion: next.sourceVersion,
    fromStatus: previous?.projectLinkStatus ?? null, toStatus: next.projectLinkStatus, projectId: next.projectId,
    targetProjectId: next.targetProjectId, reason: next.projectLinkReason } });
}

// Uma principal que chega depois libera os targets já recebidos, sem aplicar orçamento/escopo.
export async function reconcileMissionPlanningLinks(tx, input, currentId) {
  const missionId = input.opportunity.project?.prismaMissionId;
  if (!missionId) return;
  const records = await tx.crmOpportunity.findMany({ where: { ...namespace(input), prismaMissionId: missionId,
    id: { not: currentId }, projectLinkStatus: { in: ['PENDING_LINK', 'PENDING_DATA'] } } });
  for (const record of records) {
    if (!record.snapshot) continue;
    try {
      const links = await resolvePlanningProject(tx, record.snapshot, record, { allowCreate: false });
      const saved = await tx.crmOpportunity.update({ where: { id: record.id }, data: links });
      await storePlanningLinkHistory(tx, record, saved);
    } catch (error) {
      if (!(error instanceof IntegrationApiError)) throw error;
      const saved = await tx.crmOpportunity.update({ where: { id: record.id }, data: { projectLinkStatus: 'NEEDS_REVIEW', projectLinkReason: error.code } });
      await storePlanningLinkHistory(tx, record, saved);
    }
  }
}
