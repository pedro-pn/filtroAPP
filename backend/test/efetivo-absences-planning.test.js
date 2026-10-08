import assert from 'node:assert/strict';
import test from 'node:test';

import { createEfetivoAbsence } from '../src/lib/efetivo/service.js';

test('serviço legado compatível persiste os quatro tipos de indisponibilidade', async () => {
  for (const type of ['FERIAS', 'FOLGA', 'AFASTAMENTO', 'FADIGA_OFFSHORE']) {
    let saved;
    const database = { collaboratorAbsence: { findMany: async () => [], create: async input => { saved = input.data; return input.data; } } };
    await createEfetivoAbsence({ collaboratorId: 'c1', type, startDate: '2026-08-21', endDate: '2026-08-21' }, 'u1', { database, laborCost: {} });
    assert.equal(saved.type, type);
  }
});
