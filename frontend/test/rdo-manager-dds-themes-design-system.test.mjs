import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => readFileSync(join(frontendRoot, path), 'utf8');

const expectedAppearance = (() => {
  const value = process.env.RDO_B8_EXPECT_APPEARANCE ?? 'design-system';
  if (value === 'legacy' || value === 'design-system') return value;
  throw new Error(`RDO_B8_EXPECT_APPEARANCE inválido: ${value}`);
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

test('B.8 preserves the dds-theme query, original order and mutation contracts', () => {
  const manager = source('src/components/reports/DdsThemeManager.tsx');
  const api = source('src/api/ddsThemes.ts');

  assert.match(
    manager,
    /queryKey:\s*\['dds-themes', 'all'\],[\s\S]{0,100}?queryFn: \(\) => listDdsThemes\(true\)/
  );
  assert.match(manager, /const themes = data \?\? \[\]/);
  assert.doesNotMatch(manager, /themes\.(?:sort|toSorted)\(/);
  assert.match(manager, /const visibleThemes = normalizedSearch/);
  assert.match(
    manager,
    /invalidateQueries\(\{ queryKey: \['dds-themes'\] \}\)/
  );

  assert.match(
    manager,
    /mutationFn: \(name: string\) => createDdsTheme\(name\)/
  );
  assert.match(manager, /const name = newName\.trim\(\)/);
  assert.match(manager, /if \(!name \|\| createMutation\.isPending\) return/);
  assert.match(manager, /createMutation\.mutate\(name\)/);
  assert.match(manager, /Tema adicionado\./);
  assert.match(manager, /Não foi possível adicionar \(nome já existe\?\)\./);

  assert.match(manager, /updateDdsTheme\(payload\.id, payload\.data\)/);
  assert.match(
    manager,
    /id: theme\.id,[\s\S]{0,80}?data: \{ name: editing\.name\.trim\(\) \}/
  );
  assert.match(
    manager,
    /id: theme\.id,[\s\S]{0,80}?data: \{ isActive: true \}/
  );
  assert.match(manager, /Tema atualizado\./);
  assert.match(manager, /Não foi possível atualizar o tema\./);

  assert.match(
    manager,
    /mutationFn: \(id: string\) => deactivateDdsTheme\(id\)/
  );
  assert.match(manager, /deactivateMutation\.mutate\(theme\.id\)/);
  assert.match(manager, /Tema desativado\./);
  assert.match(manager, /Não foi possível desativar o tema\./);

  // A API do RDO permanece intocada pela B.8.
  assert.match(
    api,
    /rdoApiPath\(`\/dds-themes\$\{all \? '\?all=true' : ''\}`\)/
  );
  assert.match(
    api,
    /apiClient\.post<DdsTheme>\(rdoApiPath\('\/dds-themes'\), \{ name \}\)/
  );
  assert.match(
    api,
    /apiClient\.patch<DdsTheme>\(rdoApiPath\(`\/dds-themes\/\$\{id\}`\), payload\)/
  );
  assert.match(
    api,
    /apiClient\.delete\(rdoApiPath\(`\/dds-themes\/\$\{id\}`\)\)/
  );
});

test('B.8 preserves pending, disabled, reset and legacy rendering contracts', () => {
  const manager = source('src/components/reports/DdsThemeManager.tsx');

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

  // O caminho legacy continua existindo byte a byte para o Coordenador.
  assert.match(manager, /className="page-card"/);
  assert.match(manager, /className="admin-stack"/);
  assert.match(manager, /className="mini-btn"/);
  assert.match(manager, /id="dds-theme-name"/);
  assert.match(manager, /Carregando temas…/);

  // A B.8 não introduz confirmação, filtro, paginação, autosave ou polling.
  assert.doesNotMatch(manager, /window\.confirm|ConfirmDialog|refetchInterval/);
  assert.doesNotMatch(manager, /useSearchParams|localStorage|sessionStorage/);
});

test('B.8 keeps legacy as default and opts in on migrated RDO management surfaces', () => {
  const manager = source('src/components/reports/DdsThemeManager.tsx');
  const gestor = source('src/pages/gestor/GestorPage.tsx');
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');

  assert.match(coordinator, /<DdsThemeManager appearance="design-system"\s*\/>/);

  if (expectedAppearance === 'legacy') {
    assert.match(manager, /export function DdsThemeManager\(\)/);
    assert.doesNotMatch(manager, /appearance\s*[?:=]/);
    assert.match(gestor, /<DdsThemeManager\s*\/>/);
    return;
  }

  assert.match(manager, /appearance\?: DdsThemeManagerAppearance/);
  assert.match(manager, /appearance = 'legacy'/);
  assert.match(manager, /appearance === 'design-system'/);
  assert.match(
    gestor,
    /<DdsThemeManager[\s\S]*?appearance="design-system"[\s\S]*?\/>/
  );

  // Gestor e Coordenador ativam explicitamente a apresentação migrada.
  const optIns = sourceFilesUnder('src').filter((path) =>
    /<DdsThemeManager\b[^>]*appearance=["'{]/s.test(readFileSync(path, 'utf8'))
  );
  assert.deepEqual(optIns, [
    join(frontendRoot, 'src/pages/coordinator/CoordinatorPage.tsx'),
    join(frontendRoot, 'src/pages/gestor/GestorPage.tsx')
  ]);

  // Nenhum outro consumidor de DdsThemeManager existe além de Gestor e
  // Coordenador.
  const consumers = sourceFilesUnder('src')
    .filter((path) => /<DdsThemeManager\b/s.test(readFileSync(path, 'utf8')))
    .sort();
  assert.deepEqual(consumers, [
    join(frontendRoot, 'src/pages/coordinator/CoordinatorPage.tsx'),
    join(frontendRoot, 'src/pages/gestor/GestorPage.tsx')
  ]);
});

test('B.8 keeps the shared dds-themes cache consumers untouched', () => {
  const reportDetail = source('src/pages/ReportDetailPage.tsx');
  const newReport = source('src/pages/collaborator/NewReportPage.tsx');
  const reviewAlert = source(
    'src/components/reports/DdsCustomThemeReviewAlert.tsx'
  );

  assert.match(
    reportDetail,
    /queryKey: \['dds-themes'\],\s*queryFn: \(\) => listDdsThemes\(\)/
  );
  assert.match(
    newReport,
    /queryKey: \['dds-themes'\],\s*queryFn: \(\) => listDdsThemes\(\)/
  );
  assert.match(
    reviewAlert,
    /invalidateQueries\(\{ queryKey: \['dds-themes'\] \}\)/
  );
});

test('B.8 DS branch uses existing responsive primitives and scoped tokens', () => {
  if (expectedAppearance === 'legacy') return;

  const manager = source('src/components/reports/DdsThemeManager.tsx');
  const css = source('src/components/reports/DdsThemeManager.ds.css');

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
  assert.match(manager, /data-dds-theme-create/);
  assert.match(manager, /data-dds-theme-rename=\{theme\.id\}/);
  assert.match(manager, /Novo nome para \$\{theme\.name\}/);
  assert.match(manager, /event\.key !== 'Escape'/);
  assert.match(manager, /<h2 id="rdo-dds-themes-title">Temas de DDS<\/h2>/);

  // O anel de foco pertence ao control shell; o outline do input é neutralizado
  // apenas dentro desta superfície (nunca em foundation.css).
  assert.match(
    css,
    /\.fv-ds\.rdo-dds-themes \.fv-input:focus-visible \{\s*outline: 0;/
  );

  // Todo o CSS da migração é escopado e tokenizado.
  assert.match(css, /\.rdo-dds-themes/);
  assert.match(css, /var\(--/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(/i);
  assert.doesNotMatch(css, /!important/);
  // Cada seletor declarado no arquivo precisa estar sob .rdo-dds-themes, para
  // que a migração não vaze para nenhuma outra superfície.
  const selectors = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((block) => block.slice(0, block.indexOf('{')))
    .flatMap((text) => text.split(','))
    .filter((text) => !text.trim().startsWith('@'))
    .map((selector) => selector.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  assert.ok(selectors.length > 0);
  for (const selector of selectors) {
    assert.match(
      selector,
      /\.rdo-dds-themes\b/,
      `seletor fora do escopo .rdo-dds-themes: ${selector}`
    );
  }
});

test('a escala dos botões de ação do RDO DS é compartilhada e escopada', () => {
  const shared = source('src/styles/rdo-ds-actions.css');

  // A escala vive em um único lugar e mantém o alvo de 44px.
  assert.match(shared, /--fv-button-padding: var\(--space-3\)/);

  // Ação principal: o alvo vem da própria caixa.
  assert.match(
    shared,
    /:not\(\.fv-button--sm\)[\s\S]{0,200}?min-block-size: calc\(var\(--space-10\) \+ var\(--space-1\)\)/
  );

  // Ação compacta: a caixa é menor, e o alvo de 44x44px é reposto pelo
  // pseudo-elemento — nunca por redução da área interativa.
  assert.match(shared, /\.fv-button--sm::after/);
  assert.match(
    shared,
    /min-width: calc\(var\(--space-10\) \+ var\(--space-1\)\)/
  );
  assert.match(
    shared,
    /min-height: calc\(var\(--space-10\) \+ var\(--space-1\)\)/
  );

  // O intervalo entre ações precisa superar a extensão do alvo (6px de cada
  // lado), senão dois alvos de 44px se sobrepõem ao quebrar em duas linhas.
  assert.match(shared, /gap: var\(--space-4\)/);
  assert.match(shared, /var\(--/);
  assert.doesNotMatch(shared, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(shared, /\brgba?\(/i);
  assert.doesNotMatch(shared, /!important/);

  // Nenhuma regra vale fora de `.rdo-ds-actions`, declarado explicitamente.
  // A divisão precisa ignorar vírgulas dentro de `:where(...)`.
  const splitSelectorList = (text) => {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const character of text) {
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      if (character === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
      current += character;
    }
    parts.push(current);
    return parts;
  };

  const selectors = shared
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((block) => block.slice(0, block.indexOf('{')))
    .flatMap(splitSelectorList)
    .filter((text) => !text.trim().startsWith('@'))
    .map((selector) => selector.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  assert.ok(selectors.length > 0);
  for (const selector of selectors) {
    assert.match(
      selector,
      /\.rdo-ds-actions\b/,
      `seletor fora do escopo .rdo-ds-actions: ${selector}`
    );
  }

  // Cada superfície RDO DS que usa esse padrão opta por ele explicitamente.
  const optIns = [
    ['src/components/projects/JobRoleManager.tsx', 'rdo-job-roles'],
    ['src/components/reports/DdsThemeManager.tsx', 'rdo-dds-themes'],
    ['src/components/stats/StatsDashboard.tsx', 'rdo-stats-allocation__section']
  ];
  for (const [path, marker] of optIns) {
    const code = source(path);
    assert.match(
      code,
      /styles\/rdo-ds-actions\.css/,
      `${path} não importa a escala`
    );
    assert.match(
      code,
      new RegExp(`${marker} rdo-ds-actions`),
      `${path} não declara rdo-ds-actions em ${marker}`
    );
  }

  // Cargos e Temas de DDS são inteiramente desse padrão: nenhum Button `lg`.
  for (const path of [
    'src/components/projects/JobRoleManager.tsx',
    'src/components/reports/DdsThemeManager.tsx'
  ]) {
    assert.doesNotMatch(
      source(path),
      /<Button\b[^>]*size="lg"/s,
      `${path} ainda tem Button size="lg" fora da escala compartilhada`
    );
  }

  // Hierarquia: a ação principal do formulário (Salvar) continua em `md`,
  // enquanto as ações curtas ficam em `sm`. Sem isto, a distinção some.
  for (const [path, launcher] of [
    ['src/components/projects/JobRoleManager.tsx', 'data-job-role-create'],
    ['src/components/reports/DdsThemeManager.tsx', 'data-dds-theme-create']
  ]) {
    const code = source(path);
    const primary = code.match(/<Button\b[\s\S]{0,180}?size="md"/g) ?? [];
    assert.equal(
      primary.length,
      2,
      `${path} deve manter exatamente os dois Salvar em md`
    );
    assert.match(
      code,
      new RegExp(`${launcher}\\s*\\n\\s*size="sm"`),
      `${path}: o lançador deve usar a escala compacta`
    );
    for (const compact of ['Renomear', 'Desativar', 'Reativar', 'Cancelar']) {
      assert.match(
        code,
        new RegExp(`size="sm"[\\s\\S]{0,320}?>\\s*${compact}`),
        `${path}: ${compact} deve usar a escala compacta`
      );
    }
  }

  // Na alocação mensal só a lista de destinatários entra na escala compacta.
  // As abas e o "Voltar" do modal são outra categoria visual e seguem em `lg`.
  const stats = source('src/components/stats/StatsDashboard.tsx');
  assert.match(
    stats,
    /<Button variant="secondary" size="md" onClick=\{onToggle\}>/
  );
  assert.match(
    stats,
    /<Button variant="danger" size="md" onClick=\{onRemove\}>/
  );
  assert.match(
    stats,
    /className="rdo-stats-allocation__tab"[\s\S]{0,200}?size="lg"/
  );

  // O primitivo Button compartilhado continua intacto: nenhuma variante nova.
  const button = source('src/components/ui/ds/Button.tsx');
  assert.match(button, /size = 'md'/);
  assert.doesNotMatch(button, /rdo-/);
});
