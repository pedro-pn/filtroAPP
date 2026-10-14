import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildWeeklyProgressComparison } from '../../shared/modules/mission-weekly-progress.js';

test('edição conserva medidas e jornadas por cenário, carrega metas antigas e salva repetição', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { scenarioToDraft, weeklyTargetDraftToInput } = await server.ssrLoadModule('/src/components/projects/weeklyTargetDraft.ts');
    const { WeeklyTargetEditor } = await server.ssrLoadModule('/src/components/projects/WeeklyTargetEditor.tsx');
    const definition = { metric: 'M', basis: 'PER_PRODUCTIVE_DAY', referenceDayHours: 8,
      scenarios: [{ name: 'Legado', condition: { kind: 'ALWAYS' }, goals: [{ serviceType: null, value: 42 }] }] };
    const legacy = scenarioToDraft(definition.scenarios[0], definition, 9.5);
    assert.equal(legacy.metric, 'M'); assert.equal(legacy.referenceDayHours, '8');
    const draft = { weekStartDate: '2026-09-28', repeatWeekly: true, expectedRevision: 0, scenarios: [
      { ...legacy, basis: 'WEEK_TOTAL', goals: [{ serviceType: null, value: '300' }] },
      { ...legacy, name: 'Sistemas', metric: 'UN', basis: 'WEEK_TOTAL', condition: { kind: 'SERVICE_SET', serviceTypes: ['LIMPEZA_QUIMICA'] }, goals: [{ serviceType: null, value: '3' }] },
      { ...legacy, name: 'Óleo', metric: 'L', referenceDayHours: '4', condition: { kind: 'SERVICE_SET', serviceTypes: ['FILTRAGEM'] }, goals: [{ serviceType: null, value: '1000' }] }
    ] };
    const html = renderToStaticMarkup(createElement(WeeklyTargetEditor, { id: 'weekly', draft, disabled: false, onChange() {} }));
    assert.equal((html.match(/Medida da meta/g) ?? []).length, 3);
    assert.match(html, /value="UN" selected=""/);
    assert.match(html, /value="L" selected=""/);
    const payload = weeklyTargetDraftToInput(draft);
    assert.equal(payload.definition.repeatWeekly, true);
    assert.deepEqual(payload.definition.scenarios.map(scenario => scenario.metric), ['M', 'UN', 'L']);
    assert.equal(payload.definition.scenarios[0].referenceDayHours, undefined);
    assert.equal(payload.definition.scenarios[2].referenceDayHours, 4);
    const rows = buildWeeklyProgressComparison({ today: '2026-10-06', targets: [{ ...payload, id: 't1', plannedPctPoints: null, revision: 1 }], serviceHistory: [{ date: '2026-10-05', serviceType: 'LIMPEZA_QUIMICA', quantities: { M: 999, UN: 3, L: 0 } }] });
    assert.equal(rows.find(row => row.weekStartDate === '2026-10-05').metric, 'UN');
    assert.equal(rows.find(row => row.weekStartDate === '2026-10-05').status, 'ON_TARGET');
    assert.throws(() => weeklyTargetDraftToInput({ ...draft, scenarios: [draft.scenarios[0], draft.scenarios[0]] }), /condição diferente/);
    assert.throws(() => weeklyTargetDraftToInput({ ...draft, scenarios: [{ ...draft.scenarios[1], goals: [{ serviceType: null, value: '1.5' }] }] }), /valores/);
  } finally { await server.close(); }
});
