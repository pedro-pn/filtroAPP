import assert from 'node:assert/strict';
import test from 'node:test';

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) || null,
  setItem: (key, value) => values.set(key, value)
};

const novelty = await import('../src/utils/projectWorkflowNovelty.ts');

test('novidade dura exatamente a janela global e uma vez por usuário', () => {
  values.clear();
  assert.equal(novelty.PROJECT_WORKFLOW_NOVELTY_IMPLEMENTED_AT, '2026-09-09');
  assert.equal(novelty.shouldShowProjectWorkflowNovelty('u1', new Date('2026-09-19T20:00:00-03:00').getTime()), true);
  novelty.markProjectWorkflowNoveltySeen('u1');
  assert.equal(novelty.shouldShowProjectWorkflowNovelty('u1', new Date('2026-09-19T20:00:00-03:00').getTime()), false);
  assert.equal(novelty.shouldShowProjectWorkflowNovelty('u2', new Date('2026-09-20T00:00:00-03:00').getTime()), false);
});
