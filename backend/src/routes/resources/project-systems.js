import { Router } from 'express';
import asyncHandler from '../../lib/async-handler.js';
import { requireAuth, requireModuleRole, RDO_INTERNAL_ROLES } from '../../middleware/auth.js';
import { hasModuleRole } from '../../lib/module-roles.js';
import { defineRoute } from '../../lib/api-contract/registry.js';
import { rdoRoute, jsonArraySchema } from '../../lib/api-contract/domains/rdo.js';

export function createProjectSystemsRouter(client, collaboratorCanAccessProject) {
  const router = Router();
  defineRoute(router, rdoRoute('GET /:projectId', { summary: 'Sistemas do projeto para o formulário do RDO', responses: { 200: jsonArraySchema }, errors: [401, 403, 404] }), requireAuth, requireModuleRole(...RDO_INTERNAL_ROLES), asyncHandler(async (req, res) => {
    const project = await client.project.findFirst({ where: { id: req.params.projectId, deletedAt: null }, include: { authorizedUsers: true } });
    const canAccess = hasModuleRole(req.auth.user, 'rdo:manager')
      || (hasModuleRole(req.auth.user, 'rdo:coordinator') && project && !project.managerOnly)
      || collaboratorCanAccessProject(req.auth, project);
    if (!project || !canAccess) return res.status(404).json({ error: 'Projeto não encontrado.' });
    const systems = await client.projectServiceSystem.findMany({
      where: { projectId: project.id }, orderBy: [{ equipment: 'asc' }, { name: 'asc' }],
      select: { id: true, projectId: true, equipment: true, name: true,
        plannedRows: { select: { systemType: true, unit: true, service: { select: { serviceType: true } } } } }
    });
    res.json(systems.map(({ plannedRows, ...system }) => ({ ...system,
      measurements: plannedRows.map(row => ({ serviceType: row.service.serviceType, systemType: row.systemType, unit: row.unit }))
    })));
  }));
  return router;
}
