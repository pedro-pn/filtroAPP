import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { withRdoCompanions } from './rdo-source.mjs';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => withRdoCompanions(path, candidate => readFileSync(join(frontendRoot, candidate), 'utf8'));

const expectedAppearance = (() => {
  const value = process.env.RDO_B9_EXPECT_APPEARANCE ?? 'design-system';
  if (value === 'legacy' || value === 'design-system') return value;
  throw new Error(`RDO_B9_EXPECT_APPEARANCE inválido: ${value}`);
})();

function npsTabSource() {
  const gestor = source('src/pages/gestor/GestorPage.tsx');
  const start = gestor.indexOf('function renderNpsTab()');
  assert.ok(start > 0, 'renderNpsTab não encontrado');
  const end = gestor.indexOf('function renderGestorSearch()', start);
  assert.ok(end > start, 'fim de renderNpsTab não encontrado');
  return gestor.slice(start, end);
}

test('B.9 preserva a derivação de dados da aba NPS', () => {
  const tab = npsTabSource();

  // Origem dos dados: bootstrap do Gestor, sem GET dedicado.
  const gestor = source('src/pages/gestor/GestorPage.tsx');
  assert.match(
    gestor,
    /const surveysQuery = \{ data: gestorBootstrapQuery\.data\?\.surveys, isLoading: gestorBootstrapQuery\.isLoading \};/
  );
  assert.doesNotMatch(tab, /useQuery|queryKey|useSurveys\(/);

  // Filtro pela busca do Gestor, com os mesmos campos.
  assert.match(tab, /matchesSearch\(parts, gestorSearch\)/);
  for (const field of [
    'survey\\.project\\?\\.code',
    'survey\\.project\\?\\.name',
    'survey\\.project\\?\\.clientName',
    'survey\\.emailTo'
  ]) {
    assert.match(tab, new RegExp(field));
  }
  assert.match(tab, /surveyStatusLabel\(survey\)\.label\.toLowerCase\(\)/);

  // Agrupamento e título.
  assert.match(tab, /npsProjectKey\(survey\)/);
  assert.match(tab, /npsProjectTitle\(survey\)/);

  // Ordenação dos grupos e das pesquisas.
  assert.match(tab, /npsSortDir === 'asc'/);
  assert.match(
    tab,
    /localeCompare\(titleB, 'pt-BR', \{ numeric: true, sensitivity: 'base' \}\)/
  );
  assert.match(
    tab,
    /new Date\(b\.sentAt\)\.getTime\(\) - new Date\(a\.sentAt\)\.getTime\(\)/
  );

  // Numeração decrescente e acordeão de um único item.
  assert.match(tab, /Pesquisa #\$\{group\.surveys\.length - index\}/);
  assert.match(
    tab,
    /setOpenSurveyId\(\(current\) => \(current === survey\.id \? null : survey\.id\)\)/
  );
  assert.match(tab, /const open = openSurveyId === survey\.id/);

  // Condição de reenvio e handler/pending preservados.
  assert.match(
    tab,
    /const canResendSurvey = !survey\.respondedAt && survey\.project\?\.isActive === false/
  );
  assert.match(tab, /handleResendSurvey\(survey\)/);
  assert.match(tab, /surveyMutations\.resendSurvey\.isPending/);

  // Condição de loading inalterada.
  assert.match(tab, /surveysQuery\.isLoading/);

  // Textos preservados literalmente.
  assert.match(tab, /Pesquisas pendentes, respondidas e expiradas\./);
  assert.match(tab, /Pesquisa expirada sem resposta do cliente\./);
  assert.match(tab, /Pesquisa enviada, aguardando resposta do cliente\./);
  assert.match(tab, /Nenhuma pesquisa encontrada\./);
  assert.match(tab, /Nenhuma pesquisa NPS disponível\./);
  assert.match(tab, /Carregando pesquisas\.\.\./);
  assert.match(tab, /Reenviar pesquisa/);
  assert.match(tab, /Editar pesquisa/);
  assert.match(tab, /Dashboard NPS/);
});

test('B.9 não introduz persistência, URL, paginação nem confirmação', () => {
  const tab = npsTabSource();

  assert.doesNotMatch(tab, /localStorage|sessionStorage/);
  assert.doesNotMatch(tab, /useSearchParams|setSearchParams|navigate\(/);
  assert.doesNotMatch(tab, /window\.confirm|ConfirmDialog/);
  assert.doesNotMatch(tab, /refetchInterval|setInterval/);
  assert.doesNotMatch(tab, /Pagination|pageSize|onSelectionChange/);

  // O handler de reenvio continua sendo o único ponto de mutation da aba.
  const mutations = tab.match(/\.mutate\(|mutateAsync\(/g) ?? [];
  assert.deepEqual(mutations, []);
});

test('B.9 usa os primitives DS existentes na aba do Gestor', () => {
  const tab = npsTabSource();

  if (expectedAppearance === 'legacy') {
    assert.match(tab, /className="nps-tab-content"/);
    assert.doesNotMatch(tab, /rdo-nps/);
    return;
  }

  assert.match(tab, /className="fv-ds rdo-nps rdo-ds-actions"/);
  assert.match(tab, /aria-label="NPS"/);
  // A área de toque das ações compactas vem da escala compartilhada já
  // existente (a9b49969), não de uma nova regra local.
  assert.match(
    source('src/pages/gestor/GestorPage.tsx'),
    /styles\/rdo-ds-actions\.css/
  );
  assert.match(tab, /<PageHeader\b/);
  assert.match(tab, /title="NPS"/);
  assert.match(tab, /<h3 className="rdo-nps__group-title">/);

  for (const component of [
    'PageHeader',
    'FilterBar',
    'SearchInput',
    'MetricCard',
    'Card',
    'Button',
    'StatusPill',
    'Skeleton',
    'EmptyState'
  ]) {
    assert.match(tab, new RegExp(`<${component}\\b`));
  }

  // As classes legadas da aba deixaram de ser usadas aqui.
  for (const legacy of [
    'nps-tab-content',
    'nps-tab-toolbar',
    'admin-card',
    'admin-stack',
    'mini-btn',
    'section-title',
    'client-account-group-toggle',
    'status-pill'
  ]) {
    assert.doesNotMatch(tab, new RegExp(`"[^"]*\\b${legacy}\\b`));
  }
});

test('B.9 corrige a acessibilidade do acordeão de pesquisas', () => {
  if (expectedAppearance === 'legacy') return;
  const tab = npsTabSource();

  // aria-expanded reflete o estado real de openSurveyId.
  assert.match(tab, /aria-expanded=\{open\}/);
  // aria-controls aponta para um id único e estável por pesquisa.
  assert.match(tab, /const panelId = `rdo-nps-panel-\$\{survey\.id\}`/);
  assert.match(tab, /aria-controls=\{panelId\}/);
  assert.match(tab, /id=\{panelId\}/);
  assert.match(tab, /hidden=\{!open\}/);
  // Nome acessível distinguível por pesquisa.
  assert.match(tab, /aria-label=\{`\$\{surveyLabel\} — \$\{group\.title\}`\}/);
});

test('B.9 usa variantes DS coerentes nas ações da página', () => {
  if (expectedAppearance === 'legacy') return;
  const tab = npsTabSource();

  assert.match(
    tab,
    /variant="secondary"[\s\S]{0,300}?aria-label="Editar pesquisa NPS"/
  );
  assert.match(
    tab,
    /variant="primary"[\s\S]{0,300}?aria-label="Abrir dashboard NPS"/
  );
  assert.match(tab, /size="sm"[\s\S]{0,420}?>\s*Reenviar pesquisa/);
  assert.match(tab, /icon=\{DS_ICONS\.sort\}/);
  assert.doesNotMatch(tab, /<ProjectSortButton\b/);
});

test('editor da pesquisa NPS usa modal e superfícies compatíveis com dark mode', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const css = source('src/pages/gestor/GestorPage.ds.css');

  assert.match(
    page,
    /<Modal[\s\S]{0,220}?open=\{showSurveyQuestionEditor\}[\s\S]{0,220}?appearance="design-system"/
  );
  assert.match(page, /panelClassName="rdo-manager-survey-editor-dialog"/);
  assert.doesNotMatch(page, /panelClassName="modal-card survey-question-editor-modal"/);
  assert.match(
    css,
    /\.rdo-manager-survey-editor-dialog[\s\S]*?\.survey-question-card \{[\s\S]*?background: var\(--surface\)[\s\S]*?color: var\(--ink\)/
  );
  assert.match(
    css,
    /\.rdo-manager-survey-editor-dialog[\s\S]*?\.survey-question-editor-list \{[\s\S]*?background: var\(--surface-2\)/
  );
});

test('B.9 mantém o CSS escopado e tokenizado', () => {
  if (expectedAppearance === 'legacy') return;
  const css = source('src/pages/gestor/GestorPage.ds.css');
  const start = css.indexOf('RDO B.9');
  const nextBlock = css.indexOf('RDO B.10', start);
  const end = css.lastIndexOf('/*', nextBlock);
  assert.ok(start > 0, 'bloco da B.9 não encontrado no CSS');
  assert.ok(end > start, 'fim do bloco da B.9 não encontrado no CSS');
  const block = css.slice(start, end);

  assert.match(block, /:where\(\.fv-ds, \[data-fv-ds\]\)\.rdo-nps/);
  assert.match(block, /var\(--/);
  assert.doesNotMatch(block, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(block, /\brgba?\(/i);
  assert.doesNotMatch(block, /!important/);

  // A área de toque do toggle é preservada mesmo com caixa compacta.
  assert.match(
    block,
    /min-height: calc\(var\(--space-10\) \+ var\(--space-1\)\)/
  );

  // Nenhum seletor escapa de `.rdo-nps` (divisão ciente de parênteses).
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

  const selectors = block
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((chunk) => chunk.slice(0, chunk.indexOf('{')))
    .flatMap(splitSelectorList)
    .filter((text) => !text.trim().startsWith('@'))
    .map((selector) => selector.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  assert.ok(selectors.length > 0);
  for (const selector of selectors) {
    assert.match(
      selector,
      /\.rdo-nps\b/,
      `seletor fora do escopo .rdo-nps: ${selector}`
    );
  }
});

test('respostas longas do NPS preservam espaço para a pergunta no tablet e desktop', () => {
  const css = source('src/pages/gestor/GestorPage.ds.css');
  const responseRules = [...css.matchAll(/\.rdo-nps \.rdo-nps__response \{([^}]+)\}/g)]
    .map((match) => match[1]);
  const columns = responseRules.filter((rule) => /grid-template-columns:/.test(rule));

  assert.equal(columns.length, 2, 'validar as duas regras responsivas das respostas');
  for (const rule of columns) {
    assert.match(rule, /grid-template-columns: minmax\(0, 1fr\) fit-content\(60%\);/);
    assert.doesNotMatch(rule, /minmax\(0, auto\)/);
  }
  // Textos sem espaços continuam quebrando dentro da coluna, sem truncamento.
  for (const element of ['dt', 'dd']) {
    assert.match(css, new RegExp(`\\.rdo-nps__response ${element} \\{[^}]*overflow-wrap: anywhere;`));
  }
});

test('a ordenação do NPS usa Button DS sem alterar o ProjectSortButton compartilhado', () => {
  const css = source('src/pages/gestor/GestorPage.ds.css');
  const tab = npsTabSource();
  const component = source('src/utils/ProjectSortButton.tsx');
  const base = source('src/styles/base.css');

  // 1. O componente compartilhado permanece exatamente como estava: um único
  //    botão, sem props novas, sem estrutura interna nova.
  assert.match(
    component,
    /<button className="secondary-button project-sort-button" type="button" title="Alternar ordem" onClick=\{onToggle\}>/
  );
  assert.match(
    component,
    /direction: ProjectSortDirection;\s*onToggle: \(\) => void;/
  );
  assert.match(component, /direction === 'asc' \? 'A→Z' : 'Z→A'/);
  assert.doesNotMatch(component, /rdo-nps|fv-ds|fv-button|appearance/);

  // 2. base.css não ganhou nenhuma regra ligada à superfície NPS.
  assert.doesNotMatch(base, /rdo-nps/);

  assert.doesNotMatch(tab, /<ProjectSortButton\b/);
  assert.match(tab, /icon=\{DS_ICONS\.sort\}/);

  // Nenhuma regra do sort button compartilhado vale globalmente.
  const rules = [...css.matchAll(/([^{}]*\.project-sort-button[^{}]*)\{/g)].map(
    (match) => match[1].replace(/\s+/g, ' ').trim()
  );
  assert.ok(
    rules.length > 0,
    'nenhuma regra de .project-sort-button encontrada'
  );
  for (const rule of rules) {
    assert.match(
      rule,
      /\.rdo-[a-z-]+\b/,
      `regra global para .project-sort-button: ${rule}`
    );
  }
  assert.ok(
    rules.some((rule) => /\.rdo-manager-listing__toolbar\b/.test(rule)),
    'a regra da B.1 para o sort button foi removida'
  );

  // 5. Nenhum seletor global (fora de .rdo-nps) para o componente.
  assert.doesNotMatch(css, /(^|\})\s*\.project-sort-button\s*\{/);

  assert.doesNotMatch(css, /\.rdo-nps \.project-sort-button/);
});

test('B.9 preserva o fluxo do Coordenador e migra seu dashboard compartilhado por opt-in', () => {
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');
  const gestor = source('src/pages/gestor/GestorPage.tsx');

  // O Coordenador mantém a implementação e as regras próprias da aba.
  assert.match(coordinator, /function renderNpsTab\(\)/);
  assert.match(coordinator, /className="nps-tab-content"/);
  assert.doesNotMatch(coordinator, /rdo-nps/);
  assert.match(coordinator, /<RdoAppShell\b/);
  assert.doesNotMatch(coordinator, /gestorSurveyHelpers/);

  // O dashboard compartilhado continua centralizado no componente próprio.
  const files = [];
  (function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (/\.tsx?$/.test(entry.name)) files.push(absolutePath);
    }
  })(join(frontendRoot, 'src'));

  const owners = files
    .filter((path) => /rdo-nps/.test(readFileSync(path, 'utf8')))
    .sort();
  assert.deepEqual(owners, [
    join(frontendRoot, 'src/components/surveys/SurveyDashboard.tsx'),
    join(frontendRoot, 'src/pages/gestor/GestorPage.tsx')
  ]);

  // Os helpers de status continuam independentes da migração visual.
  const helpers = source('src/pages/gestor/gestorSurveyHelpers.ts');
  assert.match(helpers, /className: 'status-approved'/);
  assert.match(helpers, /className: 'status-returned'/);
  assert.match(helpers, /className: 'status-pending'/);

  const surveyDashboard = source('src/components/surveys/SurveyDashboard.tsx');
  assert.match(surveyDashboard, /appearance = 'legacy'/);
  assert.match(surveyDashboard, /appearance === 'design-system'/);
  assert.match(surveyDashboard, /panelClassName="rdo-nps-dashboard-modal"/);
  assert.match(
    gestor,
    /<SurveyDashboardOverlay[\s\S]{0,180}?appearance="design-system"/
  );
  assert.match(
    coordinator,
    /<SurveyDashboardOverlay[\s\S]{0,180}?appearance="design-system"/
  );

  const sortButton = source('src/utils/ProjectSortButton.tsx');
  assert.doesNotMatch(sortButton, /fv-button|rdo-nps/);
});

test('dashboard NPS detalhado organiza filtros, leitura executiva e ação de recuperação', () => {
  const dashboard = source('src/components/surveys/SurveyDashboard.tsx');

  // Mantém as derivações e os fluxos existentes; a mudança é de apresentação.
  for (const contract of [
    'aggregateMonths',
    'getFilteredMonths',
    'getPreviousMonths',
    'useSurveyDashboard',
    'useSurveyMutations',
    'downloadCsv'
  ]) {
    assert.match(dashboard, new RegExp(`\\b${contract}\\b`));
  }

  // Filtros compactos substituem a grade de 16 botões apenas no opt-in DS.
  assert.match(dashboard, /className="rdo-nps-dashboard__filter-grid"/);
  assert.match(dashboard, /<Field label="Ano"/);
  assert.match(dashboard, /<Field label="Período"/);
  assert.match(dashboard, /<optgroup label="Trimestres">/);
  assert.match(dashboard, /<optgroup label="Meses">/);
  assert.match(dashboard, /className="survey-dash-period-grid"/);

  // A primeira leitura reúne o índice, qualidade da coleta e distribuição.
  assert.match(dashboard, /<h2>Visão executiva<\/h2>/);
  assert.equal((dashboard.match(/<MetricCard\b/g) ?? []).length, 4);
  assert.match(dashboard, /className="rdo-nps-dashboard__segments"/);
  assert.match(dashboard, /Promotores/);
  assert.match(dashboard, /Neutros/);
  assert.match(dashboard, /Detratores/);

  // Análise e ação permanecem na mesma tela com títulos semânticos.
  for (const title of [
    'Distribuição das notas NPS',
    'Evolução NPS por período',
    'Médias por pergunta',
    'NPS por responsável',
    'Drivers de satisfação',
    'Evolução por cliente',
    'Acompanhamento de detratores'
  ]) {
    assert.match(dashboard, new RegExp(title));
  }
  assert.match(dashboard, /<Field[^>]*label="Status"/);
  assert.match(dashboard, /<Field[^>]*label="Resultado do contato"/);
  assert.match(
    dashboard,
    /<details className="rdo-nps-dashboard__project-disclosure">/
  );
  assert.match(
    dashboard,
    /<Modal[\s\S]{0,120}?appearance="design-system"/
  );
});

test('dashboard NPS detalhado mantém CSS responsivo, escopado e tokenizado', () => {
  const css = source('src/components/surveys/SurveyDashboard.ds.css');

  assert.match(css, /\.rdo-nps-dashboard\b/);
  assert.match(css, /\.rdo-nps-dashboard-modal\b/);
  assert.match(css, /var\(--/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(/i);
  assert.doesNotMatch(css, /!important/);

  // Breakpoints oficiais do app e tendência sem carrossel local no mobile.
  assert.match(css, /@media \(max-width: 767\.98px\)/);
  assert.match(css, /@media \(min-width: 768px\)/);
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.match(
    css,
    /\.survey-dash-trend\s*\{[\s\S]{0,180}?grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/
  );
  assert.doesNotMatch(css, /overflow-x:\s*(auto|scroll)/);

  const rules = [...css.matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1].replace(/\s+/g, ' ').trim())
    .filter((selector) => selector && !selector.startsWith('@'));
  for (const selector of rules) {
    assert.match(
      selector,
      /\.rdo-nps-dashboard(?:-modal)?\b/,
      `seletor fora do escopo do dashboard NPS: ${selector}`
    );
  }
});
