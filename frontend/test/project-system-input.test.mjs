import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFile } from 'node:fs/promises';

test('equipment and system offer explicit dropdowns without discarding free text', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient();
  try {
    const { ProjectSystemInput } = await server.ssrLoadModule('/src/components/projects/ProjectSystemInput.tsx');
    const { SearchCombobox } = await server.ssrLoadModule('/src/components/ui/SearchCombobox.tsx');
    const { ReportWorkforceNotices } = await server.ssrLoadModule('/src/components/reports/ReportWorkforceNotices.tsx');
    const render = component => renderToStaticMarkup(createElement(QueryClientProvider, { client }, component));
    const data = { equipmentId: 'Equipamento livre do cliente', system: 'Nome legado sem cadastro' };
    for (const field of ['equipmentId', 'system']) {
      const html = render(createElement(ProjectSystemInput, { field, data, onChange: () => {} }));
      assert.match(html, /role="combobox"/);
      assert.match(html, /app-combobox-select/);
      assert.match(html, /type="text"/);
      assert.doesNotMatch(html, /⌄/); // uses the shared select arrow, not a font-dependent glyph
      assert.match(html, /aria-expanded="false"/);
      assert.match(html, /Mostrar sugestões de (equipamentos do cliente|sistemas)/);
      assert.ok(html.includes(`value="${data[field]}"`));
      assert.doesNotMatch(html, /<datalist/);
    }
    const strict = render(createElement(SearchCombobox, { label: 'Seleção restrita', value: 'missing', options: [], onChange: () => {} }));
    assert.match(strict, /value=""/); // existing select-only callers must not accept unknown values
    assert.doesNotMatch(strict, /app-combobox-select/); // the new visual is limited to client equipment/systems
    const notices = render(createElement(ReportWorkforceNotices, { planningContext: null, missionSuggestionCollaboratorIds: [],
      prefilledFromLastReport: false, canApplyMissionSuggestion: false, absenceConflictCount: 1, workforceJustification: '', invalid: false,
      onApplyMissionSuggestion: () => {}, onDismissMissionSuggestion: () => {}, onJustificationChange: () => {} }));
    assert.match(notices, /data-invalid-target="header:workforceJustification" style="margin-top:12px;margin-bottom:20px"/);
  } finally { client.clear(); await server.close(); }
});

test('suggestions contain only current scope equipment/systems and respect unsaved scope edits', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { projectSystemSuggestionOptions, projectSystemSelectionPatch } = await server.ssrLoadModule('/src/utils/projectSystemSelection.ts');
    const measurement = { serviceType: 'LIMPEZA_QUIMICA', systemType: 'TUBULACAO' };
    const orphan = { id: 'old', equipment: 'UG 01', name: 'Mancal Escora', measurements: [] };
    const active = { id: 'current', equipment: 'Unidade Geradora 01', name: 'Mancal Escora', measurements: [measurement, measurement] };
    const registry = [orphan, active,
      { id: 'removed-system', equipment: active.equipment, name: 'Sistema removido', measurements: [] },
      { id: 'other', equipment: 'Unidade Geradora 02', name: 'Regulador', measurements: [measurement] }];
    assert.deepEqual(projectSystemSuggestionOptions(registry, 'equipmentId', ''), ['Unidade Geradora 01', 'Unidade Geradora 02']);
    assert.deepEqual(projectSystemSuggestionOptions(registry, 'system', ' unidade geradora 01 '), ['Mancal Escora']);
    assert.deepEqual(projectSystemSuggestionOptions(registry, 'system', 'UG 01'), []);
    assert.deepEqual(projectSystemSuggestionOptions(registry, 'system', 'Unidade Geradora 02'), ['Regulador']);
    assert.deepEqual(projectSystemSuggestionOptions([orphan], 'equipmentId', ''), []);
    assert.deepEqual(projectSystemSuggestionOptions([{ ...active, measurements: undefined }], 'equipmentId', ''), []);
    // Merely hiding an orphan must not delete its identity or prevent an existing report from retaining it.
    assert.deepEqual(projectSystemSelectionPatch(registry, { equipmentId: orphan.equipment, system: orphan.name, __projectSystemId: orphan.id }, 'system', orphan.name),
      { system: orphan.name, __projectSystemId: orphan.id });
    const editing = [{ ...active, equipment: 'Unidade Geradora 14', name: 'Novo sistema', id: '' }];
    assert.deepEqual(projectSystemSuggestionOptions(registry, 'equipmentId', '', editing), ['Unidade Geradora 14']);
    assert.deepEqual(projectSystemSuggestionOptions(registry, 'system', active.equipment, editing), []);
    assert.deepEqual(projectSystemSuggestionOptions(registry, 'system', editing[0].equipment, editing), ['Novo sistema']);
    assert.deepEqual(projectSystemSuggestionOptions(registry, 'equipmentId', '', []), []);
    assert.equal(registry[0], orphan);
  } finally { await server.close(); }
});

test('report suggestion options have no custom green selected state', async () => {
  const css = await readFile(new URL('../src/styles/base.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.app-combobox-select[^{}]*\[aria-selected="true"\]\s*\{/);
  assert.match(css, /\.app-combobox-select \.app-combobox-list button\.active,[^{}]*\{\s*background:\s*var\(--bg\)/);
});
