import { z } from 'zod';
import { IntegrationApiError } from '../../middleware/api-request-context.js';

const id = z.uuid();
const date = z.iso.date();
const text = z.string().trim().min(1).max(300);
const nullableId = id.nullable();
const occurrence = { id, status: z.enum(['ACTIVE', 'CANCELLED']), supersedesId: nullableId };
const evidence = z.object({
  id, version: id, contentType: text, fileName: text,
  authenticatedDownloadPath: z.string().startsWith('/api/integracoes/filtroapp/v1/evidence/').max(1000),
  expiresAt: z.null()
}).strict().nullable();
const schemas = {
  job_role: z.object({ id, name: text, isActive: z.boolean(), isOperational: z.boolean(), cbo: text.nullable() }).strict(),
  job_role_salary: z.object({ ...occurrence, jobRoleId: id, amount: z.string().regex(/^\d{1,10}\.\d{2}$/),
    currency: z.literal('BRL'), basis: z.literal('MONTHLY'), effectiveDate: date }).strict(),
  employment: z.object({
    personId: id, employmentId: id, name: text, cpf: z.string().regex(/^\d{11}$/).nullable(),
    registrationNumber: text.nullable(), email: z.string().max(320).nullable(), isOperational: z.boolean(),
    admissionDate: date.nullable(), terminationDate: date.nullable(),
    status: z.enum(['PRE_ADMISSION', 'ACTIVE', 'TERMINATED', 'CANCELLED']), currentJobRoleId: nullableId
  }).strict().superRefine((value, ctx) => {
    if (['ACTIVE', 'TERMINATED'].includes(value.status) && !value.admissionDate) {
      ctx.addIssue({ code: 'custom', path: ['admissionDate'], message: 'A admissão oficial é obrigatória após a ativação.' });
    }
    if ((value.status === 'TERMINATED') !== Boolean(value.terminationDate)) {
      ctx.addIssue({ code: 'custom', path: ['terminationDate'], message: 'Informe desligamento somente para vínculo TERMINATED.' });
    }
    if (value.admissionDate && value.terminationDate && value.terminationDate < value.admissionDate) {
      ctx.addIssue({ code: 'custom', path: ['terminationDate'], message: 'Desligamento anterior à admissão.' });
    }
  }),
  role_change: z.object({ ...occurrence, personId: id, employmentId: id, jobRoleId: id,
    // Adequação acordada: pré-admissão sem data usa a referência persistida do vínculo.
    effectiveDate: date.nullable() }).strict(),
  compliance: z.object({ id, personId: id, employmentId: z.null(), category: z.enum(['DOCUMENT', 'EXAM', 'TRAINING', 'CERTIFICATE']),
    typeCode: text, title: text, status: z.enum(['VALID', 'EXPIRED', 'REVOKED', 'PENDING', 'UNKNOWN']),
    issuedOn: date.nullable(), expiresOn: date.nullable(), hasNoExpiry: z.boolean(), evidence }).strict()
};
const envelope = z.object({ schemaVersion: z.literal('1.0'), eventId: id, companyId: id,
  eventType: z.string(), aggregateType: z.enum(Object.keys(schemas)), aggregateId: id,
  revision: z.number().int().positive().max(2_147_483_647), occurredAt: z.iso.datetime({ offset: true }), data: z.unknown() }).strict();

export function validateConectaEvent(raw, idempotencyKey = raw?.eventId) {
  const input = envelope.parse(raw);
  input.data = schemas[input.aggregateType].parse(input.data);
  if (input.data.supersedesId === input.aggregateId) {
    throw new IntegrationApiError(422, 'SUPERSEDES_MISMATCH', 'Uma ocorrência não pode substituir a si mesma.');
  }
  if (input.aggregateType === 'compliance' && ['ASO', 'TOXICOLOGICO'].includes(input.data.typeCode.toUpperCase()) && input.data.evidence) {
    throw new IntegrationApiError(422, 'CLINICAL_EVIDENCE_NOT_ALLOWED', 'ASO e toxicológico não devem conter evidência.');
  }
  if (input.eventType !== `${input.aggregateType}.upserted`
    || input.aggregateId !== (input.data.employmentId && input.aggregateType === 'employment' ? input.data.employmentId : input.data.id)) {
    throw new IntegrationApiError(422, 'AGGREGATE_MISMATCH', 'Tipo ou identificador incompatível com o agregado.');
  }
  if (idempotencyKey !== input.eventId) {
    throw new IntegrationApiError(400, 'IDEMPOTENCY_KEY_MISMATCH', 'Envie Idempotency-Key igual ao eventId.');
  }
  return input;
}

export function requireConectaCompany(companyId, configuredCompanyId) {
  if (!configuredCompanyId) throw new IntegrationApiError(503, 'INTEGRATION_NOT_CONFIGURED', 'Configure a empresa da integração Conecta.');
  if (companyId !== configuredCompanyId) throw new IntegrationApiError(403, 'COMPANY_NOT_ALLOWED', 'Empresa não autorizada para esta integração.');
}

// A referência usa o calendário da operação brasileira, e não o dia UTC da entrega.
export function receiptDate(receivedAt) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(receivedAt);
}

export function employmentDates(data, firstReceivedAt) {
  return { admissionDate: data.admissionDate || receiptDate(firstReceivedAt),
    admissionDateProvisional: data.admissionDate === null };
}

export function complianceStatusAt(data, referenceDate) {
  if (data.status === 'REVOKED') return 'REVOKED';
  if (!data.issuedOn || data.issuedOn > referenceDate) return data.status === 'UNKNOWN' ? 'UNKNOWN' : 'PENDING';
  if (data.hasNoExpiry) return 'VALID';
  if (!data.expiresOn) return 'UNKNOWN';
  return data.expiresOn < referenceDate ? 'EXPIRED' : 'VALID';
}
