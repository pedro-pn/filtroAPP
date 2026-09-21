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

test('B.3 is an explicit StatsDashboardOverlay opt-in restricted to Gestor', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');
  const stats = source('src/components/stats/StatsDashboard.tsx');
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
  const managerDetailedOverlay = sectionBetween(
    manager,
    '{statisticsTab && statsDashboardOpen ? <StatsDashboardOverlay',
    '\n      {statisticsTab && allocationDashboardOpen'
  );

  assert.match(
    stats,
    /type StatsDashboardAppearance = 'legacy' \| 'design-system'/
  );
  assert.match(stats, /appearance\?: StatsDashboardAppearance/);
  assert.match(
    detailedOverlay,
    /appearance = 'legacy'/,
    'o componente compartilhado deve continuar legacy por padrão'
  );
  assert.match(
    detailedOverlay,
    /<StatsDashboard appearance="design-system"\s*\/>/
  );
  assert.match(detailedOverlay, /<StatsDashboard\s*\/>/);
  assert.match(
    detailedOverlay,
    /className="survey-dash-overlay"/,
    'o branch legacy compartilhado deve manter o contrato visual atual'
  );

  assert.match(managerDetailedOverlay, /<StatsDashboardOverlay\b/);
  assert.match(managerDetailedOverlay, /appearance="design-system"/);
  assert.match(
    managerDetailedOverlay,
    /onClose=\{\(\) => setStatsDashboardOpen\(false\)\}/
  );
  assert.match(
    coordinator,
    /<StatsDashboardOverlay appearance="design-system" onClose=\{\(\) => setStatsDashboardOpen\(false\)\}\s*\/>/
  );

  const optInConsumers = sourceFilesUnder('src')
    .filter((path) => /\.tsx$/.test(path))
    .filter((path) =>
      /<StatsDashboardOverlay\b[^>]*appearance=["'{]/s.test(
        readFileSync(path, 'utf8')
      )
    );

  assert.deepEqual(optInConsumers, [
    join(frontendRoot, 'src/pages/coordinator/CoordinatorPage.tsx'),
    join(frontendRoot, 'src/pages/gestor/GestorPage.tsx')
  ]);

  assert.match(monthlyOverlay, /className="survey-dash-overlay"/);
  assert.match(monthlyOverlay, /<MonthlyAllocationDashboard\s*\/>/);
  assert.match(monthlyOverlay, /appearance = 'legacy'/);
  assert.match(
    manager,
    /<MonthlyAllocationDashboardOverlay\s+appearance="design-system"/,
    'a evolução B.6 deve continuar explícita no Gestor'
  );
  assert.match(
    coordinator,
    /<MonthlyAllocationDashboardOverlay appearance="design-system"/,
    'o Coordenador também deve usar a apresentação migrada'
  );
});

test('B.3 preserves detailed statistics hooks, parameters, exports and transient state', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const dashboard = sectionBetween(
    stats,
    'export function StatsDashboard',
    '// ─── Overlay wrapper'
  );

  assert.match(dashboard, /appearance = 'legacy'/);
  assert.match(dashboard, /useProjects\(\)/);
  assert.match(dashboard, /useProjectSegments\(\)/);
  assert.match(dashboard, /useProjectStats\(statsParams\)/);
  assert.match(
    dashboard,
    /useProjectStats\(\s*byProjectStatsParams,\s*selectedVisibleProjects\.length !== 1\s*\)/
  );
  assert.match(dashboard, /useState<PeriodPreset>\('year'\)/);
  assert.match(dashboard, /useState<string\[\]>\(\[\]\)/);
  assert.match(dashboard, /useState<ProjectStatusFilterValue>\('all'\)/);
  assert.match(dashboard, /useState<'hours' \| 'services'>\(\s*'hours'\s*\)/);
  assert.match(dashboard, /const sharedStatsParams: StatsParams =/);
  assert.match(dashboard, /const statsParams: StatsParams =/);
  assert.match(dashboard, /const byProjectStatsParams: StatsParams =/);
  assert.match(dashboard, /downloadProjectStatsCsv\(exportParams\)/);
  assert.match(
    dashboard,
    /downloadBlob\(blob, statsExportFileName\(exportParams\)\)/
  );

  assert.match(stats, /filtrovali-stats-project-filter-highlight-v1/);
  assert.match(stats, /const selector = '\.stats-byproject-status-filter'/);
  assert.match(stats, /localStorage\.getItem\(statsProjectFilterHighlightKey/);
  assert.match(stats, /localStorage\.setItem\(statsProjectFilterHighlightKey/);
  assert.match(stats, /markStatsProjectFilterHighlightSeen\(user\?\.id\)/);

  assert.doesNotMatch(
    dashboard,
    /useAllocationReportRecipientMutations|sendAllocationReportNow|saveAllocationReportRecipient|updateAllocationReportRecipient|removeAllocationReportRecipient/,
    'o dashboard detalhado não pode absorver mutações da Alocação mensal'
  );
});

test('B.3 preserves A.1 anchors and adds modal and filter semantics in the DS branch', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const detailedOverlay = sectionBetween(
    stats,
    'export function StatsDashboardOverlay',
    '// ─── Stats Overview'
  );

  assert.match(detailedOverlay, /appearance === 'design-system'/);
  assert.match(detailedOverlay, /<Modal\b/);
  assert.match(detailedOverlay, /appearance="design-system"/);
  assert.match(detailedOverlay, /ariaLabel="Dashboard de Estatísticas"/);
  assert.match(detailedOverlay, />\s*Voltar\s*</);

  assert.match(stats, /className="stats-kpi-card/);
  assert.match(stats, />Resumo do período</);
  assert.match(stats, />Mês</);
  assert.match(stats, /stats-preset-btn.*active/);
  assert.match(stats, /className="stats-byproject-status-filter"/);
  assert.match(stats, /aria-pressed=\{/);
  assert.match(stats, /aria-expanded=\{/);
  assert.match(stats, /aria-controls=\{/);
  assert.match(
    stats,
    /appearance === 'design-system' \? \(\s*<div className="stats-byproject-detail" id=\{detailId\} hidden \/>/,
    'o painel controlado pelo disclosure DS deve continuar no DOM quando recolhido'
  );

  assert.match(
    manager,
    /statisticsTab && statsDashboardOpen \? <StatsDashboardOverlay/
  );
  assert.match(manager, /onClose=\{\(\) => setStatsDashboardOpen\(false\)\}/);
});

test('B.3 keeps responsive table alternatives exclusive in the detailed DS composition', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const serviceTable = sectionBetween(
    stats,
    'function DesignSystemServiceItemsTable',
    'function ServicesSection'
  );
  const dailyTable = sectionBetween(
    stats,
    'function DesignSystemDailyReportTable',
    'function ProjectDailyDetail'
  );
  const servicesSection = sectionBetween(
    stats,
    'function ServicesSection',
    '// ─── By Project Section'
  );
  const dashboard = sectionBetween(
    stats,
    'export function StatsDashboard',
    '// ─── Overlay wrapper'
  );

  for (const table of [serviceTable, dailyTable]) {
    assert.match(table, /<DataTable\b/);
    assert.match(table, /mobile=\{\{/);
    assert.match(table, /renderItem:/);
  }

  assert.match(
    dashboard,
    /const isDesignSystem = appearance === 'design-system'/
  );
  assert.match(dashboard, /<DashboardCard\b/);
  assert.match(dashboard, /<Alert\b/);
  assert.match(dashboard, /<Skeleton\b/);
  assert.match(servicesSection, /<EmptyState\b/);
});

test('B.3 reorganiza filtros e dados com divulgação progressiva no dashboard detalhado', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const css = source('src/components/stats/StatsDashboard.ds.css');
  const dashboard = sectionBetween(
    stats,
    'export function StatsDashboard',
    '// ─── Overlay wrapper'
  );
  const kpis = sectionBetween(stats, 'function KpiCards', '// ─── Timeline SVG');
  const timeline = sectionBetween(stats, 'function TimelineChart', '// ─── Services Section');
  const services = sectionBetween(stats, 'function ServicesSection', '// ─── By Project Section');

  assert.match(dashboard, /useState\(''\).*projectSearch|\[projectSearch, setProjectSearch\] = useState\(''\)/s);
  assert.match(dashboard, /className="stats-project-picker"/);
  assert.match(dashboard, /type="search"/);
  assert.match(dashboard, /aria-label="Buscar projeto"/);
  assert.match(dashboard, /filteredProjects\.map/);
  assert.match(dashboard, /className="stats-filter-scope" aria-live="polite"/);
  assert.match(dashboard, />\s*Limpar filtros\s*</);

  assert.match(kpis, /label="RDOs analisados"/);
  assert.match(kpis, /className="stats-kpi-primary"/);
  assert.match(kpis, /className="stats-shift-comparison"/);
  assert.match(kpis, /data-shift=\{shift\.key\}/);
  assert.match(timeline, /className="stats-chart-insights"/);
  assert.match(timeline, />Total no período</);
  assert.match(timeline, />Maior volume</);
  assert.match(services, /<details className="stats-service-disclosure">/);
  assert.match(services, />Equipamentos e sistemas</);

  for (const selector of [
    '.stats-project-picker',
    '.stats-filter-scope',
    '.stats-kpi-primary',
    '.stats-shift-comparison',
    '.stats-chart-insights',
    '.stats-service-disclosure'
  ]) {
    assert.match(css, new RegExp(selector.replace('.', '\\.')));
  }
  assert.match(css, /@media \(max-width: 767\.98px\)/);
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.match(
    css,
    /\.stats-byproject-toggle\.fv-button\s*\{[\s\S]{0,120}?height: auto;/,
    'os cards de projeto precisam crescer com nome e métricas no mobile'
  );
  assert.doesNotMatch(css, /!important/);
});
