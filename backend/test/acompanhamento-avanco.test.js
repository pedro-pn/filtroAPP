import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeRdoServiceType,
  realizedFromExtraData,
  isServiceFinalized,
  buildProgress,
  buildProgressHistory,
  buildRequiredWeeklyProgress,
  realizedReportWhere,
  isRealizedSourceReport,
  isPointWorkbookDerivedRdoRoster,
  isConfirmedReportParticipant,
  selectRealizedSourceReportData
} from '../src/lib/acompanhamento/avanco.js';

test('consulta do avanço considera relatórios ativos do projeto', () => {
  assert.deepEqual(realizedReportWhere(['projeto-1']), {
    report: {
      projectId: { in: ['projeto-1'] },
      deletedAt: null
    }
  });
});

test('fonte do realizado aceita RDO e relatório independente, mas ignora derivado do RDO', () => {
  assert.equal(isRealizedSourceReport({ reportType: 'RDO' }), true);
  assert.equal(isRealizedSourceReport({ reportType: 'RLQ', specialConditions: { serviceOnly: true } }), true);
  assert.equal(isRealizedSourceReport({
    reportType: 'RLQ',
    specialConditions: { parentRdoId: 'rdo-1' }
  }), false);
});

test('seleção do realizado inclui equipe de serviceOnly independente e exclui equipe de derivado', () => {
  const reports = [
    { id: 'rdo-1', reportType: 'RDO', specialConditions: {} },
    { id: 'service-only-1', reportType: 'RLQ', specialConditions: { serviceOnly: true } },
    { id: 'derived-1', reportType: 'RLQ', specialConditions: { parentRdoId: 'rdo-1' } }
  ];
  const collaborators = [
    { reportId: 'rdo-1', collaboratorId: 'maria' },
    { reportId: 'service-only-1', collaboratorId: 'ronaldo' },
    { reportId: 'derived-1', collaboratorId: 'duplicado' }
  ];

  const selected = selectRealizedSourceReportData(reports, collaborators);

  assert.deepEqual(selected.reports.map(report => report.id), ['rdo-1', 'service-only-1']);
  assert.deepEqual(selected.collaborators.map(item => item.collaboratorId), ['maria', 'ronaldo']);
});

test('equipe inferida da planilha do ponto não confirma participação sem horas apropriadas', () => {
  const imported = {
    reportType: 'RDO',
    specialConditions: {
      __manualUpload: { importedByScript: 'import-manual-rdo-pdfs' }
    }
  };
  const native = { reportType: 'RDO', specialConditions: {} };

  assert.equal(isPointWorkbookDerivedRdoRoster(imported), true);
  assert.equal(isConfirmedReportParticipant(imported, false), false);
  assert.equal(isConfirmedReportParticipant(imported, true), true);
  assert.equal(isPointWorkbookDerivedRdoRoster(native), false);
  assert.equal(isConfirmedReportParticipant(native, false), true);
});

test('isServiceFinalized: coluna booleana e campo textual do extraData', () => {
  assert.equal(isServiceFinalized({ finalized: true }), true);
  assert.equal(isServiceFinalized({ finalized: false }), false);
  assert.equal(isServiceFinalized({ finalized: null, extraData: { 'Serviço finalizado?': 'Sim' } }), true);
  assert.equal(isServiceFinalized({ extraData: { 'Serviço finalizado?': 'Não' } }), false);
  assert.equal(isServiceFinalized({}), false);
  assert.equal(isServiceFinalized(null), false);
});

test('normalizeRdoServiceType aceita os vários formatos do RDO', () => {
  assert.equal(normalizeRdoServiceType('limpeza'), 'LIMPEZA_QUIMICA');
  assert.equal(normalizeRdoServiceType('LIMPEZA'), 'LIMPEZA_QUIMICA');
  assert.equal(normalizeRdoServiceType('Limpeza química'), 'LIMPEZA_QUIMICA');
  assert.equal(normalizeRdoServiceType('pressao'), 'TESTE_PRESSAO');
  assert.equal(normalizeRdoServiceType('Teste de pressão'), 'TESTE_PRESSAO');
  assert.equal(normalizeRdoServiceType('flushing'), 'FLUSHING');
  assert.equal(normalizeRdoServiceType('Filtragem'), 'FILTRAGEM');
  assert.equal(normalizeRdoServiceType('mecanica'), null);
  assert.equal(normalizeRdoServiceType('inibicao'), null);
  assert.equal(normalizeRdoServiceType(''), null);
});

test('realizedFromExtraData soma tubulação (cm→m) e óleo (mL→L)', () => {
  const r = realizedFromExtraData({
    tubes: [
      { c: '100', lengthUnit: 'm' },
      { c: '250', lengthUnit: 'cm' }, // = 2.5 m
      { c: '1.234,5', lengthUnit: 'm' } // BR: 1234.5 m
    ],
    volumeOleo: '500',
    volumeOleoUnit: 'mL' // = 0.5 L
  });
  assert.equal(r.tubulacaoM, 100 + 2.5 + 1234.5);
  assert.equal(r.oleoL, 0.5);
});

test('realizedFromExtraData tolera dados ausentes', () => {
  assert.deepEqual(realizedFromExtraData(null), { tubulacaoM: 0, oleoL: 0 });
  assert.deepEqual(realizedFromExtraData({ tubes: 'x' }), { tubulacaoM: 0, oleoL: 0 });
});

test('buildProgress: execução por sistema limitada a 100% e ponderada por peso', () => {
  const planned = [
    { serviceType: 'LIMPEZA_QUIMICA', weight: 3, systems: [{ systemType: 'TUBULACAO', quantity: 1000, unit: 'M' }] },
    { serviceType: 'FILTRAGEM', weight: 1, systems: [{ systemType: 'OLEO', quantity: 200, unit: 'L' }] }
  ];
  const realized = new Map([
    ['LIMPEZA_QUIMICA', { tubulacaoM: 500, oleoL: 0 }], // 50%
    ['FILTRAGEM', { tubulacaoM: 0, oleoL: 400 }] // 200% -> cap 100%
  ]);
  const out = buildProgress(planned, realized);
  assert.equal(out.hasScope, true);
  assert.equal(out.services[0].executionPct, 50);
  assert.equal(out.services[1].executionPct, 100); // cap
  // (3*50 + 1*100) / (3+1) = 250/4 = 62.5
  assert.equal(out.progressPct, 62.5);
});

test('buildProgress: serviço com sistema de múltiplas medidas usa a média', () => {
  const planned = [
    { serviceType: 'FLUSHING', weight: 1, systems: [
      { systemType: 'TUBULACAO', quantity: 100, unit: 'M' }, // 100% (real 100)
      { systemType: 'OLEO', quantity: 100, unit: 'L' } // 0% (real 0)
    ] }
  ];
  const realized = new Map([['FLUSHING', { tubulacaoM: 100, oleoL: 0 }]]);
  const out = buildProgress(planned, realized);
  assert.equal(out.services[0].executionPct, 50); // média de 100% e 0%
  assert.equal(out.progressPct, 50);
});

test('buildProgress: sem meta cadastrada não entra no avanço (progressPct null)', () => {
  const planned = [
    { serviceType: 'LIMPEZA_QUIMICA', weight: 1, systems: [{ systemType: 'TUBULACAO', quantity: null, unit: 'M' }] }
  ];
  const out = buildProgress(planned, new Map());
  assert.equal(out.services[0].executionPct, null);
  assert.equal(out.progressPct, null);
  assert.equal(out.hasScope, false);
});

test('buildProgress: agrega escopos repetidos do mesmo serviço sem duplicar o realizado', () => {
  const planned = [
    { serviceType: 'LIMPEZA_QUIMICA', weight: 1, systems: [{ systemType: 'TUBULACAO', quantity: 400, unit: 'M' }] },
    { serviceType: 'LIMPEZA_QUIMICA', weight: 2, systems: [{ systemType: 'TUBULACAO', quantity: 600, unit: 'M' }] }
  ];
  const realized = new Map([['LIMPEZA_QUIMICA', { tubulacaoM: 250, oleoL: 0 }]]);

  const out = buildProgress(planned, realized);

  assert.equal(out.services.length, 1);
  assert.equal(out.services[0].weight, 3);
  assert.deepEqual(out.services[0].systems[0], {
    systemType: 'TUBULACAO',
    unit: 'M',
    plannedQty: 1000,
    realizedQty: 250,
    pct: 25
  });
  assert.equal(out.progressPct, 25);
});

test('buildRequiredWeeklyProgress calcula pontos percentuais e quantitativos por semana', () => {
  const out = buildRequiredWeeklyProgress({
    progressPct: 58,
    services: [{
      serviceType: 'LIMPEZA_QUIMICA',
      executionPct: 37.5,
      systems: [{ systemType: 'TUBULACAO', unit: 'M', plannedQty: 1200, realizedQty: 450 }]
    }]
  }, {
    startDate: '2026-07-01',
    expectedEndDate: '2026-09-11',
    referenceDate: '2026-08-07'
  });

  assert.equal(out.status, 'REQUIRED');
  assert.equal(out.remainingDays, 35);
  assert.equal(out.remainingPctPoints, 42);
  assert.equal(out.requiredPctPointsPerWeek, 8.4);
  assert.deepEqual(out.services[0].systems[0], {
    systemType: 'TUBULACAO',
    unit: 'M',
    plannedQty: 1200,
    realizedQty: 450,
    remainingQty: 750,
    status: 'REQUIRED',
    requiredQtyPerWeek: 150
  });
});

test('buildRequiredWeeklyProgress descreve conclusão, prazo de hoje e atraso', () => {
  const service = remaining => ({
    progressPct: 100 - remaining,
    services: [{
      serviceType: 'FILTRAGEM',
      executionPct: 100 - remaining,
      systems: [{ systemType: 'OLEO', unit: 'L', plannedQty: 100, realizedQty: 100 - remaining }]
    }]
  });

  assert.equal(buildRequiredWeeklyProgress(service(0), {
    expectedEndDate: '2026-08-07', referenceDate: '2026-08-07'
  }).status, 'COMPLETED');
  assert.equal(buildRequiredWeeklyProgress(service(20), {
    expectedEndDate: '2026-08-07', referenceDate: '2026-08-07'
  }).status, 'DUE_TODAY');
  assert.equal(buildRequiredWeeklyProgress(service(20), {
    expectedEndDate: '2026-08-06', referenceDate: '2026-08-07'
  }).services[0].systems[0].status, 'OVERDUE');
});

test('buildRequiredWeeklyProgress não consome prazo antes do início', () => {
  const out = buildRequiredWeeklyProgress({ progressPct: 0, services: [] }, {
    startDate: '2026-08-14',
    expectedEndDate: '2026-08-28',
    referenceDate: '2026-08-07'
  });

  assert.equal(out.remainingDays, 14);
  assert.equal(out.requiredPctPointsPerWeek, 50);
});

test('buildProgressHistory compacta avanço acumulado em pontos semanais', () => {
  const planned = [
    { serviceType: 'LIMPEZA_QUIMICA', weight: 1, systems: [{ systemType: 'TUBULACAO', quantity: 1000, unit: 'M' }] }
  ];
  const out = buildProgressHistory(planned, [
    {
      finalized: true,
      serviceType: 'limpeza',
      reportDate: '2026-07-01T00:00:00.000Z',
      extraData: { tubes: [{ c: '100', lengthUnit: 'm' }] }
    },
    {
      finalized: true,
      serviceType: 'limpeza',
      reportDate: '2026-07-03T00:00:00.000Z',
      extraData: { tubes: [{ c: '200', lengthUnit: 'm' }] }
    },
    {
      finalized: true,
      serviceType: 'limpeza',
      reportDate: '2026-07-10T00:00:00.000Z',
      extraData: { tubes: [{ c: '300', lengthUnit: 'm' }] }
    }
  ], { startDate: '2026-06-30T00:00:00.000Z' });

  assert.deepEqual(out, [
    { date: '2026-06-30', progressPct: 0 },
    { date: '2026-07-03', progressPct: 30 },
    { date: '2026-07-10', progressPct: 60 }
  ]);
});

test('buildProgressHistory ignora relatório derivado e contabiliza relatório de serviço independente', () => {
  const planned = [
    { serviceType: 'LIMPEZA_QUIMICA', weight: 1, systems: [{ systemType: 'TUBULACAO', quantity: 1000, unit: 'M' }] },
    { serviceType: 'TESTE_PRESSAO', weight: 1, systems: [{ systemType: 'TUBULACAO', quantity: 1000, unit: 'M' }] }
  ];
  const tubeMeasurement = { tubes: [{ c: '500', lengthUnit: 'm' }] };
  const out = buildProgressHistory(planned, [
    {
      finalized: true,
      serviceType: 'limpeza',
      reportType: 'RDO',
      reportDate: '2026-07-01T00:00:00.000Z',
      extraData: tubeMeasurement
    },
    {
      finalized: true,
      serviceType: 'limpeza',
      reportType: 'RLQ',
      specialConditions: { parentRdoId: 'rdo-1' },
      reportDate: '2026-07-01T00:00:00.000Z',
      extraData: tubeMeasurement
    },
    {
      finalized: true,
      serviceType: 'pressao',
      reportType: 'RTP',
      specialConditions: { serviceOnly: true },
      reportDate: '2026-07-01T00:00:00.000Z',
      extraData: tubeMeasurement
    }
  ]);

  assert.deepEqual(out, [{ date: '2026-07-01', progressPct: 50 }]);
});

test('buildProgressHistory usa ponto manual atual quando não há escopo medível', () => {
  const out = buildProgressHistory([], [], {
    startDate: '2026-07-01T00:00:00.000Z',
    manualProgressPct: 42.4,
    currentDate: '2026-07-15T00:00:00.000Z'
  });

  assert.deepEqual(out, [
    { date: '2026-07-01', progressPct: 0 },
    { date: '2026-07-15', progressPct: 42.4 }
  ]);
});

test('buildProgressHistory usa histórico manual quando não há escopo medível', () => {
  const out = buildProgressHistory([], [], {
    startDate: '2026-07-01T00:00:00.000Z',
    manualProgressPct: 35,
    currentDate: '2026-07-15T00:00:00.000Z',
    manualProgressHistory: [
      { recordedAt: '2026-07-03T00:00:00.000Z', progressPct: 10 },
      { recordedAt: '2026-07-07T00:00:00.000Z', progressPct: '20.5' },
      { recordedAt: '2026-07-10T00:00:00.000Z', progressPct: 35 }
    ]
  });

  assert.deepEqual(out, [
    { date: '2026-07-01', progressPct: 0 },
    { date: '2026-07-03', progressPct: 10 },
    { date: '2026-07-10', progressPct: 35 }
  ]);
});
