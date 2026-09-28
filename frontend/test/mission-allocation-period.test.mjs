import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from 'vite';

const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
const { defaultNewAllocationPeriod } = await server.ssrLoadModule('/src/utils/missionAllocationPeriod.ts');
await server.close();

test('nova pessoa na execução começa na data da entrada, dentro da missão', () => {
  const mission = { stage: 'EXECUTION', mobilizationDate: '2026-09-01', executionEndDate: '2026-09-29', returnDate: '2026-09-30' };
  assert.deepEqual(defaultNewAllocationPeriod(mission, true, '2026-09-15'), {
    mobilizationDate: '2026-09-15', demobilizationDate: ''
  });
  assert.deepEqual(defaultNewAllocationPeriod(mission, true, '2026-08-20').mobilizationDate, '2026-09-01');
  assert.deepEqual(defaultNewAllocationPeriod(mission, true, '2026-10-02').mobilizationDate, '2026-09-30');
});

test('equipe inicial conserva o período completo da missão', () => {
  const mission = { stage: 'MOBILIZATION', mobilizationDate: '2026-09-01', executionEndDate: '2026-09-29', returnDate: '2026-09-30' };
  assert.deepEqual(defaultNewAllocationPeriod(mission, false, '2026-09-15'), {
    mobilizationDate: '2026-09-01', demobilizationDate: '2026-09-30'
  });
});
