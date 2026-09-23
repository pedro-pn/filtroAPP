import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const componentUrl = new URL('../src/components/projects/ProjectDetailDashboard.tsx', import.meta.url);
const helperUrl = new URL('../src/components/projects/projectQualityDeviations.ts', import.meta.url);

async function loadQualityDeviationProjects() {
  const source = await readFile(helperUrl, 'utf8');
  const tree = ts.createSourceFile(helperUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let declaration = '';
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'qualityDeviationProjects') {
      declaration = node.getText(tree).replace(/^export\s+/, '');
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, 'qualityDeviationProjects');
  const code = ts.transpileModule(`${declaration}\nqualityDeviationProjects;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return runInNewContext(code);
}

test('desvios de projeto mesclado preservam cada missão em um grupo separado', async () => {
  const qualityDeviationProjects = await loadQualityDeviationProjects();
  const projects = qualityDeviationProjects({
    header: { code: '05776 + 05777', clientName: 'Cliente' },
    group: {
      members: [
        { projectId: 'p1', code: '05776', name: 'Escopo principal', clientName: 'Cliente', visible: true },
        { projectId: 'p2', code: '05777', name: 'Adicional', clientName: 'Cliente', visible: true },
        { projectId: 'p3', code: '05778', name: 'Oculto', clientName: 'Cliente', visible: false }
      ]
    }
  }, undefined, true);

  assert.deepEqual(JSON.parse(JSON.stringify(projects)), [
    { projectId: 'p1', code: '05776', name: 'Escopo principal', clientName: 'Cliente' },
    { projectId: 'p2', code: '05777', name: 'Adicional', clientName: 'Cliente' }
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(qualityDeviationProjects({
    header: { code: '05776', clientName: 'Cliente' }
  }, 'p1', false))), [
    { projectId: 'p1', code: '05776', name: '', clientName: 'Cliente' }
  ]);
});

test('painel consulta desvios por projeto e identifica visualmente cada missão mesclada', async () => {
  const [source, styles] = await Promise.all([
    readFile(componentUrl, 'utf8'),
    readFile(new URL('../src/styles/base.css', import.meta.url), 'utf8')
  ]);

  assert.match(source, /useQueries\(\{[\s\S]{0,500}?deviationProjects\.map/);
  assert.match(source, /listProjectQualityDeviations\(deviationProject\.projectId\)/);
  assert.match(source, /quality-deviation-project-head/);
  assert.match(source, /Missão \{deviationProject\.code \|\| 'sem código'\}/);
  assert.match(styles, /\.quality-deviation-projects\.is-grouped \.quality-deviation-project\s*\{/);
});
