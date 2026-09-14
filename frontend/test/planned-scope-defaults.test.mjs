import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('adding a planned system always defaults to tubing where supported, without changing existing rows', async () => {
  const source = await readFile(new URL('../src/components/projects/ProjectPlannedScopeEditor.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('scope.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  // Execute the actual state updater and its configuration without mounting React or fetching a project.
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ['SERVICE_SYSTEMS', 'ALL_SYSTEMS', 'allowedSystems'].includes(node.name.getText(tree))) {
      declarations.set(node.name.getText(tree), `const ${node.getText(tree)};`);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'addSystem') declarations.set('addSystem', node.getText(tree));
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const name of ['SERVICE_SYSTEMS', 'ALL_SYSTEMS', 'allowedSystems', 'addSystem']) assert.ok(declarations.has(name), name);
  const code = ts.transpileModule([...declarations.values(), "addSystem('target');"].join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;

  for (const [serviceType, expected] of [
    ['LIMPEZA_QUIMICA', 'TUBULACAO'], ['TESTE_PRESSAO', 'TUBULACAO'],
    ['FLUSHING', 'TUBULACAO'], ['FILTRAGEM', 'OLEO']
  ]) {
    for (const existingTypes of [[], ['TUBULACAO'], ['SISTEMA'], ['OLEO'], ['TUBULACAO', 'SISTEMA']]) {
      const existing = existingTypes.map((systemType, index) => ({ key: `existing-${index}`, systemType, equipment: 'Unidade Geradora 01', quantity: '12' }));
      const other = { key: 'other', serviceType, systems: [] };
      let state = [{ key: 'target', serviceType, systems: existing }, other];
      const context = { setServices: update => { state = update(state); }, nextKey: () => 'new-row' };
      // Repeated additions must keep the same default, even after a unit-based system.
      for (let count = 0; count < 3; count++) {
        runInNewContext(code, { ...context });
        const added = state[0].systems.at(-1);
        assert.equal(added.systemType, expected, `${serviceType}: ${existingTypes.join(',')}`);
        assert.equal(added.quantity, '');
        assert.equal(added.projectSystemId, null);
        assert.equal(added.equipment, existing.length ? 'Unidade Geradora 01' : '');
        assert.equal(added.systemName, '');
        assert.equal(added.diameterUnit, 'pol');
        assert.equal(state[1], other);
        existing.forEach((row, index) => assert.equal(state[0].systems[index], row));
      }
    }
  }
});
