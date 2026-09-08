import assert from 'node:assert/strict';
import test from 'node:test';

import { createScenario } from '../src/lib/efetivo/planning/scenarios.js';
import { scenarioInputSchema } from '../src/lib/efetivo/planning/schemas.js';

function fakeDatabase() {
  const state = { hires: [], audits: [] };
  const tx = {
    $transaction: async callback => callback(tx),
    $queryRawUnsafe: async () => [],
    $executeRawUnsafe: async () => 0,
    workforceCalendarState: { findUnique: async () => ({ id: 'global', revision: 1 }) },
    efetivoPlan: {
      findFirst: async () => ({ id: 'oficial', kind: 'OFFICIAL', status: 'ACTIVE', revision: 4 }),
      findUnique: async () => ({ id: 'oficial', missions: [], plannedHires: [] }),
      create: async ({ data }) => ({ id: 'cenario-1', ...data }),
      update: async () => ({ id: 'cenario-1' })
    },
    jobRole: { findFirst: async ({ where }) => (where.id === 'r1' ? { id: 'r1', name: 'Operador' } : null) },
    efetivoPlannedHire: {
      createMany: async () => ({ count: 0 }),
      upsert: async ({ create }) => { state.hires.push(create); return { id: 'hire-1', ...create }; }
    },
    efetivoAuditEvent: { create: async ({ data }) => { state.audits.push(data.action); return data; } }
  };
  return { tx, state };
}

test('cenário aceita contratação hipotética já na criação', () => {
  const parsed = scenarioInputSchema.parse({
    name: 'Pico de outubro',
    objective: 'Reforço temporário',
    initialHire: { jobRoleId: 'r1', quantity: 2, availableFrom: '2026-09-01' }
  });
  assert.deepEqual(parsed.initialHire, { jobRoleId: 'r1', quantity: 2, availableFrom: '2026-09-01' });
  assert.equal(scenarioInputSchema.parse({ name: 'Sem contratação' }).initialHire, undefined);
  assert.equal(scenarioInputSchema.safeParse({ name: 'x', initialHire: { jobRoleId: 'r1', quantity: -1, availableFrom: '2026-09-01' } }).success, false);
});

test('criar cenário com contratação grava a contratação e a auditoria', async () => {
  const { tx, state } = fakeDatabase();
  const scenario = await createScenario(
    { name: 'Pico de outubro', objective: null, initialHire: { jobRoleId: 'r1', quantity: 3, availableFrom: '2026-09-01' } },
    { actorUserId: 'u1' },
    { database: tx }
  );
  assert.equal(scenario.id, 'cenario-1');
  assert.equal(state.hires.length, 1);
  assert.equal(state.hires[0].quantity, 3);
  assert.equal(state.hires[0].planId, 'cenario-1');
  assert.deepEqual(state.audits, ['SCENARIO_CREATE', 'SCENARIO_HIRE_UPDATE']);
});

test('quantidade zero cria o cenário sem contratação hipotética', async () => {
  const { tx, state } = fakeDatabase();
  await createScenario(
    { name: 'Somente base', initialHire: { jobRoleId: 'r1', quantity: 0, availableFrom: '2026-09-01' } },
    {},
    { database: tx }
  );
  assert.equal(state.hires.length, 0);
  assert.deepEqual(state.audits, ['SCENARIO_CREATE']);
});

test('função inexistente recusa a contratação informada na criação', async () => {
  const { tx } = fakeDatabase();
  await assert.rejects(
    () => createScenario({ name: 'Inválida', initialHire: { jobRoleId: 'nope', quantity: 1, availableFrom: '2026-09-01' } }, {}, { database: tx }),
    /Função operacional não encontrada/
  );
});
