import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
let model;
try { model = await server.ssrLoadModule('/src/utils/databook.ts'); } finally { await server.close(); }

test('databook formulário preserva datas operacionais sem conversão de fuso e permite ausência de RDO', () => {
  const defaults = { startDate: '2026-09-16', endDate: '2026-10-07' };
  assert.deepEqual(model.emptyDatabookInput(defaults), { title: '', ...defaults, summary: '', productsReviewed: false,
    reportIds: [], photos: [], products: [], documentVersionIds: [] });
  assert.equal(model.emptyDatabookInput({ startDate: null, endDate: null }).startDate, '');
});

test('databook curadoria de etapa retira fotos de relatório fora do recorte e conserva ordem/legendas', () => {
  const input = { ...model.emptyDatabookInput({ startDate: '2026-09-16', endDate: '2026-09-17' }), title: 'Etapa 1',
    reportIds: ['r1', 'r2'], photos: [{ key: 'p2', caption: 'Segunda' }, { key: 'p1', caption: 'Primeira' }, { key: 'p3', caption: 'Fora' }],
    products: [{ itemId: 'item1', documentId: 'doc1' }], documentVersionIds: ['v1', 'v2'] };
  const source = { reports: [{ id: 'r1' }], photos: [{ key: 'p1', reportId: 'r1' }, { key: 'p2', reportId: 'r1' }, { key: 'p3', reportId: 'r2' }],
    products: [{ id: 'item1' }], documents: [{ versionId: 'v1' }] };
  const selected = model.reconcileDatabookSelection(input, source);
  assert.deepEqual(selected.reportIds, ['r1']); assert.deepEqual(selected.photos, input.photos.slice(0, 2));
  assert.deepEqual(selected.documentVersionIds, ['v1']); assert.equal(selected.title, 'Etapa 1'); assert.equal(input.photos.length, 3);
});

test('databook novidade e guia são individuais e expiram exatamente em dez dias', () => {
  const storage = new Map(); globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  try {
    assert.equal(model.DATABOOK_NOVELTY_END - model.DATABOOK_NOVELTY_START, 10 * 86400000);
    assert.equal(model.shouldShowDatabookNovelty('u1', false, model.DATABOOK_NOVELTY_START - 1), false);
    assert.equal(model.shouldShowDatabookNovelty('u1', false, model.DATABOOK_NOVELTY_START), true);
    model.markDatabookNoveltySeen('u1'); assert.equal(model.shouldShowDatabookNovelty('u1', false, model.DATABOOK_NOVELTY_START), false);
    assert.equal(model.shouldShowDatabookNovelty('u1', true, model.DATABOOK_NOVELTY_START), true);
    assert.equal(model.shouldShowDatabookNovelty('u2', false, model.DATABOOK_NOVELTY_END - 1), true);
    assert.equal(model.shouldShowDatabookNovelty('u2', false, model.DATABOOK_NOVELTY_END), false);
  } finally { delete globalThis.localStorage; }
});

test('databook atalho permite leitores internos e bloqueia clientes/colaboradores', () => {
  const user = { accountType: 'INTERNAL', moduleRoles: ['acompanhamento:viewer'] };
  assert.equal(model.canOpenDatabook(user), true);
  assert.equal(model.canOpenDatabook({ ...user, accountType: 'CLIENT' }), false);
  assert.equal(model.canOpenDatabook({ ...user, moduleRoles: ['rdo:collaborator'] }), false);
  assert.equal(model.canOpenDatabook({ ...user, accountType: 'ADMIN', moduleRoles: [] }), true);
});
