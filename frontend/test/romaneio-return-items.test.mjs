import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadReturnItems() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/utils/romaneioReturnItems.ts');
  } finally {
    await server.close();
  }
}

function returnItem(overrides = {}) {
  return {
    key: 'catalog:pq-1',
    catalogItemId: 'pq-1',
    itemCode: 'PQ 001',
    itemName: 'Carbonato de sódio',
    categoryName: 'Produtos químicos',
    kind: 'EQUIPMENT',
    measureType: 'WEIGHT',
    quantity: 25,
    unitLabel: 'kg',
    isCustom: false,
    isExtra: false,
    returnMaxQuantity: 25,
    ...overrides
  };
}

test('romaneioReturnKey matches the backend key for catalog and snapshot items', async () => {
  const { romaneioReturnKey } = await loadReturnItems();

  assert.equal(romaneioReturnKey(returnItem()), 'catalog:pq-1');
  assert.equal(
    romaneioReturnKey(returnItem({ catalogItemId: null, itemCode: ' PQ 001 ', itemName: 'Carbonato de Sódio' })),
    'snapshot|pq 001|carbonato de sódio|produtos químicos|EQUIPMENT|WEIGHT|kg'
  );
});

test('mergeRomaneioReturnSelection keeps every outbound item even when a draft omits it', async () => {
  const { mergeRomaneioReturnSelection } = await loadReturnItems();

  const chemical = returnItem();
  const filter = returnItem({
    key: 'catalog:fl-1',
    catalogItemId: 'fl-1',
    itemCode: 'FL 010',
    itemName: 'Filtro 10"',
    categoryName: 'Filtros',
    measureType: 'UNIT',
    quantity: 4,
    unitLabel: 'un',
    returnMaxQuantity: 4
  });

  const draftSelection = [
    { ...filter, quantity: 2 },
    { key: 'extra-1', catalogItemId: 'x-1', itemCode: null, itemName: 'Item extra', categoryName: 'Outros', kind: 'EQUIPMENT', measureType: 'UNIT', quantity: 1, unitLabel: 'unidade', isCustom: false, isExtra: true }
  ];

  const merged = mergeRomaneioReturnSelection([chemical, filter], draftSelection);

  assert.deepEqual(merged.map(item => item.key), ['catalog:pq-1', 'catalog:fl-1', 'extra-1']);
  assert.equal(merged[0].quantity, 25, 'item ausente no rascunho volta com a quantidade disponível');
  assert.equal(merged[1].quantity, 2, 'quantidade digitada no rascunho é preservada');
  assert.equal(merged[2].isExtra, true, 'itens extras do rascunho são mantidos');
});

test('mergeRomaneioReturnSelection clamps stale draft quantities to the available balance', async () => {
  const { mergeRomaneioReturnSelection } = await loadReturnItems();

  const merged = mergeRomaneioReturnSelection(
    [returnItem({ quantity: 10, returnMaxQuantity: 10 })],
    [returnItem({ quantity: 25, returnMaxQuantity: 25 })]
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].quantity, 10);
  assert.equal(merged[0].returnMaxQuantity, 10);
});
