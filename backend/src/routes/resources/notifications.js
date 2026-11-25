import { Router } from 'express';
import { z } from 'zod';
import asyncHandler from '../../lib/async-handler.js';
import { deleteNotification, listNotifications, markAllNotificationsRead, markNotificationRead } from '../../lib/notifications/center.js';
import { requireAuth } from '../../middleware/auth.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/operacoes.js';
const router = Router();
const idSchema = z.string().trim().min(1).max(100);
const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: idSchema });
router.use(requireAuth);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

defineRoute(router, opsRoute('GET /', { tag: 'notificacoes', summary: 'Notificações: Listar notificações do usuário', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const query = z.object({
    filter: z.enum(['all', 'unread']).default('all'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(500).optional()
  }).parse(req.query);
  let cursor;
  if (query.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString())); }
    catch { return res.status(400).json({ error: 'Página de notificações inválida.' }); }
  }
  res.json(await listNotifications(req.auth, { ...query, cursor }));
}));

defineRoute(router, opsRoute('POST /read-all', { tag: 'notificacoes', summary: 'Notificações: Marcar todas como lidas', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const { before } = z.object({ before: z.iso.datetime() }).parse(req.body);
  if (new Date(before) > new Date()) return res.status(400).json({ error: 'Data de leitura inválida.' });
  res.json({ count: await markAllNotificationsRead(req.auth, new Date(before)) });
}));

defineRoute(router, opsRoute('POST /:id/read', { tag: 'notificacoes', summary: 'Notificações: Marcar como lida', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  if (!await markNotificationRead(req.auth, id)) return res.status(404).json({ error: 'Notificação não encontrada.' });
  res.json({ ok: true });
}));

defineRoute(router, opsRoute('DELETE /:id', { tag: 'notificacoes', summary: 'Notificações: Excluir notificação', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  if (!await deleteNotification(req.auth, id)) return res.status(404).json({ error: 'Notificação não encontrada.' });
  res.json({ ok: true });
}));

export default router;
