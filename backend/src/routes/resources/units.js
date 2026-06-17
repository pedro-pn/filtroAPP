import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import { listUnitsCompat, respondManagedByModule } from '../../lib/equipment-compat.js';
import { UNIT_SYSTEMKEY_PREFIX, legacyUnitCategory } from '../../lib/equipment-categories.js';
import prisma from '../../lib/prisma.js';
import { unitCategoriesCache, unitsCache } from '../../lib/resource-list-cache.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

// Os equipamentos do tipo "unidade" passaram a ser gerenciados pelo módulo
// Equipamentos. Este router agora é apenas um shim de LEITURA que projeta o
// modelo unificado de volta para a forma legada usada pelos relatórios.
const router = Router();
router.use(requireAuth);

router.get('/', requireInternalUser, asyncHandler(async (_req, res) => {
  const items = await unitsCache.get(() => listUnitsCompat());
  res.json(items);
}));

router.get('/categories', requireManager, asyncHandler(async (_req, res) => {
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
router.post('/', requireManager, respondManagedByModule);
router.put('/categories/rename', requireManager, respondManagedByModule);
router.put('/:id', requireManager, respondManagedByModule);
router.delete('/:id', requireManager, respondManagedByModule);

export default router;
