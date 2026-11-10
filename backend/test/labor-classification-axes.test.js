import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMissionGroupProjectIndex, classifyProjectHours, classifyProjectHoursForCostAxes, reviewedDayEntry } from '../src/lib/acompanhamento/labor-cost.js';

const rows = [
  { date: '2026-09-21', normalHours: 8, he70Horas: 1, he100Horas: .5, nightHours: 2, tags: ['A', 'B'] },
  { date: '2026-09-22', normalHours: 8.8, tags: ['EM VIAGEM', 'A'] }
];
const rdo = { dayProjects: new Map([['2026-09-21', new Map([
  ['a', { projectId: 'a', hours: 8 }], ['b', { projectId: 'b', hours: 4 }]
])]]) };
const meta = new Map([['a', { offshore: true }], ['b', { sleepMode: 'HOME' }]]);
const resolve = tag => ({ A: 'a', B: 'b' })[tag] || null;
const groups = mode => buildMissionGroupProjectIndex([{ id: 'group', laborAllocationMode: mode,
  primaryLaborProjectId: mode === 'CONSOLIDATE_PRIMARY' ? 'a' : null, members: [{ projectId: 'a' }, { projectId: 'b' }] }]);

test('identical cost axes preserve complete aggregates/trails and resolve tags only once', () => {
  for (const mode of ['VISUAL_ONLY', 'CONSOLIDATE_PRIMARY']) {
    let calls = 0;
    const resolveTag = tag => { calls++; return resolve(tag); };
    const context = groups(mode), manual = new Map();
    const before = structuredClone({ rows, rdo, meta, context, manual });
    const accounting = classifyProjectHours(rows, rdo, resolveTag, meta, manual, context);
    const onePassCalls = calls;
    const analytical = classifyProjectHours(rows, rdo, resolveTag, meta, manual, context, 'ANALYTICAL');
    calls = 0;
    const paired = classifyProjectHoursForCostAxes(rows, rdo, resolveTag, meta, manual, context);
    assert.deepEqual(paired.accounting, accounting);
    assert.deepEqual(paired.analytical, analytical);
    assert.equal(calls, onePassCalls, 'Do not repeat tag/travel resolution when the axes have identical decisions');
    assert.deepEqual({ rows, rdo, meta, context, manual }, before);
  }
});

test('shared execution, manual sharing and confirmed sharing retain separate weights and full segment context', () => {
  for (const [reason, context, manual] of [
    ['SHARED_EXECUTION_ACCOUNTING', groups('SHARED_EXECUTION'), new Map()],
    ['MANUAL_SHARED_OVERRIDE', groups('VISUAL_ONLY'), new Map([['2026-09-21', ['a', 'b']]])],
    ['REVIEW_SHARED_CONFIRMED', groups('VISUAL_ONLY'), new Map([['2026-09-21', reviewedDayEntry(['a', 'b'])]])]
  ]) {
    const paired = classifyProjectHoursForCostAxes(rows, rdo, resolve, meta, manual, context);
    assert.deepEqual(paired.accounting, classifyProjectHours(rows, rdo, resolve, meta, manual, context));
    assert.deepEqual(paired.analytical, classifyProjectHours(rows, rdo, resolve, meta, manual, context, 'ANALYTICAL'));
    assert.equal(paired.accounting.dayTrail[0].reason, reason);
    assert.equal(paired.accounting.dayTrail[0].allocations.reduce((sum,row)=>sum+row.weight,0), 1);
    assert.equal(paired.analytical.dayTrail[0].allocations.reduce((sum,row)=>sum+row.weight,0), 2);
    assert.deepEqual(paired.analytical.dayTrail[1], paired.accounting.dayTrail[1]);
  }
});

test('empty, unresolved and idle reviewed days preserve classification without creating allocation', () => {
  for (const [days, manual] of [[[], new Map()], [[{ date: '2026-09-21', normalHours: 8, tags: [] }], new Map()],
    [rows, new Map([['2026-09-21', reviewedDayEntry([], 'IDLE')]])]]) {
    const paired = classifyProjectHoursForCostAxes(days, null, resolve, meta, manual, new Map());
    assert.deepEqual(paired.accounting, classifyProjectHours(days, null, resolve, meta, manual));
    assert.deepEqual(paired.analytical, classifyProjectHours(days, null, resolve, meta, manual, new Map(), 'ANALYTICAL'));
  }
});
