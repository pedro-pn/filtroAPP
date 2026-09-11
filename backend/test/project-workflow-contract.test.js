import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { z } from 'zod';

import { makeProjectWorkflowSchemas } from '../../shared/schemas/project-workflow.js';

test('router de gestão fica sob autenticação do Efetivo e valida todas as entradas com Zod', () => {
  const parent = fs.readFileSync(new URL('../src/routes/resources/efetivo.js', import.meta.url), 'utf8');
  const router = fs.readFileSync(new URL('../src/routes/efetivo-project-workflow.js', import.meta.url), 'utf8');
  assert.ok(parent.indexOf('router.use(requireAuth)') < parent.indexOf("router.use('/project-workflow'"));
  assert.match(router, /schemas\.list\.parse\(req\.query\)/);
  assert.match(router, /schemas\.start\.parse\(req\.body\)/);
  assert.match(router, /schemas\.patch\.parse\(req\.body\)/);
  assert.match(router, /executionSchemas\.reportTargets\.parse\(req\.body\)/);
  assert.match(router, /executionSchemas\.deviationCreate\.parse\(req\.body\)/);
  assert.match(router, /executionSchemas\.deviationStatus\.parse\(req\.body\)/);
  assert.match(router, /getProjectCloseoutDashboard/);
  assert.match(router, /requireEfetivoManager/);
  assert.match(router, /requireEfetivoViewer/);
});

test('contrato de desmobilização recebe a mobilização do cronograma sem quebrar clientes anteriores', () => {
  const { patch } = makeProjectWorkflowSchemas(z);
  assert.equal(patch.safeParse({
    action: 'demobilization', version: 1, mobilizationDate: '2026-09-10', returnDate: '2026-09-22'
  }).success, true);
  assert.equal(patch.safeParse({
    action: 'demobilization', version: 1, returnDate: '2026-09-22'
  }).success, true);
  assert.equal(patch.safeParse({
    action: 'demobilization', version: 1, mobilizationDate: null, returnDate: '2026-09-22'
  }).success, false);
});

test('contrato valida o planejamento estruturado de insumos e logística', () => {
  const { patch } = makeProjectWorkflowSchemas(z);
  assert.equal(patch.safeParse({
    action: 'supply_plan', version: 1, defined: true,
    items: [{ id: 'stock-item-1', stockItemId: 'item-1', type: 'FILTRO', name: 'Filtro 10 µm', unitLabel: 'un', requiredQuantity: 4, requestedAt: null, purchasedAt: null }]
  }).success, true);
  assert.equal(patch.safeParse({
    action: 'supply_plan', version: 1, defined: true, items: []
  }).success, false);
  assert.equal(patch.safeParse({
    action: 'supply_plan', version: 1, defined: true,
    items: [{ id: 'custom-1', stockItemId: null, type: 'PRODUTO_QUIMICO', name: 'Produto especial', unitLabel: 'L', requiredQuantity: 2, requestedAt: null, purchasedAt: '2026-09-12' }]
  }).success, false);
  assert.equal(patch.safeParse({
    action: 'logistics_plan', version: 1,
    vehicleRequired: true, vehicleQuantity: null, vehicleType: null,
    freightRequired: null,
    lodgingRequired: true, lodgingPeopleCount: null, lodgingExpectedDate: '2026-09-20', lodgingRequested: null,
    lodgingRequestedAt: null, lodgingCompletedAt: null
  }).success, true);
});
