import prisma from '../../prisma.js';

/*
 * Dias de linhas CONFERIDAS da conferência semanal (feature 037). É a única leitura usada pelo
 * custo HH e pelo relatório mensal: rascunhos (linha ainda não conferida) não têm efeito.
 * `to` é exclusivo.
 */
function asDate(value) {
  if (value instanceof Date) return value;
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

export async function loadConfirmedReviewDays({ from, to }, client = prisma) {
  if (!client?.allocationReviewDay?.findMany || !from || !to) return [];
  const rows = await client.allocationReviewDay.findMany({
    where: {
      workDate: { gte: asDate(from), lt: asDate(to) },
      row: { confirmedAt: { not: null } }
    },
    select: {
      id: true,
      collaboratorId: true,
      workDate: true,
      kind: true
    }
  });
  if (!rows.length) return [];
  const links = await client.allocationReviewDayProject.findMany({
    where: { dayId: { in: rows.map(row => row.id) } },
    select: { dayId: true, projectId: true }
  });
  const byDay = new Map();
  for (const { dayId, projectId } of links) {
    if (!byDay.has(dayId)) byDay.set(dayId, []);
    byDay.get(dayId).push(projectId);
  }
  return rows.map(row => ({
    collaboratorId: row.collaboratorId,
    date: new Date(row.workDate).toISOString().slice(0, 10),
    kind: row.kind,
    projectIds: (byDay.get(row.id) || []).sort()
  }));
}

export function reviewDaysByCollaborator(days = []) {
  const result = new Map();
  for (const day of days) {
    if (!result.has(day.collaboratorId)) result.set(day.collaboratorId, new Map());
    result.get(day.collaboratorId).set(day.date, day);
  }
  return result;
}
