import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Aviso não bloqueante da data do relatório (incidente 2026-11-19: anos 2062/2027).

async function loadModules(t) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  t.after(() => server.close());
  const helper = await server.ssrLoadModule('/src/utils/reportDateWarning.ts');
  const component = await server.ssrLoadModule('/src/components/reports/ReportDateWarning.tsx');
  return { ...helper, ...component };
}

// 19/11/2026 às 12:00 em São Paulo.
const NOW = new Date('2026-11-19T15:00:00Z');

test('classifies future day and other year against the business-timezone today', async t => {
  const { reportDateWarnings } = await loadModules(t);
  assert.deepEqual(reportDateWarnings('2026-11-19', NOW), []);
  assert.deepEqual(reportDateWarnings('2026-01-02', NOW), []);
  assert.deepEqual(reportDateWarnings('2026-11-20', NOW), ['FUTURE_DAY']);
  assert.deepEqual(reportDateWarnings('2025-12-31', NOW), ['OTHER_YEAR']);
  assert.deepEqual(reportDateWarnings('2062-06-29', NOW), ['FUTURE_DAY', 'OTHER_YEAR']);
  assert.deepEqual(reportDateWarnings('2027-02-08', NOW), ['FUTURE_DAY', 'OTHER_YEAR']);
});

test('uses São Paulo midnight, not UTC: 23:30 local is still the same day', async t => {
  const { reportDateWarnings } = await loadModules(t);
  const lateEvening = new Date('2026-11-20T02:30:00Z'); // 19/11 23:30 em São Paulo
  assert.deepEqual(reportDateWarnings('2026-11-19', lateEvening), []);
  assert.deepEqual(reportDateWarnings('2026-11-20', lateEvening), ['FUTURE_DAY']);
  const newYearEve = new Date('2027-01-01T02:00:00Z'); // 31/12/2026 23:00 em São Paulo
  assert.deepEqual(reportDateWarnings('2026-12-31', newYearEve), []);
});

test('ignores empty, malformed and partially typed years', async t => {
  const { reportDateWarnings } = await loadModules(t);
  for (const value of ['', null, undefined, '2026-11', '19/11/2026', '0002-06-29', '0206-06-29']) {
    assert.deepEqual(reportDateWarnings(value, NOW), [], String(value));
  }
});

test('messages are in Portuguese and name the dates involved', async t => {
  const { reportDateWarningMessage } = await loadModules(t);
  assert.equal(reportDateWarningMessage('2026-11-19', NOW), null);
  assert.equal(reportDateWarningMessage('2026-11-25', NOW),
    'Atenção: a data está no futuro (25/11/2026). Confira antes de enviar.');
  assert.equal(reportDateWarningMessage('2025-06-29', NOW),
    'Atenção: o ano informado (2025) não é o ano atual (2026). Confira antes de enviar.');
  assert.equal(reportDateWarningMessage('2062-06-29', NOW),
    'Atenção: a data está no futuro (29/06/2062) e o ano informado (2062) não é o ano atual (2026). Confira antes de enviar.');
});

test('component keeps a polite live region and only links the input when there is a warning', async t => {
  const { ReportDateWarning, reportDateDescribedBy, reportDateWarningId } = await loadModules(t);
  const empty = renderToStaticMarkup(createElement(ReportDateWarning, { inputId: 'rdo-date', value: '' }));
  assert.match(empty, /role="status"/);
  assert.match(empty, /aria-live="polite"/);
  assert.doesNotMatch(empty, /Atenção/);
  assert.equal(reportDateDescribedBy('rdo-date', ''), undefined);

  const warned = renderToStaticMarkup(createElement(ReportDateWarning, { inputId: 'rdo-date', value: '2062-06-29' }));
  assert.match(warned, /Atenção: a data está no futuro/);
  assert.match(warned, new RegExp(`id="${reportDateWarningId('rdo-date')}"`));
  assert.equal(reportDateDescribedBy('rdo-date', '2062-06-29'), 'rdo-date-date-warning');
});
