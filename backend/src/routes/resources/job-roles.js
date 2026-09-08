import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { normalizeJobRoleKey } from '../../lib/collaborators/job-role-service.js';
import { requireJobRolePatchAccess } from '../../lib/efetivo/access.js';
import { sortJobRolesByName } from '../../lib/job-roles/index.js';
import prisma from '../../lib/prisma.js';
import { RDO_INTERNAL_ROLES, requireAuth, requireManager, requireModuleRole } from '../../middleware/auth.js';

const router = Router();
const requireRdoInternal = requireModuleRole(...RDO_INTERNAL_ROLES);

const schema = z.object({
  name: z.string().min(1),
  order: z.number().int().optional(),
  isActive: z.boolean().optional(),
  isOperational: z.boolean().optional()
});

router.get('/', requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const includeInactive = req.query.all === 'true';
  const items = await prisma.jobRole.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: 'asc' }
  });
  res.json(sortJobRolesByName(items));
}));

router.post('/', requireAuth, requireRdoInternal, requireManager, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const item = await prisma.jobRole.create({
    data: {
      name: data.name.trim(),
      normalizedKey: normalizeJobRoleKey(data.name),
      order: data.order ?? 0,
      isActive: data.isActive ?? true,
      isOperational: data.isOperational ?? true
    }
  });
  res.status(201).json(item);
}));

router.patch('/:id', requireAuth, requireRdoInternal, requireJobRolePatchAccess, asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const item = await prisma.jobRole.update({
    where: { id: req.params.id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.name !== undefined ? { normalizedKey: normalizeJobRoleKey(data.name) } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.isOperational !== undefined ? { isOperational: data.isOperational } : {})
    }
  });
  res.json(item);
}));

router.delete('/:id', requireAuth, requireRdoInternal, requireManager, asyncHandler(async (req, res) => {
  await prisma.jobRole.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.status(204).end();
}));

export default router;
