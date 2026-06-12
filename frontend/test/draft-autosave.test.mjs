import assert from 'node:assert/strict';
import test from 'node:test';
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

test('autosaveDraftTargetId keeps updating the active draft when project/date changes', async () => {
  const { autosaveDraftTargetId } = await loadDraftAutosave();

  assert.equal(autosaveDraftTargetId('draft-active', ['draft-same-date']), 'draft-active');
  assert.equal(autosaveDraftTargetId(' draft-active ', []), 'draft-active');
});

test('autosaveDraftTargetId falls back to matching project/date only without an active draft', async () => {
  const { autosaveDraftTargetId } = await loadDraftAutosave();

  assert.equal(autosaveDraftTargetId(null, ['draft-same-date']), 'draft-same-date');
  assert.equal(autosaveDraftTargetId('', [null, undefined, 'draft-next']), 'draft-next');
  assert.equal(autosaveDraftTargetId('', []), '');
});
