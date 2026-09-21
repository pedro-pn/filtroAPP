import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withRdoCompanions } from './rdo-source.mjs';

const source = (path) =>
  withRdoCompanions(path, candidate => readFileSync(new URL(`../${candidate}`, import.meta.url), 'utf8'));

function sectionBetween(contents, start, end) {
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex);

  assert.notEqual(startIndex, -1, `Seção inicial ausente: ${start}`);
  assert.notEqual(endIndex, -1, `Seção final ausente: ${end}`);

  return contents.slice(startIndex, endIndex);
}

test('Arquivados faz opt-in explícito no DS sem alterar o default legacy compartilhado', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const loadMoreRenderer = sectionBetween(
    page,
    'function renderLoadMoreReports',
    'function renderReportTabContent'
  );
  const reportTabs = sectionBetween(
    page,
    'function renderReportTabContent',
    'function renderProjectsTab'
  );
  const archivedTab = sectionBetween(
    page,
    'function renderArchivedProjectsTab',
    'function renderEquipeTab'
  );

  assert.match(
    loadMoreRenderer,
    /appearance:\s*'design-system' \| 'legacy' = 'legacy'/
  );
  assert.match(loadMoreRenderer, /appearance === 'design-system'/);
  assert.match(loadMoreRenderer, /<Button\b/);
  assert.match(loadMoreRenderer, /className="mini-btn"/);
  assert.match(
    loadMoreRenderer,
    /reportListQuery\.isLoadingMore\s*\? 'Carregando\.\.\.'\s*: 'Carregar mais'/
  );

  assert.match(reportTabs, /renderLoadMoreReports\('design-system'\)/);
  assert.match(archivedTab, /renderLoadMoreReports\('design-system'\)/);
  assert.match(archivedTab, /appearance: 'design-system'/);
  assert.match(
    archivedTab,
    /renderReportTypeSections\(dialogProject\.projectReports, dialogProject\.project\.id, 'design-system'\)/
  );
  assert.doesNotMatch(archivedTab, /page-card|admin-stack|placeholder-copy/);
  assert.doesNotMatch(archivedTab, /mini-btn|primary-button|secondary-button/);
});

test('Arquivados reutiliza a grade de projetos e a listagem em cards sem mudar seus handlers', () => {
  const css = source('src/pages/gestor/GestorPage.ds.css');
  const grid = sectionBetween(css, '/* Desktop: the existing project card', '/* Archived tiles retain');
  const archived = sectionBetween(css, '/* Archived tiles retain', '/* A edição acontece dentro de um card');
  const dialogCss = source('src/pages/gestor/GestorArchivedReportsDialog.css');
  assert.match(grid, /\.rdo-archived-projects__list,/);
  assert.match(grid, /\.rdo-archived-projects__loading/);
  assert.match(grid, /repeat\(auto-fill, minmax\(min\(100%, 26rem\), 1fr\)\)/);
  assert.match(archived, /@media \(min-width: 1024px\)/);
  assert.match(archived, /container: rdo-archived-tile \/ inline-size/);
  assert.match(archived, /grid-template-areas: 'identity identity' 'reports quick-actions'/);
  assert.match(dialogCss, /\.rdo-manager-listing__actions \{\s*flex-wrap: nowrap;/);
  assert.match(dialogCss, /\.report-batch-select-all \.report-batch-action-label--full \{ display: inline; \}/);
  assert.match(archived, /\.rdo-archived-project-card__actions > \.fv-badge \{ grid-column: 1 \/ -1/);
  assert.doesNotMatch(archived, /grid-auto-flow:\s*(?:dense|column)|\.rdo-active-project-card/);
  const page = source('src/pages/gestor/GestorPage.tsx');
  const sections = sectionBetween(page, 'function renderReportTypeSections', 'function renderManualReportModal');
  assert.match(sections, /<ManagerReportListing[\s\S]*?layout="cards"/);
  const listing = source('src/components/reports/manager/ManagerReportListing.tsx');
  assert.match(listing, /layout = 'responsive'/);
  assert.match(listing, /layout=\{layout\}/);
});

test('Arquivados preserva queries, busca, agrupamento, paginação e handlers de projeto', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const archivedTab = sectionBetween(
    page,
    'function renderArchivedProjectsTab',
    'function renderEquipeTab'
  );
  const archivedTypeSections = sectionBetween(
    page,
    'function renderReportTypeSections',
    'function renderManualReportModal'
  );

  assert.match(
    page,
    /const archivedReportListQuery = useAccumulatedReportsPage\(\s*\{[\s\S]*?statuses: \['APPROVED', 'SIGNED'\],[\s\S]*?projectActive: false,[\s\S]*?search: debouncedGestorSearch,[\s\S]*?projectSort: projectSortDir,[\s\S]*?pageSize: REPORT_PAGE_SIZE[\s\S]*?\},\s*tab === 'arquivados'\s*\)/
  );
  assert.match(
    archivedTab,
    /\(archivedProjectsQuery\.data \|\| \[\]\)\.filter\(\(project\) => project\.isActive === false\)/
  );
  assert.match(archivedTab, /sortProjects\(archivedProjects, projectSortDir\)/);
  assert.match(
    archivedTab,
    /archivedReports\.filter\(\(report\) => report\.projectId === project\.id\)/
  );
  assert.match(
    archivedTab,
    /matchesSearch\(projectSearchParts\(project\), gestorSearch\)/
  );
  assert.match(
    archivedTab,
    /matchesSearch\(reportSearchParts\(report\), gestorSearch\)/
  );
  assert.match(archivedTab, /project\.id === archivedReportsProjectId/);
  assert.match(archivedTab, /onToggleArchive: handleProjectToggleArchive/);
  assert.match(archivedTab, /onRemove: setRemoveProjectTarget/);
  assert.match(archivedTab, /onToggleDetails: toggleProjectDetails/);
  assert.match(
    archivedTab,
    /onOpenReports: openArchivedReports/
  );
  assert.match(archivedTab, /onSendSurvey: handleSendSurvey/);
  assert.match(archivedTab, /onResendSurvey: handleResendSurvey/);
  assert.match(archivedTab, /segments: projectSegmentsQuery\.data/);

  assert.match(
    archivedTypeSections,
    /reportListQuery\.projectTypeTotals\(projectId\)/
  );
  assert.match(archivedTypeSections, /reportListQuery\.groupLoadedCount\(/);
  assert.match(archivedTypeSections, /reportListQuery\.isGroupPageReady\(/);
  assert.match(archivedTypeSections, /reportListQuery\.isGroupError\(/);
  assert.match(archivedTypeSections, /reportListQuery\.isGroupLoading\(/);
  assert.match(archivedTypeSections, /revealMoreArchivedType\(/);
  assert.match(archivedTypeSections, /handleLoadMoreArchivedType\(/);
  assert.match(archivedTypeSections, /<InfiniteScrollSentinel/);
  assert.match(archivedTypeSections, /<ManagerReportListing/);
  assert.match(
    archivedTypeSections,
    /renderBatchReportActions\(visibleReports, true\)/
  );
  assert.doesNotMatch(archivedTab, /renderArchivedBatchActions/);
  assert.doesNotMatch(archivedTab, /reportSelection:\s*\{/);
  assert.match(
    archivedTypeSections,
    /renderManagerReportActions\(report, true\)/
  );
});

test('Arquivados abre um único diálogo DS sob demanda sem expandir os cards', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const tab = sectionBetween(page, 'function renderArchivedProjectsTab', 'function renderEquipeTab');
  const cardOptions = sectionBetween(tab, 'return renderProjectCard', 'segments: projectSegmentsQuery.data');
  assert.doesNotMatch(cardOptions, /children:|reportSectionExpanded:|onToggleReports:/);
  assert.match(cardOptions, /onOpenReports: openArchivedReports/);
  assert.equal((tab.match(/<Modal\b/g) || []).length, 1);
  assert.match(tab, /open=\{Boolean\(dialogProject\)\}/);
  assert.match(tab, /onClose=\{closeArchivedReports\}/);
  assert.match(tab, /appearance="design-system"/);
  assert.match(tab, /fullscreenOnMobile=\{false\}/);
  assert.match(tab, /title="Relatórios do projeto"/);
  assert.match(tab, /ariaDescribedBy="archived-reports-project-context"/);
  assert.match(tab, /renderReportTypeSections\(dialogProject\.projectReports, dialogProject\.project\.id, 'design-system'\)/);
  assert.match(page, /if \(tab !== 'arquivados' \|\| !archivedReportsProjectId\) return/);
  assert.match(page, /ensureGroupPage\(\{\s*projectId: archivedReportsProjectId/);
  assert.match(page, /function openArchivedReports\(project: Project\) \{\s*setSelectedReportIds\(\[\]\);\s*setArchivedReportsProjectId\(project.id\)/);
  assert.match(page, /function closeArchivedReports\(\) \{\s*setArchivedReportsProjectId\(null\);\s*setSelectedReportIds\(\[\]\)/);
  assert.doesNotMatch(page, /initiallyExpandedProject|function toggleArchivedProject/);
  assert.match(page, /footer=\{activeProject \|\| reportsInDialog \|\| options.reportSectionExpanded/);
  assert.match(page, /function renderReportSequenceDialog\(\)/);
  assert.match(page, /\{renderReportSequenceDialog\(\)\}/);
  const css = source('src/pages/gestor/GestorArchivedReportsDialog.css');
  assert.match(css, /\.rdo-archived-reports-dialog-backdrop \{\s*align-items: center;\s*padding: var\(--space-4\)/);
  assert.match(css, /\.rdo-manager-listing__mobile-title \{\s*color: var\(--ink\)/);
  assert.doesNotMatch(css, /#[a-f\d]{3,8}\b|rgba?\(|!important/i);
});

test('Arquivados compõe primitives responsivos e mantém o opt-in restrito', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const projectCard = sectionBetween(
    page,
    'function renderProjectCard',
    'export function GestorPage'
  );
  const archivedTypeSections = sectionBetween(
    page,
    'function renderReportTypeSections',
    'function renderManualReportModal'
  );
  const archivedTab = sectionBetween(
    page,
    'function renderArchivedProjectsTab',
    'function renderEquipeTab'
  );
  const search = sectionBetween(
    page,
    'function renderGestorSearch',
    'function renderEstatisticasTab'
  );
  const css = source('src/pages/gestor/GestorPage.ds.css');
  const cssStart = css.indexOf('Projetos arquivados');
  const cssEnd = css.indexOf('RDO B.11', cssStart);

  assert.match(projectCard, /appearance\?: 'legacy' \| 'design-system'/);
  assert.match(projectCard, /if \(options\.appearance === 'design-system'\)/);
  assert.match(projectCard, /<Card[\s\S]*?rdo-archived-project-card/);
  assert.match(projectCard, /<Badge\b/);
  assert.match(projectCard, /<StatusPill\b/);
  assert.doesNotMatch(projectCard, /Apto para restaurar/);
  assert.match(projectCard, /<Alert\b/);
  assert.match(projectCard, /<Button\b/);
  assert.match(projectCard, /aria-expanded=\{reportsInDialog \? undefined : options\.reportSectionExpanded\}/);
  assert.match(projectCard, /aria-expanded=\{options\.detailsExpanded\}/);
  assert.doesNotMatch(projectCard, /reportSelection/);
  assert.doesNotMatch(projectCard, /<Badge tone="brand">RDO<\/Badge>/);
  assert.match(
    projectCard,
    /className="rdo-archived-project-card__reports-toggle"[\s\S]*?>\s*Relatórios\s*<\/Button>/
  );
  assert.match(
    projectCard,
    /className="rdo-project-card__title-toggle"[\s\S]*?aria-haspopup=\{reportsInDialog \? 'dialog' : undefined\}[\s\S]*?onClick=\{handleReports\}/
  );
  assert.match(projectCard, /<dl>[\s\S]*?<dt>[\s\S]*?<dd>/);
  assert.match(projectCard, /className=\{`card admin-card project-admin-card/);

  assert.match(
    archivedTypeSections,
    /appearance: 'legacy' \| 'design-system' = 'legacy'/
  );
  assert.match(archivedTypeSections, /<ManagerReportListing/);
  assert.match(
    archivedTypeSections,
    /<ReportTypeBadge reportType=\{reportType\} \/>/
  );
  assert.match(archivedTypeSections, /<Skeleton\b/);
  assert.match(archivedTypeSections, /<EmptyState\b/);
  assert.match(archivedTypeSections, /<ManagerReportTypeSortButton\b/);
  assert.doesNotMatch(archivedTypeSections, /DS_ICONS\.sort(?:Ascending|Descending)/);
  assert.match(archivedTypeSections, /aria-controls=\{typeContentId\}/);
  assert.match(archivedTypeSections, /aria-expanded=\{!typeClosed\}/);
  assert.match(
    archivedTypeSections,
    /rdo-archived-report-type__content[\s\S]*?renderBatchReportActions\(visibleReports, true\)[\s\S]*?<ManagerReportListing/
  );

  assert.match(archivedTab, /<Skeleton\b/);
  assert.match(archivedTab, /<EmptyState\b/);
  assert.match(archivedTab, /if \(reportListQuery\.isError\)/);
  assert.doesNotMatch(archivedTab, /renderArchivedBatchActions/);
  assert.match(
    search,
    /reportListingTab \|\| projectsTab \|\| archivedProjectsTab \|\| adminTab/
  );
  assert.match(search, /<FilterBar[\s\S]*?<SearchInput/);
  assert.match(page, /const archivedProjectsTab = tab === 'arquivados'/);
  assert.match(page, /title="Arquivados"/);
  assert.match(page, /label="Projetos arquivados"/);
  assert.match(page, /label="Relatórios arquivados"/);

  assert.ok(cssStart >= 0, 'bloco CSS de Arquivados ausente');
  assert.ok(cssEnd > cssStart, 'limite do bloco CSS de Arquivados ausente');
  const archivedCss = css.slice(cssStart, cssEnd);
  assert.match(archivedCss, /:where\(\.fv-ds, \[data-fv-ds\]\)/);
  assert.match(archivedCss, /var\(--/);
  assert.match(archivedCss, /@media \(min-width: 768px\)/);
  assert.match(archivedCss, /@media \(max-width: 480px\)/);
  assert.match(
    archivedCss,
    /grid-template-areas:\s*'identity identity'\s*'reports quick-actions'/
  );
  assert.match(
    archivedCss,
    /> \.fv-card__actions\s*\{[\s\S]*?grid-area:\s*quick-actions[\s\S]*?justify-self:\s*end;[\s\S]*?overflow:\s*visible/
  );
  assert.match(
    archivedCss,
    /\.rdo-archived-project-card__reports-toggle\s*\{[\s\S]*?grid-area:\s*reports;[\s\S]*?justify-self:\s*start;/
  );
  assert.doesNotMatch(archivedCss, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(archivedCss, /\brgba?\(/i);
  assert.doesNotMatch(archivedCss, /!important/);
});

test('consumidores compartilhados de GroupedReportList fazem opt-in no Design System', () => {
  for (const path of [
    'src/pages/coordinator/CoordinatorPage.tsx',
    'src/pages/collaborator/MyReportsPage.tsx',
    'src/pages/collaborator/MyArchivedReportsPage.tsx'
  ]) {
    const page = source(path);

    assert.match(page, /<GroupedReportList\b/, path);
    assert.match(page, /appearance="design-system"/, path);
  }
});
