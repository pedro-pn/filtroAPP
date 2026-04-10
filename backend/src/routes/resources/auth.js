import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { createSession, publicUser } from '../../lib/auth.js';
import { verifyPassword } from '../../lib/password.js';
import prisma from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

router.post('/login', asyncHandler(async (req, res) => {
  const data = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { username: data.username },
    include: { collaborator: true }
  });

  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'Usuario ou senha invalidos.' });
  }

  const valid = await verifyPassword(data.password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Usuario ou senha invalidos.' });
  }

  const session = await createSession(user.id);

  res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: publicUser(user)
  });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.auth.user });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await prisma.userSession.deleteMany({
    where: { id: req.auth.sessionId }
  });

  res.status(204).end();
}));

export default router;
