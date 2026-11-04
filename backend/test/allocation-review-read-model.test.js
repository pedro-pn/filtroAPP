import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assembleReviewWeek,
  getReviewMonth,
  loadReviewWeekContext,
  mondayOf,
  weekDateKeys
} from '../src/lib/efetivo/allocation-review/read-model.js';

const WEEK = '2026-10-26';
const NOW_AFTER = new Date('2026-11-03T15:00:00.000Z');   // terça seguinte
const NOW_DURING = new Date('2026-10-28T15:00:00.000Z');  // quarta da própria semana

function trail(date, extra = {}) {
  return { date, normalHours: 8.8, he70Hours: 0, he100Hours: 0, tags: [], tagProjectIds: [], ...extra };
}

function context(overrides = {}) {
  const dates = weekDateKeys(WEEK);
  return {
    weekStart: WEEK,
    dates,
    trails: new Map(),
    reports: [],
    effectiveIndex: new Map(),
    overrides: [],
    absences: [],
    holidays: [],
    holidayDates: new Set(),
    savedWeek: null,
    collaborators: [
      { id: 'c1', name: 'Ana', isActive: true, admissionDate: null, terminationDate: null, jobRole: { name: 'Técnica' } }
    ],
    projects: [
      { id: 'pA', code: '5620', name: 'Thyssenkrupp', clientName: 'TK', clientCnpj: '37981316000111', isActive: true, deletedAt: null }
    ],
    closedBy: null,
    ...overrides
  };
}

test('mondayOf e weekDateKeys', () => {
  assert.equal(mondayOf('2026-11-01'), '2026-10-26');
  assert.equal(mondayOf('2026-10-26'), '2026-10-26');
  assert.deepEqual(weekDateKeys(WEEK).slice(-1), ['2026-11-01']);
});

test('semana sem dados: dias úteis sem informação, fim de semana em folga, CNPJ formatado', () => {
  const result = assembleReviewWeek(context(), { now: NOW_AFTER });
  const [row] = result.rows;
  assert.equal(row.days.length, 7);
  assert.deepEqual(row.days.slice(0, 5).map(day => day.value.kind), ['NONE', 'NONE', 'NONE', 'NONE', 'NONE']);
  assert.deepEqual(row.days.slice(5).map(day => day.value.kind), ['FOLGA', 'FOLGA']);
  assert.equal(row.pendingCount, 5);
  assert.equal(row.canConfirm, false);
  assert.equal(result.summary.noInformationDays, 5);
  assert.equal(result.projects[0].clientCnpj, '37.981.316/0001-11');
  assert.equal(result.week.version, 0);
  assert.equal(result.week.canClose, false);
});

test('RDO na semana inteira deixa a linha pronta para conferir e define o projeto principal', () => {
  const dates = weekDateKeys(WEEK).slice(0, 5);
  const reports = dates.map((date, index) => ({
    id: `r${index}`, sequenceNumber: 100 + index, status: 'APPROVED', projectId: 'pA',
    reportDate: new Date(`${date}T00:00:00.000Z`), collaborators: [{ collaboratorId: 'c1' }]
  }));
  const trails = new Map([['c1', new Map(dates.map(date => [date, trail(date)]))]]);
  const result = assembleReviewWeek(context({ reports, trails }), { now: NOW_AFTER });
  const [row] = result.rows;
  assert.equal(row.pendingCount, 0);
  assert.equal(row.canConfirm, true);
  assert.equal(row.mainProjectId, 'pA');
  assert.equal(row.days[0].sources.rdo.reports[0].number, 100);
  assert.equal(row.days[0].sources.ponto.normalHours, 8.8);
  assert.equal(result.summary.readyRows, 1);
});

test('dias futuros não contam como pendência e impedem conferir a linha', () => {
  const result = assembleReviewWeek(context(), { now: NOW_DURING });
  const [row] = result.rows;
  assert.equal(row.days[3].isFuture, true);
  assert.equal(row.pendingCount, 3);
  assert.equal(row.canConfirm, false);
  assert.ok(result.week.closeBlockers.some(item => item.includes('domingo')));
});

test('dias fora do vínculo ficam inelegíveis; colaborador sem dia elegível sai da grade', () => {
  const collaborators = [
    { id: 'c1', name: 'Ana', isActive: true, admissionDate: new Date('2026-10-29T00:00:00.000Z'), terminationDate: null, jobRole: null },
    { id: 'c2', name: 'Bia', isActive: false, admissionDate: null, terminationDate: new Date('2026-10-01T00:00:00.000Z'), jobRole: null }
  ];
  const result = assembleReviewWeek(context({ collaborators }), { now: NOW_AFTER });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].days.map(day => day.eligible), [false, false, false, true, true, true, true]);
  assert.equal(result.rows[0].pendingCount, 2);
});

test('rascunho resolve pendência, marca ajuste e aviso de ausência; linha conferida compara fingerprint', () => {
  const savedWeek = {
    status: 'OPEN', version: 3, closedAt: null,
    rows: [{
      collaboratorId: 'c1', confirmedAt: null,
      days: [
        { workDate: new Date('2026-10-26T00:00:00.000Z'), kind: 'FERIAS', note: 'férias não lançadas', projects: [], sourceFingerprint: null },
        { workDate: new Date('2026-10-27T00:00:00.000Z'), kind: 'PROJECT', note: null, projects: [{ projectId: 'pA' }], sourceFingerprint: null }
      ]
    }]
  };
  const result = assembleReviewWeek(context({ savedWeek }), { now: NOW_AFTER });
  const [row] = result.rows;
  assert.equal(row.days[0].value.kind, 'FERIAS');
  assert.equal(row.days[0].edited, true);
  assert.equal(row.days[0].absenceAlert, true);
  assert.equal(row.days[0].pending, false);
  assert.equal(row.days[1].absenceAlert, false);
  assert.equal(row.pendingCount, 3);
  assert.equal(result.week.version, 3);
  assert.equal(result.summary.editedDays, 2);

  savedWeek.rows[0].confirmedAt = new Date();
  savedWeek.rows[0].days[1].sourceFingerprint = 'fingerprint-antigo';
  const confirmed = assembleReviewWeek(context({ savedWeek }), { now: NOW_AFTER });
  assert.equal(confirmed.rows[0].confirmed, true);
  assert.equal(confirmed.rows[0].pendingCount, 0);
  assert.equal(confirmed.rows[0].days[1].sourceChangedAfterReview, true);
});

test('semana fechada: só admin pode reabrir', () => {
  const savedWeek = { status: 'CLOSED', version: 5, closedAt: new Date(), closedByUserId: 'u1', rows: [] };
  assert.equal(assembleReviewWeek(context({ savedWeek }), { now: NOW_AFTER, user: { accountType: 'INTERNAL' } }).week.canReopen, false);
  assert.equal(assembleReviewWeek(context({ savedWeek }), { now: NOW_AFTER, user: { accountType: 'ADMIN' } }).week.canReopen, true);
});

test('loadReviewWeekContext inclui operacionais e quem tem ponto ou RDO na semana, e lê 7 dias de folga para os vizinhos', async () => {
  const calls = {};
  const database = {
    report: { findMany: async args => { calls.report = args; return [{ id: 'r1', sequenceNumber: 1, status: 'PENDING', projectId: 'pA', reportDate: new Date('2026-10-27T00:00:00.000Z'), collaborators: [{ collaboratorId: 'cR' }] }]; } },
    pontoDayProjectOverride: { findMany: async () => [] },
    collaboratorAbsence: { findMany: async () => [] },
    allocationReviewWeek: { findUnique: async () => null },
    collaborator: { findMany: async args => { calls.collaborator = args; return []; } },
    project: { findMany: async args => { calls.project = args; return []; } },
    user: { findUnique: async () => null }
  };
  const trails = new Map([['cP', new Map([['2026-10-26', trail('2026-10-26')]])]]);
  await loadReviewWeekContext({ weekStart: WEEK }, {
    database,
    getTrails: async ({ from, to }) => { calls.trails = { from, to }; return trails; },
    loadEffectiveIndex: async () => new Map(),
    loadCalendar: async () => ({ holidays: [], holidayDates: new Set() })
  });
  assert.deepEqual(calls.trails, { from: '2026-10-19', to: '2026-11-08' });
  assert.equal(calls.report.where.reportType, 'RDO');
  assert.equal(calls.report.where.reportDate.gte.toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(calls.report.where.reportDate.lt.toISOString(), '2026-11-09T00:00:00.000Z');
  const extra = calls.collaborator.where.OR[1].id.in.sort();
  assert.deepEqual(extra, ['cP', 'cR']);
  assert.deepEqual(calls.collaborator.where.OR[0].AND[0], { jobRole: { isActive: true, isOperational: true } });
  assert.deepEqual(calls.project.where.OR[0].id.in, ['pA']);
});

test('"sede/em viagem" vira viagem para o projeto vizinho, nunca para o centro de custo da Sede', () => {
  // Caso real: ponto com etiqueta "Sede/Em viagem" resolvida para o projeto 5000 (Sede).
  const dates = weekDateKeys(WEEK);
  const reports = dates.slice(0, 5).map((date, index) => ({
    id: `r${index}`, sequenceNumber: index + 1, status: 'APPROVED', projectId: 'pA',
    reportDate: new Date(`${date}T00:00:00.000Z`), collaborators: [{ collaboratorId: 'c1' }]
  }));
  const trails = new Map([['c1', new Map([
    ...dates.slice(0, 5).map(date => [date, trail(date)]),
    ['2026-10-31', trail('2026-10-31', { normalHours: 6, tags: ['Sede/Em viagem'], tagProjectIds: ['p5000'] })]
  ])]]);
  const projects = [
    { id: 'pA', code: '5620', name: 'Thyssenkrupp', clientName: 'TK', clientCnpj: '37981316000111', isActive: true, deletedAt: null },
    { id: 'p5000', code: '5000', name: 'Sede', clientName: 'Filtrovali', clientCnpj: '', isActive: true, deletedAt: null }
  ];
  const result = assembleReviewWeek(context({ reports, trails, projects, sedeProjectIds: new Set(['p5000']) }), { now: NOW_AFTER });
  const saturday = result.rows[0].days[5];
  assert.deepEqual(saturday.suggestion, { kind: 'TRAVEL', projectIds: ['pA'] });
  assert.equal(saturday.pending, false);
  assert.ok(!saturday.candidateProjectIds.includes('p5000'));
});

test('etiqueta só de Sede (centro de custo 5000) sugere Sede, não projeto', () => {
  const trails = new Map([['c1', new Map([['2026-10-26', trail('2026-10-26', { tags: ['Sede'], tagProjectIds: ['p5000'] })]])]]);
  const projects = [{ id: 'p5000', code: '5000', name: 'Sede', clientName: null, clientCnpj: '', isActive: true, deletedAt: null }];
  const result = assembleReviewWeek(context({ trails, projects, sedeProjectIds: new Set(['p5000']) }), { now: NOW_AFTER });
  assert.deepEqual(result.rows[0].days[0].suggestion, { kind: 'SEDE', projectIds: [] });
});

test('visão do mês junta as semanas, recorta os dias do mês e soma dias por projeto', async () => {
  const database = {
    report: { findMany: async () => [] },
    pontoDayProjectOverride: { findMany: async () => [] },
    collaboratorAbsence: { findMany: async () => [] },
    allocationReviewWeek: { findUnique: async () => null },
    collaborator: { findMany: async () => [{ id: 'c1', name: 'Ana', isActive: true, admissionDate: null, terminationDate: null, jobRole: null }] },
    project: { findMany: async () => [] },
    user: { findUnique: async () => null }
  };
  const weeksLoaded = [];
  const month = await getReviewMonth({ yearMonth: '2026-10', now: NOW_AFTER }, {
    database,
    getTrails: async ({ from }) => { weeksLoaded.push(from); return new Map(); },
    loadEffectiveIndex: async () => new Map(),
    loadCalendar: async () => ({ holidays: [], holidayDates: new Set() })
  });
  assert.equal(month.weeks.length, 5);
  assert.equal(month.weeks[0].weekStart, '2026-09-28');
  assert.equal(month.days.length, 31);
  assert.equal(month.days[0].date, '2026-10-01');
  assert.equal(month.rows[0].days.length, 31);
  const folga = month.rows[0].totals.find(item => item.kind === 'FOLGA');
  assert.equal(folga.days, 9);
  assert.equal(weeksLoaded.length, 5);
});
