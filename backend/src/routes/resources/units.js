import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import { listUnitsCompat, respondManagedByModule } from '../../lib/equipment-compat.js';
import { UNIT_SYSTEMKEY_PREFIX, legacyUnitCategory } from '../../lib/equipment-categories.js';
import prisma from '../../lib/prisma.js';
import { unitCategoriesCache, unitsCache } from '../../lib/resource-list-cache.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, jsonResponseSchema } from '../../lib/api-contract/domains/operacoes.js';
// Os equipamentos do tipo "unidade" passaram a ser gerenciados pelo módulo
// Equipamentos. Este router agora é apenas um shim de LEITURA que projeta o
// modelo unificado de volta para a forma legada usada pelos relatórios.
const router = Router();
router.use(requireAuth);

defineRoute(router, opsRoute('GET /', { tag: 'inventario-rdo', summary: 'Unidades: Listar registros', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireInternalUser, asyncHandler(async (_req, res) => {
  const items = await unitsCache.get(() => listUnitsCompat());
  res.json(items);
}));

defineRoute(router, opsRoute('GET /categories', { tag: 'inventario-rdo', summary: 'Unidades: Listar categorias', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireManager, asyncHandler(async (_req, res) => {
  const categories = await unitCategoriesCache.get(async () => {
    const [unitCategories, romaneioCategories] = await Promise.all([
      prisma.equipmentCategory.findMany({
        where: { isActive: true, systemKey: { startsWith: UNIT_SYSTEMKEY_PREFIX } },
        select: { systemKey: true, name: true }
      }),
      prisma.romaneioCatalogItem.findMany({
        distinct: ['categoryName'],
        where: { isActive: true },
        select: { categoryName: true },
        orderBy: { categoryName: 'asc' }
      })
    ]);

    return Array.from(new Set([
      ...unitCategories.map(item => legacyUnitCategory(item.systemKey) || item.name),
      ...romaneioCategories.map(item => item.categoryName)
    ].map(item => String(item || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  });

  res.json(categories);
}));

// Escritas agora são feitas exclusivamente pelo módulo Equipamentos.
defineRoute(router, opsRoute('POST /', { tag: 'inventario-rdo', summary: 'Unidades: Escritas agora são feitas exclusivamente pelo módulo Equipamentos', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireManager, respondManagedByModule);
defineRoute(router, opsRoute('PUT /categories/rename', { tag: 'inventario-rdo', summary: 'Unidades: Atualizar categorias › rename', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireManager, respondManagedByModule);
defineRoute(router, opsRoute('PUT /:id', { tag: 'inventario-rdo', summary: 'Unidades: Atualizar registro (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireManager, respondManagedByModule);
defineRoute(router, opsRoute('DELETE /:id', { tag: 'inventario-rdo', summary: 'Unidades: Excluir registro (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireManager, respondManagedByModule);

export default router;
