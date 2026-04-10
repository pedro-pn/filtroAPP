import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { publicUser } from '../../lib/auth.js';
import { hashPassword } from '../../lib/password.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireManager } from '../../middleware/auth.js';

const router = Router();

const schema = z.object({
  username: z.string().min(1),
  name: z.string().min(1),
  password: z.string().min(6).optional(),
  role: z.nativeEnum(UserRole),
  isActive: z.boolean().default(true),
  collaboratorId: z.string().nullable().optional()
});

router.use(requireAuth, requireManager);

router.get('/', asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({
    include: { collaborator: true },
    orderBy: [{ role: 'asc' }, { name: 'asc' }]
  });

  res.json(users.map(publicUser));
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  if (!data.password) {
    return res.status(400).json({ error: 'Senha obrigatoria para novo usuario.' });
  }

  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({
    data: {
      username: data.username,
      name: data.name,
      passwordHash,
      role: data.role,
      isActive: data.isActive,
      collaboratorId: data.collaboratorId || null
    },
    include: { collaborator: true }
  });

  res.status(201).json(publicUser(user));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const payload = {
    ...(data.username !== undefined ? { username: data.username } : {}),
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.role !== undefined ? { role: data.role } : {}),
    ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    ...(data.collaboratorId !== undefined ? { collaboratorId: data.collaboratorId || null } : {}),
    ...(data.password ? { passwordHash: await hashPassword(data.password) } : {})
  };

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: payload,
    include: { collaborator: true }
  });

  res.json(publicUser(user));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
