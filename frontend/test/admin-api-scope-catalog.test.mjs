import assert from 'node:assert/strict';
import test from 'node:test';
import { API_SCOPES, futureScopeDefinitions } from '../../backend/src/lib/api-credentials/catalog.js';
import { toggleApiScope } from '../src/components/admin/api-tokens/apiScopeSelection.ts';

const scopes = [
  ...API_SCOPES.map(({ status, dependencies, ...scope }) => ({ ...scope, availability: status, requiredScopes: dependencies })),
  ...futureScopeDefinitions()
];
const records = 'qualidade.registros.read';
const natures = 'qualidade.naturezas.read';
const metadata = 'qualidade.evidencias.metadata.read';
const download = 'qualidade.evidencias.download';
const deleted = 'qualidade.excluidos.read';

test('selecting evidence downloads includes all dependencies without duplicates', () => {
  const original = [records, natures];
  const result = toggleApiScope(scopes, original, download);
  assert.deepEqual(new Set(result), new Set([records, natures, metadata, download]));
  assert.equal(result.length, 4);
  assert.deepEqual(original, [records, natures]);
});

test('removing records also removes dependent access, preserving independent permissions', () => {
  assert.deepEqual(toggleApiScope(scopes, [records, natures, metadata, download, deleted], records), [natures]);
});

test('removing metadata removes downloads but retains records and deleted-record access', () => {
  assert.deepEqual(toggleApiScope(scopes, [records, metadata, download, deleted], metadata), [records, deleted]);
});

test('removing a leaf permission does not remove its dependencies', () => {
  assert.deepEqual(toggleApiScope(scopes, [records, metadata, download], download), [records, metadata]);
});

test('future and unknown permissions cannot be selected', () => {
  for (const scope of futureScopeDefinitions()) {
    assert.deepEqual(toggleApiScope(scopes, [records], scope.code), [records]);
  }
  assert.deepEqual(toggleApiScope(scopes, [], 'unknown.read'), []);
});

test('dependencies are resolved transitively without changing the input selection on failure', () => {
  const nested = [
    { code: 'base', availability: 'AVAILABLE', requiredScopes: [] },
    { code: 'middle', availability: 'AVAILABLE', requiredScopes: ['base'] },
    { code: 'leaf', availability: 'AVAILABLE', requiredScopes: ['middle'] }
  ];
  assert.deepEqual(new Set(toggleApiScope(nested, [], 'leaf')), new Set(['base', 'middle', 'leaf']));
  const original = ['base'];
  assert.throws(() => toggleApiScope([...nested, { code: 'broken', availability: 'AVAILABLE', requiredScopes: ['missing'] }], original, 'broken'), /não está disponível/);
  assert.deepEqual(original, ['base']);
});
