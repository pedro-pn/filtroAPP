import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withRdoCompanions } from './rdo-source.mjs';

const source = (path) =>
  withRdoCompanions(path, candidate => readFileSync(new URL(`../${candidate}`, import.meta.url), 'utf8'));

test('manager report tabs opt into the DS shell and listing without changing the domain hooks', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const reportTab = page.slice(
    page.indexOf('function renderReportTabContent'),
    page.indexOf('function renderProjectsTab')
  );

  assert.match(
    page,
    /const reportListingTab = tab === 'pendentes' \|\| tab === 'aprovados'/
  );
  assert.match(page, /<AppShell\b/);
  assert.match(page, /<PageHeader\b/);
  assert.match(page, /<ManagerReportListing\b/);
  assert.match(page, /appearance="design-system"/);
  assert.match(page, /<SearchInput\b/);
  assert.match(page, /<FilterBar\b/);
  assert.match(page, /<MetricCard\b/);
  assert.doesNotMatch(reportTab, /<Pagination\b/);

  for (const contract of [
    'useAccumulatedReportsPage',
    'usePersistentSearch',
    'useDebouncedValue',
    'useInfiniteScrollSentinel',
    'saveCurrentPageScroll',
    'rdoReportDetailPath'
  ]) {
    assert.match(page, new RegExp(`\\b${contract}\\b`));
  }
});

test('manager listing composes DataTable and MobileList explicitly while preserving DOM anchors', () => {
  const listing = source(
    'src/components/reports/manager/ManagerReportListing.tsx'
  );

  assert.match(listing, /<DataTable<ReportSummary>/);
  assert.match(listing, /mobile=\{\{/);
  assert.match(listing, /mobileBreakpoint="xl"/);
  assert.doesNotMatch(listing, /rdo-manager-listing__mobile-sort/);
  assert.match(listing, /showSelectAll: false/);
  assert.match(listing, /controlClassName: 'report-select-checkbox'/);
  assert.match(listing, /'rel-item rdo-manager-listing__row'/);
  assert.match(
    listing,
    /className="rel-name rdo-manager-listing__report-link"/
  );
  assert.match(listing, /onOpenReport/);
  assert.match(listing, /handleRowClick/);
  assert.match(listing, /data-row-navigation-ignore/);
  assert.match(listing, /onSortChange/);
  assert.doesNotMatch(listing, /from ['"]lucide-react['"]/);
});

test('manager report ordering stays beside the report type on mobile', () => {
  const groupedList = source('src/components/reports/GroupedReportList.tsx');
  const reportTypeSortButton = source(
    'src/components/reports/manager/ManagerReportTypeSortButton.tsx'
  );
  const reportTypeBadge = source('src/components/reports/ReportTypeBadge.tsx');
  const reportTypeBadgeCss = source(
    'src/components/reports/ReportTypeBadge.css'
  );
  const styles = source('src/pages/gestor/GestorPage.ds.css');

  assert.match(groupedList, /rdo-manager-report-type-row/);
  assert.match(groupedList, /<ManagerReportTypeSortButton/);
  assert.match(groupedList, /showTypeSort \?/);
  assert.match(reportTypeSortButton, /<Button\b/);
  assert.match(reportTypeSortButton, /rdo-manager-report-type-sort/);
  assert.match(reportTypeSortButton, /DS_ICONS\.sort/);
  assert.match(reportTypeSortButton, /A→Z/);
  assert.match(reportTypeSortButton, /Z→A/);
  assert.match(
    reportTypeSortButton,
    /Ordenar relatórios \$\{reportType\} em ordem \$\{nextDirectionLabel\}/
  );
  assert.match(
    groupedList,
    /<ReportTypeBadge[\s\S]*?reportType=\{reportType\}/
  );
  assert.match(
    reportTypeBadge,
    /data-report-type=\{reportTypeToken\(reportType\)\}/
  );
  for (const reportType of ['RDO', 'RTP', 'RLQ', 'RCPU', 'RLM', 'RLI', 'RLF']) {
    assert.match(
      reportTypeBadgeCss,
      new RegExp(`data-report-type='${reportType}'`)
    );
  }
  assert.doesNotMatch(reportTypeBadgeCss, /#[\da-f]{3,8}\b|\brgba?\(/i);
  assert.match(
    styles,
    /\.rdo-manager-listing[\s\S]*?> \.rdo-manager-project-card[\s\S]*?\+ \.rdo-manager-project-card[\s\S]*?margin-block-start:\s*var\(--space-4\)/
  );
  assert.match(
    styles,
    /\.rdo-manager-report-type-sort[\s\S]*?display: none;[\s\S]*?@media \(max-width: 768px\)[\s\S]*?\.rdo-manager-report-type-sort[\s\S]*?display: inline-flex;/
  );
  assert.match(
    styles,
    /\.rdo-archived-report-type__header[\s\S]*?> \.rdo-manager-report-type-sort[\s\S]*?display: inline-flex;/
  );
});

test('manager row navigation preserves the non-clickable legacy side regions', () => {
  const legacyCard = source('src/components/reports/ReportSummaryCard.tsx');
  const listing = source(
    'src/components/reports/manager/ManagerReportListing.tsx'
  );

  assert.match(
    legacyCard,
    /className="report-card-select"[\s\S]*?event\.stopPropagation\(\)/
  );
  assert.match(
    legacyCard,
    /className="report-card-side"[\s\S]*?event\.stopPropagation\(\)/
  );
  assert.match(listing, /const tableCell = event\.target\.closest\('td, th'\)/);
  assert.match(listing, /tableCell\?\.matches\('\.fv-data-table__selection'\)/);
  assert.match(
    listing,
    /tableCell\?\.querySelector\('\[data-row-navigation-ignore\]'\)/
  );
  assert.match(listing, /\.fv-mobile-list__status, \.fv-mobile-list__actions/);
});

test('manager search only references the results region while that region exists', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');

  assert.match(
    page,
    /const reportResultsId =\s*projectsTab[\s\S]*?\? 'rdo-manager-project-results'[\s\S]*?archivedProjectsTab[\s\S]*?\? 'rdo-manager-archived-results'[\s\S]*?!reportListQuery\.isLoadingInitial &&[\s\S]*?pendingReports\.length[\s\S]*?approvedReports\.length[\s\S]*?\? 'rdo-manager-report-results'/
  );
  assert.match(page, /resultsId=\{reportResultsId\}/);
  assert.match(page, /id="rdo-manager-report-results"/);
  assert.match(page, /className="rdo-manager-listing"/);
  assert.equal(
    page.match(/id="rdo-manager-report-results"/g)?.length,
    1,
    'a região controlada deve existir uma única vez no estado populado'
  );
  assert.match(
    page,
    /id="rdo-manager-archived-results"[\s\S]*?aria-label="Lista de projetos arquivados"/
  );
  assert.match(
    page,
    /!reportListQuery\.isLoadingInitial && !archivedProjectsQuery\.isLoading/
  );
  assert.match(
    page,
    /!activeProjectsQuery\.isLoading && !activeProjectsQuery\.isError/
  );
  assert.match(page, /if \(reportListQuery\.isLoadingInitial\)/);
  assert.match(
    page,
    /if \(reportListQuery\.isError && !visibleReports\.length\)/
  );
  assert.match(page, /if \(!visibleReports\.length\)/);
});

test('manager pending and approved pages compose actions, search and real metrics in the DS hierarchy', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');

  assert.match(page, /search: debouncedGestorSearch \|\| undefined/);
  assert.match(page, /pendentes: 'Buscar em pendentes'/);
  assert.match(page, /className="rdo-manager-listing__page-header"/);
  assert.match(page, /Upload PDF antigo/);
  assert.match(page, /Criar Relatório/);
  assert.match(
    page,
    /\{renderReportSummary\(\)\}\s*\{reportListingTab \? renderGestorSearch\(\) : null\}/
  );
  assert.match(
    page,
    /label="Aguardando revisão"[\s\S]*?value=\{pendingCount\}/
  );
  assert.match(page, /label="Aprovados"[\s\S]*?value=\{approvedCount\}/);
  assert.match(page, /label="Assinados"[\s\S]*?value=\{signedCount\}/);
});

test('manager mobile composition keeps metrics in one row, fits approved metrics, and removes redundant list detail', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const pageCss = source('src/pages/gestor/GestorPage.ds.css');
  const statsCss = source('src/components/stats/StatsDashboard.ds.css');
  const listing = source(
    'src/components/reports/manager/ManagerReportListing.tsx'
  );

  assert.doesNotMatch(page, /rdo-manager-listing--approved/);
  assert.match(page, /rdo-approved-action-label--compact/);

  assert.match(
    pageCss,
    /@media \(max-width: 768px\)[\s\S]*?\.rdo-manager-metrics\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(
    page,
    /className=\{`rdo-manager-metrics\$\{tab === 'aprovados' \? ' rdo-manager-metrics--approved' : ''\}`\}/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-metrics\.rdo-manager-metrics--approved\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)[\s\S]*?overflow-x:\s*visible/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-metrics\.rdo-manager-metrics--approved[\s\S]*?\.fv-metric-card\s*\{[\s\S]*?min-width:\s*0[\s\S]*?flex:\s*none/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-metrics[\s\S]*?\.fv-metric-card__description\s*\{[\s\S]*?display:\s*none/
  );
  assert.match(
    pageCss,
    /\.fv-mobile-list__actions,\s*\.fv-mobile-list__details\)[\s\S]*?border-block-start:\s*0/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-listing__batch-toolbar[\s\S]*?border-block:\s*0/
  );
  assert.match(
    pageCss,
    /@media \(max-width: 768px\)[\s\S]*?\.fv-control-shell\s*\{[\s\S]*?height:\s*var\(--space-10\)/
  );
  assert.match(
    pageCss,
    /@media \(max-width: 768px\)[\s\S]*?\.fv-button\s*\{[\s\S]*?min-height:\s*calc\(var\(--space-8\) \+ var\(--space-1\)\)/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-project-card \.project-group-toggle\s*\{[\s\S]*?min-height:\s*calc\(var\(--space-8\) \+ var\(--space-1\)\)/
  );
  assert.match(
    pageCss,
    /\.rdo-team \.rdo-admin-tab,\s*[\s\S]*?\.rdo-users \.rdo-admin-tab\s*\{[\s\S]*?min-height:\s*calc\(var\(--space-8\) \+ var\(--space-1\)\)/
  );
  assert.match(
    pageCss,
    /\.fv-control-shell[\s\S]*?:where\(\.fv-input, \.fv-select\)[\s\S]*?font-size:\s*var\(--text-base\)/
  );
  assert.match(
    pageCss,
    /\.fv-mobile-list__item[\s\S]*?> \.fv-card\s*\{[\s\S]*?padding:\s*var\(--space-2\)/
  );
  assert.match(
    pageCss,
    /\.rdo-admin-form\s*\{[\s\S]*?gap:\s*var\(--space-3\)[\s\S]*?padding:\s*var\(--space-3\)/
  );
  assert.match(
    pageCss,
    /\.client-account-button-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 3fr\) minmax\(0, 2fr\)/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-listing[\s\S]*?\.fv-mobile-list__item[\s\S]*?> \.fv-card:not\(\.fv-card--selected\)\s*\{[\s\S]*?border-color:\s*var\(--line-strong\)[\s\S]*?background:\s*var\(--surface-2\)[\s\S]*?box-shadow:\s*var\(--shadow-e1\)/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-listing__page-header[\s\S]*?\.fv-page-header__actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-listing[\s\S]*?\.fv-mobile-list__actions[\s\S]*?> \.rdo-manager-listing__actions\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-wrap:\s*nowrap[\s\S]*?justify-content:\s*flex-start/
  );
  assert.doesNotMatch(
    pageCss,
    /\.rdo-manager-listing[\s\S]*?\.fv-mobile-list__actions[\s\S]*?> \.rdo-manager-listing__actions\s*\{[^}]*overflow-x:\s*auto/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-listing[\s\S]*?\.fv-mobile-list__actions[\s\S]*?\.fv-button\s*\{[\s\S]*?flex:\s*1 1 0[\s\S]*?--fv-button-padding:\s*var\(--space-1\)/
  );
  assert.match(
    statsCss,
    /@media \(max-width: 768px\)[\s\S]*?\.rdo-stats-overview__count-grid\s*\{[\s\S]*?display:\s*flex[\s\S]*?overflow-x:\s*auto/
  );
  assert.match(listing, /function mobileServicesLabel/);
  assert.match(listing, /\+\$\{remaining\} serviço/);
  assert.match(
    listing,
    /value:\s*hasSignatureProgress[\s\S]*?actions:[\s\S]*?details:\s*hasFeedback/
  );
  assert.match(
    listing,
    /report\.status === 'RETURNED' \? 'danger' : 'info'/
  );
  assert.match(
    listing,
    /className="rdo-manager-listing__mobile-title"[\s\S]*?\{reportLabel\(report\)\}/
  );
});

test('grouped report list keeps legacy as the default and adds an accessible DS opt-in', () => {
  const grouped = source('src/components/reports/GroupedReportList.tsx');

  assert.match(grouped, /appearance = 'legacy'/);
  assert.match(grouped, /appearance === 'design-system'/);
  assert.match(grouped, /aria-expanded=\{!projectClosed\}/);
  assert.match(grouped, /aria-controls=\{projectPanelId\}/);
  assert.match(grouped, /aria-expanded=\{!typeClosed\}/);
  assert.match(grouped, /aria-controls=\{typePanelId\}/);
  assert.match(grouped, /renderReportCollection/);
});

test('RDO manager CSS is scoped, tokenized and uses only official breakpoints', () => {
  const css = `${source('src/pages/gestor/GestorPage.ds.css')}\n${source(
    'src/components/reports/manager/ManagerReportListing.css'
  )}`;

  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(/i);
  assert.doesNotMatch(css, /!important/);

  const selectors = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:media|container)[^\{]+\{/g, '}')
    .matchAll(/(?:^|})\s*([^@{}][^{}]*)\{/g);
  for (const match of selectors) {
    assert.match(match[1], /:where\(\.fv-ds, \[data-fv-ds\]\)/);
  }

  const officialBreakpointEdges = new Set([
    '480',
    '768',
    '1024',
    '1280',
    '1536'
  ]);
  for (const match of css.matchAll(/@(media|container)\s*([^\{]+)/g)) {
    for (const value of match[2].matchAll(/(\d+(?:\.\d+)?)px\b/g)) {
      assert.ok(
        officialBreakpointEdges.has(value[1]),
        `Breakpoint não oficial no CSS RDO Gestor: ${value[0]}`
      );
    }
  }
});

test('other RDO profiles share the new shell and responsive report listing', () => {
  for (const path of [
    'src/pages/coordinator/CoordinatorPage.tsx',
    'src/pages/collaborator/MyReportsPage.tsx',
    'src/pages/collaborator/MyArchivedReportsPage.tsx'
  ]) {
    const page = source(path);
    assert.match(page, /<RdoAppShell\b/);
    assert.match(page, /<ManagerReportListing\b/);
    assert.match(page, /appearance="design-system"/);
    assert.doesNotMatch(page, /layout\/Shell|<Shell\b/);
  }

  const client = source('src/pages/client/ClientPage.tsx');
  assert.match(client, /<RdoAppShell\b/);
  assert.match(client, /<MetricCard\b/);
  assert.doesNotMatch(client, /layout\/Shell|<Shell\b/);
});

test('upload manual usa modal DS e campos tokenizados no tema escuro', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const css = source('src/pages/gestor/GestorPage.ds.css');

  assert.match(
    page,
    /<Modal[\s\S]{0,220}?open=\{manualReportModalOpen\}[\s\S]{0,220}?appearance="design-system"/
  );
  assert.match(page, /panelClassName="rdo-manager-manual-report-dialog"/);
  assert.match(page, /form="manual-report-form"/);
  assert.match(
    css,
    /\.rdo-manager-manual-report-dialog[\s\S]*?\.pdf-dropzone \{[\s\S]*?background: var\(--surface-2\)[\s\S]*?color: var\(--ink\)/
  );
  assert.doesNotMatch(page, /panelClassName="modal-card manual-report-modal"/);
});
