import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  assertRomaneioOutboundProjectAvailable,
  romaneioProjectAvailableForType,
  romaneioProjectListWhereForUser
} from '../src/routes/resources/romaneios.js';

test('Saída lista projetos ativos mesmo antes da mobilização', () => {
  assert.equal(romaneioProjectAvailableForType({
    id: 'managed-preparing', isActive: true, workflow: { stage: 'PREPARATION' }
  }, 'OUTBOUND'), true);
  assert.equal(romaneioProjectAvailableForType({
    id: 'managed-blocked', isActive: true, workflow: { stage: 'PREPARATION', qsmsVerified: false }
  }, 'OUTBOUND'), true);
  assert.equal(romaneioProjectAvailableForType({ id: 'legacy-active', isActive: true, workflow: null }, 'OUTBOUND'), true);
  assert.equal(romaneioProjectAvailableForType({ id: 'legacy-finished', isActive: false, workflow: null }, 'OUTBOUND'), false);
  assert.equal(romaneioProjectAvailableForType({
    id: 'managed-executing', isActive: true, workflow: { stage: 'EXECUTION' }
  }, 'OUTBOUND'), true);
  assert.equal(romaneioProjectAvailableForType({
    id: 'managed-finished', isActive: false, workflow: { stage: 'FINISHED' }
  }, 'OUTBOUND'), false);
});

test('Entrada aceita gerenciado bloqueado e legado concluído', () => {
  assert.equal(romaneioProjectAvailableForType({
    id: 'managed-blocked', isActive: false, workflow: { stage: 'PREPARATION' }
  }, 'INBOUND'), true);
  assert.equal(romaneioProjectAvailableForType({ id: 'legacy-finished', isActive: false, workflow: null }, 'INBOUND'), true);
});

test('consultas tipadas preservam visibilidade e listam projetos ativos para Saída', () => {
  assert.deepEqual(
    romaneioProjectListWhereForUser({ role: 'COORDINATOR' }, undefined, 'OUTBOUND'),
    {
      deletedAt: null,
      managerOnly: false,
      isActive: true
    }
  );
  assert.deepEqual(
    romaneioProjectListWhereForUser({ role: 'COORDINATOR' }, undefined, 'INBOUND'),
    { deletedAt: null, managerOnly: false }
  );
});

test('Saída direta aceita projeto ativo sem consultar o Efetivo e rejeita concluído', async () => {
  const calls = [];
  const database = {
    project: { findUnique: async ({ where }) => { calls.push(where.id); return { isActive: where.id === 'managed-preparing' }; } }
  };
  assert.equal(await assertRomaneioOutboundProjectAvailable('OUTBOUND', 'managed-preparing', database), null);
  await assert.rejects(
    assertRomaneioOutboundProjectAvailable('OUTBOUND', 'legacy-finished', database),
    error => error.statusCode === 409 && error.code === 'ROMANEIO_OUTBOUND_PROJECT_NOT_AVAILABLE'
  );
  assert.deepEqual(calls, ['managed-preparing', 'legacy-finished']);
  calls.length = 0;
  assert.equal(await assertRomaneioOutboundProjectAvailable('INBOUND', 'legacy-finished', database), null);
  assert.deepEqual(calls, []);
});

test('rotas de gravação não criam obra pendente para código ausente', () => {
  const source = fs.readFileSync(new URL('../src/routes/resources/romaneios.js', import.meta.url), 'utf8');
  const createRoute = source.slice(source.indexOf("router.post('/',"), source.indexOf("router.put('/:id'"));
  const updateRoute = source.slice(source.indexOf("router.put('/:id'"));
  assert.match(createRoute, /createPending:\s*false/);
  assert.match(updateRoute, /createPending:\s*false/);
});
