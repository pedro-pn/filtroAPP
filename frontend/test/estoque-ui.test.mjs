import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const frontendRoot = new URL('..', import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, frontendRoot), 'utf8');
}

test('Resumo do estoque usa uma linha por produto e expande lotes e detalhes', async () => {
  const summary = await source('src/pages/estoque/StockSummaryTab.tsx');

  assert.match(summary, /className="equip-table stock-summary-table"/);
  assert.match(summary, /<th>Saldo total<\/th>/);
  assert.match(summary, /<th>Lote<\/th>/);
  assert.match(summary, /<th>Validade<\/th>/);
  assert.match(summary, /rows\.map/);
  assert.match(summary, /stock-summary-detail-row/);
  assert.match(summary, /aria-expanded=\{isExpanded\}/);
  assert.doesNotMatch(summary, /rows\.flatMap/);
  assert.doesNotMatch(summary, /<article className="card"/);
});

test('Devolução de obra permite várias linhas e envia uma requisição em lote', async () => {
  const [modal, api] = await Promise.all([
    source('src/pages/estoque/StockMovementFormModal.tsx'),
    source('src/api/estoque.ts')
  ]);

  assert.match(modal, /Adicionar produto/);
  assert.match(modal, /Produtos e lotes/);
  assert.match(modal, /Validade/);
  assert.match(modal, /returnLines\.map/);
  assert.match(modal, /createStockReturnMovements/);
  assert.match(api, /interface StockReturnMovementsPayload/);
  assert.match(api, /items: Array<\{/);
  assert.match(api, /batchId: string/);
});

test('Movimentações permite ordenar datas nos dois sentidos', async () => {
  const [movements, api] = await Promise.all([
    source('src/pages/estoque/StockMovementsTab.tsx'),
    source('src/api/estoque.ts')
  ]);

  assert.match(movements, /Mais recentes primeiro/);
  assert.match(movements, /Mais antigas primeiro/);
  assert.match(movements, /dateOrder/);
  assert.match(api, /dateOrder\?: 'asc' \| 'desc'/);
});
