import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import { listManometersCompat, respondManagedByModule } from '../../lib/equipment-compat.js';
import { manometersCache } from '../../lib/resource-list-cache.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

// Manômetros agora são gerenciados pelo módulo Equipamentos. Este router é um
// shim de LEITURA que projeta o modelo unificado para a forma legada usada pelos
// relatórios (teste de pressão).
const router = Router();
router.use(requireAuth);

router.get('/', requireInternalUser, asyncHandler(async (_req, res) => {
  const items = await manometersCache.get(() => listManometersCompat());
  res.json(items);
}));

router.post('/', requireManager, respondManagedByModule);
router.put('/:id', requireManager, respondManagedByModule);
router.delete('/:id', requireManager, respondManagedByModule);

export default router;
