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
