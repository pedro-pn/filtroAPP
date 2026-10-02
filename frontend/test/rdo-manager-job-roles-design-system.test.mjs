import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => readFileSync(join(frontendRoot, path), 'utf8');

const expectedAppearance = (() => {
  const value = process.env.RDO_B7_EXPECT_APPEARANCE ?? 'design-system';
  if (value === 'legacy' || value === 'design-system') return value;
  throw new Error(`RDO_B7_EXPECT_APPEARANCE inválido: ${value}`);
})();

function sourceFilesUnder(path) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(absolutePath);
    }
  }
  visit(join(frontendRoot, path));
  return files;
}

test('B.7 preserves the job-role query, original order and mutation contracts', () => {
  const manager = source('src/components/projects/JobRoleManager.tsx');
  const api = source('src/api/jobRoles.ts');

  assert.match(
    manager,
    /queryKey:\s*\['job-roles', 'all'\],[\s\S]{0,100}?queryFn: \(\) => listJobRoles\(true\)/
  );
  assert.match(manager, /const roles = data \?\? \[\]/);
  assert.doesNotMatch(manager, /roles\.(?:sort|toSorted)\(/);
  assert.match(manager, /const visibleRoles = normalizedSearch/);
  assert.match(manager, /invalidateQueries\(\{ queryKey: \['job-roles'\] \}\)/);

  assert.match(
    manager,
    /mutationFn: \(payload: \{ name: string; isOperational\?: boolean \}\)[\s\S]{0,40}?createJobRole\(payload\)/
  );
  assert.match(manager, /const name = newName\.trim\(\)/);
  assert.match(manager, /if \(!name \|\| createMutation\.isPending\) return/);
  assert.match(
    manager,
    /createMutation\.mutate\(\{[\s\S]{0,120}?name,[\s\S]{0,120}?isOperational: newIsOperational/
  );
  assert.match(manager, /Cargo adicionado\./);
  assert.match(manager, /Não foi possível adicionar \(nome já existe\?\)\./);

  assert.match(manager, /updateJobRole\(payload\.id, payload\.data\)/);
  assert.match(
    manager,
    /id: role\.id,[\s\S]{0,120}?name: editing\.name\.trim\(\)/
  );
  assert.match(manager, /id: role\.id,[\s\S]{0,80}?data: \{ isActive: true \}/);
  assert.match(manager, /Cargo atualizado\./);
  assert.match(manager, /Não foi possível atualizar o cargo\./);

  assert.match(
    manager,
    /mutationFn: \(id: string\) => deactivateJobRole\(id\)/
  );
  assert.match(manager, /deactivateMutation\.mutate\(role\.id\)/);
  assert.match(manager, /Cargo desativado\./);
  assert.match(manager, /Não foi possível desativar o cargo\./);

  assert.match(
    api,
    /rdoApiPath\(`\/job-roles\$\{all \? '\?all=true' : ''\}`\)/
  );
  assert.match(
    api,
    /apiClient\.post<JobRole>\(rdoApiPath\('\/job-roles'\), payload\)/
  );
  assert.match(
    api,
    /apiClient\.patch<JobRole>\(rdoApiPath\(`\/job-roles\/\$\{id\}`\), payload\)/
  );
  assert.match(
    api,
    /apiClient\.delete\(rdoApiPath\(`\/job-roles\/\$\{id\}`\)\)/
  );
});

test('B.7 preserves pending, disabled, reset and legacy rendering contracts', () => {
  const manager = source('src/components/projects/JobRoleManager.tsx');

  assert.match(
    manager,
    /disabled=\{createMutation\.isPending \|\| !newName\.trim\(\)\}/
  );
  assert.match(
    manager,
    /disabled=\{updateMutation\.isPending \|\| !editing\.name\.trim\(\)\}/
  );
  assert.match(manager, /disabled=\{deactivateMutation\.isPending\}/);
  assert.match(
    manager,
    /setShowCreateForm\(false\);[\s\S]{0,50}?setNewName\(''\)/
  );
  assert.match(manager, /setEditing\(null\)/);
  assert.match(manager, /className="page-card"/);
  assert.match(manager, /className="admin-stack"/);
  assert.match(manager, /className="mini-btn"/);
});

test('B.7 keeps legacy as default and opts in only the Gestor job-role surface', () => {
  const manager = source('src/components/projects/JobRoleManager.tsx');
  const gestor = source('src/pages/gestor/GestorPage.tsx');
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');

  // A superfície de Temas de DDS do Coordenador também segue o novo padrão.
  // As asserções sobre o opt-in em DdsThemeManager passaram a
  // pertencer ao contrato da B.8
  // (rdo-manager-dds-themes-design-system.test.mjs), que as verifica de forma
  // mais forte, varrendo `src` inteiro.
  assert.match(coordinator, /<DdsThemeManager appearance="design-system"\s*\/>/);

  if (expectedAppearance === 'legacy') {
    assert.match(manager, /export function JobRoleManager\(\)/);
    assert.doesNotMatch(manager, /appearance\s*[?:=]/);
    assert.match(gestor, /<JobRoleManager\s*\/>/);
    return;
  }

  assert.match(manager, /appearance\?: JobRoleManagerAppearance/);
  assert.match(manager, /appearance = 'legacy'/);
  assert.match(manager, /appearance === 'design-system'/);
  assert.match(
    gestor,
    /<JobRoleManager[\s\S]*?appearance="design-system"[\s\S]*?\/>/
  );

  const optIns = sourceFilesUnder('src').filter((path) =>
    /<JobRoleManager\b[^>]*appearance=["'{]/s.test(readFileSync(path, 'utf8'))
  );
  assert.deepEqual(optIns, [
    join(frontendRoot, 'src/pages/gestor/GestorPage.tsx')
  ]);
});

test('B.7 DS branch uses existing responsive primitives and scoped tokens', () => {
  if (expectedAppearance === 'legacy') return;

  const manager = source('src/components/projects/JobRoleManager.tsx');
  const css = source('src/components/projects/JobRoleManager.ds.css');

  for (const component of [
    'Button',
    'Card',
    'DataTable',
    'EmptyState',
    'Field',
    'Input',
    'Skeleton',
    'StatusPill'
  ]) {
    assert.match(manager, new RegExp(`<${component}\\b`));
  }
  assert.match(manager, /mobile=\{\{/);
  assert.match(manager, /renderItem:/);
  assert.match(manager, /createInputRef\.current\?\.focus\(\)/);
  assert.match(manager, /editingInputRef\.current\?\.focus\(\)/);
  assert.match(manager, /Novo nome para \$\{role\.name\}/);
  assert.match(manager, /event\.key !== 'Escape'/);

  assert.match(css, /\.rdo-job-roles/);
  assert.match(css, /var\(--/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(/i);
  assert.doesNotMatch(css, /!important/);

  // O anel de foco pertence ao control shell; o outline do input é
  // neutralizado apenas dentro desta superfície (nunca em foundation.css).
  assert.match(
    css,
    /\.fv-ds\.rdo-job-roles \.fv-input:focus-visible \{\s*outline: 0;/
  );
});
