import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/projects/ProjectPlannedScopeEditor.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('scope.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
const names = ['duplicateService', 'changeSystem', 'removeSystem', 'changeWeight', 'removeService', 'normalize', 'rebalanceUntouched', 'roundToSum', 'toNum'];
// Run the actual editor actions against local draft state, without a database or React renderer.
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) declarations.set(node.name.text, node.getText(tree));
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(tree))) declarations.set(node.name.getText(tree), `const ${node.getText(tree)};`);
  ts.forEachChild(node, visit);
}
visit(tree);
for (const name of names) assert.ok(declarations.has(name), name);
const code = ts.transpileModule([...declarations.values()].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const system = (key, patch = {}) => ({
  key, projectSystemId: 'canonical-system', equipment: 'Unidade Geradora 01', systemName: 'Kaplan',
  systemType: 'TUBULACAO', description: 'Tubulação de alimentação', diameter: '2', diameterUnit: 'pol', quantity: '35,5', ...patch
});
function harness(initial, touched = initial.map(s => s.key)) {
  let state = initial;
  let collapsedServices = new Set(initial.map(s => s.key));
  let seq = 0;
  const touchedWeights = { current: new Set(touched) };
  const context = {
    get services() { return state; },
    setServices: update => { state = update(state); },
    setCollapsedServices: update => { collapsedServices = update(collapsedServices); },
    nextKey: () => `copy-${++seq}`, touchedWeights
  };
  const actions = runInNewContext(`${code}\n({${names.join(',')}});`, context);
  return { ...actions, get state() { return state; }, touchedWeights };
}

test('duplicates each service type immediately after its source with all current system values and fresh keys', () => {
  for (const [serviceType, systems] of [
    ['LIMPEZA_QUIMICA', [system('tube'), system('unit', { systemType: 'SISTEMA', diameter: '', quantity: '3' })]],
    ['TESTE_PRESSAO', [system('mm', { diameter: '50', diameterUnit: 'mm' })]],
    ['FLUSHING', [system('tube'), system('oil', { systemType: 'OLEO', diameter: '', quantity: '1200' })]],
    ['FILTRAGEM', [system('oil', { systemType: 'OLEO', diameter: '', quantity: '500,25', projectSystemId: null })]],
    ['LIMPEZA_QUIMICA', []]
  ]) {
    const original = { key: 'original', serviceType, weight: '60', systems };
    const other = { key: 'other', serviceType: 'FILTRAGEM', weight: '40', systems: [] };
    const before = plain(original);
    const editor = harness([other, original, { ...other, key: 'last' }]);
    editor.duplicateService('original');
    assert.deepEqual(Array.from(editor.state, s => s.key), ['other', 'original', 'copy-1', 'last']);
    const copy = editor.state[2];
    assert.equal(editor.state[1], original);
    assert.equal(editor.state[0], other);
    assert.deepEqual(original, before);
    assert.notEqual(copy, original);
    assert.notEqual(copy.systems, original.systems);
    assert.equal(copy.serviceType, serviceType);
    assert.equal(copy.weight, '60');
    copy.systems.forEach((row, i) => {
      assert.notEqual(row, systems[i]);
      assert.notEqual(row.key, systems[i].key);
      assert.deepEqual(plain({ ...row, key: systems[i].key }), systems[i]);
    });
    const keys = editor.state.flatMap(s => [s.key, ...s.systems.map(sys => sys.key)]);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(editor.touchedWeights.current.has(copy.key));
  }
});

test('copy edits and removals are independent and duplicating again uses the current edited values', () => {
  const original = { key: 'original', serviceType: 'LIMPEZA_QUIMICA', weight: '100', systems: [system('tube'), system('second')] };
  const before = plain(original);
  const editor = harness([original]);
  editor.duplicateService(original.key);
  const copy = editor.state[1];
  editor.changeSystem(copy.key, copy.systems[0].key, { equipment: 'Unidade Geradora 02', projectSystemId: null, quantity: '45' });
  editor.removeSystem(copy.key, copy.systems[1].key);
  editor.duplicateService(copy.key);
  const next = editor.state[2];
  assert.equal(next.systems.length, 1);
  assert.equal(next.systems[0].equipment, 'Unidade Geradora 02');
  assert.equal(next.systems[0].projectSystemId, null);
  assert.equal(next.systems[0].quantity, '45');
  assert.notEqual(next.systems[0].key, copy.systems[0].key);
  editor.removeService(copy.key);
  assert.equal(editor.state.length, 2);
  assert.equal(editor.state[1], next);
  assert.deepEqual(original, before);
  editor.changeSystem(original.key, 'tube', { quantity: '10' });
  assert.equal(editor.state[1].systems[0].quantity, '45');
});

test('preserves all weights on duplication and keeps the copied weight fixed during subsequent edits', () => {
  const editor = harness([
    { key: 'original', serviceType: 'LIMPEZA_QUIMICA', weight: '60', systems: [] },
    { key: 'auto', serviceType: 'FLUSHING', weight: '40', systems: [] }
  ], ['original']);
  editor.duplicateService('original');
  assert.deepEqual(Array.from(editor.state, s => s.weight), ['60', '60', '40']);
  editor.changeWeight('original', '20');
  assert.deepEqual(Array.from(editor.state, s => s.weight), ['20', '60', '20']);
  editor.changeWeight(editor.state[1].key, '30');
  assert.deepEqual(Array.from(editor.state, s => s.weight), ['20', '30', '50']);
});

test('duplicate marks the existing draft dirty and removing the copy restores the saved baseline', () => {
  const editor = harness([{ key: 'original', serviceType: 'LIMPEZA_QUIMICA', weight: '100', systems: [system('tube')] }]);
  const baseline = editor.normalize(editor.state, [], []);
  editor.duplicateService('original');
  assert.notEqual(editor.normalize(editor.state, [], []), baseline);
  editor.removeService(editor.state[1].key);
  assert.equal(editor.normalize(editor.state, [], []), baseline);
});

test('ignores a service that no longer exists without changing the draft or weights', () => {
  const initial = [{ key: 'original', serviceType: 'FLUSHING', weight: '100', systems: [] }];
  const editor = harness(initial);
  editor.duplicateService('missing');
  assert.equal(editor.state, initial);
  assert.deepEqual([...editor.touchedWeights.current], ['original']);
});
