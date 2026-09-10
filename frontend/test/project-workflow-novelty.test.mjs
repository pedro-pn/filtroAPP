import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) || null,
  setItem: (key, value) => values.set(key, value)
};

const novelty = await import('../src/utils/projectWorkflowNovelty.ts');

test('novidade dura exatamente a janela global e uma vez por usuário', () => {
  values.clear();
  assert.equal(novelty.PROJECT_WORKFLOW_NOVELTY_IMPLEMENTED_AT, '2026-09-10');
  assert.equal(novelty.shouldShowProjectWorkflowNovelty('u1', new Date('2026-09-20T20:00:00-03:00').getTime()), true);
  novelty.markProjectWorkflowNoveltySeen('u1');
  assert.equal(novelty.shouldShowProjectWorkflowNovelty('u1', new Date('2026-09-20T20:00:00-03:00').getTime()), false);
  assert.equal(novelty.shouldShowProjectWorkflowNovelty('u2', new Date('2026-09-21T00:00:00-03:00').getTime()), false);
});

test('guia apresenta documentos, versões e aceite no fluxo existente', () => {
  const source = fs.readFileSync(new URL('../src/pages/efetivo/ProjectWorkflowNovelty.tsx', import.meta.url), 'utf8');
  assert.match(source, /Documentos dentro do projeto/);
  assert.match(source, /data-project-document-add/);
  assert.match(source, /data-project-document-version/);
  assert.match(source, /data-project-document-acceptance/);
});
