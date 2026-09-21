import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => readFileSync(join(frontendRoot, path), 'utf8');

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

test('listings barrel exposes every Phase 5 primitive through the DS public API', () => {
  const designSystemBarrel = source('src/components/ui/ds/index.ts');
  const exports = [
    'DataTable',
    'SearchInput',
    'FilterBar',
    'MobileList',
    'Pagination'
  ];

  for (const component of exports) {
    assert.match(designSystemBarrel, new RegExp(`\\b${component}\\b`));
  }
});

test('DataTable keeps native table semantics, sortable headers and accessible selection', () => {
  const dataTable = source('src/components/ui/ds/listings/DataTable.tsx');
  const listingTypes = source('src/components/ui/ds/listings/types.ts');

  assert.match(dataTable, /<table\b/);
  assert.match(dataTable, /<thead\b/);
  assert.match(dataTable, /<tbody\b/);
  assert.match(dataTable, /scope=["']col["']/);
  assert.match(dataTable, /scope=["']row["']/);
  assert.match(dataTable, /aria-sort=/);
  assert.match(dataTable, /type=["']checkbox["']/);
  assert.match(dataTable, /aria-label=/);
  assert.match(dataTable, /selecion/i);
  assert.match(
    listingTypes,
    /accessor\?:\s*keyof T \| \(\(row: T\) => unknown\)/
  );
});

test('DataTable can reuse its card presentation while keeping tables as the default', async () => {
  const server = await createServer({
    configFile: false,
    root: frontendRoot,
    server: { middlewareMode: true, hmr: false },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    const { DataTable } = await server.ssrLoadModule('/src/components/ui/ds/listings/DataTable.tsx');
    const props = {
      rows: [{ id: 'r1', name: 'RDO 1' }],
      getRowId: (row) => row.id,
      columns: [{ key: 'name', header: 'Relatório', render: (row) => row.name }],
      ariaLabel: 'Relatórios',
      mobile: { renderItem: (row) => ({ title: row.name }) },
      selection: {
        selectedRowIds: ['r1'],
        onSelectionChange() {},
        getRowLabel: (row) => row.name,
        showSelectAll: false
      }
    };
    const table = renderToStaticMarkup(createElement(DataTable, props));
    const cards = renderToStaticMarkup(createElement(DataTable, { ...props, layout: 'cards' }));
    assert.match(table, /<table\b/);
    assert.doesNotMatch(table, /class="fv-data-table__mobile/);
    assert.doesNotMatch(cards, /<table\b/);
    assert.match(cards, /fv-data-table__mobile/);
    assert.match(cards, /aria-selected="true"/);
    assert.match(cards, /type="checkbox"[^>]*checked=""/);
    assert.match(cards, /RDO 1/);
  } finally {
    await server.close();
  }
});

test('SearchInput keeps controlled input immediate and debounce as an auxiliary callback', () => {
  const searchInput = source('src/components/ui/ds/listings/SearchInput.tsx');

  assert.match(searchInput, /value:\s*string/);
  assert.match(searchInput, /onChange:\s*\(value:\s*string\)/);
  assert.match(searchInput, /onDebouncedChange\?/);
  assert.match(searchInput, /useDebouncedValue/);
  assert.match(searchInput, /onCompositionStart/);
  assert.match(searchInput, /role=["']searchbox["']/);
  assert.match(searchInput, /clearLabel/);
  assert.match(searchInput, /'fv-control-shell'/);
  assert.match(searchInput, /className="fv-input fv-search-input__control"/);
});

test('FilterBar provides active filters and an accessible mobile sheet', () => {
  const filterBar = source('src/components/ui/ds/listings/FilterBar.tsx');

  assert.match(filterBar, /activeFilters/);
  assert.match(filterBar, /activeCount/);
  assert.match(filterBar, /<dialog\b/);
  assert.match(filterBar, /showModal\(\)/);
  assert.match(filterBar, /aria-haspopup=["']dialog["']/);
  assert.match(filterBar, /onCancel=/);
  assert.match(filterBar, /sheetOpen = open && !disabled/);
  assert.match(filterBar, /document\.body\.style\.overflow = 'hidden'/);
});

test('dense listings can opt into card composition at official tablet breakpoints', () => {
  const dataTable = source('src/components/ui/ds/listings/DataTable.tsx');
  const filterBar = source('src/components/ui/ds/listings/FilterBar.tsx');
  const listingMedia = source(
    'src/components/ui/ds/listings/useListingMedia.ts'
  );
  const designSystemBarrel = source('src/components/ui/ds/index.ts');

  assert.match(
    listingMedia,
    /ListingMobileBreakpoint = 'md' \| 'lg' \| 'xl'/
  );
  for (const edge of ['767.98', '1023.98', '1279.98']) {
    assert.match(listingMedia, new RegExp(`max-width: ${edge.replace('.', '\\.')}`));
  }
  assert.match(dataTable, /mobileBreakpoint\?: ListingMobileBreakpoint/);
  assert.match(dataTable, /mobileBreakpoint = 'md'/);
  assert.match(dataTable, /useListingMobileViewport\(mobileBreakpoint\)/);
  assert.match(filterBar, /mobileBreakpoint\?: ListingMobileBreakpoint/);
  assert.match(filterBar, /mobileBreakpoint = 'md'/);
  assert.match(filterBar, /useListingMobileViewport\(mobileBreakpoint\)/);
  assert.match(designSystemBarrel, /type \{ ListingMobileBreakpoint \}/);
});

test('Pagination is controlled, semantic and exposes all navigation boundaries', () => {
  const pagination = source('src/components/ui/ds/listings/Pagination.tsx');

  assert.match(pagination, /<nav\b/);
  assert.match(pagination, /onPageChange/);
  assert.match(pagination, /onPageSizeChange/);
  assert.match(pagination, /aria-current=/);
  assert.match(pagination, /role=["']group["']/);
  assert.match(pagination, /firstPage/);
  assert.match(pagination, /lastPage/);
});

test('MobileList renders description-list semantics from an explicit row/column mapping', () => {
  const dataTable = source('src/components/ui/ds/listings/DataTable.tsx');
  const mobileList = source('src/components/ui/ds/listings/MobileList.tsx');

  assert.match(dataTable, /<MobileList\b/);
  assert.match(mobileList, /<dl\b/);
  assert.match(mobileList, /<dt\b/);
  assert.match(mobileList, /<dd\b/);
  assert.match(mobileList, /\.map\(/);
  assert.match(dataTable, /\brenderItem\b/);
  assert.match(mobileList, /\bmetadata\b/);
  assert.match(mobileList, /hasContent\(content\.value\)/);
  assert.match(mobileList, /inert=\{disabled \|\| undefined\}/);
});

test('MobileList exposes the current selection state on each list item', () => {
  const mobileList = source('src/components/ui/ds/listings/MobileList.tsx');

  assert.match(
    mobileList,
    /aria-selected=\{selection \? selected : undefined\}/
  );
});

test('DataTable and MobileList expose optional contextual row details', () => {
  const dataTable = source('src/components/ui/ds/listings/DataTable.tsx');
  const mobileList = source('src/components/ui/ds/listings/MobileList.tsx');
  const listingTypes = source('src/components/ui/ds/listings/types.ts');

  assert.match(dataTable, /renderRowDetails\?/);
  assert.match(dataTable, /data-details-for-row=/);
  assert.match(dataTable, /className="fv-data-table__details"/);
  assert.match(dataTable, /colSpan=\{columnCount\}/);
  assert.match(
    dataTable,
    /details: content\.details \?\? renderRowDetails\?\.\(row, index\)/
  );
  assert.match(listingTypes, /details\?: ReactNode/);
  assert.match(mobileList, /hasContent\(content\.details\)/);
  assert.match(mobileList, /className="fv-mobile-list__details"/);
  assert.ok(
    mobileList.indexOf('className="fv-mobile-list__actions"') <
      mobileList.indexOf('className="fv-mobile-list__details"'),
    'os detalhes contextuais do card devem vir depois das ações'
  );
});

test('listing CSS is DS-scoped, tokenized and uses only official breakpoints', () => {
  const css = source('src/components/ui/ds/listings/listings.css');

  assert.match(css, /:where\(\.fv-ds,\s*\[data-fv-ds\]\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(/i);
  assert.doesNotMatch(css, /!important/);

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
  const responsiveRules = css.matchAll(/@(media|container)\s*([^\{]+)/g);
  for (const [, , condition] of responsiveRules) {
    for (const match of condition.matchAll(/(\d+(?:\.\d+)?)px\b/g)) {
      assert.ok(
        officialBreakpointEdges.has(match[1]),
        `Breakpoint não oficial em listings.css: ${match[0]}`
      );
    }
  }
});

test('listings harness is an isolated Vite entry without application routing', () => {
  const html = source('listings-design-system.html');
  const entry = source('src/dev/listings-design-system-main.tsx');

  assert.match(html, /src="\/src\/dev\/listings-design-system-main\.tsx"/);
  assert.match(html, /noindex,nofollow/);
  assert.match(entry, /<ListingsDesignSystemPage\s*\/>/);
  assert.doesNotMatch(entry, /BrowserRouter|MemoryRouter|Routes|Route/);
});

test('Phase 5 listing primitives are enabled across the migrated RDO, Efetivo and Assinaturas surfaces', () => {
  const listingNames = 'DataTable|SearchInput|FilterBar|MobileList|Pagination';
  const namedListingImport = new RegExp(
    `import\\s*\\{[^}]*\\b(?:${listingNames})\\b[^}]*\\}\\s*from\\s*['"][^'"]*components/ui/ds(?:/listings(?:/[^'"]+)?)?['"]`,
    's'
  );
  const directListingImport = new RegExp(
    `from\\s*['"][^'"]*components/ui/ds/listings/(?:${listingNames})['"]`
  );
  const productionFiles = [
    ...sourceFilesUnder('src/pages'),
    ...sourceFilesUnder('src/modules')
  ];
  const migratedPagePaths = new Set([
    'src/pages/gestor/GestorPage.tsx',
    'src/pages/coordinator/CoordinatorPage.tsx',
    'src/pages/client/ClientPage.tsx',
    'src/pages/collaborator/MyReportsPage.tsx',
    'src/pages/collaborator/MyArchivedReportsPage.tsx',
    'src/pages/collaborator/OngoingServicesPage.tsx',
    'src/pages/efetivo/components/CollaboratorsBoard.tsx',
    'src/pages/efetivo/components/MissionsBoard.tsx',
    'src/pages/efetivo/components/MissionTeamSelector.tsx',
    'src/pages/assinaturas/components/DocumentLibrary.tsx'
  ].map(path => new URL(`../${path}`, import.meta.url).pathname));
  const managerPagePath = new URL('../src/pages/gestor/GestorPage.tsx', import.meta.url).pathname;
  const managerPage = readFileSync(managerPagePath, 'utf8');

  assert.match(managerPage, /ManagerReportListing/);
  assert.match(managerPage, namedListingImport);

  for (const file of migratedPagePaths) {
    assert.match(readFileSync(file, 'utf8'), namedListingImport, file);
  }

  for (const file of productionFiles.filter(
    (file) => !migratedPagePaths.has(file)
  )) {
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      namedListingImport,
      `${file} não deve adotar os componentes de listagem fora das superfícies migradas`
    );
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      directListingImport,
      `${file} não deve adotar os componentes de listagem fora das superfícies migradas`
    );
  }
});
