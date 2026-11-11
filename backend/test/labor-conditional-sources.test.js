import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLaborMissionGroups } from '../src/lib/acompanhamento/labor-mission-groups.js';
import { loadConfirmedReviewDays } from '../src/lib/efetivo/allocation-review/confirmed-days.js';

test('empty group/review parents skip child queries entirely', async () => {
  assert.deepEqual(await loadLaborMissionGroups({ acompanhamentoMissionGroup: { findMany: async args => {
    assert.deepEqual(args.where, { status: 'ACTIVE' });
    assert.equal(Object.hasOwn(args.select, 'members'), false);
    return [];
  } } }), []);
  assert.deepEqual(await loadConfirmedReviewDays({ from: '2026-09-01', to: '2026-10-01' }, {
    allocationReviewDay: { findMany: async args => {
      assert.equal(Object.hasOwn(args.select, 'projects'), false);
      assert.equal(args.where.workDate.gte.toISOString(), '2026-09-01T00:00:00.000Z');
      assert.equal(args.where.workDate.lt.toISOString(), '2026-10-01T00:00:00.000Z');
      assert.deepEqual(args.where.row, { confirmedAt: { not: null } });
      return [];
    } }
  }), []);
});

test('group children preserve original parent/member order and observe changed links', async () => {
  const parents = [{ id: 'b', laborAllocationMode: 'SHARED_EXECUTION', primaryLaborProjectId: null },
    { id: 'a', laborAllocationMode: 'CONSOLIDATE_PRIMARY', primaryLaborProjectId: 'p1' }];
  let links = [{ groupId: 'a', projectId: 'p1' }, { groupId: 'b', projectId: 'p3' }, { groupId: 'b', projectId: 'p2' }];
  const original = structuredClone(parents);
  const database = { acompanhamentoMissionGroup: { findMany: async () => parents },
    acompanhamentoMissionGroupMember: { findMany: async args => {
      assert.deepEqual(args.where, { groupId: { in: ['b', 'a'] } });
      return links;
    } } };
  assert.deepEqual((await loadLaborMissionGroups(database)).map(g => [g.id, g.members]), [
    ['b', [{ projectId: 'p3' }, { projectId: 'p2' }]], ['a', [{ projectId: 'p1' }]]
  ]);
  links = [{ groupId: 'a', projectId: 'p4' }];
  const changed = await loadLaborMissionGroups(database);
  assert.deepEqual(changed[0].members, []);
  assert.deepEqual(changed[1].members, [{ projectId: 'p4' }]);
  assert.deepEqual(parents, original);
  database.acompanhamentoMissionGroupMember.findMany = async () => { throw new Error('links unavailable'); };
  await assert.rejects(loadLaborMissionGroups(database), /links unavailable/);
});

test('confirmed days retain the date/kind/parent order, sort projects and reject failed links', async () => {
  const rows = [{ id: 'd2', collaboratorId: 'c', workDate: new Date('2026-09-02'), kind: 'PROJECT' },
    { id: 'd1', collaboratorId: 'c', workDate: new Date('2026-09-01'), kind: 'SEDE' }];
  const original = structuredClone(rows);
  let links = [{ dayId: 'd2', projectId: 'p2' }, { dayId: 'd2', projectId: 'p1' }];
  const client = { allocationReviewDay: { findMany: async () => rows },
    allocationReviewDayProject: { findMany: async args => {
      assert.deepEqual(args.where, { dayId: { in: ['d2', 'd1'] } });
      return links;
    } } };
  const options = { from: '2026-09-01', to: '2026-10-01' };
  const result = await loadConfirmedReviewDays(options, client);
  assert.deepEqual(result, [{ collaboratorId: 'c', date: '2026-09-02', kind: 'PROJECT', projectIds: ['p1', 'p2'] },
    { collaboratorId: 'c', date: '2026-09-01', kind: 'SEDE', projectIds: [] }]);
  links = [{ dayId: 'd1', projectId: 'p3' }];
  assert.deepEqual((await loadConfirmedReviewDays(options, client))[1].projectIds, ['p3']);
  assert.deepEqual(rows, original);
  client.allocationReviewDayProject.findMany = async () => { throw new Error('review links unavailable'); };
  await assert.rejects(loadConfirmedReviewDays(options, client), /review links unavailable/);
});
