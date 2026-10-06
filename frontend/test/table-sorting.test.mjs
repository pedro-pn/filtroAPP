import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('shared tables sort data accurately and preserve row identity', async (t) => {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    const { compareTableValues, tableSortText } = await server.ssrLoadModule(
      '/src/utils/tableSort.ts'
    );
    const { sortTableRows } = await server.ssrLoadModule(
      '/src/components/ui/ds/listings/sortRows.ts'
    );
    const { DataTable } = await server.ssrLoadModule(
      '/src/components/ui/ds/listings/DataTable.tsx'
    );

    await t.test(
      'dates cross month/year boundaries and missing dates remain last',
      () => {
        const dates = ['02/01/2026', '31/12/2025', '10/02/2025', '—'];
        assert.deepEqual(
          [...dates].sort((a, b) => compareTableValues(a, b, 'asc')),
          ['10/02/2025', '31/12/2025', '02/01/2026', '—']
        );
        assert.deepEqual(
          [...dates].sort((a, b) => compareTableValues(a, b, 'desc')),
          ['02/01/2026', '31/12/2025', '10/02/2025', '—']
        );
      }
    );
    await t.test(
      'localized numbers, currency, hours, percentages and natural names sort by value',
      () => {
        for (const values of [
          [0, 2, 10, 1000],
          ['0,00', '2,50', '10,75', '1.000,00'],
          ['R$ 0,00', 'R$ 2,50', 'R$ 10,75', 'R$ 1.000,00'],
          ['0h', '2,5h', '10h', '1.000h'],
          ['0%', '2,5%', '10%', '100%'],
          ['00:00', '02:30', '10:00', '100:00'],
          ['Missão 1', 'Missão 2', 'Missão 10', 'Missão 100']
        ]) {
          assert.deepEqual(
            [...values]
              .reverse()
              .sort((a, b) => compareTableValues(a, b, 'asc')),
            values
          );
          assert.deepEqual(
            [...values].sort((a, b) => compareTableValues(a, b, 'desc')),
            [...values].reverse()
          );
        }
        assert.equal(compareTableValues(null, 0, 'desc'), 1);
        assert.equal(compareTableValues(Number.NaN, 0, 'asc'), 1);
      }
    );
    await t.test(
      'explicit values handle composite cells, ties stay stable and the input is untouched',
      () => {
        const rows = [
          { id: 'b', amount: 10 },
          { id: 'a', amount: 2 },
          { id: 'c', amount: 2 },
          { id: 'empty', amount: null }
        ];
        const columns = [
          {
            key: 'cost',
            header: 'Custo',
            sortValue: (row) => row.amount,
            render: () => 'Valor com detalhes'
          }
        ];
        assert.deepEqual(
          sortTableRows(rows, columns, { key: 'cost', direction: 'asc' }).map(
            (row) => row.id
          ),
          ['a', 'c', 'b', 'empty']
        );
        assert.deepEqual(
          sortTableRows(rows, columns, { key: 'cost', direction: 'desc' }).map(
            (row) => row.id
          ),
          ['b', 'a', 'c', 'empty']
        );
        assert.deepEqual(
          rows.map((row) => row.id),
          ['b', 'a', 'c', 'empty']
        );
        assert.equal(
          sortTableRows(rows, [{ ...columns[0], sortable: false }], {
            key: 'cost',
            direction: 'asc'
          }),
          rows
        );
      }
    );
    await t.test(
      'plain accessors and visible cell labels work without explicit sort values',
      () => {
        const rows = [
          { id: '10', quantity: 10 },
          { id: '2', quantity: 2 }
        ];
        assert.equal(
          sortTableRows(rows, [{ key: 'quantity', header: 'Quantidade' }], {
            key: 'quantity',
            direction: 'asc'
          })[0],
          rows[1]
        );
        assert.equal(
          sortTableRows(
            rows,
            [
              {
                key: 'label',
                header: 'Item',
                render: (row) => createElement('strong', null, `Item ${row.id}`)
              }
            ],
            { key: 'label', direction: 'asc' }
          )[0],
          rows[1]
        );
        assert.equal(
          tableSortText(
            createElement(
              'span',
              null,
              createElement('span', { 'aria-hidden': true }, 'Decoração'),
              'Ana'
            )
          ),
          'Ana'
        );
      }
    );
    await t.test(
      'default table headers are enabled, row details follow their records, actions remain unsorted',
      () => {
        const rows = [
          { id: 'late', date: '2026-01-02' },
          { id: 'early', date: '2025-12-31' }
        ];
        const markup = renderToStaticMarkup(
          createElement(DataTable, {
            rows,
            columns: [{ key: 'date', header: 'Data' }],
            sort: { key: 'date', direction: 'asc' },
            getRowId: (row) => row.id,
            ariaLabel: 'Histórico',
            mobile: { renderItem: (row) => ({ title: row.id }) },
            renderRowDetails: (row) => `Detalhes de ${row.id}`,
            rowActions: (row) =>
              createElement('button', null, `Abrir ${row.id}`)
          })
        );
        assert.match(markup, /aria-sort="ascending"/);
        assert.match(markup, /aria-label="Data: ordenar em ordem decrescente"/);
        assert.doesNotMatch(markup, /class="fv-data-table__sort"[^>]*disabled/);
        assert.ok(
          markup.indexOf('data-row-id="early"') <
            markup.indexOf('data-details-for-row="early"')
        );
        assert.ok(
          markup.indexOf('data-details-for-row="early"') <
            markup.indexOf('data-row-id="late"')
        );
        assert.match(markup, /<th scope="col">Ações<\/th>/);
      }
    );
  } finally {
    await server.close();
  }
});
