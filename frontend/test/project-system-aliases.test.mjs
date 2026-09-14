import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import axios from 'axios';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const alias = { equipment: 'UG 01', system: 'RV', serviceType: 'LIMPEZA_QUIMICA' };
const target = { id: 's1', projectId: 'p', equipment: 'Unidade Geradora 01', name: 'Regulador de velocidade', revision: 1, aliases: [], measurements: [{ serviceType: 'LIMPEZA_QUIMICA', systemType: 'TUBULACAO' }] };
const measurement = { ...alias, systemType: 'TUBULACAO', unit: 'M', quantity: 40, diameter: '3', diameterUnit: 'pol' };
const updated = { ...target, revision: 2, aliases: [alias] };
const plain = value => JSON.parse(JSON.stringify(value));

test('confirmed names leave the name queue while incompatible measurements remain visible, including after reload', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  try {
    const { pendingMeasurementSystem, projectSystemAliasKey } = await server.ssrLoadModule('/src/utils/projectSystemAliases.ts');
    const { ProjectSystemAliases } = await server.ssrLoadModule('/src/components/projects/ProjectSystemAliases.tsx');
    const { ToastProvider } = await server.ssrLoadModule('/src/components/ui/Toast.tsx');
    assert.equal(pendingMeasurementSystem([target], measurement), null);
    assert.equal(pendingMeasurementSystem([updated], measurement).id, target.id);
    assert.equal(pendingMeasurementSystem([updated], { ...measurement, equipment: 'UG 02' }), null);
    assert.equal(pendingMeasurementSystem([updated], { ...measurement, serviceType: 'FILTRAGEM' }), null);
    assert.equal(pendingMeasurementSystem([updated, { ...updated, id: 'conflict' }], measurement), null);
    assert.equal(pendingMeasurementSystem([target], { ...measurement, equipment: target.equipment, system: target.name }).id, target.id);
    assert.equal(projectSystemAliasKey(alias), projectSystemAliasKey({ ...alias, equipment: ' ug 01 ', system: ' Rv ' }));
    const manualTarget = { ...target, id: 'manual', name: 'Outro sistema' };
    assert.equal(pendingMeasurementSystem([updated, manualTarget], { ...measurement, projectSystemId: 'manual' }).id, 'manual');
    // Removing an alias must not be undone by stale progress metadata while refresh is in flight.
    assert.equal(pendingMeasurementSystem([target], { ...measurement, matchedSystem: updated }), null);
    const render = () => renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(ProjectSystemAliases, { projectId: 'p' }))));
    client.setQueryData(['project-progress', 'p'], { pendingMeasurements: [measurement] });
    client.setQueryData(['project-systems', 'scope', 'p'], [target]);
    assert.match(render(), /Confirmar equivalência de nome/);
    client.setQueryData(['project-systems', 'scope', 'p'], [updated]);
    const html = render();
    assert.doesNotMatch(html, /Confirmar equivalência de nome/);
    assert.match(html, /Equivalências confirmadas/);
    assert.match(html, /Medições com nome identificado, mas sem meta compatível/);
    assert.match(html, /40 M \(diâmetro 3 pol\)/);
    assert.match(html, /role="status" aria-live="polite"/);
    client.setQueryData(['project-progress', 'p'], { pendingMeasurements: [] });
    assert.doesNotMatch(render(), /Confirmar equivalência de nome|Medições com nome identificado/);
  } finally { client.clear(); await server.close(); }
});

test('equivalence choices are restricted to the pending service in the current scope', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  try {
    const { projectSystemAliasTargets } = await server.ssrLoadModule('/src/utils/projectSystemAliases.ts');
    const { ProjectSystemAliases } = await server.ssrLoadModule('/src/components/projects/ProjectSystemAliases.tsx');
    const { ToastProvider } = await server.ssrLoadModule('/src/components/ui/Toast.tsx');
    const types = ['LIMPEZA_QUIMICA', 'TESTE_PRESSAO', 'FLUSHING', 'FILTRAGEM'];
    const registry = types.map((serviceType, index) => ({ ...target, id: `only-${index}`, name: `Sistema ${serviceType}`,
      measurements: [{ serviceType, systemType: serviceType === 'FILTRAGEM' ? 'OLEO' : 'TUBULACAO' }] }));
    const shared = { ...target, id: 'shared', name: 'Sistema compartilhado', measurements: [registry[0].measurements[0], registry[3].measurements[0]] };
    registry.push(shared, { ...target, id: 'old', measurements: [] }, { ...target, id: 'unknown', measurements: undefined });
    const render = () => renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(ProjectSystemAliases, { projectId: 'p' }))));
    client.setQueryData(['project-systems', 'scope', 'p'], registry);
    for (const [index, serviceType] of types.entries()) {
      const expected = [`only-${index}`, ...([0, 3].includes(index) ? ['shared'] : [])];
      assert.deepEqual(projectSystemAliasTargets(registry, serviceType).map(system => system.id), expected);
      client.setQueryData(['project-progress', 'p'], { pendingMeasurements: [{ ...measurement, serviceType }] });
      const select = render().match(/<select\b[^>]*>[\s\S]*?<\/select>/)[0];
      assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), expected);
    }
    client.setQueryData(['project-systems', 'scope', 'p'], [target]); // só limpeza, pendência de filtragem
    const html = render();
    assert.match(html, /Nenhum sistema cadastrado para Filtragem no escopo atual/);
    assert.match(html, /<select[^>]*disabled=""/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>Confirmar equivalência de nome/);
    assert.equal(projectSystemAliasTargets([], 'FILTRAGEM').length, 0);
  } finally { client.clear(); await server.close(); }
});

const source = await readFile(new URL('../src/components/projects/ProjectSystemAliases.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('aliases.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let saveSource;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'save') saveSource = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(saveSource);
const saveCode = ts.transpileModule(`${saveSource}\nsave;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness({ failure, refreshFailure, hold } = {}) {
  const key = JSON.stringify([alias.equipment, alias.system, alias.serviceType]);
  const state = { selected: { [key]: target.id, unrelated: 'keep' }, feedback: '', error: '', busy: null, open: false, calls: 0, cached: [target], toasts: [], invalidations: 0 };
  const save = runInNewContext(saveCode, {
    projectId: 'p', systemsKey: ['project-systems', 'scope', 'p'], axios,
    get busy() { return state.busy; }, projectSystemAliasKey: () => key,
    setError: v => { state.error = v; }, setFeedback: v => { state.feedback = v; }, setBusy: v => { state.busy = v; },
    setConfirmedOpen: v => { state.open = v; }, setSelected: fn => { state.selected = fn(state.selected); },
    showToast: (...args) => { state.toasts.push(args); },
    saveProjectSystemAlias: async (_project, _target, _alias, remove) => { state.calls++; if (hold) await hold; if (failure) throw failure; return remove ? { ...target, revision: 3 } : updated; },
    client: { cancelQueries: async () => {}, setQueryData: (_key, fn) => { state.cached = fn(state.cached); }, invalidateQueries: async () => { state.invalidations++; } },
    refresh: async () => { if (refreshFailure) throw new Error('offline'); }
  });
  return { state, save, key };
}

test('saving an alias confirms success, updates revision, clears only its selection and opens confirmed names', async () => {
  const { state, save, key } = harness();
  await save(target, alias);
  assert.equal(state.calls, 1);
  assert.deepEqual(plain(state.cached), [updated]);
  assert.equal(state.selected[key], undefined);
  assert.equal(state.selected.unrelated, 'keep');
  assert.match(state.feedback, /Equivalência confirmada: UG 01 · RV → Unidade Geradora 01 · Regulador de velocidade/);
  assert.equal(state.open, true);
  assert.equal(state.error, '');
  assert.equal(state.busy, null);
  assert.equal(state.toasts.length, 1);
});

test('a failed save preserves the pending choice and displays the server error; conflicts refresh revisions', async () => {
  for (const status of [400, 409]) {
    const { state, save, key } = harness({ failure: { isAxiosError: true, response: { status, data: { error: 'O cadastro mudou. Atualize a lista antes de salvar.' } } } });
    await save(target, alias);
    assert.match(state.error, /O cadastro mudou/);
    assert.equal(state.feedback, '');
    assert.equal(state.selected[key], target.id);
    assert.deepEqual(plain(state.cached), [target]);
    assert.equal(state.open, false);
    assert.equal(state.busy, null);
    assert.equal(state.toasts[0][1], 'error');
    assert.equal(state.invalidations, status === 409 ? 1 : 0);
  }
});

test('refresh failure does not report a confirmed save as failed or allow the same pending choice again', async () => {
  const { state, save, key } = harness({ refreshFailure: true });
  await save(target, alias);
  assert.match(state.feedback, /Equivalência confirmada/);
  assert.match(state.error, /foi salva.*atualizar/);
  assert.equal(state.selected[key], undefined);
  assert.equal(state.cached[0].revision, 2);
  assert.equal(state.busy, null);
});

test('in-flight confirmation cannot submit twice, and removal provides explicit feedback', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const { state, save } = harness({ hold });
  const pending = save(target, alias, true);
  assert.match(state.busy, /^remove:/);
  await save(target, alias, true);
  assert.equal(state.calls, 1);
  release();
  await pending;
  assert.match(state.feedback, /Equivalência removida/);
  assert.deepEqual(plain(state.cached[0].aliases), []);
  assert.equal(state.busy, null);
});
