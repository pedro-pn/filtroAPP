import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withRdoCompanions } from './rdo-source.mjs';

const source = (path) =>
  withRdoCompanions(path, candidate => readFileSync(new URL(`../${candidate}`, import.meta.url), 'utf8'));

function assertIncludesAll(actual, expected, context) {
  for (const value of expected) {
    assert.ok(actual.includes(value), `${context}: contrato ausente: ${value}`);
  }
}

function loadProjectSortModule() {
  return import(new URL('../src/utils/projectSort.ts', import.meta.url));
}

test('buscas do RDO persistem por usuário e aba somente na sessão', () => {
  const hook = source('src/hooks/usePersistentSearch.ts');
  const collaborator = source('src/pages/collaborator/MyReportsPage.tsx');
  const archived = source('src/pages/collaborator/MyArchivedReportsPage.tsx');
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const client = source('src/pages/client/ClientPage.tsx');

  assertIncludesAll(
    hook,
    [
      'window.sessionStorage.getItem(key)',
      'window.sessionStorage.setItem(key, value)',
      'window.sessionStorage.removeItem(key)',
      'readPersistentSearch(storageKey)',
      'setPersistentSearchValue(storageKey, value)'
    ],
    'usePersistentSearch'
  );
  assert.ok(!hook.includes('localStorage'));

  assert.ok(
    collaborator.includes(
      "`my-reports-search:${user?.id || user?.username || 'anonymous'}:${tab}`"
    )
  );
  assert.ok(
    archived.includes(
      "`my-archived-search:${user?.id || user?.username || 'anonymous'}`"
    )
  );
  assert.ok(
    coordinator.includes(
      "`coordinator-search:${user?.id || 'anonymous'}:${tab}`"
    )
  );
  assert.ok(
    manager.includes("`gestor-search:${user?.id || 'anonymous'}:${tab}`")
  );
  assert.ok(
    client.includes(
      "`client-search:${user?.id || user?.username || 'anonymous'}`"
    )
  );

  for (const page of [manager, client]) {
    assert.ok(page.includes('useDebouncedValue('));
    assert.ok(page.includes(', 300)'));
  }
  const reportsHook = source('src/hooks/useReports.ts');
  assert.match(reportsHook, /useDebouncedValue\(search, 200\)/);
});

test('snapshot da lista agrupada preserva expansão, quantidade e ordenação por tipo', () => {
  const groupedList = source('src/components/reports/GroupedReportList.tsx');

  assertIncludesAll(
    groupedList,
    [
      'closedProjects: string[]',
      'closedTypes: string[]',
      'visibleByType: Record<string, number>',
      'typeSortDirections: Record<string, ProjectSortDirection>',
      'const groupedReportListSnapshots = new Map<string, GroupedReportListStorage>()',
      'groupedReportListSnapshots.get(storageKey)',
      'localStorage.getItem(storageKey)',
      'localStorage.setItem(storageKey, JSON.stringify(snapshot))',
      'initialVisiblePerType = 10',
      'loadMoreStep = 10',
      'Math.min(total, (current[typeKey] || initialVisiblePerType) + loadMoreStep)'
    ],
    'GroupedReportList'
  );
});

test('chaves dos grupos permanecem isoladas por papel, usuário e aba', () => {
  const contracts = [
    [
      'src/pages/collaborator/MyReportsPage.tsx',
      "`collaborator-report-groups:${user?.id || user?.username || 'anonymous'}:${tab}`"
    ],
    [
      'src/pages/collaborator/MyArchivedReportsPage.tsx',
      "`collaborator-archived-report-groups:${user?.id || user?.username || 'anonymous'}`"
    ],
    [
      'src/pages/coordinator/CoordinatorPage.tsx',
      "`coordinator-report-groups:${user?.id || user?.username || 'anonymous'}:${tab}`"
    ],
    [
      'src/pages/gestor/GestorPage.tsx',
      "`gestor-report-groups:${user?.id || user?.username || 'anonymous'}:${tab}`"
    ]
  ];

  for (const [file, storageKey] of contracts) {
    assert.ok(source(file).includes(storageKey), `${file}: ${storageKey}`);
  }
});

test('snapshot acumulado mantém versão, TTL, itens e janelas carregadas na sessão', () => {
  const reportsHook = source('src/hooks/useReports.ts');

  assertIncludesAll(
    reportsHook,
    [
      'version: 2',
      'savedAt: number',
      'page: number',
      'items: ReportSummary[]',
      'groupLoadedCounts: Record<string, number>',
      'groupTotals: Record<string, number>',
      'const ACCUMULATED_REPORTS_STORAGE_VERSION = 2',
      'const ACCUMULATED_REPORTS_STORAGE_TTL_MS = 30 * 60 * 1000',
      "`accumulated-reports:${userId || 'anonymous'}:${encodeURIComponent(filtersKey)}`",
      'window.sessionStorage.getItem(storageKey)',
      'window.sessionStorage.setItem(storageKey, JSON.stringify(nextSnapshot))',
      'window.sessionStorage.removeItem(storageKey)'
    ],
    'useReports'
  );
});

test('quantidade carregada é segmentada por projeto, tipo, tamanho e direção', () => {
  const reportsHook = source('src/hooks/useReports.ts');
  const groupedList = source('src/components/reports/GroupedReportList.tsx');
  const collaborator = source('src/pages/collaborator/MyReportsPage.tsx');
  const archived = source('src/pages/collaborator/MyArchivedReportsPage.tsx');
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const client = source('src/pages/client/ClientPage.tsx');

  assertIncludesAll(
    reportsHook,
    [
      "return `${projectId}-${reportType}-${pageSize}-${sortDirection || 'asc'}`",
      'Math.min(data.pagination.total, ((page - 1) * pageSize) + data.items.length)',
      'const nextGroupPage = Math.floor(loadedWindow / groupPageSize) + 1',
      'return loadedCount < knownTotal',
      "reportSort: sortDirection || 'asc'"
    ],
    'useReports'
  );
  assert.ok(
    groupedList.includes('{visibleReports.length} de {totalReports} relatório')
  );
  assert.ok(collaborator.includes('const REPORT_PAGE_SIZE = 25'));
  assert.ok(archived.includes('const REPORT_PAGE_SIZE = 25'));
  assert.ok(coordinator.includes('const REPORT_PAGE_SIZE = 50'));
  assert.ok(coordinator.includes('const REPORT_TYPE_PAGE_SIZE = 10'));
  assert.ok(manager.includes('const REPORT_PAGE_SIZE = 50'));
  assert.ok(manager.includes('const REPORT_TYPE_PAGE_SIZE = 10'));
  assert.ok(client.includes('const REPORT_PAGE_SIZE = 30'));
  assert.ok(client.includes('const REPORT_TYPE_VISIBLE_STEP = 10'));
});

test('ordenação atual mantém ordem de tipos, projetos numéricos e sequência dos RDOs', async () => {
  const { compareReportTypes, sortReportsByProject, sortReportsInGroup } =
    await loadProjectSortModule();

  assert.deepEqual(
    ['Outro 10', 'RLF', 'RDO', 'RTP', 'RCPU'].sort(compareReportTypes),
    ['RDO', 'RTP', 'RCPU', 'RLF', 'Outro 10']
  );

  const reports = [
    {
      id: 'rdo-10',
      reportType: 'RDO',
      sequenceNumber: 10,
      reportDate: '2026-08-10',
      createdAt: '2026-08-10T12:00:00Z',
      project: { code: '10', name: 'Projeto 10' }
    },
    {
      id: 'rdo-2',
      reportType: 'RDO',
      sequenceNumber: 2,
      reportDate: '2026-08-11',
      createdAt: '2026-08-11T12:00:00Z',
      project: { code: '2', name: 'Projeto 2' }
    }
  ];

  assert.deepEqual(
    sortReportsByProject(reports, 'asc').map((report) => report.id),
    ['rdo-2', 'rdo-10']
  );
  assert.deepEqual(
    sortReportsInGroup(reports, 'asc').map((report) => report.id),
    ['rdo-2', 'rdo-10']
  );
  assert.deepEqual(
    sortReportsInGroup(reports, 'desc').map((report) => report.id),
    ['rdo-10', 'rdo-2']
  );
});

test('abas do cliente restauram projeto, tipo, recolhimento e ordenação', () => {
  const client = source('src/pages/client/ClientPage.tsx');

  assertIncludesAll(
    client,
    [
      '`filtrovali-client-tabs:${user.id || user.username}`',
      'activeProjectId',
      'activeTypeByProject',
      'closedTypeByProject',
      'clientSortDirection',
      'localStorage.getItem(clientToggleStorageKey)',
      'localStorage.setItem(clientToggleStorageKey, JSON.stringify({ activeProjectId, activeTypeByProject, closedTypeByProject, clientSortDirection }))'
    ],
    'ClientPage'
  );
});

test('preferências do gestor preservam ordenação e grupos recolhidos por usuário', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');

  assertIncludesAll(
    manager,
    [
      "`gestor-ui-prefs:${user?.id || 'anonymous'}`",
      "`gestor-project-details-collapsed:${user?.id || 'anonymous'}`",
      "projectSortDir: 'asc' | 'desc'",
      'closedArchivedProjectIds: string[]',
      'closedArchivedTypeKeys: string[]',
      "archivedTypeSortDirections: Record<string, 'asc' | 'desc'>",
      'closedClientAccountGroupIds: string[]',
      'localStorage.setItem(storageKey, JSON.stringify(prefs))',
      'localStorage.setItem(projectDetailsStorageKey, JSON.stringify(ids))'
    ],
    'GestorPage'
  );
});

test('cache de assinatura permanece por identidade e nunca persiste a imagem', () => {
  const signatureDialog = source('src/components/reports/SignatureDialog.tsx');

  assertIncludesAll(
    signatureDialog,
    [
      "const SIGNATURE_CACHE_PREFIX = 'filtrovali.signature.v1'",
      "String(identity || '').trim().toLowerCase()",
      'return `${SIGNATURE_CACHE_PREFIX}:${normalized}`',
      'type SignatureCache = {',
      'signerName?: string',
      'window.localStorage.getItem(key)',
      'window.localStorage.setItem(key, JSON.stringify(cache))',
      'window.localStorage.removeItem(key)',
      "if (typeof parsed.drawnSignatureDataUrl === 'string')",
      'writeSignatureCache(cacheIdentity, { signerName: trimmedSignerName })'
    ],
    'SignatureDialog'
  );
  assert.ok(
    !/writeSignatureCache\([^)]*drawnSignatureDataUrl/.test(signatureDialog),
    'A imagem da assinatura não deve voltar a ser persistida'
  );
});

test('posição de scroll do RDO continua isolada por usuário e rota na sessão', () => {
  const scrollHook = source('src/hooks/usePageScrollRestoration.ts');

  assertIncludesAll(
    scrollHook,
    [
      "const PAGE_SCROLL_STORAGE_PREFIX = 'filtrovali:page-scroll:'",
      'window.sessionStorage.getItem(key)',
      'window.sessionStorage.setItem(key, value)',
      "return `${PAGE_SCROLL_STORAGE_PREFIX}${identity || 'anonymous'}:${pathFromLocation(location)}`",
      'writeScrollTop(storageKey, currentPageScrollTop())',
      'readStoredScrollTop(storageKey)'
    ],
    'usePageScrollRestoration'
  );
  assert.ok(!scrollHook.includes('localStorage'));
});

test('chaves de tutorial e novidade continuam individualizadas por usuário', () => {
  const tutorial = source('src/components/ClientTutorial.tsx');
  const client = source('src/pages/client/ClientPage.tsx');
  const navigation = source('src/auth/moduleNavigation.ts');

  assertIncludesAll(
    navigation,
    [
      "const RDO_DDS_NOVELTY_KEY_PREFIX = 'filtrovali:rdo-dds-novelty:v2:'",
      "const RDO_DDS_NOVELTY_EXPIRES_AT = new Date('2026-07-25T23:59:59-03:00')",
      'export function shouldShowRdoDdsNovelty',
      'safeLocalStorageGet(`${RDO_DDS_NOVELTY_KEY_PREFIX}${user.id}`)',
      'export function markRdoDdsNoveltySeen',
      "safeLocalStorageSet(`${RDO_DDS_NOVELTY_KEY_PREFIX}${user.id}`, '1')"
    ],
    'moduleNavigation'
  );

  assert.ok(
    tutorial.includes("const STORAGE_KEY_PREFIX = 'filtrovali-tutorial-done'")
  );
  assert.ok(
    client.includes(
      "const BATCH_SIGNATURE_TIP_STORAGE_KEY_PREFIX = 'filtrovali-client-batch-signature-tip-done'"
    )
  );
});
