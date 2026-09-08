import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocationDecisionRequiresAction,
  buildDailyProjectWeights,
  buildEffectiveAllocationIndex,
  effectiveProjectsForCollaborator,
  effectiveProjectsForDay,
  buildMissionGroupProjectIndex,
  buildScheduleWindowEligibility,
  buildScheduleWindows,
  scheduleWindowsForDay,
  buildRoleParamsResolver,
  buildCollaboratorRoleCostSegments,
  classifyProjectHours,
  computeAnalyticalProjectCosts,
  computeCollaboratorCost,
  examsTrainingAnnualCostForMonth,
  effectiveParameterSetAt,
  filterIgnoredPontoPeriods,
  mergePontoPeriods,
  offshoreYearsByCollaboratorFromReports,
  rdoDataByCollaboratorFromReports,
  serviceIntervalsWorkedMinutes,
  isPontoTravelTag,
  splitOvertime,
  splitOvertimeDays
} from '../src/lib/acompanhamento/labor-cost.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const PARAMS = {
  salarioBase: 4086.57, salarioMinimo: 1621, insalubridade: 324.2, cargaHoraria: 220, diasUteis: 22,
  periculosidadePct: 0.3, produtividadePct: 0.15, transferenciaPct: 0.3,
  confinamentoPct: 0.4, he70Pct: 0.7, he100Pct: 1, fgtsPct: 0.08, multaPct: 0.5,
  beneficios: { seguroVida: 50, valeAlimentacao: 600, planoSaude: 500, odonto: 18, cursos: 300, moradia: 1000 }
};

function sedeMaisFolga(idle) {
  return idle.sede.cost + idle.folga.cost;
}

test('teto de HE70 (30h): excesso vira 100%', () => {
  const a = splitOvertime(38.01, 30);
  assert.ok(near(a.he70Horas, 30) && near(a.he100Horas, 8.01));
  const b = splitOvertime(25, 30);
  assert.ok(near(b.he70Horas, 25) && near(b.he100Horas, 0));
  const c = splitOvertime(0, 30);
  assert.ok(near(c.he70Horas, 0) && near(c.he100Horas, 0));
});

test('HE genérica usa o teto mensal sem reclassificar percentuais explícitos', () => {
  const days = splitOvertimeDays([
    { date: '2026-08-01', genericOvertimeHoras: 29, he70Horas: 2, he100Horas: 1, explicitOvertime: true },
    { date: '2026-08-02', genericOvertimeHoras: 4, he70Horas: 0, he100Horas: 3, explicitOvertime: true }
  ], 30);

  assert.deepEqual(days.map(day => ({ he70: day.he70Horas, he100: day.he100Horas })), [
    { he70: 31, he100: 1 },
    { he70: 1, he100: 6 }
  ]);
  assert.equal(days.reduce((sum, day) => sum + day.he70Horas + day.he100Horas, 0), 39);
});

test('parâmetros de custo respeitam data de vigência do salário', () => {
  const sets = [
    { version: 1, effectiveDate: new Date('1970-01-01T00:00:00.000Z'), params: { salarioBase: 1000 } },
    { version: 2, effectiveDate: new Date('2026-07-10T00:00:00.000Z'), params: { salarioBase: 2000 } }
  ];
  assert.equal(effectiveParameterSetAt(sets, '2026-03-31').version, 1);
  assert.equal(effectiveParameterSetAt(sets, '2026-07-10').version, 2);

  const resolver = buildRoleParamsResolver({
    models: [
      {
        key: 'operador',
        parameterSets: [
          { version: 1, effectiveDate: new Date('1970-01-01T00:00:00.000Z'), params: { salarioBase: 1000, transferenciaPct: 0.3 } },
          { version: 2, effectiveDate: new Date('2026-07-15T00:00:00.000Z'), params: { salarioBase: 1200, transferenciaPct: 0.4 } }
        ]
      }
    ],
    roles: [
      {
        name: 'Operador',
        costProfile: {
          parameterSets: [
            { version: 1, effectiveDate: new Date('1970-01-01T00:00:00.000Z'), params: { baseModel: 'operador', salarioBase: 3000, insalubridade: 300 } },
            { version: 2, effectiveDate: new Date('2026-07-10T00:00:00.000Z'), params: { baseModel: 'operador', salarioBase: 4000, insalubridade: 300 } }
          ]
        }
      }
    ]
  });

  assert.equal(resolver.paramsFor('Operador', '2026-03-31').salarioBase, 3000);
  assert.equal(resolver.paramsFor('Operador', '2026-07-09').salarioBase, 3000);
  assert.equal(resolver.paramsFor('Operador', '2026-07-10').salarioBase, 4000);
  assert.equal(resolver.paramsFor('Operador', '2026-07-14').transferenciaPct, 0.3);
  assert.equal(resolver.paramsFor('Operador', '2026-07-15').transferenciaPct, 0.4);
});

test('mudança de cargo divide os parâmetros de custo na data efetiva', () => {
  const resolver = buildRoleParamsResolver({
    models: [{
      key: 'operador',
      parameterSets: [{ version: 1, effectiveDate: new Date('1970-01-01T00:00:00.000Z'), params: { salarioBase: 1000 } }]
    }],
    roles: [
      { name: 'Operador', costProfile: { parameterSets: [{ version: 1, effectiveDate: new Date('1970-01-01T00:00:00.000Z'), params: { baseModel: 'operador', salarioBase: 3000 } }] } },
      { name: 'Supervisor', costProfile: { parameterSets: [{ version: 1, effectiveDate: new Date('1970-01-01T00:00:00.000Z'), params: { baseModel: 'operador', salarioBase: 5000 } }] } }
    ]
  });
  const collaborator = {
    jobRoleId: 'role-2',
    jobRole: { id: 'role-2', name: 'Supervisor' },
    jobRoleHistory: [
      { jobRoleId: 'role-1', effectiveDate: new Date('2026-01-01T00:00:00.000Z'), jobRole: { id: 'role-1', name: 'Operador' } },
      { jobRoleId: 'role-2', effectiveDate: new Date('2026-01-15T00:00:00.000Z'), jobRole: { id: 'role-2', name: 'Supervisor' } }
    ]
  };

  const segments = buildCollaboratorRoleCostSegments({ collaborator, roleParams: resolver, startKey: '2026-01-01', endKey: '2026-01-31' });
  assert.deepEqual(segments.map(segment => ({
    roleName: segment.roleName,
    startKey: segment.startKey,
    endKey: segment.endKey,
    salarioBase: segment.params.salarioBase
  })), [
    { roleName: 'Operador', startKey: '2026-01-01', endKey: '2026-01-14', salarioBase: 3000 },
    { roleName: 'Supervisor', startKey: '2026-01-15', endKey: '2026-01-31', salarioBase: 5000 }
  ]);
});

test('prova real: Σ projetos + sede + folga = folha', () => {
  const r = computeCollaboratorCost({
    params: PARAMS, epiMensal: 5000 / 12,
    normalHours: 176, he70Horas: 20, he100Horas: 4, folgaHours: 8.8 * 3,
    projects: [
      { pid: 'A', rdoDaysHours: 88, awayDaysHours: 88, rdoWorkedHours: 90, offshore: false },
      { pid: 'B', rdoDaysHours: 44, awayDaysHours: 44, rdoWorkedHours: 45, offshore: false }
    ]
  });
  const somaProjetos = Object.values(r.byProject).reduce((s, p) => s + p.cost, 0);
  assert.ok(near(somaProjetos + sedeMaisFolga(r.idle), r.folha), 'Σ projetos + sede + folga = folha');
  assert.ok(near(r.idle.folga.hours, 8.8 * 3), 'folga = horas de folga informadas');
  assert.ok(r.idle.sede.hours > 0, 'sede = normais não alocadas (44h sem projeto)');
});

test('exames e treinamentos entram como custo fixo mensal igual ao EPI', () => {
  const base = {
    params: PARAMS, epiMensal: 0, normalHours: 176, he70Horas: 0, he100Horas: 0, folgaHours: 0,
    projects: []
  };
  const withoutCost = computeCollaboratorCost(base);
  const withCost = computeCollaboratorCost({ ...base, examsTrainingMensal: 1200 / 12 });
  const partial = computeCollaboratorCost({ ...base, examsTrainingMensal: 1200 / 12, fixedCoverage: 0.5 });

  assert.ok(near(withCost.folha - withoutCost.folha, 100));
  assert.ok(near(partial.folha - computeCollaboratorCost({ ...base, fixedCoverage: 0.5 }).folha, 50));
});

test('exames e treinamentos usam valor offshore quando colaborador teve offshore no ano', () => {
  const offshoreYears = offshoreYearsByCollaboratorFromReports([
    {
      reportDate: '2026-03-10T00:00:00.000Z',
      project: { offshore: true },
      collaborators: [{ collaboratorId: 'col-1' }]
    },
    {
      reportDate: '2026-04-10T00:00:00.000Z',
      project: { offshore: false },
      collaborators: [{ collaboratorId: 'col-2' }]
    },
    {
      reportDate: '2025-12-10T00:00:00.000Z',
      project: { offshore: true },
      collaborators: [{ collaboratorId: 'col-3' }]
    }
  ]);

  const params = {
    offshoreYearsByCollaborator: offshoreYears,
    examsTrainingAnnualCost: 1200,
    offshoreExamsTrainingAnnualCost: 3600
  };
  assert.equal(examsTrainingAnnualCostForMonth({ ...params, collaboratorId: 'col-1', monthKey: '2026-07' }), 3600);
  assert.equal(examsTrainingAnnualCostForMonth({ ...params, collaboratorId: 'col-2', monthKey: '2026-07' }), 1200);
  assert.equal(examsTrainingAnnualCostForMonth({ ...params, collaboratorId: 'col-3', monthKey: '2026-07' }), 1200);
  assert.equal(examsTrainingAnnualCostForMonth({ ...params, collaboratorId: 'col-3', monthKey: '2025-12' }), 3600);
});

test('mês parcial: fixo proporcional à cobertura', () => {
  const base = {
    params: PARAMS, epiMensal: 0, normalHours: 44, he70Horas: 0, he100Horas: 0, folgaHours: 0,
    projects: [{ pid: 'A', rdoDaysHours: 44, awayDaysHours: 44, rdoWorkedHours: 44, offshore: false }]
  };
  const cheio = computeCollaboratorCost({ ...base, fixedCoverage: 1 });
  const parcial = computeCollaboratorCost({ ...base, fixedCoverage: 7 / 31 });
  // O fixo (base do motor) cai proporcional; o variável (dias reais) não muda.
  assert.ok(near(parcial.fixoMensal, cheio.fixoMensal * (7 / 31)));
  assert.ok(near(parcial.variavelMensal, cheio.variavelMensal));
  assert.ok(parcial.folha < cheio.folha);
});

test('sem projeto: tudo vira sobra (sede/folga) e fecha a folha', () => {
  const r = computeCollaboratorCost({
    params: PARAMS, epiMensal: 0, normalHours: 88, he70Horas: 0, he100Horas: 0, folgaHours: 8.8 * 2,
    projects: []
  });
  assert.equal(Object.keys(r.byProject).length, 0);
  assert.ok(near(sedeMaisFolga(r.idle), r.folha));
  assert.ok(near(r.idle.folga.hours, 8.8 * 2));
});

test('planilhas de ponto são consolidadas sem somar dias repetidos', () => {
  const periods = mergePontoPeriods([
    {
      collaboratorId: 'col-1',
      rawName: 'João',
      normalizedName: 'joao',
      collaborator: { id: 'col-1', name: 'João', role: 'Operador' },
      import: { createdAt: '2026-07-13T10:00:00.000Z' },
      monthly: {
        '2026-01': {
          normalMinutes: 480,
          extrasMinutes: 30,
          nightMinutes: 0,
          workedDates: ['2026-01-01'],
          days: [{ date: '2026-01-01', workedMinutes: 480, extrasMinutes: 30, nightMinutes: 0 }]
        }
      },
      workedDates: ['2026-01-01'],
      workedMinutes: 480,
      he70Minutes: 30,
      he100Minutes: 0,
      nightMinutes: 0
    },
    {
      collaboratorId: 'col-1',
      rawName: 'João',
      normalizedName: 'joao',
      collaborator: { id: 'col-1', name: 'João', role: 'Operador' },
      import: { createdAt: '2026-07-13T11:00:00.000Z' },
      monthly: {
        '2026-01': {
          normalMinutes: 1140,
          extrasMinutes: 90,
          nightMinutes: 15,
          workedDates: ['2026-01-01', '2026-01-02'],
          days: [
            { date: '2026-01-01', workedMinutes: 600, extrasMinutes: 60, nightMinutes: 15 },
            { date: '2026-01-02', workedMinutes: 540, extrasMinutes: 30, nightMinutes: 0 }
          ]
        }
      },
      workedDates: ['2026-01-01', '2026-01-02'],
      workedMinutes: 1140,
      he70Minutes: 90,
      he100Minutes: 0,
      nightMinutes: 15
    },
    {
      collaboratorId: 'col-1',
      rawName: 'João',
      normalizedName: 'joao',
      collaborator: { id: 'col-1', name: 'João', role: 'Operador' },
      import: { createdAt: '2026-07-13T09:00:00.000Z' },
      monthly: {
        '2026-02': {
          normalMinutes: 480,
          extrasMinutes: 0,
          nightMinutes: 0,
          workedDates: ['2026-02-01'],
          days: [{ date: '2026-02-01', workedMinutes: 480, extrasMinutes: 0, nightMinutes: 0 }]
        }
      },
      workedDates: ['2026-02-01'],
      workedMinutes: 480,
      he70Minutes: 0,
      he100Minutes: 0,
      nightMinutes: 0
    }
  ]);

  assert.equal(periods.length, 1);
  const period = periods[0];
  assert.deepEqual(period.workedDates, ['2026-01-01', '2026-01-02', '2026-02-01']);
  assert.equal(period.workedMinutes, 600 + 540 + 480);
  assert.equal(period.monthly['2026-01'].normalMinutes, 1140);
  assert.equal(period.monthly['2026-01'].extrasMinutes, 90);
  assert.equal(period.monthly['2026-02'].normalMinutes, 480);
});

test('períodos históricos de colaboradores externos ignorados não entram no custo vigente', () => {
  const periods = [
    { externalEmployeeId: 'operacao-1', workedMinutes: 480 },
    { externalEmployeeId: 'administrativo-1', workedMinutes: 480 },
    { externalEmployeeId: null, workedMinutes: 480 }
  ];

  assert.deepEqual(
    filterIgnoredPontoPeriods(periods, ['administrativo-1']),
    [periods[0], periods[2]]
  );
});

test('snapshot v2 preserva HE explícita e etiquetas por dia', () => {
  const [period] = mergePontoPeriods([{
    collaboratorId: 'col-v2',
    rawName: 'Colaborador Teste',
    normalizedName: 'colaborador teste',
    import: { createdAt: '2026-08-14T10:00:00.000Z' },
    monthly: {
      schemaVersion: 2,
      months: {
        '2026-08': {
          days: [{
            date: '2026-08-03',
            workedMinutes: 480,
            he70Minutes: 70,
            he100Minutes: 100,
            nightMinutes: 30,
            tags: ['Missão 5745', 'Missão 5752', 'Missão 5745']
          }]
        }
      }
    }
  }]);

  assert.equal(period.workedMinutes, 480);
  assert.equal(period.he70Minutes, 70);
  assert.equal(period.he100Minutes, 100);
  assert.equal(period.nightMinutes, 30);
  assert.equal(period.monthly.schemaVersion, 2);
  assert.deepEqual(period.monthly.months['2026-08'].days[0].tags, ['Missão 5745', 'Missão 5752']);
});

test('ponto sem RDO não gera gratificação nem outras verbas variáveis', () => {
  const noRdo = computeCollaboratorCost({
    params: PARAMS, epiMensal: 0, normalHours: 88, he70Horas: 0, he100Horas: 0, folgaHours: 0,
    projects: []
  });
  const noHours = computeCollaboratorCost({
    params: PARAMS, epiMensal: 0, normalHours: 0, he70Horas: 0, he100Horas: 0, folgaHours: 0,
    projects: []
  });
  assert.ok(near(noRdo.folha, noHours.folha));
  assert.ok(near(noRdo.variavelMensal, 0));
});

test('relatórios somente serviço derivam horas pela união dos intervalos', () => {
  assert.equal(serviceIntervalsWorkedMinutes([
    { startTime: '08:00', endTime: '12:00' },
    { startTime: '14:00', endTime: '16:00' }
  ]), 360);
  assert.equal(serviceIntervalsWorkedMinutes([
    { startTime: '08:00', endTime: '12:00' },
    { startTime: '10:00', endTime: '14:00' }
  ]), 360);
  assert.equal(serviceIntervalsWorkedMinutes([
    { startTime: '22:00', endTime: '02:00' }
  ]), 240);
  assert.equal(serviceIntervalsWorkedMinutes([
    { startTime: '08:00', endTime: null },
    { startTime: null, endTime: '12:00' }
  ]), 0);
});

test('dados de RDO incluem manuais e relatórios de serviço com horas sem dupla contagem', () => {
  const reports = [
    {
      projectId: 'projeto-rdo',
      reportType: 'RDO',
      sequenceNumber: 17,
      reportDate: '2026-07-13T00:00:00.000Z',
      daytimeWorkedMinutes: 480,
      nighttimeWorkedMinutes: 0,
      project: { code: '5800', offshore: false, laborSleepModeByCollaborator: {} },
      collaborators: [{ collaboratorId: 'col-1' }],
      services: []
    },
    {
      projectId: 'projeto-servico',
      reportType: 'RTP',
      reportDate: '2026-07-13T00:00:00.000Z',
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      project: { offshore: false, laborSleepModeByCollaborator: {} },
      collaborators: [{ collaboratorId: 'col-1' }, { collaboratorId: 'col-2' }],
      services: [
        { startTime: '08:00', endTime: '12:00' },
        { startTime: '10:00', endTime: '14:00' }
      ]
    },
    {
      projectId: 'projeto-rdo',
      reportType: 'RTP',
      reportDate: '2026-07-13T00:00:00.000Z',
      daytimeWorkedMinutes: 540,
      nighttimeWorkedMinutes: 0,
      project: { code: '5800', offshore: false, laborSleepModeByCollaborator: {} },
      collaborators: [{ collaboratorId: 'col-1' }],
      services: []
    },
    {
      projectId: 'projeto-manual-rtp',
      reportType: 'RTP',
      reportDate: '2026-07-14T00:00:00.000Z',
      daytimeWorkedMinutes: 240,
      nighttimeWorkedMinutes: 0,
      project: { offshore: false, laborSleepModeByCollaborator: {} },
      collaborators: [{ collaboratorId: 'col-2' }],
      services: [
        { startTime: '08:00', endTime: '17:00' }
      ]
    },
    {
      projectId: 'projeto-sem-horas',
      reportType: 'RTP',
      reportDate: '2026-07-15T00:00:00.000Z',
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      project: { offshore: false, laborSleepModeByCollaborator: {} },
      collaborators: [{ collaboratorId: 'col-2' }],
      services: []
    },
    {
      projectId: 'projeto-rdo-zero',
      reportType: 'RDO',
      reportDate: '2026-07-16T00:00:00.000Z',
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      project: { offshore: false, laborSleepModeByCollaborator: {} },
      collaborators: [{ collaboratorId: 'col-3' }],
      services: [
        { startTime: '08:00', endTime: '17:00' }
      ]
    }
  ];

  const map = rdoDataByCollaboratorFromReports(reports);

  assert.equal(map.get('col-1').dayProjects.get('2026-07-13').get('projeto-rdo').hours, 9);
  assert.equal(map.get('col-1').dayProjects.get('2026-07-13').get('projeto-rdo').rdoNumber, 17);
  assert.equal(map.get('col-1').dayProjects.get('2026-07-13').get('projeto-rdo').projectCode, '5800');
  assert.equal(map.get('col-1').dayProjects.get('2026-07-13').get('projeto-servico').hours, 6);
  assert.equal(map.get('col-2').dayProjects.get('2026-07-13').get('projeto-servico').hours, 6);
  assert.equal(map.get('col-2').dayProjects.get('2026-07-14').get('projeto-manual-rtp').hours, 4);
  assert.equal(map.get('col-2').dayProjects.has('2026-07-15'), false);
  assert.equal(map.get('col-3').dayProjects.get('2026-07-16').get('projeto-rdo-zero').hours, 0);
  assert.deepEqual([...map.get('col-1').rdoProjectIds], ['projeto-rdo']);
  assert.deepEqual([...map.get('col-1').nominalRdoProjectsByDate.get('2026-07-13')], ['projeto-rdo']);
});

test('RDO posterior nominal confirma o projeto na data exata de mobilização', () => {
  const reports = [
    {
      projectId: 'projeto-a',
      reportType: 'RDO',
      reportDate: '2026-07-18T00:00:00.000Z',
      daytimeWorkedMinutes: 480,
      nighttimeWorkedMinutes: 0,
      project: {
        offshore: false,
        laborSleepModeByCollaborator: {},
        mobilizationDate: '2026-07-16T00:00:00.000Z'
      },
      collaborators: [{ collaboratorId: 'col-1' }],
      services: []
    },
    {
      projectId: 'projeto-mesmo-dia',
      reportType: 'RDO',
      reportDate: '2026-07-16T00:00:00.000Z',
      daytimeWorkedMinutes: 480,
      nighttimeWorkedMinutes: 0,
      project: {
        offshore: false,
        laborSleepModeByCollaborator: {},
        mobilizationDate: '2026-07-16T00:00:00.000Z'
      },
      collaborators: [{ collaboratorId: 'col-1' }],
      services: []
    },
    {
      projectId: 'projeto-rtp',
      reportType: 'RTP',
      reportDate: '2026-07-18T00:00:00.000Z',
      daytimeWorkedMinutes: 480,
      nighttimeWorkedMinutes: 0,
      project: {
        offshore: false,
        laborSleepModeByCollaborator: {},
        mobilizationDate: '2026-07-16T00:00:00.000Z'
      },
      collaborators: [{ collaboratorId: 'col-1' }],
      services: []
    }
  ];

  const evidence = rdoDataByCollaboratorFromReports(reports)
    .get('col-1').mobilizationProjectsByDate.get('2026-07-16');

  assert.deepEqual([...evidence].sort(), ['projeto-a']);
});

const resolveTestTag = tag => ({
  'Missão A': 'A',
  'Missão B': 'B',
  'Missão C': 'C'
})[tag] || null;

function dailyRdo(entries) {
  return new Map(entries.map(([projectId, hours]) => [projectId, {
    projectId,
    hours,
    offshore: false,
    sleepMode: 'AWAY'
  }]));
}

test('apropriação por evidência aplica 8h48 como piso do total no dia útil', () => {
  const result = classifyProjectHours([
    { date: '2026-08-03', normalHours: 7, he70Horas: 0, he100Horas: 0, tags: ['Missão A'] },
    { date: '2026-08-04', normalHours: 9, he70Horas: 0, he100Horas: 0, tags: ['Missão A'] },
    { date: '2026-08-06', normalHours: 0, he70Horas: 0, he100Horas: 0, tags: ['Missão A'] },
    { date: '2026-08-08', normalHours: 7, he70Horas: 0, he100Horas: 0, tags: ['Missão A'] },
    { date: '2026-08-05', normalHours: 7, he70Horas: 0, he100Horas: 0, tags: [] },
    { date: '2026-08-10', normalHours: 7, he70Horas: 1, he100Horas: 0, tags: [] },
    { date: '2026-08-11', normalHours: 7, he70Horas: 1, he100Horas: 1, tags: [] }
  ], {
    byProject: new Map(),
    dayProjects: new Map([
      ['2026-08-03', dailyRdo([['A', 7]])],
      ['2026-08-04', dailyRdo([['A', 9]])],
      ['2026-08-06', dailyRdo([['A', 8]])],
      ['2026-08-08', dailyRdo([['A', 7]])],
      ['2026-08-10', dailyRdo([['A', 8]])],
      ['2026-08-11', dailyRdo([['A', 9]])]
    ])
  }, resolveTestTag);

  assert.ok(near(result.byProject.get('A').normalHours, 8.8 + 9 + 7 + 7.8 + 7));
  assert.ok(near(result.byProject.get('A').he70Hours, 2));
  assert.ok(near(result.byProject.get('A').he100Hours, 1));
  assert.ok(near(result.costNormalHours, 8.8 + 9 + 7 + 7 + 7.8 + 7));
  assert.deepEqual(result.dayTrail.map(day => ({
    date: day.date,
    recorded: day.normalHours,
    cost: Number(day.costNormalHours.toFixed(6)),
    minimumApplied: day.minimumNormalHoursApplied,
    reason: day.reason
  })), [
    { date: '2026-08-03', recorded: 7, cost: 8.8, minimumApplied: true, reason: 'SINGLE_TAG' },
    { date: '2026-08-04', recorded: 9, cost: 9, minimumApplied: false, reason: 'SINGLE_TAG' },
    { date: '2026-08-06', recorded: 0, cost: 0, minimumApplied: false, reason: 'NO_POINT_HOURS' },
    { date: '2026-08-08', recorded: 7, cost: 7, minimumApplied: false, reason: 'SINGLE_TAG' },
    { date: '2026-08-05', recorded: 7, cost: 7, minimumApplied: false, reason: 'NO_PROJECT_EVIDENCE' },
    { date: '2026-08-10', recorded: 7, cost: 7.8, minimumApplied: true, reason: 'SINGLE_RDO_FALLBACK' },
    { date: '2026-08-11', recorded: 7, cost: 7, minimumApplied: false, reason: 'SINGLE_RDO_FALLBACK' }
  ]);
  assert.deepEqual(result.unresolvedDays.map(day => [day.date, day.reason]), [
    ['2026-08-05', 'NO_PROJECT_EVIDENCE']
  ]);
});

test('apropriações contábil e analítica preservam as horas de deslocamento', () => {
  const accounting = computeCollaboratorCost({
    params: PARAMS,
    normalHours: 8.8,
    he70Horas: 0,
    he100Horas: 0,
    folgaHours: 0,
    projects: [{
      pid: 'A',
      rdoDaysHours: 8.8,
      awayDaysHours: 8.8,
      rdoWorkedHours: 8.8,
      travelHours: 4.4,
      he70Hours: 0,
      he100Hours: 0
    }]
  });
  assert.equal(accounting.byProject.A.travelHours, 4.4);

  const analytical = computeAnalyticalProjectCosts({
    params: PARAMS,
    fixedBase: accounting.fixoMensal,
    totalHours: accounting.totalHours,
    projects: [{
      pid: 'A',
      rdoDaysHours: 8.8,
      awayDaysHours: 8.8,
      travelHours: 2.2,
      he70Hours: 0,
      he100Hours: 0
    }]
  });
  assert.equal(analytical.A.travelHours, 2.2);
});

test('precedência de pesos diários cobre etiqueta única, interseção e fallback de RDO', () => {
  const oneTag = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag
  });
  assert.deepEqual(oneTag.allocations, []);
  assert.equal(oneTag.reason, 'NO_PROJECT_EVIDENCE');

  const soleDivergentRdo = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: dailyRdo([['B', 8]]),
    resolveTag: resolveTestTag
  });
  assert.deepEqual(soleDivergentRdo.allocations.map(item => [item.projectId, item.weight]), [['B', 1]]);
  assert.equal(soleDivergentRdo.reason, 'SINGLE_RDO_OVERRIDES_TAG');

  const conflictingTag = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: dailyRdo([['B', 8], ['C', 4]]),
    resolveTag: resolveTestTag
  });
  assert.deepEqual(conflictingTag.allocations, []);
  assert.equal(conflictingTag.reason, 'TAG_RDO_CONFLICT');

  const manual = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: dailyRdo([['B', 8], ['C', 4]]),
    resolveTag: resolveTestTag,
    manualProjectId: 'B'
  });
  assert.deepEqual(manual.allocations.map(item => [item.projectId, item.weight]), [['B', 1]]);
  assert.equal(manual.reason, 'MANUAL_OVERRIDE');

  const oneConfirmed = buildDailyProjectWeights({
    tags: ['Missão A', 'Missão B'],
    rdoProjects: dailyRdo([['B', 8], ['C', 4]]),
    resolveTag: resolveTestTag
  });
  assert.deepEqual(oneConfirmed.allocations.map(item => [item.projectId, item.weight]), [['B', 1]]);

  const oneRdoFallback = buildDailyProjectWeights({
    tags: [],
    rdoProjects: dailyRdo([['C', 7]]),
    resolveTag: resolveTestTag
  });
  assert.deepEqual(oneRdoFallback.allocations.map(item => [item.projectId, item.weight]), [['C', 1]]);

  const ambiguousWithoutTags = buildDailyProjectWeights({
    tags: [],
    rdoProjects: dailyRdo([['A', 8], ['B', 4]]),
    resolveTag: resolveTestTag
  });
  assert.deepEqual(ambiguousWithoutTags.allocations, []);
  assert.equal(ambiguousWithoutTags.reason, 'AMBIGUOUS_WITHOUT_TAGS');
});

test('grupo de missões só resolve o dia quando resta um único RDO membro', () => {
  const missionGroups = buildMissionGroupProjectIndex([{
    id: 'group-detroit',
    members: [
      { projectId: 'A' },
      { projectId: 'B' },
      { projectId: 'D' }
    ]
  }]);

  const uniqueGroupedRdo = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: dailyRdo([['B', 8], ['C', 4]]),
    resolveTag: resolveTestTag,
    missionGroupProjectsByProjectId: missionGroups
  });
  assert.deepEqual(uniqueGroupedRdo.allocations.map(item => [item.projectId, item.weight]), [['B', 1]]);
  assert.equal(uniqueGroupedRdo.reason, 'MERGED_GROUP_SINGLE_RDO_FALLBACK');

  const twoGroupedRdos = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: dailyRdo([['B', 8], ['D', 4]]),
    resolveTag: resolveTestTag,
    missionGroupProjectsByProjectId: missionGroups
  });
  assert.deepEqual(twoGroupedRdos.allocations, []);
  assert.equal(twoGroupedRdos.reason, 'TAG_RDO_CONFLICT');

  const normalRuleKeepsPrecedence = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: dailyRdo([['A', 8], ['B', 4]]),
    resolveTag: resolveTestTag,
    missionGroupProjectsByProjectId: missionGroups
  });
  assert.deepEqual(normalRuleKeepsPrecedence.allocations.map(item => [item.projectId, item.weight]), [['A', 1]]);
  assert.equal(normalRuleKeepsPrecedence.reason, 'SINGLE_TAG');

  const withoutPointTag = buildDailyProjectWeights({
    tags: [],
    rdoProjects: dailyRdo([['B', 8], ['C', 4]]),
    resolveTag: resolveTestTag,
    missionGroupProjectsByProjectId: missionGroups
  });
  assert.deepEqual(withoutPointTag.allocations, []);
  assert.equal(withoutPointTag.reason, 'AMBIGUOUS_WITHOUT_TAGS');
});

test('fallback de missão mesclada usa o total do ponto quando ele supera 8h48', () => {
  const missionGroups = buildMissionGroupProjectIndex([{
    id: 'group-detroit',
    members: [{ projectId: 'A' }, { projectId: 'B' }]
  }]);
  const classified = classifyProjectHours([{
    date: '2026-08-05',
    normalHours: 8,
    he70Horas: 1.5,
    he100Horas: 0.5,
    tags: ['Missão A']
  }], {
    byProject: new Map(),
    dayProjects: new Map([['2026-08-05', dailyRdo([['B', 8], ['C', 4]])]])
  }, resolveTestTag, new Map(), new Map(), missionGroups);

  assert.deepEqual(classified.unresolvedDays, []);
  assert.equal(classified.byProject.size, 1);
  assert.ok(near(classified.byProject.get('B').normalHours, 8));
  assert.ok(near(classified.byProject.get('B').he70Hours, 1.5));
  assert.ok(near(classified.byProject.get('B').he100Hours, 0.5));
  assert.ok(near(
    [...classified.byProject.values()].reduce((sum, item) => (
      sum + item.normalHours + item.he70Hours + item.he100Hours
    ), 0),
    10
  ));
});

test('dois projetos confirmados usam todas as horas de RDO somente como pesos normalizados', () => {
  const unequal = buildDailyProjectWeights({
    tags: ['Missão A', 'Missão B'],
    rdoProjects: dailyRdo([['A', 8], ['B', 4]]),
    resolveTag: resolveTestTag
  });
  assert.ok(near(unequal.allocations[0].weight, 2 / 3));
  assert.ok(near(unequal.allocations[1].weight, 1 / 3));

  const equal = buildDailyProjectWeights({
    tags: ['Missão A', 'Missão B'],
    rdoProjects: dailyRdo([['A', 8], ['B', 8]]),
    resolveTag: resolveTestTag
  });
  assert.deepEqual(equal.allocations.map(item => item.weight), [0.5, 0.5]);
});

test('alocação diária aplica o mesmo peso ao normal ajustado, HE70 e HE100', () => {
  const rdo = {
    byProject: new Map(),
    dayProjects: new Map([['2026-08-03', dailyRdo([['A', 8], ['B', 4]])]])
  };
  const result = classifyProjectHours([{
    date: '2026-08-03',
    normalHours: 8,
    he70Horas: 1.5,
    he100Horas: 0.5,
    tags: ['Missão A', 'Missão B']
  }], rdo, resolveTestTag, new Map());

  assert.ok(near(result.byProject.get('A').normalHours, 8 * 2 / 3));
  assert.ok(near(result.byProject.get('B').normalHours, 8 / 3));
  assert.ok(near(result.byProject.get('A').he70Hours, 1));
  assert.ok(near(result.byProject.get('B').he70Hours, 0.5));
  assert.ok(near(result.byProject.get('A').he100Hours, 1 / 3));
  assert.ok(near(result.byProject.get('B').he100Hours, 1 / 6));
  assert.ok(near([...result.byProject.values()].reduce((sum, item) => sum + item.normalHours, 0), 8));
  assert.ok(near([...result.byProject.values()].reduce((sum, item) => sum + item.he70Hours, 0), 1.5));
  assert.ok(near([...result.byProject.values()].reduce((sum, item) => sum + item.he100Hours, 0), 0.5));

  const soleRdoOverride = classifyProjectHours([{
    date: '2026-08-04',
    normalHours: 8,
    he70Horas: 1.5,
    he100Horas: 0.5,
    tags: ['Missão A']
  }], {
    byProject: new Map(),
    dayProjects: new Map([['2026-08-04', dailyRdo([['B', 8]])]])
  }, resolveTestTag, new Map());

  assert.equal(soleRdoOverride.byProject.has('A'), false);
  assert.deepEqual(soleRdoOverride.unresolvedDays, []);
  assert.ok(near(soleRdoOverride.byProject.get('B').normalHours, 8));
  assert.ok(near(soleRdoOverride.byProject.get('B').he70Hours, 1.5));
  assert.ok(near(soleRdoOverride.byProject.get('B').he100Hours, 0.5));
});

test('custos explícitos por projeto fecham exatamente em centavos sem duplicar o mensal', () => {
  const r = computeCollaboratorCost({
    params: PARAMS,
    epiMensal: 5000 / 12,
    normalHours: 8,
    he70Horas: 1.5,
    he100Horas: 0.5,
    folgaHours: 8.8,
    projects: [
      { pid: 'A', rdoDaysHours: 16 / 3, awayDaysHours: 16 / 3, rdoWorkedHours: 8, he70Hours: 1, he100Hours: 1 / 3 },
      { pid: 'B', rdoDaysHours: 8 / 3, awayDaysHours: 8 / 3, rdoWorkedHours: 4, he70Hours: 0.5, he100Hours: 1 / 6 }
    ]
  });
  const projectCents = Object.values(r.byProject).reduce((sum, item) => sum + Math.round(item.cost * 100), 0);
  const idleCents = Math.round(r.idle.sede.cost * 100) + Math.round(r.idle.folga.cost * 100);
  const projectBaseCents = Object.values(r.byProject).reduce((sum, item) => sum + Math.round(item.costBase * 100), 0);
  const idleBaseCents = Math.round(r.idle.sede.costBase * 100) + Math.round(r.idle.folga.costBase * 100);

  assert.equal(projectCents + idleCents, Math.round(r.folha * 100));
  assert.equal(projectBaseCents + idleBaseCents, Math.round(r.folhaBase * 100));
  assert.ok(Object.values(r.byProject).every(item => item.cost >= 0 && item.costBase >= 0));
  assert.ok(r.idle.sede.cost >= 0 && r.idle.folga.cost >= 0);
  assert.ok(Object.values(r.byProject).reduce((sum, item) => sum + item.hours, 0) <= r.totalHours);
});

test('execução compartilhada conserva a folha e replica integralmente a apropriação analítica', () => {
  const missionGroups = buildMissionGroupProjectIndex([{
    id: 'group-uhe',
    laborAllocationMode: 'SHARED_EXECUTION',
    primaryLaborProjectId: null,
    members: [{ projectId: 'A' }, { projectId: 'B' }, { projectId: 'D' }]
  }]);
  const input = {
    tags: ['EM VIAGEM - cliente'],
    rdoProjects: dailyRdo([['A', 9], ['B', 9]]),
    resolveTag: resolveTestTag,
    missionGroupProjectsByProjectId: missionGroups
  };

  const accounting = buildDailyProjectWeights(input);
  const analytical = buildDailyProjectWeights({ ...input, allocationAxis: 'ANALYTICAL' });
  assert.deepEqual(accounting.allocations.map(item => [item.projectId, item.weight]), [['A', 0.5], ['B', 0.5]]);
  assert.equal(accounting.reason, 'SHARED_EXECUTION_ACCOUNTING');
  assert.deepEqual(analytical.allocations.map(item => [item.projectId, item.weight]), [['A', 1], ['B', 1]]);
  assert.equal(analytical.reason, 'SHARED_EXECUTION_ANALYTICAL');

  const rows = [{ date: '2026-07-22', normalHours: 8.8, he70Horas: 19 / 60, he100Horas: 0, tags: input.tags }];
  const rdo = { byProject: new Map(), dayProjects: new Map([['2026-07-22', input.rdoProjects]]) };
  const accountingHours = classifyProjectHours(rows, rdo, resolveTestTag, new Map(), new Map(), missionGroups);
  const analyticalHours = classifyProjectHours(rows, rdo, resolveTestTag, new Map(), new Map(), missionGroups, 'ANALYTICAL');
  assert.ok(near([...accountingHours.byProject.values()].reduce((sum, item) => sum + item.normalHours, 0), 8.8));
  assert.ok(near([...analyticalHours.byProject.values()].reduce((sum, item) => sum + item.normalHours, 0), 17.6));
  assert.equal(accountingHours.dayTrail[0].travelContext, false);
  assert.ok([...accountingHours.byProject.values()].every(item => near(item.travelHours, 0)));
  assert.ok([...analyticalHours.byProject.values()].every(item => near(item.travelHours, 0)));
});

test('consolidação excepcional direciona evidência dos membros uma única vez ao projeto principal', () => {
  const missionGroups = buildMissionGroupProjectIndex([{
    id: 'group-detroit',
    laborAllocationMode: 'CONSOLIDATE_PRIMARY',
    primaryLaborProjectId: 'A',
    members: [{ projectId: 'A' }, { projectId: 'B' }, { projectId: 'D' }]
  }]);
  for (const allocationAxis of ['ACCOUNTING', 'ANALYTICAL']) {
    const decision = buildDailyProjectWeights({
      tags: [],
      rdoProjects: dailyRdo([['B', 8], ['D', 8]]),
      resolveTag: resolveTestTag,
      missionGroupProjectsByProjectId: missionGroups,
      allocationAxis
    });
    assert.deepEqual(decision.allocations.map(item => [item.projectId, item.weight]), [['A', 1]]);
    assert.equal(decision.reason, 'CONSOLIDATE_PRIMARY');
  }
});

test('seleção manual múltipla conserva o eixo contábil e replica o eixo analítico', () => {
  const base = {
    tags: [],
    rdoProjects: dailyRdo([['A', 8], ['B', 4]]),
    resolveTag: resolveTestTag,
    manualProjectIds: ['A', 'B']
  };
  const accounting = buildDailyProjectWeights(base);
  const analytical = buildDailyProjectWeights({ ...base, allocationAxis: 'ANALYTICAL' });

  assert.equal(accounting.reason, 'MANUAL_SHARED_OVERRIDE');
  assert.ok(near(accounting.allocations[0].weight + accounting.allocations[1].weight, 1));
  assert.deepEqual(analytical.allocations.map(item => item.weight), [1, 1]);

  const incompleteRdo = buildDailyProjectWeights({
    ...base,
    rdoProjects: dailyRdo([['A', 8]])
  });
  assert.deepEqual(incompleteRdo.allocations.map(item => item.weight), [0.5, 0.5]);
});

test('política de grupo não resolve RDO externo nem grupo apenas visual', () => {
  const shared = buildMissionGroupProjectIndex([{
    id: 'group-uhe',
    laborAllocationMode: 'SHARED_EXECUTION',
    members: [{ projectId: 'A' }, { projectId: 'B' }]
  }]);
  const withExternal = buildDailyProjectWeights({
    tags: [],
    rdoProjects: dailyRdo([['A', 8], ['C', 8]]),
    resolveTag: resolveTestTag,
    missionGroupProjectsByProjectId: shared,
    allocationAxis: 'ANALYTICAL'
  });
  assert.equal(withExternal.reason, 'AMBIGUOUS_WITHOUT_TAGS');
  assert.deepEqual(withExternal.allocations, []);

  const visual = buildMissionGroupProjectIndex([{
    id: 'group-visual',
    laborAllocationMode: 'VISUAL_ONLY',
    members: [{ projectId: 'A' }, { projectId: 'B' }]
  }]);
  const visualDecision = buildDailyProjectWeights({
    tags: [],
    rdoProjects: dailyRdo([['A', 8], ['B', 8]]),
    resolveTag: resolveTestTag,
    missionGroupProjectsByProjectId: visual,
    allocationAxis: 'ANALYTICAL'
  });
  assert.equal(visualDecision.reason, 'AMBIGUOUS_WITHOUT_TAGS');
  assert.deepEqual(visualDecision.allocations, []);
});

test('mobilização inferida por RDO vira divergência; seleção manual resolve sem RDO do dia', () => {
  const unique = buildDailyProjectWeights({
    tags: ['EM VIAGEM - cliente'],
    mobilizationProjectIds: ['A']
  });
  assert.equal(unique.reason, 'RDO_PERIOD_MISMATCH');
  assert.deepEqual(unique.allocations, []);
  assert.equal(allocationDecisionRequiresAction(unique), true);

  const withoutTravel = buildDailyProjectWeights({
    tags: [],
    mobilizationProjectIds: ['A']
  });
  assert.equal(withoutTravel.reason, 'NO_PROJECT_EVIDENCE');
  assert.equal(allocationDecisionRequiresAction(withoutTravel), false);

  const sameDayWins = buildDailyProjectWeights({
    tags: ['EM VIAGEM'],
    rdoProjects: dailyRdo([['C', 8]]),
    mobilizationProjectIds: ['A']
  });
  assert.equal(sameDayWins.reason, 'SINGLE_RDO_FALLBACK');
  assert.deepEqual(sameDayWins.allocations.map(item => item.projectId), ['C']);

  const manualWins = buildDailyProjectWeights({
    tags: ['EM VIAGEM'],
    manualProjectId: 'B',
    mobilizationProjectIds: ['A']
  });
  assert.equal(manualWins.reason, 'MANUAL_OVERRIDE');
  assert.deepEqual(manualWins.allocations.map(item => item.projectId), ['B']);

  const ambiguous = buildDailyProjectWeights({
    tags: ['EM VIAGEM'],
    mobilizationProjectIds: ['A', 'B']
  });
  assert.equal(ambiguous.reason, 'RDO_PERIOD_MISMATCH');
  assert.deepEqual(ambiguous.allocations, []);
});

test('mobilização inferida sem período não é apropriada automaticamente em nenhum eixo', () => {
  const sharedGroups = buildMissionGroupProjectIndex([{
    id: 'group-shared',
    laborAllocationMode: 'SHARED_EXECUTION',
    members: [{ projectId: 'A' }, { projectId: 'B' }]
  }]);
  const input = {
    tags: ['EM VIAGEM'],
    mobilizationProjectIds: ['A', 'B'],
    missionGroupProjectsByProjectId: sharedGroups
  };
  const accounting = buildDailyProjectWeights(input);
  const analytical = buildDailyProjectWeights({ ...input, allocationAxis: 'ANALYTICAL' });

  assert.equal(accounting.reason, 'RDO_PERIOD_MISMATCH');
  assert.deepEqual(accounting.allocations, []);
  assert.equal(analytical.reason, 'RDO_PERIOD_MISMATCH');
  assert.deepEqual(analytical.allocations, []);

  const classified = classifyProjectHours([{
    date: '2026-07-16',
    normalHours: 8,
    he70Horas: 1,
    he100Horas: 0,
    tags: ['EM VIAGEM']
  }], {
    byProject: new Map(),
    dayProjects: new Map(),
    mobilizationProjectsByDate: new Map([['2026-07-16', new Set(['A'])]])
  });
  assert.equal(classified.byProject.size, 0);
  assert.deepEqual(classified.unresolvedDays.map(item => item.reason), ['RDO_PERIOD_MISMATCH']);
  assert.equal(classified.unresolvedDays[0].pending, true);

  const consolidatedGroups = buildMissionGroupProjectIndex([{
    id: 'group-primary',
    laborAllocationMode: 'CONSOLIDATE_PRIMARY',
    primaryLaborProjectId: 'A',
    members: [{ projectId: 'A' }, { projectId: 'B' }]
  }]);
  const consolidated = buildDailyProjectWeights({
    tags: ['EM VIAGEM'],
    mobilizationProjectIds: ['A', 'B'],
    missionGroupProjectsByProjectId: consolidatedGroups,
    allocationAxis: 'ANALYTICAL'
  });
  assert.equal(consolidated.reason, 'RDO_PERIOD_MISMATCH');
  assert.deepEqual(consolidated.allocations, []);
});

test('custo analítico usa a mesma base real sem reconciliar cópias compartilhadas contra a folha', () => {
  const accounting = computeCollaboratorCost({
    params: PARAMS,
    normalHours: 8,
    he70Horas: 0,
    he100Horas: 0,
    folgaHours: 0,
    projects: [
      { pid: 'A', rdoDaysHours: 4, awayDaysHours: 4, he70Hours: 0, he100Hours: 0 },
      { pid: 'B', rdoDaysHours: 4, awayDaysHours: 4, he70Hours: 0, he100Hours: 0 }
    ]
  });
  const analytical = computeAnalyticalProjectCosts({
    params: PARAMS,
    fixedBase: accounting.fixoMensal,
    totalHours: accounting.totalHours,
    projects: [
      { pid: 'A', rdoDaysHours: 8, awayDaysHours: 8, he70Hours: 0, he100Hours: 0 },
      { pid: 'B', rdoDaysHours: 8, awayDaysHours: 8, he70Hours: 0, he100Hours: 0 }
    ]
  });
  assert.equal(analytical.A.hours, 8);
  assert.equal(analytical.B.hours, 8);
  assert.ok(analytical.A.cost > 0 && analytical.B.cost > 0);
  assert.ok(analytical.A.cost + analytical.B.cost > accounting.folha);
});

test('EM VIAGEM é contexto de deslocamento e nunca código de missão', () => {
  assert.equal(isPontoTravelTag('Em viagem'), true);
  assert.equal(isPontoTravelTag('EM VIAGEM - 07.264.184/0001-46'), true);
  assert.equal(isPontoTravelTag('Missão 5810'), false);
  assert.equal(resolveTestTag('EM VIAGEM - 07.264.184/0001-46'), null);
});

test('RDO não-offshore usa hospedagem manual: fora = transferência, casa = gratificação', () => {
  const away = computeCollaboratorCost({
    params: PARAMS, epiMensal: 0, normalHours: 44, he70Horas: 0, he100Horas: 0, folgaHours: 0,
    projects: [{ pid: 'A', rdoDaysHours: 44, awayDaysHours: 44, rdoWorkedHours: 44, offshore: false }]
  });
  const home = computeCollaboratorCost({
    params: PARAMS, epiMensal: 0, normalHours: 44, he70Horas: 0, he100Horas: 0, folgaHours: 0,
    projects: [{ pid: 'A', rdoDaysHours: 44, homeDaysHours: 44, rdoWorkedHours: 44, offshore: false }]
  });
  assert.notEqual(home.folha, away.folha);
  assert.notEqual(home.variavelMensal, away.variavelMensal);
});

test('dia com horas e sem RDO/Efetivo fica na auditoria sem virar pendência', () => {
  const result = classifyProjectHours([{
    date: '2026-08-17',
    normalHours: 8.8,
    he70Horas: 0,
    he100Horas: 0,
    tags: ['EM VIAGEM - 07.264.184/0001-46']
  }], { byProject: new Map(), dayProjects: new Map() }, resolveTestTag, new Map());

  assert.equal(result.byProject.size, 0);
  assert.deepEqual(result.unresolvedDays.map(item => [item.date, item.reason]), [['2026-08-17', 'NO_PROJECT_EVIDENCE']]);
  assert.equal(result.unresolvedDays[0].pending, false);
  assert.equal(result.dayTrail[0].pending, false);
  assert.ok(near(result.unresolvedDays[0].normalHours, 8.8));
});

test('dia com RDO e ponto zerado não é apropriado nem vira pendência', () => {
  const result = classifyProjectHours([{
    date: '2026-08-16',
    normalHours: 0,
    he70Horas: 0,
    he100Horas: 0,
    tags: []
  }], {
    byProject: new Map(),
    dayProjects: new Map([['2026-08-16', dailyRdo([['A', 8]])]])
  }, resolveTestTag, new Map());

  assert.deepEqual(result.unresolvedDays, []);
  assert.equal(result.byProject.size, 0);
  assert.equal(result.dayTrail.length, 1);
  assert.equal(result.dayTrail[0].reason, 'NO_POINT_HOURS');
  assert.deepEqual(result.dayTrail[0].allocations, []);
});

test('dia só com hora extra continua auditável, mas sem evidência não vira pendência', () => {
  const result = classifyProjectHours([{
    date: '2026-06-19',
    normalHours: 0,
    he70Horas: 0,
    he100Horas: 10.97,
    tags: ['EM VIAGEM - 07.264.184/0001-46']
  }], { byProject: new Map(), dayProjects: new Map() }, resolveTestTag, new Map());

  assert.equal(result.unresolvedDays.length, 1);
  assert.ok(near(result.unresolvedDays[0].he100Hours, 10.97));
  assert.equal(result.unresolvedDays[0].pending, false);
});

test('trilha registra etiquetas, RDO, motivo e pesos de cada dia', () => {
  const rdo = {
    byProject: new Map(),
    dayProjects: new Map([['2026-07-20', dailyRdo([['A', 9.5]])]])
  };
  const result = classifyProjectHours([{
    date: '2026-07-20',
    normalHours: 6.15,
    he70Horas: 0,
    he100Horas: 0,
    tags: ['EM VIAGEM - 07.264.184/0001-46']
  }], rdo, resolveTestTag, new Map());

  const [day] = result.dayTrail;
  assert.equal(day.reason, 'SINGLE_RDO_FALLBACK');
  assert.deepEqual(day.tags, ['EM VIAGEM - 07.264.184/0001-46']);
  assert.deepEqual(day.tagProjectIds, []);
  assert.deepEqual(day.rdoProjects, [{ projectId: 'A', hours: 9.5 }]);
  assert.deepEqual(day.allocations, [{ projectId: 'A', weight: 1 }]);
  assert.deepEqual(result.unresolvedDays, []);
});

test('trilha e pendência convivem no mesmo lote sem contaminar as horas por projeto', () => {
  const rdo = {
    byProject: new Map(),
    dayProjects: new Map([['2026-07-20', dailyRdo([['A', 9.5]])]])
  };
  const rows = [
    { date: '2026-07-20', normalHours: 8, he70Horas: 0, he100Horas: 0, tags: [] },
    { date: '2026-07-21', normalHours: 8, he70Horas: 0, he100Horas: 0, tags: [] }
  ];
  const result = classifyProjectHours(rows, rdo, resolveTestTag, new Map());

  assert.equal(result.dayTrail.length, 2);
  assert.ok(near(result.byProject.get('A').normalHours, 8.8));
  assert.deepEqual(result.unresolvedDays.map(item => item.date), ['2026-07-21']);
});

// === Janela do cronograma (mobilização ↔ desmobilização) ===

const JANELA_5804 = {
  id: 'p-5804',
  code: '5804',
  operatorId: null,
  laborCollaboratorIds: [],
  mobilizationDate: new Date('2026-07-14T00:00:00.000Z'),
  demobilizationDate: new Date('2026-08-31T00:00:00.000Z')
};

function effectiveAllocation({
  id = 'allocation-a',
  collaboratorId = 'c-1',
  projectId = 'A',
  mobilizationDate = null,
  demobilizationDate = null,
  missionStart = '2026-07-14',
  missionEnd = '2026-08-31',
  cycles = null,
  missionCycles = null
} = {}) {
  return {
    id,
    collaboratorId,
    mobilizationDate: mobilizationDate ? new Date(`${mobilizationDate}T00:00:00.000Z`) : null,
    demobilizationDate: demobilizationDate ? new Date(`${demobilizationDate}T00:00:00.000Z`) : null,
    ...(cycles ? { cycles: cycles.map((cycle, index) => ({
      id: `allocation-cycle-${index}`,
      mobilizationDate: new Date(`${cycle[0]}T00:00:00.000Z`),
      demobilizationDate: cycle[1] ? new Date(`${cycle[1]}T00:00:00.000Z`) : null
    })) } : {}),
    mission: {
      id: `mission-${projectId}`,
      projectId,
      mobilizationDate: new Date(`${missionStart}T00:00:00.000Z`),
      executionEndDate: new Date(`${missionEnd}T00:00:00.000Z`),
      returnDate: new Date(`${missionEnd}T00:00:00.000Z`),
      ...(missionCycles ? { cycles: missionCycles.map((cycle, index) => ({
        id: `mission-cycle-${index}`,
        mobilizationDate: new Date(`${cycle[0]}T00:00:00.000Z`),
        demobilizationDate: cycle[1] ? new Date(`${cycle[1]}T00:00:00.000Z`) : null
      })) } : {})
    }
  };
}

test('janela só existe com mobilização E desmobilização preenchidas', () => {
  const janelas = buildScheduleWindows([
    JANELA_5804,
    { id: 'p-emAndamento', code: '5820', mobilizationDate: new Date('2026-08-01T00:00:00.000Z'), demobilizationDate: null },
    { id: 'p-semNada', code: '5900', mobilizationDate: null, demobilizationDate: null },
    { id: 'p-invertida', code: '5901', mobilizationDate: new Date('2026-08-10T00:00:00.000Z'), demobilizationDate: new Date('2026-08-01T00:00:00.000Z') }
  ]);

  assert.deepEqual(janelas.map(item => item.projectId), ['p-5804']);
  assert.equal(janelas[0].startKey, '2026-07-14');
  assert.equal(janelas[0].endKey, '2026-08-31');
});

test('projeto presente no Efetivo oficial não usa a janela global como fallback legado', () => {
  const janelas = buildScheduleWindows([JANELA_5804], new Set(['p-5804']));
  assert.deepEqual(janelas, []);
});

test('fallback legado exige RDO nominal dentro da janela e ignora cadastro manual do Project', () => {
  const janelas = buildScheduleWindows([{ ...JANELA_5804, operatorId: 'c-operador', laborCollaboratorIds: ['c-manual'] }]);
  const rdoData = new Map([
    ['c-rdoDentro', { nominalRdoProjectsByDate: new Map([['2026-07-20', new Set(['p-5804'])]]) }],
    ['c-rdoFora', { nominalRdoProjectsByDate: new Map([['2026-03-10', new Set(['p-5804'])]]) }]
  ]);

  const elegiveis = buildScheduleWindowEligibility(janelas, rdoData);
  const doProjeto = elegiveis.get('p-5804');

  assert.ok(!doProjeto.has('c-operador'));
  assert.ok(!doProjeto.has('c-manual'));
  assert.ok(doProjeto.has('c-rdoDentro'));
  // Vazamento histórico: quem fez RDO fora da janela não entra por ela.
  assert.ok(!doProjeto.has('c-rdoFora'));
});

test('Efetivo usa datas individuais e herda datas da missão quando elas não foram informadas', () => {
  const index = buildEffectiveAllocationIndex([
    effectiveAllocation({ mobilizationDate: '2026-07-20', demobilizationDate: '2026-08-20' }),
    effectiveAllocation({ id: 'allocation-b', projectId: 'B', missionStart: '2026-08-10', missionEnd: '2026-08-15' }),
    { ...effectiveAllocation({ id: 'allocation-c', projectId: 'C' }), deletedAt: new Date() },
    {
      ...effectiveAllocation({ id: 'allocation-d', projectId: 'D' }),
      mission: { ...effectiveAllocation({ projectId: 'D' }).mission, scheduleStatus: 'CANCELLED' }
    },
    {
      ...effectiveAllocation({ id: 'allocation-e', projectId: 'E' }),
      mission: {
        ...effectiveAllocation({ projectId: 'E' }).mission,
        scheduleStatus: 'CONFIRMED',
        plan: { kind: 'SCENARIO', status: 'ACTIVE' }
      }
    }
  ]);

  assert.deepEqual(effectiveProjectsForCollaborator(index, 'c-1'), ['A', 'B']);
  assert.deepEqual(effectiveProjectsForDay({ effectiveAllocationIndex: index, collaboratorId: 'c-1', dateKey: '2026-07-19' }), []);
  assert.deepEqual(effectiveProjectsForDay({ effectiveAllocationIndex: index, collaboratorId: 'c-1', dateKey: '2026-07-20' }), ['A']);
  assert.deepEqual(effectiveProjectsForDay({ effectiveAllocationIndex: index, collaboratorId: 'c-1', dateKey: '2026-08-10' }), ['A', 'B']);
  assert.deepEqual(effectiveProjectsForDay({ effectiveAllocationIndex: index, collaboratorId: 'c-1', dateKey: '2026-08-20' }), ['A']);
  assert.deepEqual(effectiveProjectsForDay({ effectiveAllocationIndex: index, collaboratorId: 'c-1', dateKey: '2026-08-21' }), []);
});

test('Efetivo não apropria horas na pausa entre ciclos de mobilização', () => {
  const index = buildEffectiveAllocationIndex([
    effectiveAllocation({
      projectId: '5811',
      missionStart: '2026-07-07',
      missionEnd: '2026-09-09',
      missionCycles: [['2026-07-07', '2026-07-09'], ['2026-09-07', '2026-09-09']]
    })
  ]);

  assert.deepEqual(effectiveProjectsForDay({ effectiveAllocationIndex: index, collaboratorId: 'c-1', dateKey: '2026-07-08' }), ['5811']);
  assert.deepEqual(effectiveProjectsForDay({ effectiveAllocationIndex: index, collaboratorId: 'c-1', dateKey: '2026-08-01' }), []);
  assert.deepEqual(effectiveProjectsForDay({ effectiveAllocationIndex: index, collaboratorId: 'c-1', dateKey: '2026-09-08' }), ['5811']);
});

test('Efetivo individual apropria EM VIAGEM sem RDO e aplica o piso de 8h48', () => {
  const effectiveAllocationIndex = buildEffectiveAllocationIndex([
    effectiveAllocation({ projectId: 'p-5804', mobilizationDate: '2026-08-01', demobilizationDate: '2026-08-31' })
  ]);

  const decisao = buildDailyProjectWeights({
    tags: ['EM VIAGEM'],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag,
    effectiveProjectIds: ['p-5804'],
  });

  assert.equal(decisao.reason, 'EFFECTIVE_ALLOCATION_TRAVEL');
  assert.deepEqual(decisao.allocations, [{ projectId: 'p-5804', weight: 1, rdo: null }]);
  assert.equal(decisao.travelContext, true);

  const classificado = classifyProjectHours([{
    date: '2026-08-17',
    normalHours: 7,
    he70Horas: 1,
    he100Horas: 0,
    tags: ['EM VIAGEM']
  }], { byProject: new Map(), dayProjects: new Map() }, resolveTestTag, new Map([
    ['p-5804', { offshore: false, sleepMode: 'HOME' }]
  ]), new Map(), new Map(), 'ACCOUNTING', {
    effectiveAllocationIndex,
    collaboratorId: 'c-1'
  });

  assert.deepEqual(classificado.unresolvedDays, []);
  assert.ok(near(classificado.byProject.get('p-5804').normalHours, 7.8));
  assert.ok(near(classificado.byProject.get('p-5804').he70Hours, 1));
  assert.ok(near(classificado.byProject.get('p-5804').travelHours, 8.8));
  assert.equal(classificado.dayTrail[0].minimumNormalHoursApplied, true);
});

test('RDO do dia prevalece; Efetivo resolve viagem e etiqueta isolada não gera pendência', () => {
  const comRdo = buildDailyProjectWeights({
    tags: [],
    rdoProjects: dailyRdo([['B', 9]]),
    resolveTag: resolveTestTag,
    effectiveProjectIds: ['A'],
    knownEffectiveProjectIds: ['A']
  });
  assert.equal(comRdo.reason, 'SINGLE_RDO_FALLBACK');
  assert.equal(comRdo.allocations[0].projectId, 'B');

  const rdoIgnoraViagem = classifyProjectHours([{
    date: '2026-08-17',
    normalHours: 8,
    he70Horas: 0.8,
    he100Horas: 0,
    tags: ['EM VIAGEM']
  }], {
    byProject: new Map(),
    dayProjects: new Map([['2026-08-17', dailyRdo([['B', 9]])]])
  }, resolveTestTag, new Map([
    ['B', { offshore: false, sleepMode: 'HOME' }]
  ]));
  assert.equal(rdoIgnoraViagem.dayTrail[0].reason, 'SINGLE_RDO_FALLBACK');
  assert.equal(rdoIgnoraViagem.dayTrail[0].travelContext, false);
  assert.ok(near(rdoIgnoraViagem.byProject.get('B').travelHours, 0));

  const comEtiqueta = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag
  });
  assert.equal(comEtiqueta.reason, 'NO_PROJECT_EVIDENCE');
  assert.deepEqual(comEtiqueta.allocations, []);
  assert.equal(allocationDecisionRequiresAction(comEtiqueta), false);

  const etiquetaDoEfetivo = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag,
    effectiveProjectIds: ['A'],
    knownEffectiveProjectIds: ['A']
  });
  assert.equal(etiquetaDoEfetivo.reason, 'EFFECTIVE_PROJECT_TAG_TRAVEL');
  assert.deepEqual(etiquetaDoEfetivo.allocations.map(item => item.projectId), ['A']);

  const etiquetaDesempata = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag,
    effectiveProjectIds: ['A', 'B'],
    knownEffectiveProjectIds: ['A', 'B']
  });
  assert.equal(etiquetaDesempata.reason, 'EFFECTIVE_PROJECT_TAG_TRAVEL');
  assert.deepEqual(etiquetaDesempata.allocations, [{ projectId: 'A', weight: 1, rdo: null }]);

  const comOverride = buildDailyProjectWeights({
    tags: [],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag,
    manualProjectIds: ['C']
  });
  assert.equal(comOverride.reason, 'MANUAL_OVERRIDE');
  assert.deepEqual(comOverride.allocations.map(item => item.projectId), ['C']);
});

test('Efetivo sem marcação do ponto não aloca nem gera pendência; EM VIAGEM ambígua gera', () => {
  const decisao = buildDailyProjectWeights({
    tags: [],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag,
    effectiveProjectIds: ['A', 'B']
  });

  assert.equal(decisao.reason, 'NO_PROJECT_EVIDENCE');
  assert.deepEqual(decisao.allocations, []);
  assert.equal(allocationDecisionRequiresAction(decisao), false);

  const viagemAmbigua = buildDailyProjectWeights({
    tags: ['EM VIAGEM'],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag,
    effectiveProjectIds: ['A', 'B']
  });
  assert.equal(viagemAmbigua.reason, 'EFFECTIVE_ALLOCATION_AMBIGUOUS');
  assert.deepEqual(viagemAmbigua.allocations, []);
});

test('dia fora do período individual não usa evidência histórica; relatório do próprio dia prevalece', () => {
  const foraDoPeriodo = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag,
    effectiveProjectIds: []
  });
  assert.equal(foraDoPeriodo.reason, 'NO_PROJECT_EVIDENCE');
  assert.equal(allocationDecisionRequiresAction(foraDoPeriodo), false);

  const comRelatorioReal = buildDailyProjectWeights({
    tags: ['Missão A'],
    rdoProjects: dailyRdo([['B', 8.8]]),
    resolveTag: resolveTestTag,
    effectiveProjectIds: []
  });
  assert.equal(comRelatorioReal.reason, 'SINGLE_RDO_OVERRIDES_TAG');
  assert.deepEqual(comRelatorioReal.allocations.map(item => item.projectId), ['B']);

  const effectiveAllocationIndex = buildEffectiveAllocationIndex([
    effectiveAllocation({ projectId: 'A', mobilizationDate: '2026-08-01', demobilizationDate: '2026-08-10' })
  ]);
  const classificado = classifyProjectHours([{
    date: '2026-08-17', normalHours: 8.8, he70Horas: 0, he100Horas: 0, tags: []
  }], {
    byProject: new Map(),
    dayProjects: new Map([['2026-08-17', dailyRdo([['B', 8.8]])]])
  }, resolveTestTag, new Map(), new Map(), new Map(), 'ACCOUNTING', {
    effectiveAllocationIndex,
    collaboratorId: 'c-1'
  });
  assert.equal(classificado.dayTrail[0].reason, 'SINGLE_RDO_FALLBACK');
  assert.equal(classificado.dayTrail[0].planningMismatch, true);
});

test('vários RDOs sem etiqueta continuam ambíguos: a janela não desempata evidência de RDO', () => {
  const decisao = buildDailyProjectWeights({
    tags: [],
    rdoProjects: dailyRdo([['A', 8], ['B', 8]]),
    resolveTag: resolveTestTag,
    scheduleWindowProjectIds: ['p-5804']
  });

  assert.equal(decisao.reason, 'AMBIGUOUS_WITHOUT_TAGS');
  assert.deepEqual(decisao.allocations, []);
});

test('fallback legado resolve janela confirmada por RDO, mas mobilização isolada não', () => {
  const semJanela = buildDailyProjectWeights({
    tags: ['EM VIAGEM'],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag,
    mobilizationProjectIds: ['A', 'B']
  });
  assert.equal(semJanela.reason, 'RDO_PERIOD_MISMATCH');

  const comJanela = buildDailyProjectWeights({
    tags: ['EM VIAGEM'],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag,
    mobilizationProjectIds: ['A', 'B'],
    scheduleWindowProjectIds: ['p-5804']
  });
  assert.equal(comJanela.reason, 'SCHEDULE_TRAVEL_TAG');
  assert.deepEqual(comJanela.allocations, [{ projectId: 'p-5804', weight: 1, rdo: null }]);

  const semMarcacaoNoPonto = buildDailyProjectWeights({
    tags: [],
    rdoProjects: new Map(),
    resolveTag: resolveTestTag,
    scheduleWindowProjectIds: ['p-5804']
  });
  assert.equal(semMarcacaoNoPonto.reason, 'NO_PROJECT_EVIDENCE');
  assert.deepEqual(semMarcacaoNoPonto.allocations, []);
  assert.equal(allocationDecisionRequiresAction(semMarcacaoNoPonto), false);
});

test('dia fora da janela não é alocado por ela', () => {
  const janelas = buildScheduleWindows([JANELA_5804]);
  const elegiveis = buildScheduleWindowEligibility(janelas, new Map([[
    'c-1',
    { nominalRdoProjectsByDate: new Map([['2026-08-17', new Set(['p-5804'])]]) }
  ]]));

  assert.deepEqual(scheduleWindowsForDay({
    scheduleWindows: janelas,
    eligibleByProject: elegiveis,
    collaboratorId: 'c-1',
    dateKey: '2026-07-13'
  }), []);
  assert.deepEqual(scheduleWindowsForDay({
    scheduleWindows: janelas,
    eligibleByProject: elegiveis,
    collaboratorId: 'c-1',
    dateKey: '2026-09-01'
  }), []);
  assert.deepEqual(scheduleWindowsForDay({
    scheduleWindows: janelas,
    eligibleByProject: elegiveis,
    collaboratorId: 'c-1',
    dateKey: '2026-08-17'
  }), ['p-5804']);
  // Colaborador que não é elegível não entra mesmo dentro da janela.
  assert.deepEqual(scheduleWindowsForDay({
    scheduleWindows: janelas,
    eligibleByProject: elegiveis,
    collaboratorId: 'c-outro',
    dateKey: '2026-08-17'
  }), []);
});

test('dia já resolvido à mão não volta a ser pendência quando o snapshot é re-sincronizado', () => {
  // Conflito clássico: etiqueta aponta um projeto, o RDO do dia aponta outros dois.
  const rdo = {
    byProject: new Map(),
    dayProjects: new Map([['2026-08-17', dailyRdo([['B', 8], ['C', 8]])]])
  };
  const rows = [{
    date: '2026-08-17',
    normalHours: 8.8,
    he70Horas: 0,
    he100Horas: 0,
    tags: ['Missão A']
  }];

  const semResolucao = classifyProjectHours(rows, rdo, resolveTestTag, new Map());
  assert.deepEqual(semResolucao.unresolvedDays.map(item => item.reason), ['TAG_RDO_CONFLICT']);

  // A seleção manual é por colaborador+data e não pertence ao snapshot, então sobrevive a qualquer
  // reimportação do período: o dia continua alocado e fora da fila de pendências.
  const resolvido = classifyProjectHours(
    rows,
    rdo,
    resolveTestTag,
    new Map(),
    new Map([['2026-08-17', ['B']]])
  );
  assert.deepEqual(resolvido.unresolvedDays, []);
  assert.equal(resolvido.dayTrail[0].reason, 'MANUAL_OVERRIDE');
  assert.deepEqual(resolvido.dayTrail[0].allocations, [{ projectId: 'B', weight: 1 }]);
  assert.ok(near(resolvido.byProject.get('B').normalHours, 8.8));
});

test('campos manuais do Project não tornam colaborador elegível no fallback legado', () => {
  const janelas = buildScheduleWindows([{
    ...JANELA_5804,
    operatorId: 'c-operador',
    laborCollaboratorIds: ['  c-1  ', '', null, 42, 'c-1', 'c-2']
  }]);
  const elegiveis = buildScheduleWindowEligibility(janelas, new Map());

  assert.deepEqual([...elegiveis.get('p-5804')], []);
  assert.deepEqual(scheduleWindowsForDay({
    scheduleWindows: janelas,
    eligibleByProject: elegiveis,
    collaboratorId: 'c-1',
    dateKey: '2026-08-17'
  }), []);
});
