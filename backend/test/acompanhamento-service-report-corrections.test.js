import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma.js';
import { computeProgressForProjects, computeProgressDetailsForProjects, loadReportServicesByProject } from '../src/lib/acompanhamento/avanco.js';
import { loadWeeklyServiceHistory } from '../src/lib/acompanhamento/weekly-service-history.js';

test('correções após assinatura atualizam avanço, recortes, histórico e metas sem duplicar o derivado ou alterar o RDO', async t => {
  const projectId = 'correction-project';
  const pipeSystem = { id: 'pipe-system', equipment: 'Unidade Geradora 14', name: 'Tubulação', aliases: [] };
  const oilSystem = { id: 'oil-system', equipment: 'Unidade Geradora 14', name: 'Óleo', aliases: [] };
  const otherSystem = { ...pipeSystem, id: 'other-system', equipment: 'Unidade Geradora 01' };
  const makeService = (id, serviceType, system, extraData) => ({ id, serviceType, finalized: true,
    system: system.name, extraData: { __scopeName: 'Jupiá', __scopeKey: '"Jupiá"', __projectSystemId: system.id, equipmentId: system.equipment, ...extraData } });
  const pipe = makeService('pipe', 'limpeza', pipeSystem, { tubes: [{ d: '2', unit: 'pol', c: '10', lengthUnit: 'm' }] });
  const oil = makeService('oil', 'filtragem', oilSystem, { volumeOleo: '100', volumeOleoUnit: 'L' });
  const parent = { id: 'signed-rdo', projectId, reportType: 'RDO', status: 'SIGNED', reportDate: new Date('2026-09-28'),
    specialConditions: {}, measurementLinks: [], services: [pipe, oil] };
  const correction = (id, source, extraData, editedAt) => ({ id, projectId, reportType: source === pipe ? 'RLQ' : 'RCPU', status: 'APPROVED',
    reportDate: new Date('2026-10-06'), sequenceNumber: 1,
    specialConditions: { parentRdoId: parent.id, serviceId: source.id, __manualDerivedServiceReportEdit: { editedAt } },
    services: [{ ...source, id: `derived-${source.id}`, extraData }] });
  const correctedPipe = correction('corrected-pipe', pipe, { 'Diâmetros e comprimentos': [{ d: '2', unit: 'pol', c: '2500', lengthUnit: 'cm' }] }, '2026-10-06T12:00:00Z');
  const correctedOil = correction('corrected-oil', oil, { volumeOleo: '2', volumeOleoUnit: 'm3' }, '2026-10-06T12:00:00Z');
  const corrections = [correctedPipe, correctedOil];
  const rawServices = [pipe, oil].map(service => ({ ...service, report: parent }));
  rawServices.push(...corrections.flatMap(report => report.services.map(service => ({ ...service, report }))));
  const snapshot = structuredClone({ parent, rawServices });
  const planned = [
    ['Jupiá', 'LIMPEZA_QUIMICA', pipeSystem, 'TUBULACAO', 'M', 100],
    ['Jupiá', 'FILTRAGEM', oilSystem, 'OLEO', 'L', 1000],
    ['Ilha Solteira', 'LIMPEZA_QUIMICA', otherSystem, 'TUBULACAO', 'M', 100]
  ].map(([scopeName, serviceType, projectSystem, systemType, unit, quantity]) => ({ projectId, scopeName, serviceType, weight: 1,
    systems: [{ projectSystemId: projectSystem.id, projectSystem, systemType, unit, quantity, diameter: systemType === 'TUBULACAO' ? '2' : null, diameterUnit: 'pol' }] }));
  const stub = (model, method, implementation) => {
    const original = prisma[model][method]; prisma[model][method] = implementation;
    t.after(() => { prisma[model][method] = original; });
  };
  stub('project', 'findMany', async () => [{ id: projectId, proposalPercentage: 100, startDate: null, manualProgressPct: null }]);
  stub('project', 'findFirst', async () => ({ id: projectId }));
  stub('projectPlannedService', 'findMany', async () => planned);
  stub('historicalServiceReport', 'findMany', async () => []);
  stub('projectManualProgressHistory', 'findMany', async () => []);
  stub('projectRealizedCorrection', 'findMany', async () => []);
  stub('reportService', 'findMany', async () => rawServices);
  stub('report', 'findMany', async ({ where }) => {
    if (where.reportType === 'RDO') return [];
    assert.equal(where.reportDate, undefined, 'a correção pode ser posterior à data de execução');
    assert.deepEqual(where.projectId, { in: [projectId] });
    assert.deepEqual(where.specialConditions.path, ['__manualDerivedServiceReportEdit', 'editedAt']);
    return corrections;
  });
  const current = (await computeProgressForProjects([projectId])).get(projectId);
  assert.equal(current.services.find(s => s.serviceType === 'LIMPEZA_QUIMICA').totals[0].realizedQty, 25);
  assert.equal(current.services.find(s => s.serviceType === 'FILTRAGEM').totals[0].realizedQty, 2000);
  const details = (await computeProgressDetailsForProjects([projectId])).get(projectId);
  const selected = details.progressSlices.slices[details.progressSlices.lookup['jupia|unidade geradora 14']];
  assert.deepEqual(selected.progress.services.map(s => s.totals[0].realizedQty), [25, 2000]);
  assert.deepEqual(details.dailyProgressHistory.map(point => point.date), ['2026-09-28']);
  assert.deepEqual(details.progressHistory.map(point => point.date), ['2026-09-28']);
  const weekly = await loadWeeklyServiceHistory({ projectId });
  assert.deepEqual(weekly.map(point => [point.date, point.serviceType, point.quantities.M, point.quantities.L]), [
    ['2026-09-28', 'LIMPEZA_QUIMICA', 25, 0], ['2026-09-28', 'FILTRAGEM', 0, 2000]
  ]);
  assert.deepEqual({ parent, rawServices }, snapshot);

  corrections[1] = correction('zero-oil', oil, { volumeOleo: '0', tubes: [] }, '2026-10-07T12:00:00Z');
  const zero = (await computeProgressForProjects([projectId])).get(projectId);
  assert.equal(zero.services.find(s => s.serviceType === 'FILTRAGEM').totals[0].realizedQty, 0);
  const projected = (await loadReportServicesByProject([projectId])).get(projectId);
  assert.equal(projected.find(s => s.serviceType === 'filtragem' && s.reportType === 'RDO').extraData.__scopeName, 'Jupiá');
  assert.deepEqual({ parent, rawServices }, snapshot);
});
