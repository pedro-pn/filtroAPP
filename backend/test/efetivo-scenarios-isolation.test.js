import assert from 'node:assert/strict';
import test from 'node:test';

import { createScenario } from '../src/lib/efetivo/planning/scenarios.js';

test('criação materializa cenário sem alterar o oficial', async () => {
  const official = { id: 'official', revision: 7, missions: [], plannedHires: [] };
  const updates = [];
  const database = {
    $transaction: async callback => callback(database),
    efetivoPlan: {
      findFirst: async () => official,
      findUnique: async ({ where }) => where.id === 'official' ? official : null,
      create: async ({ data }) => ({ id: 'scenario', ...data }),
      update: async input => { updates.push(input); return input.data; }
    },
    workforceCalendarState: { findUnique: async () => ({ id: 'global', revision: 1 }) },
    efetivoAuditEvent: { create: async input => input.data }
  };
  const scenario = await createScenario({ name: 'Alternativa A' }, { actorUserId: 'u1' }, { database });
  assert.equal(scenario.kind, 'SCENARIO');
  assert.equal(scenario.baseOfficialRevision, 7);
  assert.equal(updates.length, 0);
});
