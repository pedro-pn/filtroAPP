import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCollaboratorProductivityReport,
  buildCollaboratorAllocation,
  classifyAllocationDay,
  HH_PRODUTIVAS_REF
} from '../src/lib/acompanhamento/collaborator-productivity.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function collaborator(id, name, role) {
  return { id, code: id.toUpperCase(), name, role, isActive: true };
}

function pontoPeriod({ collaborator: item, month, normalMinutes, extrasMinutes = 0, dates, createdAt = '2026-01-10T00:00:00.000Z' }) {
  const workedMinutes = normalMinutes / dates.length;
  const dayExtras = extrasMinutes / dates.length;
  return {
    collaboratorId: item.id,
    rawName: item.name,
    normalizedName: item.name.toLowerCase(),
    collaborator: item,
    periodStart: new Date(`${month}-01T00:00:00.000Z`),
    periodEnd: new Date(`${month}-${dates.length > 1 ? '28' : '02'}T00:00:00.000Z`),
    workedMinutes: normalMinutes,
    he70Minutes: extrasMinutes,
    he100Minutes: extrasMinutes,
    nightMinutes: 0,
    workedDates: dates,
    import: { createdAt },
    monthly: {
      [month]: {
        normalMinutes,
        extrasMinutes,
        nightMinutes: 0,
        workedDates: dates,
        days: dates.map(date => ({ date, workedMinutes, extrasMinutes: dayExtras, nightMinutes: 0 }))
      }
    }
  };
}

function report(projectId, date, collaboratorId, project = {}) {
  return {
    projectId,
    reportType: 'RDO',
    reportDate: `${date}T00:00:00.000Z`,
    daytimeWorkedMinutes: 480,
    nighttimeWorkedMinutes: 0,
    project: {
      code: project.code ?? projectId,
      name: project.name ?? `Obra ${projectId}`,
      offshore: false,
      laborSleepModeByCollaborator: {}
    },
    collaborators: [{ collaboratorId }],
    services: []
  };
}

test('horas extras não alteram HH produtivas, média mensal nem taxa individual', () => {
  const col = collaborator('col-1', 'João Operacional', 'Operador');
  const [row] = buildCollaboratorProductivityReport({
    year: 2026,
    jobRoles: [{ id: 'role-1', name: 'Operador', isOperational: true }],
    pontoPeriods: [
      pontoPeriod({
        collaborator: col,
        month: '2026-01',
        normalMinutes: 120 * 60,
        extrasMinutes: 80 * 60,
        dates: ['2026-01-02', '2026-01-03']
      })
    ]
  }).colaboradores;

  assert.equal(row.totalHHprodutivas, 120);
  assert.equal(row.mediaMensal, 120);
  assert.ok(near(row.taxaIndividual, (HH_PRODUTIVAS_REF - 120) / HH_PRODUTIVAS_REF));
});

test('média mensal igual ou superior a 161 HH produz taxa individual zero', () => {
  const col = collaborator('col-1', 'Maria Campo', 'Operador');
  const [row] = buildCollaboratorProductivityReport({
    year: 2026,
    jobRoles: [{ id: 'role-1', name: 'Operador', isOperational: true }],
    pontoPeriods: [
      pontoPeriod({
        collaborator: col,
        month: '2026-02',
        normalMinutes: 175 * 60,
        dates: ['2026-02-02', '2026-02-03']
      })
    ]
  }).colaboradores;

  assert.equal(row.mediaMensal, 175);
  assert.equal(row.taxaIndividual, 0);
});

test('taxa geral usa só operacionais com meses ativos e exclui administrativo', () => {
  const opOne = collaborator('col-1', 'Operacional Um', 'Operador');
  const opTwo = collaborator('col-2', 'Operacional Dois', 'Técnico');
  const admin = collaborator('col-3', 'Administrativo', 'Almoxarife');

  const result = buildCollaboratorProductivityReport({
    year: 2026,
    jobRoles: [
      { id: 'role-1', name: 'Operador', isOperational: true },
      { id: 'role-2', name: 'Técnico', isOperational: true },
      { id: 'role-3', name: 'Almoxarife', isOperational: false }
    ],
    pontoPeriods: [
      pontoPeriod({ collaborator: opOne, month: '2026-01', normalMinutes: 80.5 * 60, dates: ['2026-01-02'] }),
      pontoPeriod({ collaborator: opTwo, month: '2026-01', normalMinutes: 161 * 60, dates: ['2026-01-02'] }),
      pontoPeriod({ collaborator: admin, month: '2026-01', normalMinutes: 10 * 60, dates: ['2026-01-02'] })
    ]
  });

  assert.deepEqual(result.colaboradores.map(row => row.collaboratorId), ['col-1', 'col-2']);
  assert.ok(near(result.taxaGeral, 0.25));
});

test('alocação classifica dia em projeto, sede e folga; disponível segue situação atual sede', () => {
  const col = collaborator('col-1', 'Ana Técnica', 'Técnico');
  const result = buildCollaboratorProductivityReport({
    year: 2026,
    jobRoles: [{ id: 'role-1', name: 'Técnico', isOperational: true }],
    reports: [report('proj-1', '2026-01-02', col.id, { code: '5719', name: 'Ilha Solteira' })],
    pontoPeriods: [
      pontoPeriod({
        collaborator: col,
        month: '2026-01',
        normalMinutes: 16 * 60,
        dates: ['2026-01-02', '2026-01-03']
      })
    ]
  });

  const [row] = result.colaboradores;
  assert.equal(row.alocacao.situacaoAtual, 'sede');
  assert.equal(row.alocacao.disponivel, true);
  assert.equal(row.alocacao.periodos[0].situacao, 'alocado');
  assert.equal(row.alocacao.periodos[0].projeto, '5719 - Ilha Solteira');
  assert.equal(row.alocacao.periodos[1].situacao, 'sede');

  const allocation = buildCollaboratorAllocation({
    year: 2026,
    monthly: {
      '2026-01': { normalMinutes: 16 * 60, workedDates: ['2026-01-02', '2026-01-03'] }
    },
    rdoEntry: new Map(),
    projectLabels: new Map()
  });
  const workedDates = new Set(['2026-01-02']);
  assert.equal(classifyAllocationDay('2026-01-02', workedDates, new Map(), new Map()).situacao, 'sede');
  assert.equal(classifyAllocationDay('2026-01-04', workedDates, new Map(), new Map()).situacao, 'folga');
  assert.equal(allocation.situacaoAtual, 'sede');
});

test('soma do detalhe mensal bate com o total anual de HH produtivas', () => {
  const col = collaborator('col-1', 'Carlos Operador', 'Operador');
  const [row] = buildCollaboratorProductivityReport({
    year: 2026,
    jobRoles: [{ id: 'role-1', name: 'Operador', isOperational: true }],
    pontoPeriods: [
      pontoPeriod({ collaborator: col, month: '2026-01', normalMinutes: 60 * 60, dates: ['2026-01-02'] }),
      pontoPeriod({ collaborator: col, month: '2026-02', normalMinutes: 90 * 60, dates: ['2026-02-02'] })
    ]
  }).colaboradores;

  const monthlyTotal = row.porMes.reduce((sum, item) => sum + item.hhProdutivas, 0);
  assert.ok(near(monthlyTotal, row.totalHHprodutivas));
});
