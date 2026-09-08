import assert from 'node:assert/strict';
import test from 'node:test';

import { applyScenario } from '../src/lib/efetivo/planning/scenarios.js';

test('retry de cenário aplicado retorna o mesmo oficial sem nova mutação', async () => {
  const scenario = { id: 's1', kind: 'SCENARIO', status: 'APPLIED', appliedPlanId: 'o2', revision: 2 };
  const official = { id: 'o2', revision: 9 };
  let updates = 0;
  const database = { $transaction: async callback => callback(database), efetivoPlan: { findUnique: async ({ where }) => where.id === 's1' ? scenario : official, update: async () => { updates += 1; } } };
  const result = await applyScenario('s1', {}, { database });
  assert.deepEqual(result, { scenarioId: 's1', officialPlanId: 'o2', revision: 9, idempotentRetry: true });
  assert.equal(updates, 0);
});

test('apply exige transação real', async () => {
  await assert.rejects(() => applyScenario('s1', {}, { database: {} }), /suporte transacional/i);
});
