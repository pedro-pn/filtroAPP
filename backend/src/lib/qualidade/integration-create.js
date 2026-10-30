import { projectChannelWhere } from '../projects/distribution.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { stableJson } from '../api-credentials/cursor.js';
import { assertProjectAllowed, assertProjectFilterAllowed } from './integration-service.js';
import { nextQualityRecordNumber } from './numbering.js';

const text = max => z.string().trim().min(1).max(max);
export const integrationQualityCreateSchema = z.object({
  type: z.enum(['DESVIO', 'INCIDENTE', 'RECLAMACAO_CLIENTE']),
  projectId: text(100).optional(), projectCode: text(100).optional(),
  eventDate: z.iso.date(), description: text(10000), impact: z.enum(['ALTO', 'MEDIO', 'BAIXO']),
  actionOwnerEmail: z.email().max(254),
  externalRef: z.object({ system: text(100), url: z.url().max(2000).refine(value => ['http:', 'https:'].includes(new URL(value).protocol)), reference: text(500) }).strict()
}).strict().refine(value => Boolean(value.projectId) !== Boolean(value.projectCode), { path: ['projectCode'], message: 'Informe projectCode ou projectId, não ambos.' });

export function validateIntegrationQualityCreate(body, key, context, query = {}) {
  if (!context.scopes.has('qualidade.registros.create')) throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'A credencial não possui o escopo necessário.');
  z.object({}).strict().parse(query);
  if (!key) throw new IntegrationApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Envie Idempotency-Key UUID.');
  const parsedKey = z.uuid().safeParse(key);
  if (!parsedKey.success) throw new IntegrationApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key deve ser UUID.');
  const data = integrationQualityCreateSchema.parse(body);
  assertProjectFilterAllowed(data, context);
  return { data, key: parsedKey.data.toLowerCase() };
}

export async function createIntegrationQualityRecord(client, body, key, context) {
  const validated = validateIntegrationQualityCreate(body, key, context);
  const requestHash = createHash('sha256').update(stableJson(body)).digest('hex');
  return client.$transaction(async tx => {
    // Bloqueio durável por credencial serializa reenvios concorrentes antes de
    // numerar/criar; rollback remove recibo, registro, auditoria e evento juntos.
    await tx.$queryRaw`SELECT id FROM "ApiCredential" WHERE id = ${context.credentialId} FOR UPDATE`;
    const receipt = await tx.integrationQualityReceipt.findUnique({
      where: { credentialId_key: { credentialId: context.credentialId, key: validated.key } }
    });
    if (receipt) {
      if (!await tx.project.findFirst({ where: { id: receipt.projectId, ...projectChannelWhere('api') }, select: { id: true } })) {
        throw new IntegrationApiError(404, 'NOT_FOUND', 'Projeto não encontrado.');
      }
      assertProjectAllowed(receipt.projectId, context);
      if (receipt.requestHash !== requestHash) throw new IntegrationApiError(409, 'IDEMPOTENCY_CONFLICT', 'A chave já foi usada com outro corpo.');
      return receipt.response;
    }
    const project = await tx.project.findFirst({ where: { ...projectChannelWhere('api'),
      ...(validated.data.projectId ? { id: validated.data.projectId } : { code: validated.data.projectCode }),
      ...(context.projectAccessMode === 'SELECTED' ? { id: { in: [...context.projectIds], ...(validated.data.projectId ? { equals: validated.data.projectId } : {}) } } : {}) },
    select: { id: true } });
    if (!project) throw new IntegrationApiError(404, 'NOT_FOUND', 'Projeto não encontrado.');
    assertProjectAllowed(project.id, context);
    const users = await tx.user.findMany({ where: { isActive: true, email: { equals: validated.data.actionOwnerEmail, mode: 'insensitive' } },
      select: { id: true, name: true, email: true }, take: 2 });
    if (users.length !== 1) throw new IntegrationApiError(422, 'ACTION_OWNER_NOT_FOUND', 'O e-mail deve identificar um único usuário ativo.');
    const owner = users[0];
    const now = new Date(context.now || new Date());
    const numbering = await nextQualityRecordNumber(tx, { type: validated.data.type, registeredAt: now });
    await tx.$queryRaw`SELECT set_config('app.integration_credential_id', ${context.credentialId}, true)`;
    const row = await tx.qualityRecord.create({ data: {
      ...numbering, type: validated.data.type, registeredAt: now, projectId: project.id,
      origin: 'OMNI', status: 'EM_TRIAGEM', natureId: null,
      eventDate: new Date(`${validated.data.eventDate}T00:00:00.000Z`), description: validated.data.description,
      impact: validated.data.impact, actionOwnerUserId: owner.id, actionOwner: owner.name || owner.email,
      externalRef: validated.data.externalRef
    }, select: { id: true, number: true, status: true, createdAt: true } });
    const response = { id: row.id, number: row.number, status: row.status, createdAt: new Date(row.createdAt).toISOString() };
    await tx.integrationQualityReceipt.create({ data: { credentialId: context.credentialId, key: validated.key, requestHash, projectId: project.id, response } });
    return response;
  });
}
