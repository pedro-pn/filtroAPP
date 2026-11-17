import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import env from '../../config/env.js';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { stableJson } from '../api-credentials/cursor.js';
import { clearCollaboratorDerivedCaches } from '../resource-list-cache.js';
import { requireConectaCompany, validateConectaEvent, complianceStatusAt } from './schema.js';
import { aggregateWhere, projectConectaAggregate } from './projection.js';

const hash = input => createHash('sha256').update(stableJson(input)).digest('hex');
const conflict = code => new IntegrationApiError(409, code, 'O identificador recebido já existe com conteúdo diferente.');
const receiptWhere = input => ({ companyId_eventId: { companyId: input.companyId, eventId: input.eventId } });
const ack = row => ({ receiptId: row.id, statusUrl: `/api/integracoes/v1/rh/conecta/recebimentos/${row.id}`,
  status: row.status, ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}), receivedAt: row.receivedAt.toISOString() });

export async function reconcileConectaCompany(tx, companyId) {
  // A ordem de entrega entre agregados não é uma dependência do protocolo.
  for (const aggregateType of ['job_role', 'employment', 'role_change', 'job_role_salary', 'compliance']) {
    const pending = await tx.conectaRhAggregate.findMany({ where: { companyId, aggregateType, status: 'PENDING' }, orderBy: [{ lastAttemptAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }], take: 100 });
    for (const row of pending) {
      const projected = await projectConectaAggregate(tx, row);
      const status = projected.status || (projected.reasonCode ? 'PENDING' : 'APPLIED');
      await tx.conectaRhAggregate.update({ where: { id: row.id }, data: { status, lastAttemptAt: new Date(), reasonCode: projected.reasonCode || null, ...(Object.hasOwn(projected, 'localId') ? { localId: projected.localId } : {}) } });
      await tx.conectaRhReceipt.updateMany({ where: { aggregateId: row.id, revision: row.revision }, data: { status, reasonCode: projected.reasonCode || null } });
      await tx.conectaRhReceipt.updateMany({ where: { aggregateId: row.id, revision: { lt: row.revision }, status: 'PENDING' }, data: { status: 'SUPERSEDED', reasonCode: null } });
    }
  }
}

export async function receiveConectaEvent(database, raw, { idempotencyKey, now = new Date(), companyId = env.conectaRhCompanyId } = {}) {
  const input = validateConectaEvent(raw, idempotencyKey);
  requireConectaCompany(input.companyId, companyId);
  const payloadHash = hash(input);
  const { eventId: _eventId, ...version } = input;
  const versionHash = hash(version);
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await database.$transaction(async tx => {
        const previousReceipt = await tx.conectaRhReceipt.findUnique({ where: receiptWhere(input) });
        if (previousReceipt) {
          if (previousReceipt.payloadHash !== payloadHash) throw conflict('EVENT_CONTENT_CONFLICT');
          return ack(previousReceipt);
        }
        const where = aggregateWhere(input.companyId, input.aggregateType, input.aggregateId);
        const previous = await tx.conectaRhAggregate.findUnique({ where });
        const previousVersion = previous && await tx.conectaRhReceipt.findFirst({ where: { aggregateId: previous.id, revision: input.revision } });
        if (previousVersion && previousVersion.versionHash !== versionHash) throw conflict('REVISION_CONTENT_CONFLICT');
        const newer = !previous || input.revision > previous.revision;
        let row = previous;
        if (newer) {
          const state = { revision: input.revision, data: input.data, occurredAt: new Date(input.occurredAt), status: 'PENDING', reasonCode: null };
          row = await tx.conectaRhAggregate.upsert({ where,
            create: { companyId: input.companyId, aggregateType: input.aggregateType, externalId: input.aggregateId, firstReceivedAt: now, ...state }, update: state });
        }
        const receipt = await tx.conectaRhReceipt.create({ data: { companyId: input.companyId, eventId: input.eventId,
          aggregateId: row.id, revision: input.revision, payloadHash, versionHash, receivedAt: now,
          status: input.revision < row.revision ? 'SUPERSEDED' : row.status, reasonCode: input.revision < row.revision ? null : row.reasonCode } });
        await reconcileConectaCompany(tx, companyId);
        return ack(await tx.conectaRhReceipt.findUniqueOrThrow({ where: { id: receipt.id } }));
      }, { isolationLevel: 'Serializable', timeout: 15_000 });
      clearCollaboratorDerivedCaches();
      return result;
    } catch (error) {
      if (!['P2034', 'P2002'].includes(error.code)) throw error;
      if (attempt >= 3) throw new IntegrationApiError(503, 'CONCURRENT_UPDATE', 'Reenvie o mesmo evento em instantes.');
      await delay(20 * 2 ** attempt);
    }
  }
}

export async function getConectaReceipt(database, receiptId, companyId = env.conectaRhCompanyId) {
  const row = await database.conectaRhReceipt.findFirst({ where: { id: receiptId, companyId } });
  if (!row) throw new IntegrationApiError(404, 'NOT_FOUND', 'Recebimento não encontrado.');
  return ack(row);
}

export async function getConectaCompliance(database, collaboratorId, referenceDate, companyId = env.conectaRhCompanyId) {
  const mapping = await database.conectaRhPerson.findUnique({ where: { collaboratorId } });
  if (!mapping || mapping.companyId !== companyId) return [];
  const rows = await database.conectaRhAggregate.findMany({ where: { companyId, aggregateType: 'compliance', localId: collaboratorId, status: 'APPLIED' } });
  return rows.map(({ data }) => ({ ...data, status: complianceStatusAt(data, referenceDate) }));
}
