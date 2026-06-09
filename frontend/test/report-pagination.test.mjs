import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadReportHooks() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/hooks/useReports.ts');
  } finally {
    await server.close();
  }
}

test('global report load more hides when all distinct projects are loaded', async () => {
  const { hasMoreReportProjects } = await loadReportHooks();
  const pagination = { page: 1, pageSize: 25, total: 75, totalPages: 3 };

  assert.equal(hasMoreReportProjects(pagination, 1, 1), false);
});

test('global report load more stays visible while more projects remain', async () => {
  const { hasMoreReportProjects } = await loadReportHooks();
  const pagination = { page: 1, pageSize: 25, total: 75, totalPages: 3 };

  assert.equal(hasMoreReportProjects(pagination, 1, 2), true);
});

test('global report load more falls back to report pages without project metadata', async () => {
  const { hasMoreReportProjects } = await loadReportHooks();

  assert.equal(hasMoreReportProjects({ page: 1, pageSize: 25, total: 75, totalPages: 3 }, 1), true);
  assert.equal(hasMoreReportProjects({ page: 3, pageSize: 25, total: 75, totalPages: 3 }, 1), false);
});

test('empty first report page replaces accumulated reports', async () => {
  const { isFirstReportPageAlreadyCovered } = await loadReportHooks();

  assert.equal(isFirstReportPageAlreadyCovered([{ id: 'old-report' }], [], 1), false);
});

test('covered first report page keeps accumulated reports but refreshes item data', async () => {
  const { mergeCoveredFirstReportPage } = await loadReportHooks();

  const merged = mergeCoveredFirstReportPage(
    [
      { id: 'report-1', status: 'APPROVED' },
      { id: 'report-2', status: 'APPROVED' },
      { id: 'report-3', status: 'APPROVED' }
    ],
    [
      { id: 'report-1', status: 'SIGNED' },
      { id: 'report-2', status: 'APPROVED' }
    ],
    1
  );

  assert.deepEqual(merged, [
    { id: 'report-1', status: 'SIGNED' },
    { id: 'report-2', status: 'APPROVED' },
    { id: 'report-3', status: 'APPROVED' }
  ]);
});

test('report page merge refreshes existing group items and appends new ones', async () => {
  const { mergeReportItemsById } = await loadReportHooks();

  const merged = mergeReportItemsById(
    [
      { id: 'report-1', status: 'APPROVED', signatures: 1 },
      { id: 'report-2', status: 'APPROVED', signatures: 1 }
    ],
    [
      { id: 'report-1', status: 'SIGNED', signatures: 2 },
      { id: 'report-3', status: 'APPROVED', signatures: 1 }
    ]
  );

  assert.deepEqual(merged, [
    { id: 'report-1', status: 'SIGNED', signatures: 2 },
    { id: 'report-2', status: 'APPROVED', signatures: 1 },
    { id: 'report-3', status: 'APPROVED', signatures: 1 }
  ]);
});
