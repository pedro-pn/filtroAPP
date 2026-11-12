import assert from 'node:assert/strict';
import test from 'node:test';
import { progressSourceRevision } from '../src/lib/acompanhamento/progress-projection.js';
import { computeDivisionProgressDetails, computeProgressDetailsForProjects } from '../src/lib/acompanhamento/avanco.js';

test('revision ignores object-key and unordered service-row order while preserving every source value', () => {
  const services = [{ reportDate: new Date('2026-09-02'), finalized: true, extraData: { volumeOleo: 20, tubes: [{ c: 1 }, { c: 2 }] } },
    { reportDate: new Date('2026-09-01'), finalized: false, extraData: { volumeOleo: 10 } }];
  const sources = { project: { id: 'p', proposalPercentage: 100 }, serviceReports: services,
    planned: [{ id: 'a' }, { id: 'b' }], manualHistory: [{ progressPct: 10 }, { progressPct: 20 }] };
  const original = structuredClone(sources), options = { unorderedArrays: ['serviceReports'] };
  const initial = progressSourceRevision(sources, options);
  const reordered = { ...sources, project: { proposalPercentage: 100, id: 'p' }, serviceReports: [...services].reverse() };
  assert.equal(progressSourceRevision(reordered, options), initial);
  for (const mutate of [
    state => { state.serviceReports[0].extraData.volumeOleo++; },
    state => { state.serviceReports[0].finalized = false; },
    state => { state.serviceReports[0].reportDate = new Date('2026-09-03'); },
    state => { state.serviceReports.push(structuredClone(state.serviceReports[0])); },
    state => { state.serviceReports[0].extraData.tubes.reverse(); },
    state => { state.planned.reverse(); },
    state => { state.manualHistory.reverse(); }
  ]) {
    const changed = structuredClone(sources); mutate(changed);
    assert.notEqual(progressSourceRevision(changed, options), initial);
  }
  assert.deepEqual(sources, original);
});

test('project and division revisions remain stable when the database returns service rows in another order', async () => {
  const project = { id: 'p', proposalPercentage: 100 };
  const planned = [{ projectId: 'p', serviceType: 'FLUSHING', weight: 1, systems: [{
    systemType: 'TUBULACAO', unit: 'M', quantity: 100
  }] }];
  let services = [1, 2, 3].map(day => ({ serviceType: 'FLUSHING', finalized: true, reportType: 'RDO',
    reportDate: new Date(`2026-09-0${day}`), extraData: { tubes: [{ c: day, lengthUnit: 'm' }] } }));
  const database = { project: { findMany: async () => [project], findUnique: async () => project },
    projectPlannedService: { findMany: async () => planned }, projectManualProgressHistory: { findMany: async () => [] } };
  const division = { key: JSON.stringify(['DATE', 'period', null]), startDate: '2026-09-01', endDate: '2026-09-30' };
  const read = async () => {
    const options = { database, servicesByProject: new Map([['p', services]]), currentOnly: true, includeRevision: true };
    return { project: (await computeProgressDetailsForProjects(['p'], options)).get('p'),
      division: await computeDivisionProgressDetails('p', division, options) };
  };
  const before = await read();
  services = [...services].reverse();
  assert.deepEqual(await read(), before);
  services[0] = { ...services[0], extraData: { tubes: [{ c: 50, lengthUnit: 'm' }] } };
  const changed = await read();
  assert.notEqual(changed.project.progressRevision, before.project.progressRevision);
  assert.notEqual(changed.division.progressRevision, before.division.progressRevision);
});
