import { z } from 'zod';
import { IntegrationApiError } from '../../middleware/api-request-context.js';

const text = max => z.string().trim().min(1).max(max);
const optional = schema => schema.nullable();
const instant = z.iso.datetime({ offset: true });
const actor = z.object({ id: text(180), name: text(240), type: z.enum(['USER', 'SYSTEM']) }).strict();
const decision = { reason: optional(text(1000)), actor: optional(actor) };
const proposalIdentity = {
  system: z.enum(['COMERCIALAPP', 'PRISMA']), id: optional(text(180)), externalId: optional(text(180)),
  code: text(160), revision: z.number().int().min(0).max(2_147_483_647)
};
const project = z.object({ prismaMissionId: optional(text(180)), number: optional(text(80)),
  numberScope: optional(text(180)), filtroappProjectId: optional(text(100)) }).strict();

export const CRM_PLANNING_VERSION = 'planning-1.0';
export const CRM_STATUSES = ['OPEN', 'WON', 'LOST', 'DISCARDED', 'CANCELLED', 'POSTPONED'];
export const CRM_LINK_STATUSES = ['NOT_REQUESTED', 'PENDING_DATA', 'PENDING_LINK', 'LINKED', 'NEEDS_REVIEW'];
export const crmPlanningSnapshotSchema = z.object({
  contractVersion: z.literal(CRM_PLANNING_VERSION), eventId: z.uuid(),
  sourceSystem: z.literal('prismaCRM'), tenantId: text(100), environment: z.enum(['production', 'sandbox']),
  externalId: text(180), sourceVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), sourceUpdatedAt: instant,
  change: z.object({ kind: z.enum(['PLANNING_REQUESTED', 'PLANNING_WITHDRAWN', 'STATE_UPDATED', 'COMMERCIAL_STATUS_CHANGED', 'SOURCE_RECORD_DELETED']),
    occurredAt: optional(instant), ...decision }).strict(),
  opportunity: z.object({
    title: text(240), description: optional(text(4000)), planningRequested: z.boolean(),
    planningDecision: z.object({ requestedAt: optional(instant), withdrawnAt: optional(instant), ...decision }).strict(),
    commercialStatus: z.enum(CRM_STATUSES), sourceCommercialStatus: text(80),
    commercialStatusDecision: z.object({ occurredAt: optional(instant), ...decision }).strict(),
    commercialOwner: optional(z.object({ id: text(180), name: text(240) }).strict()),
    client: z.object({ externalId: optional(text(180)), name: optional(text(240)), legalName: optional(text(240)),
      taxId: optional(z.string().regex(/^\d{14}$/)), segment: z.string().trim().max(100).nullable().optional() }).strict(),
    proposal: optional(z.object({ ...proposalIdentity, acceptedAt: optional(instant) }).strict()),
    scope: z.object({ kind: z.enum(['PRIMARY', 'ADDITIONAL', 'UNCLASSIFIED']), primaryOpportunityExternalId: optional(text(180)),
      primaryProposal: optional(z.object(proposalIdentity).strict()), additionalProposalId: optional(text(180)), contributionKey: optional(text(240)) }).strict(),
    project: optional(project), location: optional(text(240)),
    value: optional(z.object({ amount: z.string().regex(/^(0|[1-9]\d{0,11})\.\d{2}$/), currency: z.literal('BRL') }).strict()),
    expectedDates: z.object({ closeOn: optional(z.iso.date()), executionStartOn: optional(z.iso.date()), executionEndOn: optional(z.iso.date()) }).strict(),
    closedAt: optional(instant), sourceRecordDeleted: z.boolean(),
    recordUrl: z.url().max(2000).refine(value => /^https?:\/\//i.test(value), 'Informe uma URL HTTP ou HTTPS.')
  }).strict()
}).strict();

export function validateCrmOpportunity(input) {
  const parsed = crmPlanningSnapshotSchema.safeParse(input);
  if (!parsed.success) throw new IntegrationApiError(422, 'INCOMPLETE_SNAPSHOT', 'Retrato de planejamento inválido ou incompleto.', {
    fields: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: 'Campo obrigatório ausente ou valor inválido.' }))
  });
  const value = parsed.data;
  const op = value.opportunity;
  if (value.change.kind === 'PLANNING_WITHDRAWN' && (op.planningRequested || !value.change.reason || !op.planningDecision.reason)) {
    throw new IntegrationApiError(422, 'WITHDRAWAL_REASON_REQUIRED', 'Retirar a sinalização exige motivo e planningRequested=false.');
  }
  if (value.change.kind === 'PLANNING_REQUESTED' && !op.planningRequested) {
    throw new IntegrationApiError(422, 'INVALID_PLANNING_DECISION', 'A sinalização exige planningRequested=true.');
  }
  if (value.change.kind === 'SOURCE_RECORD_DELETED' && !op.sourceRecordDeleted) {
    throw new IntegrationApiError(422, 'INVALID_TOMBSTONE', 'O evento de exclusão exige sourceRecordDeleted=true.');
  }
  if (op.expectedDates.executionStartOn && op.expectedDates.executionEndOn && op.expectedDates.executionEndOn < op.expectedDates.executionStartOn) {
    throw new IntegrationApiError(422, 'INVALID_EXPECTED_DATES', 'O fim previsto não pode preceder o início previsto.');
  }
  return value;
}

export function planningNamespace(envConfig) {
  return { sourceSystem: 'prismaCRM', tenantId: envConfig.crmPlanningTenantId || 'filtrovali',
    environment: envConfig.crmPlanningEnvironment || (envConfig.nodeEnv === 'production' && envConfig.appEnv !== 'staging' ? 'production' : 'sandbox') };
}
export function validatePlanningNamespace(input, namespace) {
  if (['sourceSystem', 'tenantId', 'environment'].some(key => input[key] !== namespace[key])) {
    throw new IntegrationApiError(403, 'NAMESPACE_NOT_ALLOWED', 'Origem, organização ou ambiente não autorizado por esta credencial.');
  }
}
export const opportunityKey = input => ({ sourceSystem: input.sourceSystem, tenantId: input.tenantId, environment: input.environment, externalId: input.externalId });
export const opportunityWhere = input => ({ sourceSystem_tenantId_environment_externalId: opportunityKey(input) });
export const receiptWhere = input => ({ sourceSystem_tenantId_environment_eventId: { sourceSystem: input.sourceSystem, tenantId: input.tenantId, environment: input.environment, eventId: input.eventId } });
