import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import { listParticleCountersCompat, respondManagedByModule } from '../../lib/equipment-compat.js';
import { particleCountersCache } from '../../lib/resource-list-cache.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, jsonResponseSchema } from '../../lib/api-contract/domains/operacoes.js';
// Contadores de partículas agora são gerenciados pelo módulo Equipamentos.
// Este router é um shim de LEITURA que projeta o modelo unificado para a forma
// legada usada pelos relatórios (bloco de partículas).
const router = Router();
router.use(requireAuth);

defineRoute(router, opsRoute('GET /', { tag: 'inventario-rdo', summary: 'Contadores de partículas: Listar registros', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireInternalUser, asyncHandler(async (_req, res) => {
  const items = await particleCountersCache.get(() => listParticleCountersCompat());
  res.json(items);
}));

defineRoute(router, opsRoute('POST /', { tag: 'inventario-rdo', summary: 'Contadores de partículas: Criar registro', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireManager, respondManagedByModule);
defineRoute(router, opsRoute('PUT /categories/rename', { tag: 'inventario-rdo', summary: 'Contadores de partículas: Atualizar categorias › rename', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireManager, respondManagedByModule);
defineRoute(router, opsRoute('PUT /:id', { tag: 'inventario-rdo', summary: 'Contadores de partículas: Atualizar registro (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireManager, respondManagedByModule);
defineRoute(router, opsRoute('DELETE /:id', { tag: 'inventario-rdo', summary: 'Contadores de partículas: Excluir registro (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireManager, respondManagedByModule);

export default router;
