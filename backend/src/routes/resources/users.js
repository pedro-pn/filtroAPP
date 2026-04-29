import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import env from '../../config/env.js';
import { publicUser } from '../../lib/auth.js';
import { buildClientAccessReminderEmailTemplate } from '../../lib/email-templates.js';
import { getMissingMailerConfig, sendMail } from '../../lib/mailer.js';
import { hashPassword } from '../../lib/password.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireManager } from '../../middleware/auth.js';

const router = Router();

const schema = z.object({
  username: z.string().min(1),
  name: z.string().min(1),
  email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
  password: z.string().min(6).optional(),
  role: z.nativeEnum(UserRole),
  isActive: z.boolean().default(true),
  collaboratorId: z.string().nullable().optional()
});

router.use(requireAuth, requireManager);

router.get('/', asyncHandler(async (req, res) => {
  const group = String(req.query.group || '').trim().toLowerCase();
  const where = {};
  if (group === 'internal') {
    where.role = { in: [UserRole.MANAGER, UserRole.COLLABORATOR, UserRole.COORDINATOR] };
  } else if (group === 'client') {
    where.role = UserRole.CLIENT;
  }

  const users = await prisma.user.findMany({
    where,
    include: { collaborator: true },
    orderBy: [{ role: 'asc' }, { name: 'asc' }]
  });

  const clientUsers = users.filter(user => user.role === UserRole.CLIENT);
  const linkedProjects = clientUsers.length
    ? await prisma.project.findMany({
        where: { clientCnpj: { in: clientUsers.map(user => user.username) } },
        orderBy: [{ name: 'asc' }],
        select: {
          clientCnpj: true,
          code: true,
          name: true,
          contractCode: true,
          isActive: true
        }
      })
    : [];

  const projectsByCnpj = linkedProjects.reduce((acc, project) => {
    if (!acc[project.clientCnpj]) acc[project.clientCnpj] = [];
    acc[project.clientCnpj].push(project);
    return acc;
  }, {});

  res.json(users.map(user => ({
    ...publicUser(user),
    linkedProjects: projectsByCnpj[user.username] || []
  })));
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  if (!data.password) {
    return res.status(400).json({ error: 'Senha obrigatória para novo usuário.' });
  }

  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({
    data: {
      username: data.username,
      name: data.name,
      email: data.email || null,
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
    ...(data.email !== undefined ? { email: data.email || null } : {}),
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

router.post('/:id/resend-client-access', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id }
  });

  if (user.role !== UserRole.CLIENT) {
    return res.status(400).json({ error: 'Esta ação é exclusiva para contas CLIENT.' });
  }

  if (!user.email) {
    return res.status(400).json({ error: 'A conta CLIENT não possui e-mail principal cadastrado.' });
  }

  const projects = await prisma.project.findMany({
    where: { clientCnpj: user.username },
    orderBy: [{ name: 'asc' }],
    select: { code: true, name: true, contractCode: true }
  });

  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length) {
    return res.status(400).json({ error: `Configuração SMTP ausente: ${missingMailerConfig.join(', ')}` });
  }

  const { randomBytes } = await import('node:crypto');
  const newPassword = randomBytes(5).toString('hex');
  const newHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

  const template = buildClientAccessReminderEmailTemplate({
    clientName: user.name,
    cnpj: user.username,
    newPassword,
    appUrl: env.appUrl,
    projectCount: projects.length
  });

  await sendMail({
    to: user.email,
    ...template
  });

  res.json({ ok: true });
}));

export default router;
