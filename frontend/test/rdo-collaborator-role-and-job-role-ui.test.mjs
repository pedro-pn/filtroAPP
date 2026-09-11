import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('equipe do RDO mostra o cargo canônico abaixo do nome do colaborador', () => {
  const sharedFields = read('../src/components/reports/ReportCoreFields.tsx');
  const css = read('../src/styles/base.css');

  assert.match(
    sharedFields,
    /collaborator\?\.jobRole\?\.name \|\|[\s\S]*collaborator\?\.role/
  );
  assert.match(sharedFields, /className="colab-tag-copy"/);
  assert.match(
    sharedFields,
    /className="colab-tag-role">\{roleName\}<\/small>/
  );
  assert.match(css, /\.colab-tag-copy\s*\{[^}]*flex-direction:\s*column/s);
});

test('função operacional fica apenas nos formulários de criação e edição do cargo', () => {
  const manager = read('../src/components/projects/JobRoleManager.tsx');
  const api = read('../src/api/jobRoles.ts');

  assert.doesNotMatch(manager, />Renomear</);
  assert.match(manager, />\s*Editar\s*<\/button>/);
  assert.equal(
    (manager.match(/className="tog-row job-role-operational-field"/g) || [])
      .length,
    2
  );
  assert.equal((manager.match(/className="tog-sl"/g) || []).length, 2);
  assert.match(manager, /setNewIsOperational\(event\.target\.checked\)/);
  assert.match(
    manager,
    /setEditing\(\{ \.\.\.editing, isOperational: event\.target\.checked \}\)/
  );
  assert.match(
    api,
    /createJobRole\(payload: \{ name: string; isOperational\?: boolean \}\)/
  );
});

test('histórico de cargos edita registros existentes sem duplicar a inclusão de mudança', () => {
  const editor = read(
    '../src/pages/gestor/CollaboratorJobRoleHistoryEditor.tsx'
  );
  const manager = read('../src/pages/gestor/GestorPage.tsx');
  const css = read('../src/styles/base.css');

  assert.doesNotMatch(editor, /Adicionar mudança/);
  assert.doesNotMatch(
    manager,
    /onCreate=\{payload => collaboratorMutations\.createJobRoleHistory/
  );
  assert.match(editor, /history\.map\(entry/);
  assert.match(editor, /onClick=\{\(\) => startEdit\(entry\)\}>Editar/);
  assert.match(editor, /await onUpdate\(editing\.id, payload\)/);
  assert.match(
    css,
    /\.collaborator-role-history\s*\{[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/s
  );
  assert.match(
    css,
    /\.admin-inline-grid\.collaborator-role-history-form\s*\{[^}]*minmax\(0, 1fr\)/s
  );
  assert.match(
    css,
    /\.collaborator-role-history-form select,[\s\S]*?max-width:\s*100%/
  );
});
