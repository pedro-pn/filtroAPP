import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildOmieCostPaymentSummary,
  buildPlannedRoleCounts,
  buildProjectAppropriationDays,
  buildProjectDetailCollaborator,
  buildProjectReportHours,
  buildRecentReportDays
} from '../src/lib/acompanhamento/project-detail.js';
import { isSalaryCategory } from '../src/lib/acompanhamento/salary.js';

test('isSalaryCategory: reconhece categorias de folha/mão de obra (acentos e caixa)', () => {
  assert.equal(isSalaryCategory('Salários e ordenados'), true);
  assert.equal(isSalaryCategory('FOLHA DE PAGAMENTO'), true);
  assert.equal(isSalaryCategory('Pró-labore'), true);
  assert.equal(isSalaryCategory('INSS a recolher'), true);
  assert.equal(isSalaryCategory('FGTS'), true);
  assert.equal(isSalaryCategory('Férias'), true);
  assert.equal(isSalaryCategory('Rescisão contratual'), true);
  assert.equal(isSalaryCategory('Vale transporte'), true);
});

test('isSalaryCategory: não marca custos de obra/material', () => {
  assert.equal(isSalaryCategory('Material de consumo'), false);
  assert.equal(isSalaryCategory('Hospedagem'), false);
  assert.equal(isSalaryCategory('Locação de equipamento'), false);
  assert.equal(isSalaryCategory('Combustível'), false);
  assert.equal(isSalaryCategory(null), false);
  assert.equal(isSalaryCategory(''), false);
});

test('buildPlannedRoleCounts conta colaboradores distintos e horas usadas por cargo previsto', () => {
  const plannedRows = [
    { roleName: 'Técnico de Campo' },
    { jobRole: { name: 'Encarregado' } },
    { roleName: null }
  ];
  const collaborators = [
    { collaboratorId: 'c1', roleNameSnapshot: 'tecnico de campo', collaborator: { jobRole: { name: 'Técnico de Campo' } }, report: { daytimeWorkedMinutes: 1800, nighttimeWorkedMinutes: 0 } },
    { collaboratorId: 'c1', roleNameSnapshot: 'Técnico de Campo', collaborator: { jobRole: { name: 'Técnico de Campo' } }, report: { daytimeWorkedMinutes: 1200, nighttimeWorkedMinutes: 0 } },
    { collaboratorId: 'c2', roleNameSnapshot: 'TÉCNICO DE CAMPO', collaborator: { jobRole: { name: 'Técnico de Campo' } }, report: { daytimeWorkedMinutes: 3000, nighttimeWorkedMinutes: 0 } },
    { collaboratorId: 'c3', roleNameSnapshot: 'Auxiliar', collaborator: { jobRole: { name: 'Auxiliar' } }, report: { daytimeWorkedMinutes: 600, nighttimeWorkedMinutes: 0 } },
    { collaboratorId: 'c4', roleNameSnapshot: 'Encarregado', collaborator: { jobRole: { name: 'Encarregado' } }, report: { daytimeWorkedMinutes: 480, nighttimeWorkedMinutes: 120 } }
  ];

  assert.deepEqual(buildPlannedRoleCounts(plannedRows, collaborators, 300), [
    { roleName: 'Encarregado', collaboratorCount: 1, usedHours: 10, pctOfPlannedTotal: 3 },
    { roleName: 'Técnico de Campo', collaboratorCount: 2, usedHours: 100, pctOfPlannedTotal: 33 }
  ]);
});

test('buildPlannedRoleCounts separa horas noturnas por equipe do turno quando recebe RDOs', () => {
  const plannedRows = [
    { roleName: 'Técnico' },
    { roleName: 'Supervisor' }
  ];
  const collaborators = [
    {
      collaboratorId: 'day-1',
      roleNameSnapshot: 'Técnico',
      collaborator: { jobRole: { name: 'Técnico' } },
      report: { daytimeWorkedMinutes: 480, nighttimeWorkedMinutes: 360 }
    }
  ];
  const reports = [
    {
      nighttimeWorkedMinutes: 360,
      specialConditions: {
        noturnoDetails: {
          collaboratorIds: ['night-1'],
          colaboradores: [{ id: 'night-1', name: 'Nina', role: 'Supervisor' }]
        }
      }
    }
  ];

  assert.deepEqual(buildPlannedRoleCounts(plannedRows, collaborators, 100, reports), [
    { roleName: 'Supervisor', collaboratorCount: 1, usedHours: 6, pctOfPlannedTotal: 6 },
    { roleName: 'Técnico', collaboratorCount: 1, usedHours: 8, pctOfPlannedTotal: 8 }
  ]);
});

test('buildPlannedRoleCounts omite cargos previstos sem colaborador correspondente', () => {
  const out = buildPlannedRoleCounts(
    [{ roleName: 'Supervisor' }],
    [{ collaboratorId: 'c1', roleNameSnapshot: 'Técnico', collaborator: { jobRole: { name: 'Técnico' } } }]
  );

  assert.deepEqual(out, []);
});

test('buildProjectDetailCollaborator separa apropriação financeira da jornada dos RDOs', () => {
  const result = buildProjectDetailCollaborator({
    name: 'Ana',
    role: 'Operadora',
    allocation: { cost: 212.5, hours: 4.25, travelHours: 1.5 },
    workedMinutes: 630,
    workedMinutesByDate: new Map([
      ['2026-07-17', 150],
      ['2026-07-16', 480]
    ]),
    includeCollaboratorCosts: true
  });

  assert.deepEqual(result, {
    name: 'Ana',
    role: 'Operadora',
    horas: 10.5,
    horasLancadas: 10.5,
    horasApropriadas: 4.25,
    horasDeslocamento: 1.5,
    diasApropriados: [],
    sobreposicaoHoras: 0,
    horasRelatoriosPorData: [
      { data: '2026-07-16', horas: 8, relatorios: [] },
      { data: '2026-07-17', horas: 2.5, relatorios: [] }
    ],
    custo: 212.5,
    custoHora: 50,
    custoDeslocamento: 75
  });
});

test('jornada sem apropriação conserva cada relatório-fonte e respeita a equipe do turno', () => {
  const reports = [
    {
      id: 'rdo-7', projectId: 'p-5761', reportType: 'RDO', sequenceNumber: 7,
      reportDate: '2026-02-18T12:00:00Z', daytimeWorkedMinutes: 605, nighttimeWorkedMinutes: 120,
      specialConditions: { noturnoDetails: { collaboratorIds: ['night'] } }
    },
    {
      id: 'rtp-2', projectId: 'p-5761', reportType: 'RTP', sequenceNumber: 2,
      reportDate: '2026-02-18T12:00:00Z', daytimeWorkedMinutes: 60, nighttimeWorkedMinutes: 0
    }
  ];
  const hours = buildProjectReportHours(reports, new Map([
    ['rdo-7', ['aldo']], ['rtp-2', ['aldo']]
  ]), '5761');
  const aldo = buildProjectDetailCollaborator({ name: 'Aldo', ...hours.get('aldo') });
  assert.equal(aldo.horasApropriadas, null);
  assert.equal(aldo.custo, null);
  assert.equal(aldo.horas, 11.1);
  assert.deepEqual(aldo.horasRelatoriosPorData, [{
    data: '2026-02-18', horas: 665 / 60,
    relatorios: [
      { id: 'rdo-7', tipo: 'RDO', numero: 7, projetoId: 'p-5761', projetoCodigo: '5761', horas: 605 / 60 },
      { id: 'rtp-2', tipo: 'RTP', numero: 2, projetoId: 'p-5761', projetoCodigo: '5761', horas: 1 }
    ]
  }]);
  const night = buildProjectDetailCollaborator({ ...hours.get('night') });
  assert.equal(night.horas, 2);
  assert.deepEqual(night.horasRelatoriosPorData[0].relatorios, [
    { id: 'rdo-7', tipo: 'RDO', numero: 7, projetoId: 'p-5761', projetoCodigo: '5761', horas: 2 }
  ]);
  assert.equal(hours.has('absent'), false);
});

test('buildProjectAppropriationDays detalha horas analíticas, viagem e número do RDO', () => {
  const result = buildProjectAppropriationDays({
    analyticalAllocationTrail: [
      {
        date: '2026-08-25',
        costNormalHours: 8.8,
        he70Hours: 1,
        he100Hours: 0,
        travelContext: false,
        allocations: [{ projectId: 'p-5800', weight: 1 }],
        rdoProjects: [{ projectId: 'p-5800', projectCode: '5800', rdoNumber: 12, hours: 8 }]
      },
      {
        date: '2026-08-26',
        costNormalHours: 8.8,
        he70Hours: 0,
        he100Hours: 0,
        travelContext: true,
        allocations: [{ projectId: 'p-5800', weight: 1 }],
        rdoProjects: []
      }
    ]
  }, 'p-5800');

  assert.deepEqual(result, [
    {
      data: '2026-08-25',
      horas: 9.8,
      horasNormais: 8.8,
      horasExtras: 1,
      emViagem: false,
      rdos: [{ numero: 12, projetoId: 'p-5800', projetoCodigo: '5800' }]
    },
    {
      data: '2026-08-26',
      horas: 8.8,
      horasNormais: 8.8,
      horasExtras: 0,
      emViagem: true,
      rdos: []
    }
  ]);
});

test('buildProjectDetailCollaborator oculta valores financeiros sem ocultar as horas apropriadas', () => {
  const result = buildProjectDetailCollaborator({
    rate: { name: 'Carlos', role: 'Assistente' },
    allocation: { cost: 180, hours: 6, travelHours: 2 },
    includeCollaboratorCosts: false
  });

  assert.equal(result.name, 'Carlos');
  assert.equal(result.role, 'Assistente');
  assert.equal(result.horasApropriadas, 6);
  assert.equal(result.horasDeslocamento, 2);
  assert.equal(result.custo, null);
  assert.equal(result.custoHora, null);
  assert.equal(result.custoDeslocamento, null);
});

test('buildOmieCostPaymentSummary separa pago de títulos previstos a pagar', () => {
  const out = buildOmieCostPaymentSummary([
    { statusTitulo: 'PAGO', categoriaDescricao: 'Projeto - Hospedagem', _sum: { valor: 150.25 } },
    { statusTitulo: 'A VENCER', categoriaDescricao: 'Projeto - Alimentação', _sum: { valor: 200 } },
    { statusTitulo: 'ATRASADO', categoriaDescricao: 'Projeto - Combustível', _sum: { valor: 50.5 } },
    { statusTitulo: 'PAGO', categoriaDescricao: 'Salários - Operação', _sum: { valor: 9999 } }
  ]);

  assert.deepEqual(out, { pago: 150.25, previstoPagar: 250.5 });
});

test('buildRecentReportDays preserva os 10 RDOs mais recentes em ordem cronológica', () => {
  const byDay = new Map(Array.from({ length: 12 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    const date = `2026-08-${day}`;
    const standbyMinutes = index === 11 ? 480 : index === 10 ? 60 : 0;
    return [date, {
      reportDate: `${date}T12:00:00.000Z`,
      statusStandbyMin: standbyMinutes,
      workedMin: standbyMinutes === 480 ? 0 : 480,
      standbyMin: standbyMinutes
    }];
  }));

  const result = buildRecentReportDays(byDay, { workdayHours: '08:00' });

  assert.equal(result.length, 10);
  assert.equal(result[0].date, '2026-08-03');
  assert.equal(result[8].status, 'STANDBY');
  assert.deepEqual(result[9], {
    date: '2026-08-12',
    status: 'PARADO',
    workedMinutes: 0,
    standbyMinutes: 480
  });
});
