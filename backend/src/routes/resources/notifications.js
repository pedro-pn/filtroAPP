import { Router } from 'express';
import { z } from 'zod';
import asyncHandler from '../../lib/async-handler.js';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../../lib/notifications/center.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();
const idSchema = z.string().trim().min(1).max(100);
const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: idSchema });
router.use(requireAuth);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/', asyncHandler(async (req, res) => {
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

router.post('/read-all', asyncHandler(async (req, res) => {
  const { before } = z.object({ before: z.iso.datetime() }).parse(req.body);
  if (new Date(before) > new Date()) return res.status(400).json({ error: 'Data de leitura inválida.' });
  res.json({ count: await markAllNotificationsRead(req.auth, new Date(before)) });
}));

router.post('/:id/read', asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  if (!await markNotificationRead(req.auth, id)) return res.status(404).json({ error: 'Notificação não encontrada.' });
  res.json({ ok: true });
}));

export default router;
