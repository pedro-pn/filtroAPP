import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import { createServer } from 'vite';
import { withRdoCompanions } from './rdo-source.mjs';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => withRdoCompanions(path, candidate => readFileSync(join(frontendRoot, candidate), 'utf8'));

let viteServer;

before(async () => {
  viteServer = await createServer({
    configFile: false,
    root: frontendRoot,
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
});

after(async () => {
  await viteServer?.close();
});

function loadModule(path) {
  return viteServer.ssrLoadModule(path);
}

function rdoUser(role, accountType, moduleRole) {
  return {
    id: `baseline-${role.toLowerCase()}`,
    username: `baseline-${role.toLowerCase()}`,
    name: role,
    email: null,
    role,
    accountType,
    moduleRoles: moduleRole ? [moduleRole] : [],
    isActive: true
  };
}

test('RDO registry keeps every canonical and legacy route unchanged', async () => {
  const { moduleRoutePath } = await loadModule('/src/modules/registry.ts');
  const canonicalRoutes = {
    root: '/rdo',
    newReport: '/rdo/relatorio/novo',
    newReportsAlias: '/rdo/relatorios/novo',
    reportDetail: '/rdo/relatorios/:id',
    collaboratorHome: '/rdo/home',
    ongoingServices: '/rdo/andamento',
    myReports: '/rdo/meus-relatorios',
    myArchivedReports: '/rdo/meus-relatorios/arquivados',
    managerHome: '/rdo/gestor',
    managerReportDetail: '/rdo/gestor/relatorio/:id',
    coordinatorHome: '/rdo/coordenador',
    coordinatorReportDetail: '/rdo/coordenador/relatorio/:id',
    clientHome: '/rdo/cliente',
    clientReportDetail: '/rdo/cliente/relatorio/:id'
  };
  const legacyRoutes = {
    newReport: '/relatorio/novo',
    newReportsAlias: '/relatorios/novo',
    reportDetail: '/relatorios/:id',
    collaboratorHome: '/home',
    ongoingServices: '/andamento',
    myReports: '/meus-relatorios',
    myArchivedReports: '/meus-relatorios/arquivados',
    managerHome: '/gestor',
    managerReportDetail: '/gestor/relatorio/:id',
    coordinatorHome: '/coordenador',
    coordinatorReportDetail: '/coordenador/relatorio/:id',
    clientHome: '/cliente',
    clientReportDetail: '/cliente/relatorio/:id'
  };

  for (const [routeKey, path] of Object.entries(canonicalRoutes)) {
    assert.equal(moduleRoutePath('rdo', routeKey), path);
  }
  for (const [routeKey, path] of Object.entries(legacyRoutes)) {
    assert.equal(moduleRoutePath('rdo', routeKey, { legacy: true }), path);
  }
});

test('RDO access requires the matching legacy role and module role for each profile', async () => {
  const { isRouteAllowed } = await loadModule('/src/auth/routeAccess.ts');
  const { moduleRouteAccess } = await loadModule('/src/modules/registry.ts');
  const profiles = [
    {
      group: 'collaborator',
      user: rdoUser('COLLABORATOR', 'INTERNAL', 'rdo:collaborator')
    },
    {
      group: 'coordinator',
      user: rdoUser('COORDINATOR', 'INTERNAL', 'rdo:coordinator')
    },
    {
      group: 'manager',
      user: rdoUser('MANAGER', 'ADMIN', 'rdo:manager')
    },
    {
      group: 'client',
      user: rdoUser('CLIENT', 'CLIENT', 'rdo:client')
    }
  ];

  for (const profile of profiles) {
    const access = moduleRouteAccess('rdo', profile.group);
    assert.equal(
      isRouteAllowed(profile.user, access),
      true,
      `${profile.group} should be allowed`
    );
    assert.equal(
      isRouteAllowed({ ...profile.user, moduleRoles: [] }, access),
      false,
      `${profile.group} without its module role should be denied`
    );
    assert.equal(
      isRouteAllowed({ ...profile.user, role: 'COLLABORATOR' }, access),
      profile.group === 'collaborator',
      `${profile.group} should still require its legacy role`
    );
  }

  const reportWriteAccess = moduleRouteAccess('rdo', 'reportWrite');
  assert.equal(isRouteAllowed(profiles[0].user, reportWriteAccess), true);
  assert.equal(isRouteAllowed(profiles[1].user, reportWriteAccess), true);
  assert.equal(isRouteAllowed(profiles[2].user, reportWriteAccess), true);
  assert.equal(isRouteAllowed(profiles[3].user, reportWriteAccess), false);
});

test('RDO redirects and detail navigation remain profile-aware', async () => {
  const { modulePathForUser } = await loadModule(
    '/src/auth/moduleNavigation.ts'
  );
  const { rdoPath, rdoReportDetailPath, roleHomePath } = await loadModule(
    '/src/auth/rolePath.ts'
  );
  const profiles = [
    [
      rdoUser('COLLABORATOR', 'INTERNAL', 'rdo:collaborator'),
      '/rdo/home',
      '/rdo/relatorios/report-1'
    ],
    [
      rdoUser('COORDINATOR', 'INTERNAL', 'rdo:coordinator'),
      '/rdo/coordenador',
      '/rdo/coordenador/relatorio/report-1'
    ],
    [
      rdoUser('MANAGER', 'ADMIN', 'rdo:manager'),
      '/rdo/gestor',
      '/rdo/gestor/relatorio/report-1'
    ],
    [
      rdoUser('CLIENT', 'CLIENT', 'rdo:client'),
      '/rdo/cliente',
      '/rdo/cliente/relatorio/report-1'
    ]
  ];

  for (const [user, homePath, detailPath] of profiles) {
    assert.equal(roleHomePath(user.role), homePath);
    assert.equal(rdoReportDetailPath(user, 'report-1'), detailPath);
    if (user.role !== 'CLIENT')
      assert.equal(modulePathForUser(user, 'rdo'), homePath);
  }

  assert.equal(rdoPath(), '/rdo');
  assert.equal(rdoPath('andamento'), '/rdo/andamento');
});

test('App keeps RDO route groups, aliases, public signature routes and replace redirects wired', () => {
  const app = source('src/App.tsx');
  const routeKeys = [
    'root',
    'newReport',
    'newReportsAlias',
    'reportDetail',
    'collaboratorHome',
    'ongoingServices',
    'myReports',
    'myArchivedReports',
    'managerHome',
    'managerReportDetail',
    'coordinatorHome',
    'coordinatorReportDetail',
    'clientHome',
    'clientReportDetail'
  ];

  for (const accessName of [
    'RDO_REPORT_WRITE_ACCESS',
    'RDO_COLLABORATOR_ACCESS',
    'RDO_MANAGER_ACCESS',
    'RDO_COORDINATOR_ACCESS',
    'RDO_CLIENT_ACCESS'
  ]) {
    assert.match(app, new RegExp(`<RoleRoute \\{\\.\\.\\.${accessName}\\}`));
  }
  for (const routeKey of routeKeys) {
    assert.match(app, new RegExp(`moduleRoutePath\\('rdo', '${routeKey}'`));
  }
  for (const routeKey of routeKeys.filter((key) => key !== 'root')) {
    assert.match(
      app,
      new RegExp(
        `moduleRoutePath\\('rdo', '${routeKey}', \\{\\s*legacy: true\\s*\\}\\)`
      )
    );
  }

  assert.match(
    app,
    /<Route path="\/assinar\/:token" element=\{<PublicSignaturePage \/>\} \/>/
  );
  assert.match(
    app,
    /<Route path="\/validar-assinatura\/:validationCode" element=\{<SignatureValidationPage \/>\} \/>/
  );
  assert.match(
    app,
    /modulePathForUser\(user, 'rdo'\) \|\| preferredEntryPath\(user\)/
  );
  assert.match(
    app,
    /<Navigate to=\{modulePathForUser\(user, 'rdo'\) \|\| preferredEntryPath\(user\)\} replace \/>/
  );
});

test('collaborator report listing keeps tabs, filters, search, selection and incremental loading contracts', () => {
  const page = source('src/pages/collaborator/MyReportsPage.tsx');

  assert.match(
    page,
    /const MY_REPORTS_TABS: MyReportsTab\[\] = \['pending', 'approved'\]/
  );
  assert.match(page, /useUrlParamState<MyReportsTab>/);
  assert.match(page, /param: 'tab',[\s\S]*defaultValue: 'pending'/);
  assert.match(page, /my-reports-search:[^`]+:\$\{tab\}/);
  assert.match(page, /useDebouncedValue\(search, 300\)/);
  assert.match(
    page,
    /mine: true,[\s\S]*projectActive: true,[\s\S]*statuses: \['PENDING', 'RETURNED'\]/
  );
  assert.match(page, /statuses: \['APPROVED', 'SIGNED'\]/);
  assert.match(page, /pageSize: REPORT_PAGE_SIZE/);
  assert.match(
    page,
    /setProjectSortDir\(direction => direction === 'asc' \? 'desc' : 'asc'\)/
  );
  assert.match(page, /useState<string\[\]>\(\[\]\)/);
  assert.match(
    page,
    /storageKey=\{`collaborator-report-groups:[^`]+:\$\{tab\}`\}/
  );
  assert.match(page, /<ReportPdfBatchActions/);
  assert.match(page, /<ReportSelectionCheckbox/);
  assert.match(
    page,
    /useInfiniteScrollSentinel\(\{[\s\S]*onLoadMore: reportsQuery\.loadMore/
  );
  assert.match(page, /onClick=\{reportsQuery\.loadMore\}/);
  assert.match(page, /reportsQuery\.isLoading \? <ReportListSkeleton \/>/);
  assert.match(page, /Nenhum relatório pendente encontrado/);
  assert.match(page, /Nenhum relatório aprovado encontrado/);
});

test('collaborator home and ongoing-services actions keep their current data and navigation contracts', () => {
  const home = source('src/pages/collaborator/HomePage.tsx');
  const ongoing = source('src/pages/collaborator/OngoingServicesPage.tsx');

  assert.match(home, /useDrafts\(\)/);
  assert.match(home, /useReports\(\{ mine: true, summary: true \}\)/);
  assert.match(home, /collectOngoingServices\(reportsQuery\.data \|\| \[\]\)/);
  assert.match(home, /hydrate\(\{/);
  assert.match(home, /navigate\(rdoPath\('\/relatorio\/novo'\)\)/);
  assert.match(home, /navigate\(rdoPath\('\/meus-relatorios'\)\)/);
  assert.match(home, /navigate\(rdoPath\('\/andamento'\)\)/);
  assert.match(home, /aria-disabled=\{!ongoingServices\.length\}/);
  assert.match(home, /onClick=\{ongoingServices\.length \? \(\) => navigate\(rdoPath\('\/andamento'\)\) : undefined\}/);
  assert.match(home, /draftMutations\.removeDraft\.mutate\(draft\.id\)/);

  assert.match(ongoing, /useReports\(\{ mine: true, summary: true \}\)/);
  assert.match(ongoing, /<SearchInput value=\{search\} onChange=\{setSearch\}/);
  assert.match(ongoing, /matchesSearch\(\[/);
  assert.match(ongoing, /Carregando serviços em andamento/);
  assert.match(ongoing, /Nenhum serviço em andamento encontrado/);
  assert.match(ongoing, /<ConfirmDialog/);
  assert.match(ongoing, /title="Excluir serviço em andamento\?"/);
  assert.match(ongoing, /onConfirm=\{\(\) => deleteTarget && void handleDeleteService/);
  assert.match(
    ongoing,
    /reportMutations\.deleteService\.mutateAsync\(\{ reportId, serviceId \}\)/
  );
});

test('new report keeps the existing server-backed autosave contract', () => {
  const page = source('src/pages/collaborator/NewReportPage.tsx');

  assert.match(
    page,
    /if \(!projectId \|\| !reportDate\) \{[\s\S]*return true;/
  );
  assert.match(
    page,
    /const targetId = autosaveDraftTargetId\(draftId, sameProjectDateIds\)/
  );
  assert.match(
    page,
    /targetId[\s\S]*updateDraftAsync\(\{ id: targetId, payload \}\)[\s\S]*createDraftAsync\(payload\)/
  );
  assert.match(
    page,
    /sameProjectDateIds[\s\S]*filter\(\(?id\)? => id !== saved\.id\)[\s\S]*removeDraftAsync\(id\)/
  );
  assert.match(
    page,
    /draftSaveTimerRef\.current = window\.setTimeout\(\(\) => \{[\s\S]*void saveDraftNow\(\);[\s\S]*\}, 150\)/
  );
  assert.match(
    page,
    /const saved = await saveDraftNow\(\{ notifyOnError: true \}\)/
  );
  assert.match(page, /if \(saved\) navigate\(backPath\)/);
});

test('coordinator, manager and client tabs keep their current query filters and paging sizes', () => {
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const managerSections = source(
    'src/pages/gestor/rdoSectionNavigationModel.ts'
  );
  const client = source('src/pages/client/ClientPage.tsx');

  assert.match(
    coordinator,
    /\['pending', 'approved', 'archived', 'nps', 'estatisticas', 'dds'\]/
  );
  assert.match(coordinator, /const REPORT_PAGE_SIZE = 50/);
  assert.match(coordinator, /const REPORT_TYPE_PAGE_SIZE = 10/);
  assert.match(
    coordinator,
    /statuses: \['PENDING', 'RETURNED'\],[\s\S]*createdByUserId: user\?\.id \|\| ''/
  );
  assert.match(
    coordinator,
    /statuses: \['APPROVED', 'SIGNED'\],[\s\S]*projectActive: false/
  );
  assert.match(
    coordinator,
    /coordinator-search:\$\{user\?\.id \|\| 'anonymous'\}:\$\{tab\}/
  );

  for (const tab of [
    'pendentes',
    'aprovados',
    'arquivados',
    'projetos',
    'equipe',
    'usuarios',
    'nps',
    'estatisticas'
  ]) {
    assert.match(managerSections, new RegExp(`'${tab}'`));
  }
  assert.match(manager, /const REPORT_PAGE_SIZE = 50/);
  assert.match(manager, /const REPORT_TYPE_PAGE_SIZE = 10/);
  assert.match(manager, /reviewQueue: true,[\s\S]*projectActive: true/);
  assert.match(
    manager,
    /statuses: \['APPROVED', 'SIGNED'\],[\s\S]*projectActive: false/
  );
  assert.match(
    manager,
    /gestor-search:\$\{user\?\.id \|\| 'anonymous'\}:\$\{tab\}/
  );

  assert.match(client, /const REPORT_PAGE_SIZE = 30/);
  assert.match(client, /const REPORT_TYPE_VISIBLE_STEP = 10/);
  assert.match(client, /const CLIENT_REPORT_REFRESH_MS = 15_000/);
  assert.match(client, /refetchInterval: CLIENT_REPORT_REFRESH_MS/);
  assert.match(
    client,
    /client-search:\$\{user\?\.id \|\| user\?\.username \|\| 'anonymous'\}/
  );
  assert.match(client, /aria-label="Projetos do cliente"/);
  assert.match(client, /aria-label="Tipos de relatório"/);
  assert.match(
    client,
    /setSelectedIds\(\[\]\);[\s\S]*\[activeProjectId, activeReportType, clientSearch\]/
  );
});

test('incremental report loading keeps lazy ensure, skeleton, error and retry states', () => {
  const groupedList = source('src/components/reports/GroupedReportList.tsx');
  const reportHooks = source('src/hooks/useReports.ts');
  const baseCss = source('src/styles/base.css');

  assert.match(groupedList, /new IntersectionObserver/);
  assert.match(groupedList, /rootMargin = '400px'/);
  assert.match(groupedList, /<LazyTypeEnsure/);
  assert.match(groupedList, /report-type-skeleton/);
  assert.match(
    baseCss,
    /\.skeleton\s*\{[^}]*var\(--surface-2\)[^}]*var\(--skeleton-highlight\)[^}]*var\(--surface-2\)/
  );
  assert.doesNotMatch(
    baseCss,
    /\.skeleton\s*\{[^}]*#[\da-f]{3,8}\b[^}]*\}/i
  );
  assert.match(
    groupedList,
    /Não foi possível carregar os relatórios desta aba/
  );
  assert.match(
    groupedList,
    /typeErrored \? 'Tentar novamente' : 'Carregar mais'/
  );
  assert.match(groupedList, /typeLoading \? 'Carregando\.\.\.'/);
  assert.match(groupedList, /<InfiniteScrollSentinel/);
  assert.match(
    reportHooks,
    /function loadMore\(\)[\s\S]*setPage\(current => Math\.min\(pagination\.totalPages, current \+ 1\)\)/
  );
  assert.match(reportHooks, /async function loadMoreGroup/);
  assert.match(reportHooks, /async function ensureGroupPage/);
  assert.match(
    reportHooks,
    /isLoadingInitial: query\.isLoading && items\.length === 0/
  );
  assert.match(
    reportHooks,
    /isLoadingMore: query\.isFetching && items\.length > 0/
  );
});

test('batch selection keeps off-group ids while selecting or clearing visible reports', () => {
  const batchActions = source(
    'src/components/reports/ReportPdfBatchActions.tsx'
  );

  assert.match(
    batchActions,
    /selectedVisibleIds = selectedIds\.filter\(id => visibleIds\.includes\(id\)\)/
  );
  assert.match(
    batchActions,
    /Array\.from\(new Set\(\[\.\.\.selectedIds, \.\.\.visibleIds\]\)\)/
  );
  assert.match(
    batchActions,
    /selectedIds\.filter\(id => !visibleIds\.includes\(id\)\)/
  );
  assert.match(
    batchActions,
    /downloadReportsBatch\(selectedVisibleIds, 'pdf'\)/
  );
  assert.match(batchActions, /checked=\{selectedIds\.includes\(reportId\)\}/);
  assert.match(
    batchActions,
    /Array\.from\(new Set\(\[\.\.\.selectedIds, reportId\]\)\)/
  );
  assert.match(batchActions, /selectedIds\.filter\(id => id !== reportId\)/);
});

test('report cards preserve scroll state and role-aware detail navigation', () => {
  const reportCard = source('src/components/reports/ReportSummaryCard.tsx');
  const client = source('src/pages/client/ClientPage.tsx');

  for (const page of [reportCard, client]) {
    assert.match(
      page,
      /saveCurrentPageScroll\(location, user\?\.id \|\| user\?\.username \|\| 'anonymous'\)/
    );
    assert.match(page, /navigate\(rdoReportDetailPath\(user, report\.id\), \{/);
    assert.match(page, /navigationStateFromLocation\(location\)/);
    assert.match(page, /currentPageScrollState\(\)/);
  }
});

test('report actions remain connected to the existing API mutations and downloads', () => {
  const detail = source('src/pages/ReportDetailPage.tsx');
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const client = source('src/pages/client/ClientPage.tsx');
  const batchActions = source(
    'src/components/reports/ReportPdfBatchActions.tsx'
  );

  for (const action of [
    'reportMutations.updateStatus.mutateAsync',
    'reportMutations.updateSequence.mutateAsync',
    'reportMutations.requestSignature.mutateAsync',
    'reportMutations.clientReview.mutateAsync',
    'downloadReportPdf',
    'downloadReportDocx'
  ]) {
    assert.match(detail, new RegExp(action.replaceAll('.', '\\.')));
  }
  assert.match(manager, /reportMutations\.deleteReport\.mutateAsync/);
  assert.match(manager, /downloadReportsBatch\(ids, format\)/);
  assert.match(client, /downloadReportsBatch\(ids, 'pdf'\)/);
  assert.match(client, /reportMutations\.requestSignature\.mutateAsync/);
  assert.match(client, /reportMutations\.clientReview\.mutateAsync/);
  assert.match(
    batchActions,
    /downloadReportsBatch\(selectedVisibleIds, 'pdf'\)/
  );
});

test('authenticated RDO pages keep awaiting logout before their current replace navigation', () => {
  const roleShell = source('src/pages/RdoAppShell.tsx');
  assert.match(roleShell, /await logout\(\)/);
  assert.match(roleShell, /navigate\('\/', \{ replace: true \}\)/);

  const pageDestinations = new Map([
    ['src/pages/collaborator/NewReportPage.tsx', '/login'],
    ['src/pages/gestor/GestorPage.tsx', '/'],
    ['src/pages/ReportDetailPage.tsx', '/']
  ]);

  for (const [path, destination] of pageDestinations) {
    const page = source(path);
    assert.match(page, /await logout\(\)/, `${path} should await logout`);
    assert.match(
      page,
      new RegExp(`navigate\\('${destination}', \\{ replace: true \\}\\)`),
      `${path} should preserve its current logout destination`
    );
  }
});
