import assert from 'node:assert/strict';
import test from 'node:test';

import { syncEquipmentCatalogRows } from '../src/lib/romaneio-catalog.js';

function mockTx() {
  const calls = { updateMany: [] };
  return {
    calls,
    romaneioCatalogItem: {
      // Sem linha existente por sourceId → as linhas de entrada seriam criadas.
      findMany: async () => [],
      createMany: async () => ({ count: 0 }),
      update: async a => a,
      updateMany: async args => { calls.updateMany.push(args); return { count: 1 }; }
    }
  };
}

test('syncEquipmentCatalogRows desativa EQUIPAMENTOS órfãos (fora da lista atual)', async () => {
  const tx = mockTx();
  await syncEquipmentCatalogRows(tx, [
    { sourceType: 'EQUIPAMENTOS', sourceId: 'eq-1', code: 'A1', name: 'A', categoryName: 'Cat' }
  ]);
  const deact = tx.calls.updateMany.find(c => c.data?.isActive === false);
  assert.ok(deact, 'deve desativar órfãos');
  assert.equal(deact.where.sourceType, 'EQUIPAMENTOS');
  assert.deepEqual(deact.where.sourceId, { notIn: ['eq-1'] });
});

test('sem equipamentos sincronizados, desativa TODAS as linhas EQUIPAMENTOS', async () => {
  const tx = mockTx();
  await syncEquipmentCatalogRows(tx, []);
  const deact = tx.calls.updateMany.find(c => c.data?.isActive === false);
  assert.ok(deact, 'deve desativar todas');
  assert.equal(deact.where.sourceType, 'EQUIPAMENTOS');
  assert.equal('sourceId' in deact.where, false); // sem filtro de sourceId → todas
});
