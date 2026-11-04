import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AllocationReviewError,
  closeReviewWeek,
  confirmReviewRows,
  discardReviewDays,
  reopenReviewWeek,
  saveReviewDays,
  unconfirmReviewRows
} from '../src/lib/efetivo/allocation-review/service.js';

const WEEK = '2026-10-26';
const AFTER = new Date('2026-11-03T15:00:00.000Z');
const DURING = new Date('2026-10-28T15:00:00.000Z');
const ADMIN = { id: 'admin', accountType: 'ADMIN' };
const REVIEWER = { id: 'rev', accountType: 'INTERNAL', moduleRoles: ['efetivo:allocation-review'] };
const key = value => (typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10));

let seq = 0;
const nextId = prefix => `${prefix}${++seq}`;

// Banco em memória com só o que a conferência usa.
function createDb({ reports = [], absences = [], collaborators, projects } = {}) {
  const state = { weeks: [], events: [], rows: [], days: [], dayProjects: [], alerts: [], notifications: [] };
  const db = {
    state,
    report: { findMany: async () => reports },
    pontoDayProjectOverride: { findMany: async () => [] },
    collaboratorAbsence: { findMany: async () => absences },
    collaborator: {
      findMany: async ({ where }) => {
        const all = collaborators || [{ id: 'c1', name: 'Ana', isActive: true, admissionDate: null, terminationDate: null, jobRole: { name: 'Técnica' } }];
        const ids = where?.id?.in;
        return ids ? all.filter(item => ids.includes(item.id)) : all;
      }
    },
    project: {
      findMany: async ({ where }) => {
        const all = projects || [
          { id: 'pA', code: '5620', name: 'A', clientName: 'Cliente A', clientCnpj: '37981316000111', isActive: true, deletedAt: null },
          { id: 'pB', code: '5484', name: 'B', clientName: 'Cliente B', clientCnpj: '', isActive: true, deletedAt: null },
          { id: 'pOld', code: '1000', name: 'Antigo', clientName: 'X', clientCnpj: '', isActive: false, deletedAt: null }
        ];
        const ids = where?.id?.in;
        return ids ? all.filter(item => ids.includes(item.id)) : all;
      }
    },
    user: { findUnique: async () => null },
    allocationReviewWeek: {
      findUnique: async ({ where }) => {
        const week = where.id
          ? state.weeks.find(item => item.id === where.id)
          : state.weeks.find(item => key(item.weekStart) === key(where.weekStart));
        if (!week) return null;
        return {
          ...week,
          rows: state.rows.filter(row => row.weekId === week.id).map(row => ({
            ...row,
            days: state.days.filter(day => day.rowId === row.id).map(day => ({
              ...day,
              projects: state.dayProjects.filter(item => item.dayId === day.id)
            }))
          }))
        };
      },
      create: async ({ data }) => {
        if (state.weeks.some(item => key(item.weekStart) === key(data.weekStart))) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const week = { id: nextId('w'), status: 'OPEN', closedAt: null, closedByUserId: null, ...data };
        state.weeks.push(week);
        return week;
      },
      updateMany: async ({ where, data }) => {
        const week = state.weeks.find(item => item.id === where.id && item.version === where.version);
        if (!week) return { count: 0 };
        const { version, ...rest } = data;
        Object.assign(week, rest, { version: week.version + (version?.increment || 0) });
        return { count: 1 };
      }
    },
    allocationReviewWeekEvent: { create: async ({ data }) => { state.events.push(data); return data; } },
    allocationReviewRow: {
      upsert: async ({ where, create }) => {
        const { weekId, collaboratorId } = where.weekId_collaboratorId;
        let row = state.rows.find(item => item.weekId === weekId && item.collaboratorId === collaboratorId);
        if (!row) {
          row = { id: nextId('r'), confirmedAt: null, confirmedByUserId: null, ...create };
          state.rows.push(row);
        }
        return row;
      },
      update: async ({ where, data }) => Object.assign(state.rows.find(item => item.id === where.id), data),
      updateMany: async ({ where, data }) => {
        const rows = state.rows.filter(item => item.weekId === where.weekId && where.collaboratorId.in.includes(item.collaboratorId));
        rows.forEach(row => Object.assign(row, data));
        return { count: rows.length };
      }
    },
    allocationReviewDay: {
      upsert: async ({ where, create, update }) => {
        const { collaboratorId, workDate } = where.collaboratorId_workDate;
        let day = state.days.find(item => item.collaboratorId === collaboratorId && key(item.workDate) === key(workDate));
        if (day) Object.assign(day, update);
        else {
          day = { id: nextId('d'), ...create };
          state.days.push(day);
        }
        return day;
      },
      deleteMany: async ({ where }) => {
        const before = state.days.length;
        state.days = state.days.filter(day => !(day.collaboratorId === where.collaboratorId && key(day.workDate) === key(where.workDate)));
        return { count: before - state.days.length };
      }
    },
    allocationReviewDayProject: {
      deleteMany: async ({ where }) => { state.dayProjects = state.dayProjects.filter(item => item.dayId !== where.dayId); return {}; },
      createMany: async ({ data }) => { state.dayProjects.push(...data); return { count: data.length }; }
    },
    allocationReviewAbsenceAlert: {
      create: async ({ data }) => { const alert = { id: nextId('a'), status: 'OPEN', notificationEventId: null, ...data }; state.alerts.push(alert); return alert; },
      update: async ({ where, data }) => Object.assign(state.alerts.find(item => item.id === where.id), data),
      findMany: async ({ where }) => state.alerts.filter(item => item.status === where.status
        && (!where.sourceWeekId || item.sourceWeekId === where.sourceWeekId)
        && (!where.collaboratorId?.in || where.collaboratorId.in.includes(item.collaboratorId))),
      updateMany: async ({ where, data }) => {
        state.alerts.filter(item => where.id.in.includes(item.id)).forEach(item => Object.assign(item, data));
        return {};
      }
    },
    notificationEvent: {
      upsert: async ({ where, create }) => {
        let event = state.notifications.find(item => item.dedupeKey === where.dedupeKey);
        if (!event) { event = { id: nextId('n'), ...create }; state.notifications.push(event); }
        return event;
      },
      deleteMany: async ({ where }) => { state.notifications = state.notifications.filter(item => !where.id.in.includes(item.id)); return {}; }
    },
    $transaction: async fn => fn(db)
  };
  return db;
}

function rdoWeek(collaboratorId = 'c1', projectId = 'pA', dates = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']) {
  return dates.map((date, index) => ({
    id: `rdo-${collaboratorId}-${index}`, sequenceNumber: index + 1, status: 'APPROVED', projectId,
    reportDate: new Date(`${date}T00:00:00.000Z`), collaborators: [{ collaboratorId }]
  }));
}

function deps(db) {
  return {
    database: db,
    getTrails: async () => new Map(),
    loadEffectiveIndex: async () => new Map(),
    loadCalendar: async () => ({ holidays: [], holidayDates: new Set() })
  };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error instanceof AllocationReviewError && error.code === code);
}

test('gravar rascunho cria semana e linha, marca ajuste e incrementa versão', async () => {
  const db = createDb({ reports: rdoWeek() });
  const result = await saveReviewDays({
    weekStart: WEEK, expectedVersion: 0, user: REVIEWER, now: AFTER,
    items: [{ collaboratorId: 'c1', date: '2026-10-27', kind: 'PROJECT', projectIds: ['pB'], note: 'ponto errado' }]
  }, deps(db));
  assert.equal(result.version, 1);
  const day = result.rows[0].days[1];
  assert.equal(day.value.projectIds[0], 'pB');
  assert.equal(day.edited, true);
  assert.equal(db.state.days[0].differsFromSuggestion, true);
  assert.deepEqual(db.state.days[0].suggestionSnapshot, { kind: 'PROJECT', projectIds: ['pA'] });
  await rejectsCode(saveReviewDays({
    weekStart: WEEK, expectedVersion: 0, user: REVIEWER, now: AFTER,
    items: [{ collaboratorId: 'c1', date: '2026-10-28', kind: 'SEDE', projectIds: [] }]
  }, deps(db)), 'WEEK_VERSION_CONFLICT');
});

test('recusa dia futuro, dia fora da semana, projeto inativo e colaborador fora do vínculo', async () => {
  const db = createDb({
    collaborators: [{ id: 'c1', name: 'Ana', isActive: true, admissionDate: new Date('2026-10-28T00:00:00.000Z'), terminationDate: null, jobRole: null }]
  });
  const base = { weekStart: WEEK, expectedVersion: 0, user: REVIEWER };
  await rejectsCode(saveReviewDays({ ...base, now: DURING, items: [{ collaboratorId: 'c1', date: '2026-10-30', kind: 'SEDE', projectIds: [] }] }, deps(db)), 'INVALID_DAY');
  await rejectsCode(saveReviewDays({ ...base, now: AFTER, items: [{ collaboratorId: 'c1', date: '2026-11-02', kind: 'SEDE', projectIds: [] }] }, deps(db)), 'INVALID_DAY');
  await rejectsCode(saveReviewDays({ ...base, now: AFTER, items: [{ collaboratorId: 'c1', date: '2026-10-26', kind: 'SEDE', projectIds: [] }] }, deps(db)), 'COLLABORATOR_NOT_ACTIVE');
  await rejectsCode(saveReviewDays({ ...base, now: AFTER, items: [{ collaboratorId: 'c1', date: '2026-10-29', kind: 'PROJECT', projectIds: ['pOld'] }] }, deps(db)), 'PROJECT_INACTIVE');
  await rejectsCode(saveReviewDays({ ...base, now: AFTER, items: [{ collaboratorId: 'c1', date: '2026-10-29', kind: 'PROJECT', projectIds: ['nope'] }] }, deps(db)), 'PROJECT_NOT_FOUND');
});

test('conferir: pendência bloqueia; sem pendência grava os 7 dias com fingerprint; linha conferida trava edição', async () => {
  const db = createDb({ reports: rdoWeek('c1', 'pA', ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']) });
  await rejectsCode(confirmReviewRows({ weekStart: WEEK, collaboratorIds: ['c1'], expectedVersion: 0, user: REVIEWER, now: AFTER }, deps(db)), 'ROW_HAS_PENDING');
  const draft = await saveReviewDays({
    weekStart: WEEK, expectedVersion: 0, user: REVIEWER, now: AFTER,
    items: [{ collaboratorId: 'c1', date: '2026-10-30', kind: 'FERIAS', projectIds: [] }]
  }, deps(db));
  const confirmed = await confirmReviewRows({ weekStart: WEEK, collaboratorIds: ['c1'], expectedVersion: draft.version, user: REVIEWER, now: AFTER }, deps(db));
  assert.equal(confirmed.confirmed, 1);
  assert.equal(confirmed.rows[0].confirmed, true);
  assert.equal(db.state.days.length, 7);
  assert.ok(db.state.days.every(day => day.sourceFingerprint));
  assert.equal(confirmed.alertsCreated, 1);
  assert.equal(db.state.alerts[0].absenceType, 'FERIAS');
  assert.equal(db.state.notifications.length, 1);
  await rejectsCode(saveReviewDays({
    weekStart: WEEK, expectedVersion: confirmed.version, user: REVIEWER, now: AFTER,
    items: [{ collaboratorId: 'c1', date: '2026-10-30', kind: 'SEDE', projectIds: [] }]
  }, deps(db)), 'ROW_CONFIRMED');

  const undone = await unconfirmReviewRows({ weekStart: WEEK, collaboratorIds: ['c1'], expectedVersion: confirmed.version, user: REVIEWER, now: AFTER }, deps(db));
  assert.equal(undone.alertsCancelled, 1);
  assert.equal(db.state.alerts[0].status, 'CANCELLED');
  assert.equal(db.state.notifications.length, 0);
  assert.equal(undone.rows[0].confirmed, false);
});

test('conferir todas as linhas prontas ignora as que têm pendência', async () => {
  const collaborators = [
    { id: 'c1', name: 'Ana', isActive: true, admissionDate: null, terminationDate: null, jobRole: null },
    { id: 'c2', name: 'Bia', isActive: true, admissionDate: null, terminationDate: null, jobRole: null }
  ];
  const db = createDb({ collaborators, reports: rdoWeek('c1') });
  const result = await confirmReviewRows({ weekStart: WEEK, allReady: true, expectedVersion: 0, user: REVIEWER, now: AFTER }, deps(db));
  assert.equal(result.confirmed, 1);
  assert.equal(db.state.rows.length, 1);
  assert.equal(db.state.rows[0].collaboratorId, 'c1');
});

test('dias futuros impedem conferir a linha durante a semana', async () => {
  const db = createDb({ reports: rdoWeek() });
  await rejectsCode(confirmReviewRows({ weekStart: WEEK, collaboratorIds: ['c1'], expectedVersion: 0, user: REVIEWER, now: DURING }, deps(db)), 'ROW_HAS_PENDING');
});

test('fechar exige domingo encerrado e todos conferidos; reabrir só com admin', async () => {
  const db = createDb({ reports: rdoWeek() });
  const confirmedDuring = await saveReviewDays({
    weekStart: WEEK, expectedVersion: 0, user: REVIEWER, now: DURING,
    items: [{ collaboratorId: 'c1', date: '2026-10-26', kind: 'PROJECT', projectIds: ['pA'] }]
  }, deps(db));
  await rejectsCode(closeReviewWeek({ weekStart: WEEK, expectedVersion: confirmedDuring.version, user: REVIEWER, now: DURING }, deps(db)), 'WEEK_NOT_ENDED');
  await rejectsCode(closeReviewWeek({ weekStart: WEEK, expectedVersion: confirmedDuring.version, user: REVIEWER, now: AFTER }, deps(db)), 'ROWS_NOT_CONFIRMED');
  const confirmed = await confirmReviewRows({ weekStart: WEEK, allReady: true, expectedVersion: confirmedDuring.version, user: REVIEWER, now: AFTER }, deps(db));
  const closed = await closeReviewWeek({ weekStart: WEEK, expectedVersion: confirmed.version, user: REVIEWER, now: AFTER }, deps(db));
  assert.equal(closed.week.status, 'CLOSED');
  assert.equal(db.state.events.at(-1).type, 'CLOSED');
  await rejectsCode(saveReviewDays({
    weekStart: WEEK, expectedVersion: closed.version, user: REVIEWER, now: AFTER,
    items: [{ collaboratorId: 'c1', date: '2026-10-27', kind: 'SEDE', projectIds: [] }]
  }, deps(db)), 'WEEK_CLOSED');
  await rejectsCode(unconfirmReviewRows({ weekStart: WEEK, collaboratorIds: ['c1'], expectedVersion: closed.version, user: REVIEWER, now: AFTER }, deps(db)), 'WEEK_CLOSED');
  await rejectsCode(reopenReviewWeek({ weekStart: WEEK, expectedVersion: closed.version, user: REVIEWER, now: AFTER }, deps(db)), 'ADMIN_REQUIRED');
  const reopened = await reopenReviewWeek({ weekStart: WEEK, expectedVersion: closed.version, note: 'RDO atrasado', user: ADMIN, now: AFTER }, deps(db));
  assert.equal(reopened.week.status, 'OPEN');
  assert.equal(db.state.events.at(-1).type, 'REOPENED');
  assert.equal(db.state.events.at(-1).note, 'RDO atrasado');
  assert.equal(db.state.rows[0].confirmedAt instanceof Date, true, 'reabrir mantém as conferências');
});

test('descartar rascunho volta o dia para a sugestão', async () => {
  const db = createDb({ reports: rdoWeek() });
  const saved = await saveReviewDays({
    weekStart: WEEK, expectedVersion: 0, user: REVIEWER, now: AFTER,
    items: [{ collaboratorId: 'c1', date: '2026-10-27', kind: 'SEDE', projectIds: [] }]
  }, deps(db));
  const discarded = await discardReviewDays({
    weekStart: WEEK, expectedVersion: saved.version, user: REVIEWER, now: AFTER,
    items: [{ collaboratorId: 'c1', date: '2026-10-27' }]
  }, deps(db));
  assert.equal(db.state.days.length, 0);
  assert.equal(discarded.rows[0].days[1].value.kind, 'PROJECT');
  assert.equal(discarded.version, saved.version + 1);
});
