import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMonthlyProductiveHours,
  buildProductivityReport,
  computeGeneralRate,
  computeIndividualRate,
  selectAnalyzedMonths
} from '../src/lib/efetivo/productivity.js';
import { EFETIVO_MONTHLY_REFERENCE_DEFAULT as reference } from '../src/lib/efetivo/settings.js';
import { getEfetivoProductivity } from '../src/lib/efetivo/service.js';

const near = (left, right, epsilon = 1e-9) => Math.abs(left - right) <= epsilon;

test('taxa individual tem piso zero e reproduz a média mensal oficial', () => {
  assert.equal(computeIndividualRate({ totalHours: reference + 7, analyzedMonths: 1, reference }), 0);
  assert.ok(near(
    computeIndividualRate({ totalHours: reference - 7, analyzedMonths: 1, reference }),
    7 / reference
  ));
});

test('taxa geral é média simples e fica indisponível sem taxas válidas', () => {
  assert.ok(near(computeGeneralRate([0.04, 0.02, 0.06]), 0.04));
  assert.equal(computeGeneralRate([]), null);
  assert.equal(computeGeneralRate([null, undefined, Number.NaN]), null);
});

test('relatório usa total dividido pelos meses analisados e não depende de perfil de custo', () => {
  const collaborators = [{
    id: 'col-1',
    name: 'Joana',
    jobRoleId: 'role-operator',
    admissionDate: new Date('2026-07-01T00:00:00.000Z'),
    terminationDate: null
  }];
  const periods = [{
    collaboratorId: 'col-1',
    monthly: {
      '2026-07': {
        normalMinutes: (reference - 7) * 60,
        extrasMinutes: 120,
        nightMinutes: 90
      }
    }
  }];
  const base = {
    collaborators,
    periods,
    filters: { year: 2026, cutoffMonth: 7, currentMonth: '2026-08' },
    reference,
    absences: []
  };
  const withoutCost = buildProductivityReport({
    ...base,
    jobRoles: [{ id: 'role-operator', name: 'Operadora', isOperational: true }]
  });
  const withCost = buildProductivityReport({
    ...base,
    jobRoles: [{ id: 'role-operator', name: 'Operadora', isOperational: true, costProfile: { id: 'irrelevante' } }]
  });

  assert.deepEqual(withCost, withoutCost);
  assert.equal(withoutCost.colaboradores[0].mediaMensal, reference - 7);
  assert.equal(withoutCost.colaboradores[0].mesesAnalisados, 1);
  assert.ok(near(withoutCost.colaboradores[0].improdutividade, 7 / reference));
});

test('relatório sem colaborador elegível devolve taxa geral indisponível', () => {
  const report = buildProductivityReport({
    collaborators: [],
    jobRoles: [],
    periods: [],
    filters: { year: 2026, cutoffMonth: 7, currentMonth: '2026-08' },
    reference,
    absences: []
  });
  assert.equal(report.resumo.taxaGeral, null);
  assert.notEqual(report.resumo.taxaGeral, 0);
});

test('HH produtivas usam só horas normais nos formatos mensal v1 e v2', () => {
  const monthly = buildMonthlyProductiveHours([
    {
      collaboratorId: 'col-1',
      monthly: {
        '2026-01': {
          normalMinutes: 600,
          extrasMinutes: 210,
          he70Minutes: 70,
          he100Minutes: 100,
          nightMinutes: 90
        }
      }
    },
    {
      collaboratorId: 'col-1',
      monthly: {
        schemaVersion: 2,
        months: {
          '2026-02': {
            normalMinutes: 540,
            extrasMinutes: 240,
            genericOvertimeMinutes: 70,
            he70Minutes: 70,
            he100Minutes: 100,
            nightMinutes: 120
          }
        }
      }
    }
  ]);

  assert.deepEqual(monthly.get('col-1').get('2026-01'), {
    normalHours: 10,
    excludedOvertimeHours: 3.5
  });
  assert.deepEqual(monthly.get('col-1').get('2026-02'), {
    normalHours: 9,
    excludedOvertimeHours: 4
  });
});

test('meses analisados aplicam pró-rata só na admissão e no desligamento', () => {
  const analyzed = selectAnalyzedMonths({
    year: 2026,
    cutoffMonth: 12,
    admissionDate: new Date('2026-01-16T00:00:00.000Z'),
    terminationDate: new Date('2026-03-16T00:00:00.000Z'),
    currentMonth: '2026-08',
    absences: [{ startDate: '2026-02-01', endDate: '2026-02-28' }]
  });

  assert.deepEqual(analyzed.map(item => item.month), ['2026-01', '2026-02', '2026-03']);
  assert.ok(near(analyzed[0].weight, 16 / 31));
  assert.equal(analyzed[1].weight, 1);
  assert.ok(near(analyzed[2].weight, 16 / 31));
});

test('mês corrente e meses futuros permanecem fora mesmo com corte posterior', () => {
  const analyzed = selectAnalyzedMonths({
    year: 2026,
    cutoffMonth: 12,
    admissionDate: new Date('2026-07-01T00:00:00.000Z'),
    terminationDate: null,
    currentMonth: '2026-08'
  });
  assert.deepEqual(analyzed, [{ month: '2026-07', weight: 1 }]);
});

test('mês de corte limita os meses analisados no backend', () => {
  const analyzed = selectAnalyzedMonths({
    year: 2025,
    cutoffMonth: 2,
    admissionDate: new Date('2025-01-01T00:00:00.000Z'),
    terminationDate: null,
    currentMonth: '2026-08'
  });
  assert.deepEqual(analyzed, [
    { month: '2025-01', weight: 1 },
    { month: '2025-02', weight: 1 }
  ]);
});

test('serviço explicita ponto sem vínculo, ausência de dados e cargo não cadastrado', async () => {
  const rows = [
    {
      id: 'linked',
      collaboratorId: 'col-linked',
      externalEmployeeId: 'employee-linked',
      rawName: 'Ligada',
      normalizedName: 'ligada',
      monthly: { '2025-01': { normalMinutes: reference * 60, extrasMinutes: 0 } }
    },
    {
      id: 'unlinked',
      collaboratorId: null,
      externalEmployeeId: 'employee-pending',
      rawName: 'Sem vínculo',
      normalizedName: 'sem vinculo'
    },
    {
      id: 'ignored',
      collaboratorId: null,
      externalEmployeeId: 'employee-ignored',
      rawName: 'Ignorada',
      normalizedName: 'ignorada'
    }
  ];
  const collaborators = [
    { id: 'col-linked', name: 'Ligada', jobRoleId: 'role-1', jobRole: { id: 'role-1', name: 'Operadora' }, admissionDate: null, terminationDate: null, isActive: true },
    { id: 'col-empty', name: 'Sem dados', jobRoleId: 'role-1', jobRole: { id: 'role-1', name: 'Operadora' }, admissionDate: null, terminationDate: null, isActive: true },
    { id: 'col-role', name: 'Cargo livre', jobRoleId: null, jobRole: null, admissionDate: null, terminationDate: null, isActive: true }
  ];
  const database = {
    pontoPeriodSummary: { findMany: async () => rows },
    pontoExternalEmployee: { findMany: async () => [{ externalEmployeeId: 'employee-ignored' }] },
    collaborator: { findMany: async () => collaborators },
    jobRole: { findMany: async () => [{ id: 'role-1', name: 'Operadora', isOperational: true, isActive: true }] },
    collaboratorAbsence: { findMany: async () => [] },
    pontoSyncState: { findUnique: async () => null },
    efetivoSetting: { findUnique: async () => null }
  };
  const laborCost = {
    filterIgnoredPontoPeriods(periods, ignoredIds) {
      return periods.filter(period => !ignoredIds.includes(period.externalEmployeeId));
    },
    mergePontoPeriods(periods) {
      return periods;
    }
  };

  const report = await getEfetivoProductivity(
    { ano: 2025, ateMes: 1 },
    { database, laborCost, now: new Date('2026-08-21T12:00:00.000Z') }
  );
  assert.deepEqual(report.pendentes.map(item => item.tipo).sort(), [
    'CARGO_NAO_CADASTRADO',
    'PONTO_SEM_VINCULO',
    'SEM_DADOS_PERIODO'
  ]);
  assert.equal(report.resumo.pendencias, 3);
  assert.equal(report.pendentes.some(item => item.descricao.includes('Ignorada')), false);
});

test('cargo não operacional sai da taxa e o default operacional preserva o cálculo', () => {
  const report = buildProductivityReport({
    collaborators: [
      { id: 'operational-default', name: 'Operacional', jobRoleId: 'role-field', admissionDate: null, terminationDate: null },
      { id: 'administrative', name: 'Administrativa', jobRoleId: 'role-admin', admissionDate: null, terminationDate: null }
    ],
    jobRoles: [
      { id: 'role-field', name: 'Campo' },
      { id: 'role-admin', name: 'Administrativo', isOperational: false }
    ],
    periods: [
      { collaboratorId: 'operational-default', monthly: { '2025-01': { normalMinutes: reference * 60 } } },
      { collaboratorId: 'administrative', monthly: { '2025-01': { normalMinutes: 0 } } }
    ],
    filters: { year: 2025, cutoffMonth: 1, currentMonth: '2026-08' },
    reference,
    absences: []
  });
  assert.deepEqual(report.colaboradores.map(item => item.id), ['operational-default']);
  assert.equal(report.resumo.taxaGeral, 0);
});

test('férias marcam o mês sem reduzir denominador nem alterar a taxa oficial', () => {
  const base = {
    collaborators: [{ id: 'vacation', name: 'Férias', jobRoleId: 'role-field', admissionDate: null, terminationDate: null }],
    jobRoles: [{ id: 'role-field', name: 'Campo', isOperational: true }],
    periods: [{ collaboratorId: 'vacation', monthly: { '2025-01': { normalMinutes: (reference - 7) * 60 } } }],
    filters: { year: 2025, cutoffMonth: 1, currentMonth: '2026-08' },
    reference
  };
  const withoutVacation = buildProductivityReport({ ...base, absences: [] });
  const withVacation = buildProductivityReport({
    ...base,
    absences: [{
      collaboratorId: 'vacation',
      type: 'FERIAS',
      startDate: '2025-01-10',
      endDate: '2025-01-20',
      deletedAt: null
    }]
  });
  assert.equal(withVacation.colaboradores[0].mesesAnalisados, withoutVacation.colaboradores[0].mesesAnalisados);
  assert.equal(withVacation.colaboradores[0].improdutividade, withoutVacation.colaboradores[0].improdutividade);
  assert.deepEqual(withVacation.colaboradores[0].mesesComFerias, ['2025-01']);
  assert.equal(withVacation.evolucaoMensal[0].temFerias, true);
});

test('soma das HH mensais do detalhe bate com o acumulado da lista', () => {
  const report = buildProductivityReport({
    collaborators: [{ id: 'detail', name: 'Detalhada', jobRoleId: 'role-field', admissionDate: null, terminationDate: null }],
    jobRoles: [{ id: 'role-field', name: 'Campo', isOperational: true }],
    periods: [{
      collaboratorId: 'detail',
      monthly: {
        '2025-01': { normalMinutes: 6000, extrasMinutes: 60 },
        '2025-02': { normalMinutes: 6600, extrasMinutes: 120 }
      }
    }],
    filters: { year: 2025, cutoffMonth: 2, currentMonth: '2026-08' },
    reference,
    absences: []
  });
  const summary = report.colaboradores.find(item => item.id === 'detail');
  const detail = report.detalhesPorColaborador.get('detail');
  assert.equal(detail.reduce((total, month) => total + month.hhNormais, 0), summary.hhAcumuladas);
});

test('situação do colaborador separa consolidado, instável e sem base', async () => {
  const { collaboratorProductivityStatus } = await import('../src/lib/efetivo/productivity.js');
  assert.equal(collaboratorProductivityStatus({ rate: 0.04, analyzedMonths: 3, months: [{ instavel: false }, { instavel: false }] }), 'CONSOLIDADO');
  assert.equal(collaboratorProductivityStatus({ rate: 0.04, analyzedMonths: 3, months: [{ instavel: false }, { instavel: true }] }), 'PODE_MUDAR');
  assert.equal(collaboratorProductivityStatus({ rate: null, analyzedMonths: 0, months: [] }), 'SEM_BASE');
  assert.equal(collaboratorProductivityStatus({ rate: 0.1, analyzedMonths: 0, months: [] }), 'SEM_BASE');
});
