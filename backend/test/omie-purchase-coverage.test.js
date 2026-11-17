import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPurchaseCoverage, resolvePurchaseGaps } from '../src/lib/omie/purchase-coverage.js';

const page = (ids, number = 1, pages = 2) => ({ page: number, pageCount: pages,
  count: ids.length * pages, rows: ids.map(codigo_lancamento_omie => ({ codigo_lancamento_omie })) });

test('ausência dentro de uma página é comprovada; lacuna entre páginas exige sobreposição', () => {
  const coverage = createPurchaseCoverage();
  coverage.observe(page([10, 20, 30]));
  coverage.observe(page([50, 60, 70], 2));
  assert.equal(coverage.isAbsent('15'), true);
  assert.equal(coverage.isAbsent('55'), true);
  assert.equal(coverage.isAbsent('40'), false, 'um custo omitido entre páginas deve ser preservado');
  assert.equal(coverage.isAbsent('20'), false, 'título efetivamente listado não é ausente');
  assert.equal(coverage.isAbsent('5'), true, 'antes do início confirmado');
  assert.equal(coverage.isAbsent('80'), true, 'depois do fim confirmado');
  coverage.observe(page([25, 45, 55]));
  assert.equal(coverage.isAbsent('40'), true, 'sobreposição comprovou ausência');
  assert.equal(coverage.isAbsent('45'), false, 'sobreposição recuperou título válido');
});

test('sem início/fim confirmado não infere ausências fora dos intervalos lidos', () => {
  const coverage = createPurchaseCoverage();
  coverage.observe(page([20, 30], 2, 3));
  assert.equal(coverage.isAbsent('10'), false);
  assert.equal(coverage.isAbsent('40'), false);
});

test('snapshot vazio confirmado pode limpar o legado', () => {
  const coverage = createPurchaseCoverage();
  assert.equal(coverage.isAbsent('1'), false);
  coverage.observe({ page: 1, pageCount: 0, count: 0, rows: [] });
  assert.equal(coverage.isAbsent('1'), true);
});

for (const ids of [[20, 10], [10, 10], [0, 10], [-1, 10], [1.5, 10], [undefined, 10]]) {
  test(`ordem/identificador inválido impede confirmar exclusões: ${String(ids)}`, () => {
    const coverage = createPurchaseCoverage();
    assert.throws(() => coverage.observe(page(ids)), /preservada/);
  });
}

test('limite compartilhado por páginas de 100 e 99 exige uma segunda sobreposição', async () => {
  const coverage = createPurchaseCoverage();
  const rows = Array.from({ length: 9901 }, (_, i) => ({ codigo_lancamento_omie: (i + 1) * 10 }));
  const info = (number, size) => ({ page: number, pageCount: Math.ceil(rows.length / size), count: rows.length,
    rows: rows.slice((number - 1) * size, number * size) });
  for (let number = 1; number <= Math.ceil(rows.length / 100); number++) coverage.observe(info(number, 100));
  assert.equal(coverage.isAbsent('99005'), false);
  const calls = [], summary = { overlapPagesRead: 0 }, current = new Map();
  const removals = await resolvePurchaseGaps({ existing: [{ id: 'old', omieId: '99005' }], current, coverage,
    total: rows.length, summary, loadPage: async (number, size) => { calls.push([number, size]); return info(number, size); },
    consume: data => coverage.observe(data)
  });
  assert.equal(removals.length, 1);
  assert.ok(calls.some(([, size]) => size === 98));
  assert.equal(new Set(calls.map(value => value.join(':'))).size, calls.length);
  assert.equal(coverage.isAbsent('99005'), true);
});
