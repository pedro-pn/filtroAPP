import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => readFileSync(join(frontendRoot, path), 'utf8');

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
      else if (/\.tsx$/.test(entry.name)) files.push(absolutePath);
    }
  }

  visit(join(frontendRoot, path));
  return files;
}

function jsxTags(contents, component) {
  return contents.match(new RegExp(`<${component}\\b[^>]*>`, 'gs')) || [];
}

function cssRuleAt(contents, marker, fromIndex = 0) {
  const markerIndex = contents.indexOf(marker, fromIndex);
  assert.notEqual(markerIndex, -1, `Seletor CSS ausente: ${marker}`);

  const ruleStart = contents.lastIndexOf('}', markerIndex) + 1;
  const openingBrace = contents.indexOf('{', markerIndex);
  const closingBrace = contents.indexOf('}', openingBrace);

  assert.notEqual(openingBrace, -1, `Abertura da regra ausente: ${marker}`);
  assert.notEqual(closingBrace, -1, `Fechamento da regra ausente: ${marker}`);

  return {
    rule: contents.slice(ruleStart, closingBrace + 1).trim(),
    markerIndex
  };
}

test('RdoServiceSummary separates title, description and quantitative summary without changing data derivation', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const summary = sectionBetween(
    stats,
    'function RdoServiceSummary(',
    'function DesignSystemDailyReportTable('
  );
  const designSystemTable = sectionBetween(
    stats,
    'function DesignSystemDailyReportTable(',
    'function ProjectDailyDetail('
  );

  assert.match(summary, /const entries = Object\.entries\(services\)/);
  assert.match(summary, /const items = service\.items \|\| \[\]/);
  assert.match(
    summary,
    /className="rdo-stats-dashboard__daily-service-title"[\s\S]*?\{SERVICE_LABELS\[type\] \|\| type\}/
  );
  assert.match(
    summary,
    /const label =\s*\[item\.equipmentName, item\.system\][\s\S]*?\.filter\(Boolean\)[\s\S]*?\.join\(' - '\) \|\| '—'/
  );
  assert.match(
    summary,
    /className="rdo-stats-dashboard__daily-service-item"[\s\S]*?className="rdo-stats-dashboard__daily-service-description"[\s\S]*?\{label\}[\s\S]*?className="rdo-stats-dashboard__daily-service-quantity"/
  );

  assert.match(
    summary,
    /const tubes = Object\.entries\(item\.tubesByDiameter \|\| \{\}\)/
  );
  assert.match(
    summary,
    /const tubeTotal = totalTubeLength\(item\.tubesByDiameter \|\| \{\}\)/
  );
  assert.match(
    summary,
    /type === 'filtragem' &&\s*item\.volumeOleoLiters != null &&\s*item\.volumeOleoLiters > 0/
  );
  assert.match(summary, /\{hasVolume \|\| tubes\.length > 0 \? \(/);
  assert.match(summary, /fmtNum\(item\.volumeOleoLiters!, 0\)\} L/);
  assert.match(
    summary,
    /<strong>Total<\/strong> → \{fmtNum\(tubeTotal, 1\)\} m/
  );
  assert.match(
    summary,
    /tubes\.map\(\(\[diameter, meters\]\) => \([\s\S]*?<strong>\{diameter\}<\/strong> →\{' '\}[\s\S]*?\{fmtNum\(meters, 1\)\} m/
  );
  assert.doesNotMatch(
    summary,
    /\.(?:sort|toSorted)\(/,
    'a ordem de serviços, itens e diâmetros recebida pelo domínio deve ser preservada'
  );

  const titleIndex = summary.indexOf(
    'rdo-stats-dashboard__daily-service-title'
  );
  const descriptionIndex = summary.indexOf(
    'rdo-stats-dashboard__daily-service-description',
    titleIndex
  );
  const quantityIndex = summary.indexOf(
    'rdo-stats-dashboard__daily-service-quantity',
    descriptionIndex
  );

  assert.ok(
    titleIndex < descriptionIndex && descriptionIndex < quantityIndex,
    'a composição DS deve manter a hierarquia título → descrição → quantitativo'
  );
  assert.equal(
    designSystemTable.match(
      /<RdoServiceSummary services=\{report\.services\} \/>/g
    )?.length,
    2,
    'desktop e mobile DS devem reutilizar o mesmo resumo sem duplicar cálculos'
  );
});

test('the legacy RdoServiceRows presentation and calculations remain isolated', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const legacyRows = sectionBetween(
    stats,
    'function RdoServiceRows(',
    'function RdoServiceSummary('
  );
  const projectDetail = sectionBetween(
    stats,
    'function ProjectDailyDetail(',
    'function ProjectRow('
  );

  assert.match(legacyRows, /<tr key=\{type\} className="stats-svc-subrow">/);
  assert.match(legacyRows, /className="stats-svc-subrow-cell"/);
  assert.match(legacyRows, /className="stats-svc-subrow-type"/);
  assert.match(legacyRows, /className="stats-svc-subrow-label">\{label\}/);
  assert.match(legacyRows, /className="stats-svc-subrow-qty"/);
  assert.match(
    legacyRows,
    /const label =\s*\[item\.equipmentName, item\.system\]\.filter\(Boolean\)\.join\(' - '\) \|\|\s*'—'/
  );
  assert.match(
    legacyRows,
    /const tubes = Object\.entries\(item\.tubesByDiameter \|\| \{\}\)/
  );
  assert.match(
    legacyRows,
    /const tubeTotal = totalTubeLength\(item\.tubesByDiameter \|\| \{\}\)/
  );
  assert.match(legacyRows, /fmtNum\(item\.volumeOleoLiters!, 0\)\} L/);
  assert.match(
    legacyRows,
    /<strong>Total<\/strong> → \{fmtNum\(tubeTotal, 1\)\} m/
  );
  assert.match(
    legacyRows,
    /tubes\.map\(\(\[d, m\]\) => \([\s\S]*?<strong>\{d\}<\/strong> → \{fmtNum\(m, 1\)\} m/
  );
  assert.doesNotMatch(
    legacyRows,
    /rdo-stats-dashboard__daily-service-(?:title|item|description|quantity)|<Card\b/,
    'as classes e a composição DS não podem alcançar as linhas legacy'
  );
  assert.doesNotMatch(legacyRows, /\.(?:sort|toSorted)\(/);
  assert.match(
    projectDetail,
    /if \(appearance === 'design-system'\) \{[\s\S]*?<DesignSystemDailyReportTable reports=\{detailProject\.dailyReports\} \/>/
  );
  assert.match(
    projectDetail,
    /\{hasSvcs && \(\s*<RdoServiceRows[\s\S]*?services=\{rdo\.services\}/,
    'o caminho legacy deve continuar renderizando RdoServiceRows'
  );
});

test('DS service hierarchy and KPI alignment remain scoped and tokenized', () => {
  const css = source('src/components/stats/StatsDashboard.ds.css');
  const kpiCss = sectionBetween(
    css,
    ':where(.fv-ds, [data-fv-ds]) .rdo-stats-dashboard .stats-kpi-layout',
    ':where(.fv-ds, [data-fv-ds]) .rdo-stats-dashboard__chart'
  );
  const serviceCss = sectionBetween(
    css,
    ':where(.fv-ds, [data-fv-ds]) .rdo-stats-dashboard__daily-services',
    ':where(.fv-ds, [data-fv-ds]) .rdo-stats-dashboard .stats-project-status-filter'
  );

  const kpiRow = cssRuleAt(kpiCss, '.stats-kpi-row').rule;
  const firstKpiCard = cssRuleAt(kpiCss, '.stats-kpi-card');
  const kpiCard = firstKpiCard.rule;
  const kpiBody = cssRuleAt(
    kpiCss,
    '.stats-kpi-card',
    firstKpiCard.markerIndex + '.stats-kpi-card'.length
  ).rule;
  const kpiValue = cssRuleAt(kpiCss, '.stats-kpi-value').rule;
  const kpiLabel = cssRuleAt(kpiCss, '.stats-kpi-label').rule;

  assert.match(kpiRow, /align-items: stretch/);
  assert.match(kpiCard, /:where\(\.fv-ds, \[data-fv-ds\]\)/);
  assert.match(kpiCard, /\.rdo-stats-dashboard/);
  assert.match(kpiCard, /height: 100%/);
  assert.match(kpiCard, /padding: var\(--space-4\)/);
  assert.match(kpiCard, /text-align: center/);
  assert.match(kpiBody, /> \.fv-card__body/);
  assert.match(kpiBody, /display: grid/);
  assert.match(kpiBody, /height: 100%/);
  assert.match(
    kpiBody,
    /grid-template-rows: var\(--leading-2xl\) minmax\(var\(--leading-sm\), auto\)/
  );
  assert.match(kpiBody, /align-content: center/);
  assert.match(kpiBody, /justify-items: center/);
  assert.match(kpiBody, /gap: var\(--space-1\)/);
  assert.match(kpiValue, /width: 100%/);
  assert.match(kpiValue, /font-variant-numeric: tabular-nums/);
  assert.match(kpiLabel, /width: 100%/);
  assert.match(kpiLabel, /color: var\(--ink\)/);

  for (const className of [
    'rdo-stats-dashboard__daily-services',
    'rdo-stats-dashboard__daily-service',
    'rdo-stats-dashboard__daily-service-title',
    'rdo-stats-dashboard__daily-service-item',
    'rdo-stats-dashboard__daily-service-description',
    'rdo-stats-dashboard__daily-service-quantity'
  ]) {
    const rule = cssRuleAt(serviceCss, `.${className}`).rule;
    assert.match(
      rule,
      /:where\(\.fv-ds, \[data-fv-ds\]\)/,
      `${className} deve permanecer sob a fronteira do DS`
    );
  }

  const quantity = cssRuleAt(
    serviceCss,
    '.rdo-stats-dashboard__daily-service-quantity'
  ).rule;
  assert.match(quantity, /display: flex/);
  assert.match(quantity, /width: fit-content/);
  assert.match(quantity, /max-width: 100%/);
  assert.match(quantity, /flex-wrap: wrap/);
  assert.match(quantity, /gap: var\(--space-1\) var\(--space-3\)/);
  assert.match(quantity, /padding: var\(--space-1\) var\(--space-2\)/);
  assert.match(quantity, /border: var\(--border-width\) solid var\(--line\)/);
  assert.match(quantity, /border-radius: var\(--radius-md\)/);
  assert.match(quantity, /background: var\(--brand-softer\)/);
  assert.match(quantity, /color: var\(--brand-text\)/);
  assert.match(quantity, /font-weight: var\(--font-semibold\)/);
  assert.match(quantity, /font-variant-numeric: tabular-nums/);

  assert.doesNotMatch(
    `${kpiCss}\n${serviceCss}`,
    /!important|#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i,
    'o refinamento deve usar somente o escopo e os tokens semânticos do DS'
  );
});

test('Gestor and Coordinator opt into the detailed dashboard presentation', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');
  const dashboard = stats.slice(
    stats.indexOf('export function StatsDashboard')
  );
  const overlay = stats.slice(
    stats.indexOf('export function StatsDashboardOverlay')
  );

  assert.match(
    dashboard,
    /export function StatsDashboard\(\{\s*appearance = 'legacy'\s*\}: StatsDashboardProps = \{\}\)/
  );
  assert.match(
    overlay,
    /export function StatsDashboardOverlay\(\{\s*onClose,\s*appearance = 'legacy'\s*\}: StatsDashboardOverlayProps\)/
  );

  const managerTags = jsxTags(manager, 'StatsDashboardOverlay');
  const coordinatorTags = jsxTags(coordinator, 'StatsDashboardOverlay');

  assert.equal(managerTags.length, 1);
  assert.match(managerTags[0], /appearance="design-system"/);
  assert.equal(coordinatorTags.length, 1);
  assert.match(coordinatorTags[0], /appearance="design-system"/);

  const optInConsumers = sourceFilesUnder('src')
    .filter((path) =>
      jsxTags(readFileSync(path, 'utf8'), 'StatsDashboardOverlay').some((tag) =>
        /appearance="design-system"/.test(tag)
      )
    )
    .map((path) => path.slice(frontendRoot.length))
    .sort();

  assert.deepEqual(optInConsumers, [
    'src/pages/coordinator/CoordinatorPage.tsx',
    'src/pages/gestor/GestorPage.tsx'
  ]);
});
