import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

async function loadDraftAutosave() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
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
    server: { middlewareMode: true, hmr: false },
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
      workforceJustification: 'Atividade autorizada durante o afastamento.',
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
  assert.equal(state.workforceJustification, draft.payload.workforceJustification);
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

test('absence justification survives draft serialization, reopening, editing and clearing', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { useRdoStore } = await server.ssrLoadModule('/src/store/rdoStore.ts');
    const { reportDraftToRdoState } = await server.ssrLoadModule('/src/utils/reportDraft.ts');
    const store = () => useRdoStore.getState();
    store().reset();
    assert.equal(store().workforceJustification, '');
    for (const text of ['Autorizado pelo gestor.\nAtendimento emergencial.', 'Justificativa corrigida.', '']) {
      store().setHeaderField('workforceJustification', text);
      const saved = JSON.parse(JSON.stringify({ id: 'draft-test', payload: store() }));
      store().reset();
      store().hydrate(reportDraftToRdoState(saved));
      assert.equal(store().workforceJustification, text);
    }
    for (const value of [undefined, null, 123, { text: 'invalid' }]) {
      store().setHeaderField('workforceJustification', 'Texto de outro rascunho');
      store().hydrate(reportDraftToRdoState({ id: 'legacy-draft', payload: { workforceJustification: value } }));
      assert.equal(store().workforceJustification, '', 'legacy/invalid drafts cannot inherit another justification');
    }
    store().reset();
  } finally { await server.close(); }
});

test('absence justification is wired to autosave and every draft resume entry point', async () => {
  const page = await readFile(new URL('../src/pages/collaborator/NewReportPage.tsx', import.meta.url), 'utf8');
  const autosave = page.slice(page.indexOf('const buildDraftPayload ='), page.indexOf('const draftProjectDateKey ='));
  assert.match(autosave, /return\s*\{[^}]*\bworkforceJustification\b/s);
  assert.match(autosave, /\},\s*\[[^\]]*\bworkforceJustification\b/s, 'editing only this field must trigger autosave');
  assert.match(page, /onJustificationChange=\{value => setHeaderField\('workforceJustification', value\)\}/);
  assert.doesNotMatch(page, /\[workforceJustification,\s*setWorkforceJustification\]\s*=\s*useState/);
  for (const path of ['collaborator/HomePage.tsx', 'gestor/GestorPage.tsx']) {
    const source = await readFile(new URL(`../src/pages/${path}`, import.meta.url), 'utf8');
    assert.match(source, /workforceJustification:\s*asString\(payload\.workforceJustification\)/);
  }
  const coordinator = await readFile(new URL('../src/pages/coordinator/CoordinatorPage.tsx', import.meta.url), 'utf8');
  assert.match(coordinator, /hydrate\(reportDraftToRdoState\(draft\)\)/);
});
