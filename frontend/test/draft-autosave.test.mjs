import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

async function loadDraftAutosave() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/utils/draftAutosave.ts');
  } finally {
    await server.close();
  }
}

async function loadReportDraft() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/utils/reportDraft.ts');
  } finally {
    await server.close();
  }
}

test('autosaveDraftTargetId keeps updating the active draft when project/date changes', async () => {
  const { autosaveDraftTargetId } = await loadDraftAutosave();

  assert.equal(
    autosaveDraftTargetId('draft-active', ['draft-same-date']),
    'draft-active'
  );
  assert.equal(autosaveDraftTargetId(' draft-active ', []), 'draft-active');
});

test('autosaveDraftTargetId falls back to matching project/date only without an active draft', async () => {
  const { autosaveDraftTargetId } = await loadDraftAutosave();

  assert.equal(
    autosaveDraftTargetId(null, ['draft-same-date']),
    'draft-same-date'
  );
  assert.equal(
    autosaveDraftTargetId('', [null, undefined, 'draft-next']),
    'draft-next'
  );
  assert.equal(autosaveDraftTargetId('', []), '');
});

test('coordinator draft can be hydrated back into the shared report editor', async () => {
  const {
    reportDraftDateLabel,
    reportDraftServiceCount,
    reportDraftToRdoState,
    SITE_RDO_DRAFT_FORM_PATH
  } = await loadReportDraft();
  const draft = {
    id: 'draft-coordinator',
    projectId: 'project-1',
    reportDate: '2026-08-14',
    title: '5822 - Projeto teste',
    payload: {
      serviceOnly: false,
      projectId: 'project-1',
      reportDate: '2026-08-14',
      arrivalTime: '08:00',
      collaboratorIds: ['collaborator-1'],
      ddsDayThemes: [{ id: 'theme-1', name: 'Segurança' }],
      services: [
        { id: 'service-1', type: 'FLUSHING', data: { pressure: '2 bar' } }
      ]
    }
  };

  const state = reportDraftToRdoState(draft);
  assert.equal(state.draftId, 'draft-coordinator');
  assert.equal(state.projectId, 'project-1');
  assert.equal(state.reportDate, '2026-08-14');
  assert.deepEqual(state.collaboratorIds, ['collaborator-1']);
  assert.deepEqual(state.ddsDayThemes, [{ id: 'theme-1', name: 'Segurança' }]);
  assert.deepEqual(state.services, [
    { id: 'service-1', type: 'FLUSHING', data: { pressure: '2 bar' } }
  ]);
  assert.equal(reportDraftDateLabel(draft), '2026-08-14');
  assert.equal(reportDraftServiceCount(draft), 1);
  assert.equal(SITE_RDO_DRAFT_FORM_PATH, '/relatorio/novo?tipo=obra');
});

test('all draft lists resume the site RDO without asking for its type again', async () => {
  const pages = await Promise.all(
    [
      '../src/pages/collaborator/HomePage.tsx',
      '../src/pages/coordinator/CoordinatorPage.tsx',
      '../src/pages/gestor/GestorPage.tsx'
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8'))
  );

  for (const page of pages) {
    assert.match(page, /navigate\(rdoPath\(SITE_RDO_DRAFT_FORM_PATH\)\)/);
  }
});
