import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { computeDivisionProgressDetails, computeProgressDetailsForProjects } from '../src/lib/acompanhamento/avanco.js';
import { progressReadOptions } from '../src/lib/acompanhamento/progress-projection.js';
import { withRequestPerformance } from '../src/lib/operations/request-performance.js';

function fixture() {
  const project = { id: 'current-progress', proposalPercentage: 100, manualProgressPct: 18 };
  const planned = Array.from({ length: 20 }, (_, index) => ({ projectId: project.id,
    serviceType: ['LIMPEZA_QUIMICA', 'TESTE_PRESSAO', 'FLUSHING'][index % 3], weight: 1,
    scopeName: index % 2 ? 'Escopo B' : 'Escopo A',
    systems: Array.from({ length: index === 19 ? 12 : 15 }, (_, row) => {
      const projectSystem = { id: `system-${index}-${row}`, name: `Linha ${index}-${row}`,
        equipment: `Unidade Geradora ${row % 3 + 1}`, aliases: [] };
      return { projectSystemId: projectSystem.id, projectSystem, systemType: 'TUBULACAO',
        unit: 'M', diameter: '2', diameterUnit: 'pol', quantity: 100 };
    })
  }));
  const services = Array.from({ length: 133 }, (_, index) => {
    const service = planned[index % planned.length], system = service.systems[index % service.systems.length];
    return { serviceType: service.serviceType, finalized: true, reportType: 'RDO',
      reportDate: new Date(Date.UTC(2026, 0, 1 + index % 63)), system: system.projectSystem.name,
      extraData: { __projectSystemId: system.projectSystemId, __scopeName: service.scopeName,
        equipmentId: system.projectSystem.equipment, tubes: [{ d: '2', unit: 'pol', c: 1 + index % 5, lengthUnit: 'm' }] } };
  });
  let historyQueries = 0;
  const manualHistory = [];
  const database = {
    project: { async findMany() { return [project]; } },
    projectPlannedService: { async findMany() { return planned; } },
    projectManualProgressHistory: { async findMany() { historyQueries++; return manualHistory; } }
  };
  return { project, planned, services, database, manualHistory, historyQueries: () => historyQueries };
}

test('current-only progress preserves the detailed result for 297 scope rows and 11 slices without computing histories', async t => {
  const state = fixture(), ids = [state.project.id];
  const options = { database: state.database, servicesByProject: Promise.resolve(new Map([[ids[0], state.services]])) };
  const startFull = performance.now();
  const full = (await computeProgressDetailsForProjects(ids, options)).get(ids[0]);
  const fullMs = performance.now() - startFull;
  // Snapshot do resultado completo anterior à preparação compartilhada. Protege
  // histórico, recortes, pendências, grupos e arredondamento no cenário denso.
  assert.equal(createHash('sha256').update(JSON.stringify(full)).digest('hex'),
    '57a47118dce05f144ca0b14e7df62d9aae605eb64af1714252f9afdf136ec383');
  assert.equal(full.plannedServices.reduce((n, service) => n + service.systems.length, 0), 297);
  assert.equal(full.progressSlices.slices.length, 11);
  assert.equal(full.dailyProgressHistory.length, 63);
  assert.equal(state.historyQueries(), 1);

  const startCurrent = performance.now();
  const current = (await computeProgressDetailsForProjects(ids, { ...options, currentOnly: true })).get(ids[0]);
  const currentMs = performance.now() - startCurrent;
  assert.deepEqual(current.progress, full.progress);
  assert.deepEqual(current.plannedServices, full.plannedServices);
  assert.deepEqual(current.progressHistory, []);
  assert.deepEqual(current.dailyProgressHistory, []);
  assert.equal(current.progressSlices, null);
  assert.equal(state.historyQueries(), 1, 'current-only progress must not query manual history');
  assert.ok(currentMs < 1_000, `current progress took ${currentMs.toFixed(1)}ms`);
  t.diagnostic(`297 scope rows, 133 source services, 63 dates: full=${fullMs.toFixed(1)}ms; current=${currentMs.toFixed(1)}ms`);
});

test('current, history and full share a revision of their actual sources and only full builds slices', async t => {
  const state = fixture(), ids = [state.project.id];
  const options = { database: state.database, servicesByProject: new Map([[ids[0], state.services]]) };
  async function read(mode) {
    const trace = { stages: {} };
    const started = performance.now();
    const result = (await withRequestPerformance(trace, () => computeProgressDetailsForProjects(ids, {
      ...options, ...progressReadOptions(mode)
    }))).get(ids[0]);
    return { result, trace, ms: performance.now() - started };
  }
  const full = await read('full'), history = await read('history'), current = await read('current');
  assert.equal(current.result.progressRevision, full.result.progressRevision);
  assert.equal(history.result.progressRevision, full.result.progressRevision);
  assert.deepEqual(current.result.progress, full.result.progress);
  assert.deepEqual(history.result.progressHistory, full.result.progressHistory);
  assert.deepEqual(history.result.dailyProgressHistory, full.result.dailyProgressHistory);
  assert.equal(history.result.progressSlices, null);
  assert.equal(current.result.progressSlices, null);
  assert.deepEqual(current.result.dailyProgressHistory, []);
  assert.equal(Object.hasOwn(current.trace.stages, 'progress.slices'), false);
  assert.equal(Object.hasOwn(history.trace.stages, 'progress.slices'), false);
  assert.equal(Object.hasOwn(full.trace.stages, 'progress.slices'), true);
  // Uma alteração gravada por outro processo não precisa tocar no registro Project.
  state.services[0].extraData.tubes[0].c += 1;
  const corrected = await read('current');
  assert.notEqual(corrected.result.progressRevision, current.result.progressRevision);
  assert.equal((await read('full')).result.progressRevision, corrected.result.progressRevision);
  state.manualHistory.push({ projectId: ids[0], recordedAt: new Date('2026-10-01'), progressPct: 10 });
  const manualHistoryChanged = (await read('current')).result.progressRevision;
  assert.notEqual(manualHistoryChanged, corrected.result.progressRevision);
  state.project.updatedAt = new Date('2026-10-12');
  state.project.laborSleepModeByCollaborator = { other: 'CASA' };
  assert.equal((await read('current')).result.progressRevision, manualHistoryChanged, 'unrelated project updates must not rebuild measured histories');
  state.planned.length = 0;
  const manual = await read('current');
  state.project.updatedAt = new Date('2026-10-13');
  assert.notEqual((await read('current')).result.progressRevision, manual.result.progressRevision, 'manual progress uses updatedAt to anchor its history');
  t.diagnostic(`dense source projections: current=${current.ms.toFixed(1)}ms; history=${history.ms.toFixed(1)}ms; full=${full.ms.toFixed(1)}ms`);
});

test('division current projection preserves scoped results and revisions without a timeline', async () => {
  const state = fixture();
  const database = {
    project: { findUnique: async () => state.project },
    projectPlannedService: { findMany: async () => state.planned }
  };
  const servicesByProject = new Map([[state.project.id, state.services]]);
  const division = { key: JSON.stringify(['SCOPE', 'Escopo A', null]), startDate: '2026-01-10', endDate: '2026-02-10' };
  const options = { database, servicesByProject, includeRevision: true };
  const full = await computeDivisionProgressDetails(state.project.id, division, options);
  const current = await computeDivisionProgressDetails(state.project.id, division, { ...options, currentOnly: true });
  assert.deepEqual(current.progress, full.progress);
  assert.equal(current.progressRevision, full.progressRevision);
  assert.deepEqual(current.progressHistory, []);
  assert.ok(full.progressHistory.length > 0);
  const changed = await computeDivisionProgressDetails(state.project.id, { ...division, endDate: '2026-02-09' }, options);
  assert.notEqual(changed.progressRevision, current.progressRevision);
});

test('current-only progress preserves date eligibility, source filtering, values over 100%, manual zero and null', async () => {
  const state = fixture(), ids = [state.project.id];
  state.planned.splice(1);
  state.planned[0].systems.splice(1);
  state.services.splice(0, state.services.length, ...[
    { finalized: true, reportType: 'RDO', reportDate: new Date('2026-09-01'), quantity: 125 },
    { finalized: true, reportType: 'RDO', reportDate: null, quantity: 500 },
    { finalized: false, reportType: 'RDO', reportDate: new Date('2026-09-02'), quantity: 500 },
    { finalized: true, reportType: 'RLQ', reportDate: new Date('2026-09-02'), specialConditions: { parentRdoId: 'parent' }, quantity: 500 }
  ].map(({ quantity, ...source }) => ({ ...source, serviceType: 'LIMPEZA_QUIMICA',
    extraData: { __projectSystemId: state.planned[0].systems[0].projectSystemId, tubes: [{ c: quantity, lengthUnit: 'm' }] } })));
  const options = { database: state.database, servicesByProject: new Map([[ids[0], state.services]]) };
  async function compare(expected, method) {
    const full = (await computeProgressDetailsForProjects(ids, options)).get(ids[0]);
    const current = (await computeProgressDetailsForProjects(ids, { ...options, currentOnly: true })).get(ids[0]);
    assert.deepEqual(current.progress, full.progress);
    assert.equal(current.progress.progressPct, expected);
    assert.equal(current.progress.progressMethod, method);
  }
  await compare(125, 'RDO');
  state.planned.length = 0;
  for (const value of [18, 0, null]) {
    state.project.manualProgressPct = value;
    await compare(value, value === null ? null : 'MANUAL');
  }
});
