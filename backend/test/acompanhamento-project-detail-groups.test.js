import assert from 'node:assert/strict';
import { test } from 'node:test';

import { combineRecentDays, groupProjectDetails } from '../src/lib/acompanhamento/project-detail-groups.js';

function group() {
  return {
    id: 'g1',
    name: 'Cliente A - 1001 + 1002',
    status: 'ACTIVE',
    members: [
      { projectId: 'p1', order: 0, project: { id: 'p1', code: '1001', name: 'A', clientName: 'Cliente A', clientCnpj: '11222333000144' } },
      { projectId: 'p2', order: 1, project: { id: 'p2', code: '1002', name: 'B', clientName: 'Cliente A', clientCnpj: '11222333000144' } }
    ]
  };
}

function detail(overrides = {}) {
  return {
    header: {
      code: overrides.code ?? '1001',
      clientName: overrides.clientName ?? 'Cliente A',
      clientCnpj: overrides.clientCnpj ?? '11222333000144',
      proposalCode: overrides.proposalCode ?? 'PROP-1',
      lastRdoDate: overrides.lastRdoDate ?? '2026-07-10T00:00:00.000Z',
      segment: overrides.segment ?? 'Industria'
    },
    alerts: overrides.alerts ?? [],
    avancoMethod: overrides.avancoMethod ?? 'RDO',
    diasCorridos: overrides.diasCorridos ?? { elapsed: 4, planned: 10, pct: 40 },
    diasTrabalhados: overrides.diasTrabalhados ?? { worked: 3, planned: 8, pct: 38 },
    consumo: overrides.consumo ?? {
      gasto: 50,
      omie: 40,
      pago: 30,
      previstoPagar: 10,
      estoque: 10,
      manual: 0,
      previsto: 100,
      pct: 50
    },
    faturamento: overrides.faturamento ?? { previsto: 120, realizado: 80, notas: 1 },
    maoDeObra: overrides.maoDeObra ?? {
      custo: 20,
      custoBase: 18,
      horas: 5,
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-07-31T00:00:00.000Z'
    },
    presumedProfitTaxes: overrides.presumedProfitTaxes ?? { outOfInvoiceTaxTotal: 7, invoiceTaxTotal: 3, basisSource: 'EXPECTED_SALE' },
    workedHours: overrides.workedHours ?? {
      normalWorkedHours: 8,
      overtimeWorkedHours: 2,
      totalWorkedHours: 10,
      plannedNormalHours: 16,
      plannedOvertimeHours: 4,
      plannedTotalHours: 20,
      normalPct: 40,
      overtimePct: 10,
      totalPct: 50,
      roleCounts: [{ roleName: 'Operador', collaboratorCount: 1, usedHours: 10, pctOfPlannedTotal: 50 }]
    },
    maioresGastos: overrides.maioresGastos ?? [{ categoria: 'Quimicos', total: 30 }],
    manualCosts: overrides.manualCosts ?? [],
    avancoPct: overrides.avancoPct ?? 50,
    progressHistory: overrides.progressHistory ?? [],
    standby: overrides.standby ?? { count: 1, minutes: 60 },
    ultimosDias: overrides.ultimosDias ?? [
      { date: '2026-07-09', status: 'TRABALHADO', workedMinutes: 480, standbyMinutes: 0 }
    ],
    overtimeMinutes: overrides.overtimeMinutes ?? 120,
    colaboradores: overrides.colaboradores ?? [{
      name: 'Ana',
      role: 'Operador',
      horas: 5,
      horasLancadas: 5,
      horasApropriadas: 3,
      horasDeslocamento: 1,
      diasApropriados: [{
        data: '2026-07-09', horas: 3, horasNormais: 3, horasExtras: 0, emViagem: true,
        rdos: [{ numero: 4, projetoId: 'p1', projetoCodigo: '1001' }]
      }],
      sobreposicaoHoras: 0,
      horasRelatoriosPorData: [{ data: '2026-07-09', horas: 5 }],
      custo: 20,
      custoHora: 20 / 3,
      custoDeslocamento: 6
    }],
    equipamentos: overrides.equipamentos ?? [{ name: 'Bomba', days: 3, since: '2026-07-07T00:00:00.000Z' }],
    footer: overrides.footer ?? {
      mobilizationDate: '2026-06-30T00:00:00.000Z',
      startDate: '2026-07-01T00:00:00.000Z',
      expectedEndDate: '2026-07-11T00:00:00.000Z',
      projectedEndByPace: '2026-07-20T00:00:00.000Z'
    }
  };
}

test('grupo mantém RDOs das duas missões e considera somente a maior jornada por data', () => {
  const first = { id: 'r1', tipo: 'RDO', numero: 7, projetoId: 'p1', projetoCodigo: '1001', horas: 8 };
  const second = { id: 'r2', tipo: 'RDO', numero: 7, projetoId: 'p2', projetoCodigo: '1002', horas: 5 };
  const third = { id: 'r3', tipo: 'RDO', numero: 8, projetoId: 'p2', projetoCodigo: '1002', horas: 2 };
  const result = groupProjectDetails(group(), group().members.map((member, index) => ({
    projectId: member.projectId,
    member,
    detail: detail({ colaboradores: [{
      name: 'Aldo', role: 'Assistente', horas: index ? 7 : 8, horasLancadas: index ? 7 : 8,
      horasApropriadas: null, custo: null,
      horasRelatoriosPorData: index ? [
        { data: '2026-02-18', horas: 5, relatorios: [second] },
        { data: '2026-02-19', horas: 2, relatorios: [third] }
      ] : [{ data: '2026-02-18', horas: 8, relatorios: [first] }]
    }] })
  })));
  const collaborator = result.colaboradores[0];
  assert.equal(collaborator.horas, 10);
  assert.equal(collaborator.horasLancadas, 15);
  assert.equal(collaborator.sobreposicaoHoras, 5);
  assert.equal(collaborator.horasApropriadas, null);
  assert.deepEqual(collaborator.horasRelatoriosPorData, [
    { data: '2026-02-18', horas: 8, relatorios: [first, second] },
    { data: '2026-02-19', horas: 2, relatorios: [third] }
  ]);
});

test('combineRecentDays mantém até 10 dias distintos nos grupos', () => {
  const recentDays = Array.from({ length: 12 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return {
      date: `2026-08-${day}`,
      status: 'TRABALHADO',
      workedMinutes: 480,
      standbyMinutes: 0
    };
  });

  const result = combineRecentDays([{ detail: { ultimosDias: recentDays } }]);

  assert.equal(result.length, 10);
  assert.equal(result[0].date, '2026-08-03');
  assert.equal(result[9].date, '2026-08-12');
});

test('groupProjectDetails returns one consolidated project detail shape', () => {
  const result = groupProjectDetails(group(), [
    {
      projectId: 'p1',
      member: group().members[0],
      detail: detail({
        code: '1001',
        avancoPct: 25,
        progressHistory: [{ date: '2026-07-01', progressPct: 25 }],
        consumo: { gasto: 40, omie: 30, pago: 20, previstoPagar: 10, estoque: 10, manual: 0, previsto: 100, pct: 40 }
      }),
      plannedScope: {
        services: [{ serviceType: 'FLUSHING', weight: 60, systems: [{ systemType: 'OLEO', quantity: 100, unit: 'L' }] }],
        normalHours: [{ roleName: 'Operador', collaboratorCount: 1, hours: 8 }],
        overtime: []
      }
    },
    {
      projectId: 'p2',
      member: group().members[1],
      detail: detail({
        code: '1002',
        proposalCode: 'PROP-2',
        lastRdoDate: '2026-07-12T00:00:00.000Z',
        avancoPct: 75,
        progressHistory: [
          { date: '2026-07-01', progressPct: 50 },
          { date: '2026-07-08', progressPct: 75 }
        ],
        consumo: { gasto: 160, omie: 120, pago: 80, previstoPagar: 40, estoque: 30, manual: 10, previsto: 300, pct: 53 },
        faturamento: { previsto: 300, realizado: 220, notas: 2 },
        diasCorridos: { elapsed: 6, planned: 20, pct: 30 },
        diasTrabalhados: { worked: 4, planned: 12, pct: 33 },
        maoDeObra: { custo: 30, custoBase: 25, horas: 7, periodStart: '2026-07-02T00:00:00.000Z', periodEnd: '2026-08-01T00:00:00.000Z' },
        maioresGastos: [{ categoria: 'Quimicos', total: 50 }, { categoria: 'Filtros', total: 20 }, { categoria: 'Manual: Cliente pagou direto', total: 10 }],
        manualCosts: [{ id: 'm1', projectId: 'p2', projectCode: '1002', description: 'Cliente pagou direto', amount: 10 }],
        standby: { count: 2, minutes: 90 },
        ultimosDias: [
          { date: '2026-07-09', status: 'STANDBY', workedMinutes: 360, standbyMinutes: 60 },
          { date: '2026-07-12', status: 'PARADO', workedMinutes: 0, standbyMinutes: 480 }
        ],
        colaboradores: [
          {
            name: 'Ana',
            role: 'Operador',
            horas: 7,
            horasLancadas: 7,
            horasApropriadas: 4,
            horasDeslocamento: 2,
            diasApropriados: [
              {
                data: '2026-07-09', horas: 2, horasNormais: 2, horasExtras: 0, emViagem: false,
                rdos: [{ numero: 7, projetoId: 'p2', projetoCodigo: '1002' }]
              },
              { data: '2026-07-10', horas: 2, horasNormais: 1, horasExtras: 1, emViagem: true, rdos: [] }
            ],
            sobreposicaoHoras: 0,
            horasRelatoriosPorData: [
              { data: '2026-07-09', horas: 5 },
              { data: '2026-07-10', horas: 2 }
            ],
            custo: 30,
            custoHora: 7.5,
            custoDeslocamento: 15
          },
          {
            name: 'Bruno',
            role: 'Supervisor',
            horas: 4,
            horasLancadas: 4,
            horasApropriadas: 5,
            horasDeslocamento: 0,
            diasApropriados: [{
              data: '2026-07-10', horas: 5, horasNormais: 5, horasExtras: 0, emViagem: false,
              rdos: [{ numero: 7, projetoId: 'p2', projetoCodigo: '1002' }]
            }],
            sobreposicaoHoras: 0,
            horasRelatoriosPorData: [{ data: '2026-07-10', horas: 4 }],
            custo: 40,
            custoHora: 8,
            custoDeslocamento: null
          }
        ],
        equipamentos: [
          { name: 'Bomba', days: 5, since: '2026-07-07T00:00:00.000Z' },
          { name: 'Filtro', days: 2, since: '2026-07-10T00:00:00.000Z' }
        ],
        footer: {
          mobilizationDate: '2026-07-01T00:00:00.000Z',
          startDate: '2026-07-02T00:00:00.000Z',
          expectedEndDate: '2026-07-22T00:00:00.000Z',
          projectedEndByPace: '2026-07-30T00:00:00.000Z'
        }
      }),
      plannedScope: {
        services: [{ serviceType: 'FLUSHING', weight: 80, systems: [{ systemType: 'OLEO', quantity: 50, unit: 'L' }] }],
        normalHours: [{ roleName: 'Operador', collaboratorCount: 2, hours: 12 }],
        overtime: [{ roleName: 'Supervisor', collaboratorCount: 1, hours: 4 }]
      }
    }
  ]);

  assert.equal(result.group.id, 'g1');
  assert.equal(result.header.code, '1001 + 1002');
  assert.equal(result.header.clientName, 'Cliente A');
  assert.equal(result.header.proposalCode, 'PROP-1 + PROP-2');
  assert.equal(result.header.lastRdoDate, '2026-07-12T00:00:00.000Z');
  assert.deepEqual(result.diasCorridos, { elapsed: 10, planned: 30, pct: 33 });
  assert.deepEqual(result.diasTrabalhados, { worked: 7, planned: 20, pct: 35 });
  assert.equal(result.consumo.gasto, 200);
  assert.equal(result.consumo.manual, 10);
  assert.equal(result.consumo.previsto, 400);
  assert.equal(result.faturamento.previsto, 420);
  assert.equal(result.faturamento.realizado, 300);
  assert.equal(result.faturamento.notas, 3);
  assert.equal(result.maoDeObra.custo, 50);
  assert.equal(result.avancoMethod, 'GROUP_WEIGHTED');
  assert.equal(result.avancoPct, 62.5);
  assert.deepEqual(result.progressHistory, [
    { date: '2026-07-01', progressPct: 43.8 },
    { date: '2026-07-08', progressPct: 62.5 }
  ]);
  assert.deepEqual(result.maioresGastos, [
    { categoria: 'Quimicos', total: 80 },
    { categoria: 'Filtros', total: 20 },
    { categoria: 'Manual: Cliente pagou direto', total: 10 }
  ]);
  assert.deepEqual(result.manualCosts, [{ id: 'm1', projectId: 'p2', projectCode: '1002', description: 'Cliente pagou direto', amount: 10 }]);
  assert.deepEqual(result.standby, { count: 3, minutes: 150 });
  assert.deepEqual(result.ultimosDias, [
    { date: '2026-07-09', status: 'STANDBY', workedMinutes: 840, standbyMinutes: 60 },
    { date: '2026-07-12', status: 'PARADO', workedMinutes: 0, standbyMinutes: 480 }
  ]);
  assert.deepEqual(result.colaboradores.map(item => ({
    name: item.name,
    horasSemSobreposicao: item.horas,
    horasLancadas: item.horasLancadas,
    horasApropriadas: item.horasApropriadas,
    horasDeslocamento: item.horasDeslocamento,
    sobreposicaoHoras: item.sobreposicaoHoras,
    custo: item.custo,
    custoDeslocamento: item.custoDeslocamento
  })), [
    { name: 'Ana', horasSemSobreposicao: 7, horasLancadas: 12, horasApropriadas: 7, horasDeslocamento: 3, sobreposicaoHoras: 5, custo: 50, custoDeslocamento: 21 },
    { name: 'Bruno', horasSemSobreposicao: 4, horasLancadas: 4, horasApropriadas: 5, horasDeslocamento: 0, sobreposicaoHoras: 0, custo: 40, custoDeslocamento: null }
  ]);
  assert.equal(result.colaboradores[0].custoHora, 50 / 7);
  assert.deepEqual(result.colaboradores[0].diasApropriados, [
    {
      data: '2026-07-09',
      horas: 5,
      horasNormais: 5,
      horasExtras: 0,
      emViagem: true,
      rdos: [
        { numero: 4, projetoId: 'p1', projetoCodigo: '1001' },
        { numero: 7, projetoId: 'p2', projetoCodigo: '1002' }
      ]
    },
    { data: '2026-07-10', horas: 2, horasNormais: 1, horasExtras: 1, emViagem: true, rdos: [] }
  ]);
  assert.deepEqual(result.equipamentos.map(item => [item.name, item.days]), [['Bomba', 5], ['Filtro', 2]]);
  assert.equal(result.plannedScope.services[0].weight, 70);
  assert.equal(result.plannedScope.services[0].systems[0].quantity, 150);
  assert.deepEqual(result.plannedScope.normalHours, [{ jobRoleId: null, roleName: 'Operador', collaboratorCount: 3, hours: 20 }]);
  assert.deepEqual(result.plannedScope.overtime, [{ jobRoleId: null, roleName: 'Supervisor', collaboratorCount: 1, hours: 4 }]);
  assert.equal(result.footer.startDate, '2026-07-01T00:00:00.000Z');
  assert.equal(result.footer.expectedEndDate, '2026-07-22T00:00:00.000Z');
});

test('groupProjectDetails compares grouped client by CNPJ and recalculates physical scope progress', () => {
  const g = group();
  g.members[0].project.clientName = 'Cliente Matriz';
  g.members[1].project.clientName = 'Cliente Obra';

  const result = groupProjectDetails(g, [
    {
      projectId: 'p1',
      member: g.members[0],
      detail: detail({ code: '1001', clientName: 'Cliente Matriz', clientCnpj: '11222333000144', avancoPct: 55 }),
      plannedScope: null,
      progress: {
        hasScope: true,
        progressPct: 55,
        progressMethod: 'RDO',
        services: [{
          serviceType: 'FLUSHING',
          weight: 100,
          executionPct: 55,
          systems: [{ systemType: 'OLEO', unit: 'L', plannedQty: 100, realizedQty: 55, pct: 55 }]
        }]
      }
    },
    {
      projectId: 'p2',
      member: g.members[1],
      detail: detail({ code: '1002', clientName: 'Cliente Obra', clientCnpj: '11222333000144', avancoPct: 75 }),
      plannedScope: null,
      progress: {
        hasScope: true,
        progressPct: 75,
        progressMethod: 'RDO',
        services: [{
          serviceType: 'FLUSHING',
          weight: 100,
          executionPct: 75,
          systems: [{ systemType: 'OLEO', unit: 'L', plannedQty: 300, realizedQty: 225, pct: 75 }]
        }]
      }
    }
  ]);

  assert.equal(result.header.clientName, 'Cliente Matriz');
  assert.equal(result.avancoMethod, 'GROUP_SCOPE');
  assert.equal(result.avancoPct, 70);
});
