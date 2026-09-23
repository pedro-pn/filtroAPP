import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRoleParamsResolver } from '../src/lib/acompanhamento/labor-cost.js';
import { estimateReportLaborCostByDate, summarizeReportLaborCost } from '../src/lib/acompanhamento/report-labor-cost.js';
import { buildProjectDetailCollaborator } from '../src/lib/acompanhamento/project-detail.js';

const modelParams = { cargaHoraria: 220, periculosidadePct: 0, fgtsPct: 0, transferenciaPct: 0, confinamentoPct: 0 };
const roleParams = buildRoleParamsResolver({
  models: [{ key: 'operador', parameterSets: [{ effectiveDate: '2026-01-01', params: modelParams }] }],
  roles: [{ name: 'Operador', costProfile: { parameterSets: [
    { effectiveDate: '2026-01-01', params: { salarioBase: 1980 } },
    { effectiveDate: '2026-09-03', params: { salarioBase: 3960 } }
  ] } }]
});
const collaborator = { id: 'c1', jobRole: { name: 'Operador' }, rdoCostSimulationExcluded: false };
const workedMinutesByDate = new Map([['2026-09-02', 570], ['2026-09-04', 540]]);

test('exclusão manual mantém a jornada do RDO, mas deixa custo e valor/hora ausentes em qualquer cargo', () => {
  for (const name of ['Operador', 'Coordenador']) {
    const costs = estimateReportLaborCostByDate({
      collaborator: { ...collaborator, jobRole: { name }, rdoCostSimulationExcluded: true },
      roleParams: { paramsFor: () => { throw new Error('Não deve calcular custo de colaborador excluído'); } },
      workedMinutesByDate
    });
    const detail = buildProjectDetailCollaborator({
      workedMinutes: 1110, workedMinutesByDate, reportCostsByDate: costs, includeCollaboratorCosts: true
    });
    assert.equal(detail.horas, 18.5);
    assert.equal(detail.custo, null);
    assert.equal(detail.custoHora, null);
    assert.equal(detail.custoEstimadoRdo, null);
    assert.equal(detail.custoHoraEstimadoRdo, null);
    assert.ok(detail.horasRelatoriosPorData.every(day => day.custoEstimado === null));
  }
});

test('coordenador sem histórico de ponto continua elegível se não foi excluído manualmente', () => {
  const costs = estimateReportLaborCostByDate({
    collaborator: { ...collaborator, jobRole: { name: 'Coordenador' } },
    roleParams: { paramsFor: () => ({ ...modelParams, salarioBase: 3960 }) },
    workedMinutesByDate
  });
  assert.ok(costs.get('2026-09-02') > 0);
  assert.ok(costs.get('2026-09-04') > 0);
});

test('reincluir colaborador restaura a estimativa sem alterar horas ou custos reais do ponto', () => {
  const inputs = { collaborator: { ...collaborator, rdoCostSimulationExcluded: true }, roleParams, workedMinutesByDate };
  const excludedCosts = estimateReportLaborCostByDate(inputs);
  assert.equal(excludedCosts.size, 0);
  const point = buildProjectDetailCollaborator({
    workedMinutes: 1110, workedMinutesByDate, reportCostsByDate: excludedCosts,
    allocation: { hours: 8.8, cost: 200 }, includeCollaboratorCosts: true
  });
  assert.equal(point.custo, 200);
  assert.equal(point.horasApropriadas, 8.8);
  assert.equal(point.custoEstimadoRdo, null);
  inputs.collaborator.rdoCostSimulationExcluded = false;
  assert.ok(estimateReportLaborCostByDate(inputs).get('2026-09-02') > 0);
});

test('estima jornada real por data, incluindo custos anuais e mudança de salário', () => {
  const costs = estimateReportLaborCostByDate({
    collaborator, roleParams, workedMinutesByDate, annualCosts: { epiAnnualCost: 2640 }
  });
  // HH de 12,50 antes do reajuste e 24,00 após, já com provisões e EPI.
  assert.ok(Math.abs(costs.get('2026-09-02') - 118.75) < 1e-9);
  assert.ok(Math.abs(costs.get('2026-09-04') - 216) < 1e-9);
  const result = buildProjectDetailCollaborator({
    workedMinutes: 1110, workedMinutesByDate, reportCostsByDate: costs, includeCollaboratorCosts: true
  });
  assert.equal(result.horas, 18.5);
  assert.equal(result.custoEstimadoRdo, 334.75);
  assert.equal(result.custoHoraEstimadoRdo, 334.75 / 18.5);
  assert.equal(result.horasApropriadas, null);
  assert.equal(result.custo, null);
});

test('cargo e parâmetros precisam estar vigentes em todas as datas; não exibe total parcial', () => {
  const costs = estimateReportLaborCostByDate({
    collaborator: { ...collaborator, jobRoleHistory: [{ effectiveDate: '2026-09-03', jobRole: collaborator.jobRole }] },
    roleParams, workedMinutesByDate
  });
  assert.equal(costs.get('2026-09-02'), null);
  assert.ok(costs.get('2026-09-04') > 0);
  assert.equal(summarizeReportLaborCost([
    { horas: 9.5, custoEstimado: null }, { horas: 9, custoEstimado: costs.get('2026-09-04') }
  ]).custoEstimadoRdo, null);
  assert.equal(estimateReportLaborCostByDate({
    collaborator, roleParams, workedMinutesByDate: new Map([['2025-12-31', 480]])
  }).get('2025-12-31'), null);
});

test('não expõe a estimativa sem permissão nem substitui uma apropriação do ponto', () => {
  const input = { workedMinutes: 1110, workedMinutesByDate, reportCostsByDate: new Map([['2026-09-02', 100], ['2026-09-04', 90]]) };
  const hidden = buildProjectDetailCollaborator(input);
  assert.equal(hidden.custoEstimadoRdo, null);
  assert.equal(hidden.custoHoraEstimadoRdo, null);
  assert.ok(hidden.horasRelatoriosPorData.every(day => !('custoEstimado' in day)));
  const point = buildProjectDetailCollaborator({ ...input, allocation: { hours: 8.8, cost: 200 }, includeCollaboratorCosts: true });
  assert.equal(point.custo, 200);
  assert.equal(point.custoEstimadoRdo, null);
});

test('modalidade offshore aplica seu custo de exames e treinamentos', () => {
  const inputs = { collaborator, roleParams, workedMinutesByDate: new Map([['2026-09-02', 480]]), annualCosts: {
    examsTrainingAnnualCost: 2640, offshoreExamsTrainingAnnualCost: 5280
  } };
  const away = estimateReportLaborCostByDate(inputs).get('2026-09-02');
  const offshore = estimateReportLaborCostByDate({ ...inputs, project: { offshore: true } }).get('2026-09-02');
  assert.ok(Math.abs(offshore - away - 8) < 1e-9);
});
