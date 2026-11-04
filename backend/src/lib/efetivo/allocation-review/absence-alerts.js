import prisma from '../../prisma.js';

/*
 * Avisos aos gestores do Efetivo para cadastrar ausência (feature 037, FR-021/FR-022).
 * Criados quando uma linha é conferida com Folga/Férias/Afastamento sem ausência cadastrada.
 * O evento na central de notificações é apagado quando o aviso é resolvido ou cancelado.
 */

export const ABSENCE_ALERT_NOTIFICATION_KIND = 'ALLOCATION_REVIEW_ABSENCE_MISSING';

// Tipos de ausência cadastrada que encerram um aviso de cada tipo.
const RESOLVING_TYPES = {
  FOLGA: ['FOLGA'],
  FERIAS: ['FERIAS'],
  AFASTAMENTO: ['AFASTAMENTO', 'FADIGA_OFFSHORE']
};

function dateKeyOf(value) {
  return typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
}

function nextDay(dateKey) {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
}

export function notificationDedupeKey(alertId) {
  return `allocation-review-absence:${alertId}`;
}

// Dias consecutivos (no calendário) com aviso e mesmo tipo viram um único período.
export function groupAlertPeriods(days = []) {
  const flagged = days
    .filter(day => day.eligible && day.absenceAlert && day.value)
    .map(day => ({ date: day.date, type: day.value.kind }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const periods = [];
  for (const day of flagged) {
    const last = periods.at(-1);
    if (last && last.type === day.type && nextDay(last.endDate) === day.date) {
      last.endDate = day.date;
    } else {
      periods.push({ type: day.type, startDate: day.date, endDate: day.date });
    }
  }
  return periods;
}

export async function createAlertsForConfirmedRows(tx, { weekId, rows = [] }) {
  let created = 0;
  for (const row of rows) {
    for (const period of groupAlertPeriods(row.days)) {
      const alert = await tx.allocationReviewAbsenceAlert.create({
        data: {
          collaboratorId: row.collaborator.id,
          absenceType: period.type,
          startDate: new Date(`${period.startDate}T00:00:00.000Z`),
          endDate: new Date(`${period.endDate}T00:00:00.000Z`),
          sourceWeekId: weekId
        }
      });
      const dedupeKey = notificationDedupeKey(alert.id);
      const event = await tx.notificationEvent.upsert({
        where: { dedupeKey },
        create: {
          kind: ABSENCE_ALERT_NOTIFICATION_KIND,
          dedupeKey,
          data: {
            alertId: alert.id,
            collaboratorId: row.collaborator.id,
            collaboratorName: row.collaborator.name,
            absenceType: period.type,
            startDate: period.startDate,
            endDate: period.endDate
          }
        },
        update: {}
      });
      await tx.allocationReviewAbsenceAlert.update({ where: { id: alert.id }, data: { notificationEventId: event.id } });
      created += 1;
    }
  }
  return created;
}

async function closeAlerts(tx, alerts, data) {
  if (!alerts.length) return 0;
  await tx.allocationReviewAbsenceAlert.updateMany({ where: { id: { in: alerts.map(item => item.id) } }, data });
  const eventIds = alerts.map(item => item.notificationEventId).filter(Boolean);
  if (eventIds.length) await tx.notificationEvent.deleteMany({ where: { id: { in: eventIds } } });
  return alerts.length;
}

export async function cancelAlertsForRows(tx, { weekId, collaboratorIds = [] }) {
  if (!collaboratorIds.length) return 0;
  const alerts = await tx.allocationReviewAbsenceAlert.findMany({
    where: { sourceWeekId: weekId, status: 'OPEN', collaboratorId: { in: collaboratorIds } },
    select: { id: true, notificationEventId: true }
  });
  return closeAlerts(tx, alerts, { status: 'CANCELLED' });
}

/*
 * Chamado depois de criar/editar uma ausência. Encerra os avisos abertos do colaborador cujo
 * período inteiro ficou coberto por uma ausência de tipo compatível. Falha aqui nunca derruba a
 * gravação da ausência: o aviso continua aberto e pode ser resolvido na próxima gravação.
 */
export async function resolveAllocationReviewAbsenceAlerts({ collaboratorId, type, startDate, endDate, absenceId = null }, client = prisma) {
  if (!collaboratorId || !type || !startDate || !endDate) return 0;
  if (!client?.allocationReviewAbsenceAlert?.findMany) return 0;
  const alertTypes = Object.entries(RESOLVING_TYPES).filter(([, types]) => types.includes(type)).map(([alertType]) => alertType);
  if (!alertTypes.length) return 0;
  try {
    const alerts = await client.allocationReviewAbsenceAlert.findMany({
      where: {
        collaboratorId,
        status: 'OPEN',
        absenceType: { in: alertTypes },
        startDate: { gte: new Date(`${dateKeyOf(startDate)}T00:00:00.000Z`) },
        endDate: { lte: new Date(`${dateKeyOf(endDate)}T00:00:00.000Z`) }
      },
      select: { id: true, notificationEventId: true }
    });
    return await closeAlerts(client, alerts, { status: 'RESOLVED', resolvedAt: new Date(), resolvedByAbsenceId: absenceId });
  } catch (error) {
    console.error('Falha ao encerrar avisos de ausência da conferência de alocação.', error);
    return 0;
  }
}
