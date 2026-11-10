import assert from 'node:assert/strict';
import test from 'node:test';
import { createReportCostCollaboratorLoader } from '../src/lib/acompanhamento/project-detail-collaborators.js';

test('one group batches overlapping requests and reuses in-flight collaborators without changing returned fields', async () => {
  const calls = [], rows = [{ id: 'a', rdoCostSimulationExcluded: true, jobRoleHistory: [{ effectiveDate: '2026-09-01' }] }, { id: 'b' }];
  let finish;
  const load = createReportCostCollaboratorLoader({ collaborator: { findMany: query => {
    calls.push(query); return new Promise(resolve => { finish = resolve; });
  } } });
  const first = load(['a', 'a']), second = load(['b', 'a']);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where.id.in, ['a', 'b']);
  const duringRead = load(['a']);
  finish(rows);
  assert.deepEqual(await first, [rows[0]]);
  assert.deepEqual(await second, [rows[1], rows[0]]);
  assert.equal((await duringRead)[0], rows[0]);
  assert.deepEqual(await load(['b']), [rows[1]]);
  assert.equal(calls.length, 1);
});

test('empty and missing collaborators do not create repeated SQL; caches belong to separate requests', async () => {
  let reads = 0;
  const database = { collaborator: { findMany: async () => { reads++; return []; } } };
  const load = createReportCostCollaboratorLoader(database);
  assert.deepEqual(await load([]), []);
  assert.equal(reads, 0);
  assert.deepEqual(await load(['missing']), []);
  assert.deepEqual(await load(['missing']), []);
  assert.equal(reads, 1);
  assert.deepEqual(await createReportCostCollaboratorLoader(database)(['missing']), []);
  assert.equal(reads, 2);
});

test('all consumers see a failed batch and a later attempt can read again', async () => {
  let reads = 0;
  const failure = new Error('source unavailable');
  const load = createReportCostCollaboratorLoader({ collaborator: { findMany: async () => {
    if (++reads === 1) throw failure;
    return [{ id: 'a' }, { id: 'b' }];
  } } });
  const outcomes = await Promise.allSettled([load(['a']), load(['b', 'a'])]);
  assert.ok(outcomes.every(row => row.status === 'rejected' && row.reason === failure));
  assert.deepEqual(await load(['b', 'a']), [{ id: 'b' }, { id: 'a' }]);
  assert.equal(reads, 2);
});
