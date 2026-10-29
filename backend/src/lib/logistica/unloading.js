import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { stableJson } from '../api-credentials/cursor.js';
import { assertProjectAllowed } from '../qualidade/integration-service.js';

export const unloadingSchema = z.object({ romaneioId: z.string().trim().min(1).max(100), tipo: z.enum(['PARCIAL', 'TOTAL']),
  confirmadaEm: z.iso.datetime({ offset: true }), confirmadaPorEmail: z.email().max(254) }).strict();
export function validateUnloading(body, key, context, query = {}) {
  if (!context.scopes.has('logistica.descargas.create')) throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'Falta o escopo de confirmação de descarga.');
  z.object({}).strict().parse(query);
  if (!key) throw new IntegrationApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Envie Idempotency-Key UUID.');
  if (!z.uuid().safeParse(key).success) throw new IntegrationApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key deve ser UUID.');
  const data = unloadingSchema.parse(body);
  if (new Date(data.confirmadaEm) > new Date(context.now || Date.now())) throw new IntegrationApiError(422, 'FUTURE_CONFIRMATION', 'A descarga não pode ser confirmada no futuro.');
  return { data, key: key.toLowerCase() };
}
export async function assertUnloadingUser(client, projectId, email, sessionUserId) {
  const users = await client.user.findMany({ where: { isActive: true, email: { equals: email, mode: 'insensitive' },
    ...(sessionUserId ? { id: sessionUserId } : {}) }, select: { id: true, email: true, accountType: true }, take: 2 });
  const user = users.length === 1 ? users[0] : null;
  if (!user) throw new IntegrationApiError(422, 'CONFIRMING_USER_NOT_ALLOWED', 'O e-mail deve identificar um único usuário ativo com acesso ao projeto.');
  const access = user.accountType === 'ADMIN' || await client.project.findFirst({ where: { id: projectId, deletedAt: null, OR: [
    { workflow: { leaderUserId: user.id } }, { workflow: { plannerUserId: user.id } }, { authorizedUsers: { some: { userId: user.id } } }
  ] }, select: { id: true } });
  if (!access) throw new IntegrationApiError(422, 'CONFIRMING_USER_NOT_ALLOWED', 'O e-mail deve identificar um único usuário ativo com acesso ao projeto.');
  return user;
}
export async function createUnloading(client, body, key, context) {
  const validated = validateUnloading(body, key, context);
  const hash = createHash('sha256').update(stableJson(body)).digest('hex');
  return client.$transaction(async tx => {
    if (context.credentialId) {
      await tx.$queryRaw`SELECT id FROM "ApiCredential" WHERE id=${context.credentialId} FOR UPDATE`;
      const receipt = await tx.integrationUnloadingReceipt.findUnique({ where: { credentialId_key: { credentialId: context.credentialId, key: validated.key } } });
      if (receipt) {
        assertProjectAllowed(receipt.projectId, context);
        if (receipt.requestHash !== hash) throw new IntegrationApiError(409, 'IDEMPOTENCY_CONFLICT', 'A chave já foi usada com outro corpo.');
        // Revalida o usuário, inclusive em replay: acesso removido não pode confirmar.
        await assertUnloadingUser(tx, receipt.projectId, validated.data.confirmadaPorEmail, context.sessionUserId);
        return receipt.response;
      }
    }
    await tx.$queryRaw`SELECT id FROM "Romaneio" WHERE id=${validated.data.romaneioId} FOR UPDATE`;
    const romaneio = await tx.romaneio.findFirst({ where: { id: validated.data.romaneioId, project: { deletedAt: null } },
      select: { id: true, type: true, projectId: true, ctes: { select: { id: true }, orderBy: { createdAt: 'desc' }, take: 2 } } });
    if (!romaneio) throw new IntegrationApiError(404, 'NOT_FOUND', 'Romaneio não encontrado.');
    assertProjectAllowed(romaneio.projectId, context);
    if (romaneio.type !== 'OUTBOUND') throw new IntegrationApiError(422, 'OUTBOUND_REQUIRED', 'A descarga exige romaneio de saída.');
    const user = await assertUnloadingUser(tx, romaneio.projectId, validated.data.confirmadaPorEmail, context.sessionUserId);
    const at = new Date(validated.data.confirmadaEm);
    const history = await tx.logisticsUnloading.findMany({ where: { romaneioId: romaneio.id }, orderBy: { confirmadaEm: 'desc' } });
    const total = history.find(row => row.tipo === 'TOTAL');
    let row = history.find(item => item.tipo === validated.data.tipo && +item.confirmadaEm === +at);
    if (!row && total) {
      if (validated.data.tipo === 'TOTAL') row = total;
      else throw new IntegrationApiError(409, 'UNLOADING_COMPLETED', 'O romaneio já tem descarga total confirmada.');
    }
    if (!row && history[0] && at < history[0].confirmadaEm) throw new IntegrationApiError(422, 'INVALID_CONFIRMATION_ORDER', 'A confirmação deve ser posterior à última descarga.');
    if (!row) row = await tx.logisticsUnloading.create({ data: {
      romaneioId: romaneio.id, projectId: romaneio.projectId, tipo: validated.data.tipo, confirmadaEm: at,
      confirmedByUserId: user.id, confirmadaPorEmail: user.email, actorCredentialId: context.credentialId || null,
      cteId: romaneio.ctes.length === 1 ? romaneio.ctes[0].id : null
    } });
    const response = { id: row.id, romaneioId: row.romaneioId, projectId: row.projectId, tipo: row.tipo,
      confirmadaEm: row.confirmadaEm.toISOString(), confirmadaPorEmail: row.confirmadaPorEmail };
    if (context.credentialId) await tx.integrationUnloadingReceipt.create({ data: { credentialId: context.credentialId, key: validated.key,
      requestHash: hash, projectId: row.projectId, response } });
    return response;
  });
}
