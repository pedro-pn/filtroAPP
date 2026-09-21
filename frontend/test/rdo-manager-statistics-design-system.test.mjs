import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { withRdoCompanions } from './rdo-source.mjs';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => withRdoCompanions(path, candidate => readFileSync(join(frontendRoot, candidate), 'utf8'));

function sectionBetween(contents, start, end) {
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex);

  assert.notEqual(startIndex, -1, `Seção inicial ausente: ${start}`);
  assert.notEqual(endIndex, -1, `Seção final ausente: ${end}`);

  return contents.slice(startIndex, endIndex);
}

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

test('Gestor is the only StatsOverview consumer that opts into the Design System', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');
  const managerStatistics = sectionBetween(
    manager,
    'function renderEstatisticasTab',
    'function renderTabContent'
  );
  assert.match(manager, /const statisticsTab = tab === 'estatisticas'/);
  assert.match(
    manager,
    /reportListingTab \|\| projectsTab \|\| archivedProjectsTab \|\| adminTab \|\| npsTab \|\| statisticsTab/
  );
  assert.match(manager, /'rdo-manager-stats-page'/);
  assert.match(managerStatistics, /<PageHeader\b/);
  assert.match(
    managerStatistics,
    /<StatsOverview appearance="design-system"\s*\/>/
  );
  assert.match(
    managerStatistics,
    /onClick=\{\(\) => setAllocationDashboardOpen\(true\)\}/
  );
  assert.match(
    managerStatistics,
    /onClick=\{\(\) => setStatsDashboardOpen\(true\)\}/
  );
  assert.match(managerStatistics, /aria-label="Abrir alocação mensal"/);
  assert.match(
    managerStatistics,
    /rdo-action-label--full">\s*Alocação mensal\s*<\/span>/
  );
  assert.match(managerStatistics, /aria-label="Abrir dashboard detalhado"/);
  assert.match(
    managerStatistics,
    /rdo-action-label--full">\s*Dashboard detalhado\s*<\/span>/
  );
  assert.doesNotMatch(managerStatistics, /mini-btn|nps-tab-toolbar/);

  assert.match(coordinator, /<StatsOverview appearance="design-system"\s*\/>/);

  const optInConsumers = sourceFilesUnder('src')
    .filter((path) => /\.tsx$/.test(path))
    .filter((path) =>
      /<StatsOverview\b[^>]*appearance=["'{]/s.test(readFileSync(path, 'utf8'))
    );

  assert.deepEqual(optInConsumers, [
    join(frontendRoot, 'src/pages/coordinator/CoordinatorPage.tsx'),
    join(frontendRoot, 'src/pages/gestor/GestorPage.tsx')
  ]);
});

test('StatsOverview preserves the legacy default and the characterized data derivation', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const overview = stats.slice(stats.indexOf('export function StatsOverview'));

  assert.match(
    stats,
    /type StatsOverviewAppearance = 'legacy' \| 'design-system'/
  );
  assert.match(stats, /appearance\?: StatsOverviewAppearance/);
  assert.match(
    overview,
    /export function StatsOverview\(\{\s*appearance = 'legacy'\s*\}: StatsOverviewProps = \{\}\)/
  );
  assert.match(overview, /useStatsOverview\(\)/);
  assert.match(overview, /data\.byProject\.slice\(0, 10\)/);
  assert.match(
    overview,
    /data\.byProject\.filter\(\s*\(?r\)?\s*=> Object\.keys\(r\.reportCounts\)\.length > 0\s*\)/
  );
  assert.match(
    overview,
    /showAll \? withReports : withReports\.slice\(0, 15\)/
  );
  assert.doesNotMatch(
    overview,
    /byProject\.(?:sort|toSorted)\(/,
    'a ordem recebida da API deve continuar sendo preservada'
  );
  assert.match(overview, /appearance === 'design-system'/);
  assert.match(overview, /onShowAll=\{\(\) => setShowAll\(true\)\}/);
  assert.match(overview, /Ver todos os \{withReports\.length\} projetos/);
  assert.match(overview, /className="stats-ov-wrap"/);
  assert.match(overview, /<OverviewCountCard\b/);
  assert.match(overview, /<TopProjectsBar rows=\{top10\}\s*\/>/);
  assert.match(overview, /<ReportTypeTable rows=\{tableRows\}\s*\/>/);

  assert.match(
    stats,
    /Object\.values\(row\.reportCounts\)\.reduce\([\s\S]*?total \+ \(count \?\? 0\)/
  );
  assert.match(stats, /className="stats-ov-count-card/);
  assert.match(stats, /className="stats-ov-count-value"/);
});

test('the DS overview composes responsive listings and explicit loading, error and empty states', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const dataTable = source('src/components/ui/ds/listings/DataTable.tsx');
  const reportTable = sectionBetween(
    stats,
    'function DesignSystemReportTypeTable',
    'function DesignSystemStatsOverviewLoading'
  );
  const countCard = sectionBetween(
    stats,
    'function DesignSystemOverviewCountCard',
    'function DesignSystemTopProjectsBar'
  );
  const loading = sectionBetween(
    stats,
    'function DesignSystemStatsOverviewLoading',
    'function DesignSystemStatsOverview('
  );
  const designSystemOverview = sectionBetween(
    stats,
    'function DesignSystemStatsOverview(',
    'function formatAllocationDate'
  );
  const publicOverview = stats.slice(
    stats.indexOf('export function StatsOverview')
  );

  assert.match(reportTable, /DataTableColumn<StatsOverviewProject>/);
  assert.match(reportTable, /rowHeader: true/);
  assert.match(reportTable, /<DataTable\b/);
  assert.match(reportTable, /getRowId=\{\(row\) => row\.projectId\}/);
  assert.match(reportTable, /ariaLabel="Relatórios por projeto e tipo"/);
  assert.match(reportTable, /mobile=\{\{/);
  assert.match(reportTable, /renderItem: \(row\) => \(\{/);
  assert.match(
    reportTable,
    /metadata: usedTypes[\s\S]*?\.filter\(\(type\) => \(row\.reportCounts\[type\] \?\? 0\) > 0\)[\s\S]*?\.map/
  );
  assert.match(
    reportTable,
    /ALL_REPORT_TYPES\.filter\([\s\S]*?row\.reportCounts\[type\]/
  );
  assert.match(
    dataTable,
    /\{isMobile \? \([\s\S]*?<MobileList\b[\s\S]*?\) : \([\s\S]*?className="fv-data-table__desktop"/,
    'DataTable deve montar apenas MobileList ou tabela desktop por viewport'
  );

  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-label="Carregando visão geral\.\.\."/);
  assert.match(loading, /Array\.from\(\{ length: 3 \}/);
  assert.match(loading, /<Skeleton\b/);
  assert.match(loading, /variant="table-rows"/);

  assert.match(countCard, /<MetricCard\b/);
  assert.match(countCard, /description=\{description\}/);
  assert.match(countCard, /tone=\{tone\}/);
  assert.match(designSystemOverview, /<Card\b/);
  assert.match(designSystemOverview, /aria-label="Resumo dos projetos"/);
  assert.match(designSystemOverview, /<DesignSystemOverviewCountCard\b/);
  assert.match(designSystemOverview, /<DesignSystemTopProjectsBar\b/);
  assert.match(designSystemOverview, /<DesignSystemReportTypeTable\b/);
  assert.match(designSystemOverview, /<Button\b/);
  assert.match(designSystemOverview, /<EmptyState\b/);
  assert.match(publicOverview, /<DesignSystemStatsOverviewLoading\s*\/>/);
  assert.match(
    publicOverview,
    /<Alert tone="danger" title="Erro ao carregar dados\."\s*\/>/
  );
});

test('statistics overlays are DS in Gestor and Coordinator migrated surfaces', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');
  const detailedOverlay = sectionBetween(
    stats,
    'export function StatsDashboardOverlay',
    '// ─── Stats Overview'
  );
  const monthlyOverlay = sectionBetween(
    stats,
    'export function MonthlyAllocationDashboardOverlay',
    'export function StatsOverview'
  );
  const managerStatistics = sectionBetween(
    manager,
    'function renderEstatisticasTab',
    'function renderTabContent'
  );
  const managerDetailedOverlay = sectionBetween(
    manager,
    '{statisticsTab && statsDashboardOpen ? <StatsDashboardOverlay',
    '\n      {statisticsTab && allocationDashboardOpen'
  );

  assert.match(detailedOverlay, /appearance = 'legacy'/);
  assert.match(
    detailedOverlay,
    /<StatsDashboard appearance="design-system"\s*\/>/
  );
  assert.match(detailedOverlay, /<StatsDashboard\s*\/>/);
  assert.match(monthlyOverlay, /className="survey-dash-overlay"/);
  assert.match(monthlyOverlay, /<MonthlyAllocationDashboard\s*\/>/);
  assert.match(monthlyOverlay, /appearance = 'legacy'/);

  assert.match(stats, /filtrovali-stats-project-filter-highlight-v1/);
  assert.match(stats, /localStorage\.getItem\(statsProjectFilterHighlightKey/);
  assert.match(stats, /localStorage\.setItem\(statsProjectFilterHighlightKey/);
  assert.match(stats, /driver\(\{/);
  assert.match(stats, /const \[selectedYear, setSelectedYear\] = useState/);
  assert.match(stats, /const \[selectedMonth, setSelectedMonth\] = useState/);
  assert.match(stats, /handleDownloadPdf/);
  assert.match(stats, /handleSendNow/);
  assert.match(stats, /handleAddRecipient/);

  assert.doesNotMatch(
    managerStatistics,
    /StatsDashboardOverlay|MonthlyAllocationDashboardOverlay/,
    'overlays legacy não podem permanecer dentro do conteúdo inline DS'
  );
  assert.match(managerDetailedOverlay, /<StatsDashboardOverlay\b/);
  assert.match(managerDetailedOverlay, /appearance="design-system"/);
  assert.match(
    managerDetailedOverlay,
    /onClose=\{\(\) => setStatsDashboardOpen\(false\)\}/
  );
  assert.match(
    manager,
    /statisticsTab && allocationDashboardOpen \? <MonthlyAllocationDashboardOverlay/
  );
  assert.match(
    manager,
    /<MonthlyAllocationDashboardOverlay\s+appearance="design-system"/
  );
  assert.match(
    coordinator,
    /<MonthlyAllocationDashboardOverlay appearance="design-system" onClose=\{\(\) => setAllocationDashboardOpen\(false\)\}\s*\/>/
  );
});

test('statistics DS CSS stays scoped, tokenized and free of visual literals', () => {
  const css = source('src/components/stats/StatsDashboard.ds.css');

  assert.match(css, /:where\(\.fv-ds,\s*\[data-fv-ds\]\)/);
  assert.match(css, /var\(--/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(/i);
  assert.doesNotMatch(css, /!important/);

  const selectors = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@media[^\{]+\{/g, '}')
    .matchAll(/(?:^|})\s*([^@{}][^{}]*)\{/g);
  for (const match of selectors) {
    assert.match(
      match[1],
      /:where\(\.fv-ds,\s*\[data-fv-ds\]\)/,
      `Seletor de Estatísticas fora da fronteira DS: ${match[1].trim()}`
    );
  }

  const officialBreakpointEdges = new Set([
    '479.98',
    '480',
    '767.98',
    '768',
    '1023.98',
    '1024',
    '1279.98',
    '1280',
    '1535.98',
    '1536'
  ]);
  for (const match of css.matchAll(/@(media|container)\s*([^\{]+)/g)) {
    for (const value of match[2].matchAll(/(\d+(?:\.\d+)?)px\b/g)) {
      assert.ok(
        officialBreakpointEdges.has(value[1]),
        `Breakpoint não oficial no CSS de Estatísticas: ${value[0]}`
      );
    }
  }
});
