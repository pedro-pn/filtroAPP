import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import env from '../../config/env.js';
import prisma from '../prisma.js';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { clearProjectDerivedCaches } from '../resource-list-cache.js';
import { stableJson } from '../api-credentials/cursor.js';
import { CRM_PLANNING_VERSION, opportunityKey, opportunityWhere, receiptWhere, planningNamespace, validatePlanningNamespace, validateCrmOpportunity } from './crm-planning-schema.js';
import { validatePlanningTransition, resolvePlanningProject, storePlanningLinkHistory, reconcileMissionPlanningLinks } from './crm-planning-links.js';

export { validateCrmOpportunity } from './crm-planning-schema.js';
const hash = value => createHash('sha256').update(stableJson(value)).digest('hex');
const conflict = code => new IntegrationApiError(409, code, 'O identificador recebido já existe com conteúdo diferente.');
const date = value => value ? new Date(value + 'T00:00:00Z') : null;

function stateData(input, versionHash, now) {
  const op = input.opportunity;
  return { ...opportunityKey(input), contractVersion: input.contractVersion, commercialStatus: op.commercialStatus,
    planningRequested: op.planningRequested, sourceRecordDeleted: op.sourceRecordDeleted, scopeKind: op.scope.kind,
    name: op.title, description: op.description, clientName: op.client.name, clientExternalId: op.client.externalId, clientCnpj: op.client.taxId,
    location: op.location, proposalCode: op.proposal?.code ?? null, proposalSystem: op.proposal?.system ?? null, revision: op.proposal?.revision ?? null,
    estimatedValue: op.value?.amount ?? null, expectedCloseDate: date(op.expectedDates.closeOn),
    expectedStartDate: date(op.expectedDates.executionStartOn), expectedEndDate: date(op.expectedDates.executionEndOn),
    externalUrl: op.recordUrl, sourceVersion: BigInt(input.sourceVersion), sourceUpdatedAt: new Date(input.sourceUpdatedAt),
    payloadHash: versionHash, snapshot: input, currentEventId: input.eventId,
    prismaMissionId: op.project?.prismaMissionId ?? null, lastSyncedAt: now };
}

export function planningAck(input, current, disposition, receivedAt = new Date()) {
  return { eventId: input.eventId, externalId: input.externalId,
    receivedSourceVersion: input.sourceVersion, currentSourceVersion: Number(current.sourceVersion),
    disposition, accompanimentId: current.id, projectId: current.projectId,
    targetProjectId: current.targetProjectId, projectLinkStatus: current.projectLinkStatus,
    projectLinkReason: current.projectLinkReason, receivedAt: receivedAt.toISOString() };
}

export async function receiveCrmOpportunity(database, rawInput, { now = new Date(), envConfig = env, idempotencyKey } = {}) {
  const input = validateCrmOpportunity(rawInput);
  validatePlanningNamespace(input, planningNamespace(envConfig));
  if (idempotencyKey !== undefined && idempotencyKey !== input.eventId) {
    throw new IntegrationApiError(400, 'IDEMPOTENCY_KEY_MISMATCH', 'Idempotency-Key deve corresponder ao eventId.');
  }
  const payloadHash = hash(input);
  const { eventId: _eventId, ...version } = input;
  const versionHash = hash(version);
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await database.$transaction(async tx => {
        const receipt = await tx.crmPlanningReceipt.findUnique({ where: receiptWhere(input) });
        if (receipt) {
          if (receipt.payloadHash !== payloadHash) throw conflict('EVENT_CONTENT_CONFLICT');
          const current = await tx.crmOpportunity.findUniqueOrThrow({ where: { id: receipt.opportunityId } });
          return { statusCode: 200, body: planningAck(input, current, 'duplicate', now) };
        }
        const existing = await tx.crmOpportunity.findUnique({ where: opportunityWhere(input) });
        const previousVersion = existing ? await tx.crmOpportunityEvent.findUnique({ where: {
          opportunityId_sourceVersion: { opportunityId: existing.id, sourceVersion: BigInt(input.sourceVersion) }
        } }) : null;
        let current = existing;
        let versionEvent = previousVersion;
        let disposition = 'applied';
        if (previousVersion) {
          if (previousVersion.versionHash !== versionHash) throw conflict('VERSION_CONTENT_CONFLICT');
          disposition = 'duplicate_version';
        } else {
          const applied = !existing || BigInt(input.sourceVersion) > existing.sourceVersion;
          if (applied) {
            validatePlanningTransition(existing, input);
            const links = await resolvePlanningProject(tx, input, existing, { now });
            const data = stateData(input, versionHash, now);
            if (!data.prismaMissionId && (existing?.projectId || existing?.targetProjectId)) data.prismaMissionId = existing.prismaMissionId;
            current = await tx.crmOpportunity.upsert({ where: opportunityWhere(input),
              create: { ...data, ...links }, update: { ...data, ...links } });
            await storePlanningLinkHistory(tx, existing, current);
            if (current.projectLinkStatus === 'LINKED') await reconcileMissionPlanningLinks(tx, input, current.id);
          } else disposition = 'stale_ignored';
          versionEvent = await tx.crmOpportunityEvent.create({ data: { opportunityId: current.id,
            sourceVersion: BigInt(input.sourceVersion), sourceUpdatedAt: new Date(input.sourceUpdatedAt),
            eventId: input.eventId, versionHash, applied, snapshot: input, receivedAt: now } });
        }
        await tx.crmPlanningReceipt.create({ data: {
          sourceSystem: input.sourceSystem, tenantId: input.tenantId, environment: input.environment,
          eventId: input.eventId, payloadHash, opportunityId: current.id, versionEventId: versionEvent.id, disposition, receivedAt: now
        } });
        return { statusCode: existing ? 200 : 201, body: planningAck(input, current, disposition, now) };
      }, { isolationLevel: 'Serializable', timeout: 15_000 });
      clearProjectDerivedCaches();
      return response;
    } catch (error) {
      if (!['P2034', 'P2002'].includes(error.code)) throw error;
      if (attempt >= 4) throw new IntegrationApiError(409, 'CONCURRENT_UPDATE', 'Outra atualização está em andamento. Reenvie o mesmo evento.');
      await delay(20 * 2 ** attempt);
    }
  }
}

export function planningCardCategory(record) {
  if (record.sourceRecordDeleted || record.contractVersion !== CRM_PLANNING_VERSION || record.projectId) return null;
  if (record.commercialStatus === 'WON') return 'FUTURO';
  if (!record.planningRequested) return null;
  if (record.commercialStatus === 'OPEN') return 'FUTURO';
  return record.commercialStatus === 'POSTPONED' ? 'PAUSADA' : null;
}

export async function listCrmOpportunityCards(database = prisma, envConfig = env) {
  const rows = await database.crmOpportunity.findMany({ where: { ...planningNamespace(envConfig),
    contractVersion: CRM_PLANNING_VERSION, sourceRecordDeleted: false, projectId: null,
    OR: [{ commercialStatus: 'WON' }, { commercialStatus: { in: ['OPEN', 'POSTPONED'] }, planningRequested: true }] },
    orderBy: [{ expectedStartDate: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: { id: true, externalId: true, name: true, description: true, clientName: true, clientCnpj: true, location: true,
      proposalCode: true, revision: true, estimatedValue: true, expectedCloseDate: true, expectedStartDate: true, expectedEndDate: true,
      externalUrl: true, sourceUpdatedAt: true, planningRequested: true, commercialStatus: true, sourceRecordDeleted: true,
      contractVersion: true, projectId: true, projectLinkStatus: true, projectLinkReason: true, scopeKind: true,
      targetProject: { select: { id: true, code: true } } } });
  return rows.map(row => ({ ...row, kind: 'OPPORTUNITY', category: planningCardCategory(row),
    estimatedValue: row.estimatedValue === null ? null : Number(row.estimatedValue) }));
}
