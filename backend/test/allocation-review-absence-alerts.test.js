import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ABSENCE_ALERT_NOTIFICATION_KIND,
  cancelAlertsForRows,
  createAlertsForConfirmedRows,
  groupAlertPeriods,
  resolveAllocationReviewAbsenceAlerts
} from '../src/lib/efetivo/allocation-review/absence-alerts.js';
import { absenceAlertDestination, publicNotification } from '../src/lib/notifications/center.js';

const day = (date, kind, absenceAlert = true) => ({ date, eligible: true, absenceAlert, value: { kind, projectIds: [] } });

function memory() {
  const state = { alerts: [], events: [] };
  let seq = 0;
  const client = {
    state,
    allocationReviewAbsenceAlert: {
      create: async ({ data }) => { const row = { id: `a${++seq}`, status: 'OPEN', notificationEventId: null, ...data }; state.alerts.push(row); return row; },
      update: async ({ where, data }) => Object.assign(state.alerts.find(item => item.id === where.id), data),
      findMany: async ({ where }) => state.alerts.filter(item => item.status === where.status
        && (!where.sourceWeekId || item.sourceWeekId === where.sourceWeekId)
        && (!where.collaboratorId?.in || where.collaboratorId.in.includes(item.collaboratorId))
        && (typeof where.collaboratorId !== 'string' || item.collaboratorId === where.collaboratorId)
        && (!where.absenceType?.in || where.absenceType.in.includes(item.absenceType))
        && (!where.startDate?.gte || item.startDate >= where.startDate.gte)
        && (!where.endDate?.lte || item.endDate <= where.endDate.lte)),
      updateMany: async ({ where, data }) => { state.alerts.filter(item => where.id.in.includes(item.id)).forEach(item => Object.assign(item, data)); return {}; }
    },
    notificationEvent: {
      upsert: async ({ where, create }) => { const event = { id: `n${++seq}`, ...create }; state.events.push(event); assert.equal(event.dedupeKey, where.dedupeKey); return event; },
      deleteMany: async ({ where }) => { state.events = state.events.filter(item => !where.id.in.includes(item.id)); return {}; }
    }
  };
  return client;
}

test('dias consecutivos do mesmo tipo viram um período; tipos ou buracos separam', () => {
  const periods = groupAlertPeriods([
    day('2026-10-26', 'FERIAS'), day('2026-10-27', 'FERIAS'), day('2026-10-28', 'FERIAS'),
    day('2026-10-29', 'FOLGA'),
    day('2026-10-31', 'FOLGA'),
    day('2026-11-01', 'TREINAMENTO', false),
    { ...day('2026-10-30', 'FOLGA'), absenceAlert: false }
  ]);
  assert.deepEqual(periods, [
    { type: 'FERIAS', startDate: '2026-10-26', endDate: '2026-10-28' },
    { type: 'FOLGA', startDate: '2026-10-29', endDate: '2026-10-29' },
    { type: 'FOLGA', startDate: '2026-10-31', endDate: '2026-10-31' }
  ]);
});

test('conferir cria aviso + notificação; desconferir cancela e apaga a notificação', async () => {
  const client = memory();
  const created = await createAlertsForConfirmedRows(client, {
    weekId: 'w1',
    rows: [{ collaborator: { id: 'c1', name: 'Ana Lima' }, days: [day('2026-10-26', 'FERIAS'), day('2026-10-27', 'FERIAS')] }]
  });
  assert.equal(created, 1);
  const [alert] = client.state.alerts;
  assert.equal(alert.absenceType, 'FERIAS');
  assert.equal(alert.notificationEventId, client.state.events[0].id);
  assert.equal(client.state.events[0].kind, ABSENCE_ALERT_NOTIFICATION_KIND);
  assert.equal(client.state.events[0].dedupeKey, `allocation-review-absence:${alert.id}`);
  assert.deepEqual(client.state.events[0].data, {
    alertId: alert.id, collaboratorId: 'c1', collaboratorName: 'Ana Lima', absenceType: 'FERIAS', startDate: '2026-10-26', endDate: '2026-10-27'
  });

  assert.equal(await cancelAlertsForRows(client, { weekId: 'w1', collaboratorIds: ['c1'] }), 1);
  assert.equal(alert.status, 'CANCELLED');
  assert.equal(client.state.events.length, 0);
});

test('ausência que cobre o período inteiro resolve; parcial ou de outro tipo não', async () => {
  const client = memory();
  await createAlertsForConfirmedRows(client, {
    weekId: 'w1',
    rows: [{ collaborator: { id: 'c1', name: 'Ana' }, days: [day('2026-10-26', 'AFASTAMENTO'), day('2026-10-27', 'AFASTAMENTO')] }]
  });
  const [alert] = client.state.alerts;
  assert.equal(await resolveAllocationReviewAbsenceAlerts({ collaboratorId: 'c1', type: 'AFASTAMENTO', startDate: '2026-10-27', endDate: '2026-10-30' }, client), 0);
  assert.equal(await resolveAllocationReviewAbsenceAlerts({ collaboratorId: 'c1', type: 'FERIAS', startDate: '2026-10-20', endDate: '2026-10-30' }, client), 0);
  assert.equal(alert.status, 'OPEN');
  const resolved = await resolveAllocationReviewAbsenceAlerts({
    collaboratorId: 'c1', type: 'FADIGA_OFFSHORE', startDate: new Date('2026-10-26T00:00:00.000Z'), endDate: new Date('2026-10-27T00:00:00.000Z'), absenceId: 'abs-1'
  }, client);
  assert.equal(resolved, 1);
  assert.equal(alert.status, 'RESOLVED');
  assert.equal(alert.resolvedByAbsenceId, 'abs-1');
  assert.equal(client.state.events.length, 0);
});

test('falha ao resolver avisos nunca derruba o cadastro da ausência', async () => {
  const broken = { allocationReviewAbsenceAlert: { findMany: async () => { throw new Error('db down'); } } };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await resolveAllocationReviewAbsenceAlerts({ collaboratorId: 'c1', type: 'FERIAS', startDate: '2026-10-01', endDate: '2026-10-02' }, broken), 0);
  } finally {
    console.error = originalError;
  }
  assert.equal(await resolveAllocationReviewAbsenceAlerts({ collaboratorId: 'c1', type: 'FERIAS', startDate: '2026-10-01', endDate: '2026-10-02' }, {}), 0);
});

test('notificação pública leva ao cadastro de ausência já preenchido', () => {
  const event = {
    id: 'n1', kind: ABSENCE_ALERT_NOTIFICATION_KIND, createdAt: new Date('2026-11-03T12:00:00Z'), reads: [],
    data: { collaboratorId: 'c1', collaboratorName: 'Ana Lima', absenceType: 'FERIAS', startDate: '2026-10-26', endDate: '2026-10-28' }
  };
  const item = publicNotification(event, { id: 'u1', accountType: 'ADMIN' });
  assert.equal(item.title, 'Cadastrar férias de Ana Lima');
  assert.match(item.description, /de 26\/10 a 28\/10/);
  assert.equal(item.href, '/efetivo?section=colaboradores&colaborador=c1&cadastrarAusencia=1&tipo=FERIAS&de=2026-10-26&ate=2026-10-28');
  assert.equal(absenceAlertDestination({ collaboratorId: 'c 1' }).includes('colaborador=c+1'), true);
});
