import assert from 'node:assert/strict';
import test from 'node:test';

import { saveHoliday } from '../src/lib/efetivo/planning/administration.js';

test('salvar a mesma data restaura feriado excluído e audita na transação', async () => {
  let upsert;
  const plan = { id: 'p1', kind: 'OFFICIAL', status: 'ACTIVE', revision: 1 };
  const database = {
    $transaction: async callback => callback(database),
    efetivoPlan: { findFirst: async () => plan, findUnique: async () => plan, update: async () => ({ ...plan, revision: 2 }) },
    workforceHoliday: { findUnique: async () => ({ id: 'h1', deletedAt: new Date() }), upsert: async input => { upsert = input; return { id: 'h1', holidayDate: input.where.holidayDate, name: input.update.name, deletedAt: null }; } },
    workforceCalendarState: {
      upsert: async () => ({ id: 'global', revision: 1 }),
      update: async () => ({ id: 'global', revision: 2 })
    },
    efetivoAuditEvent: { create: async input => input.data }
  };
  const result = await saveHoliday({ holidayDate: '2026-12-25', name: 'Natal' }, { actorUserId: 'u1' }, { database });
  assert.equal(result.name, 'Natal');
  assert.equal(upsert.update.deletedAt, null);
});
