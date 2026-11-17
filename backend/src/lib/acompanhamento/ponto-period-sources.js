import { Prisma } from '@prisma/client';

// The import scope already read the creation dates used by mergePontoPeriods.
// Attach them without repeating an Import relation query for every period.
export function withPontoImportDates(periodRows, imports) {
  const byId = new Map(imports.map(item => [item.id, item.createdAt]));
  return periodRows.map(row => ({
    ...row, import: { createdAt: byId.get(row.importId) ?? row.import?.createdAt }
  }));
}

// Keep parent order stable across updates/query plans, including bulk-created
// rows with equal timestamps. Only the selected collaborator
// identity/history and, when requested, overlapping absence IDs/dates are joined
// into one read. Financial-only readers never query the absence table.
// Project-owned data, CPF, email, signatures, absence types and notes are omitted.
export async function loadMonthlyPontoSources(database, importIds, { startDate, endDate, includeWorkforceDetails = true }) {
  const periods = await database.pontoPeriodSummary.findMany({
    where: { importId: { in: importIds }, collaboratorId: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  });
  const ids = [...new Set(periods.map(row => row.collaboratorId))];
  const first = new Date(startDate).toISOString().slice(0, 10), last = new Date(endDate).toISOString().slice(0, 10);
  const absenceRows = includeWorkforceDetails ? Prisma.sql`
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'collaboratorId', a."collaboratorId",
      'startDate', a."startDate", 'endDate', a."endDate")), '[]'::jsonb)
      FROM "public"."CollaboratorAbsence" a WHERE a."collaboratorId" IN (SELECT id FROM selected)
        AND a."deletedAt" IS NULL AND a."startDate" <= ${last}::date AND a."endDate" >= ${first}::date)
  ` : Prisma.sql`'[]'::jsonb`;
  const [sources] = ids.length ? await database.$queryRaw`
    /* labor.period-collaborators */
    WITH selected AS (SELECT unnest(${ids}::text[]) AS id)
    SELECT
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'jobRoleId', c."jobRoleId",
        'jobRoleHistory', (SELECT COALESCE(jsonb_agg(jsonb_build_object('jobRoleId', h."jobRoleId", 'effectiveDate', h."effectiveDate")
          ORDER BY h."effectiveDate" ASC), '[]'::jsonb)
          FROM "public"."CollaboratorJobRoleHistory" h WHERE h."collaboratorId" = c.id))), '[]'::jsonb)
        FROM "public"."Collaborator" c WHERE c.id IN (SELECT id FROM selected)) AS collaborators,
      ${absenceRows} AS absences
  ` : [{ collaborators: [], absences: [] }];
  const byId = new Map(sources.collaborators.map(row => [row.id, { ...row,
    jobRoleHistory: row.jobRoleHistory.map(history => ({ ...history,
      effectiveDate: new Date(history.effectiveDate + 'T00:00:00.000Z')
    }))
  }]));
  return { periods: periods.map(row => ({ ...row, collaborator: byId.get(row.collaboratorId) ?? null })),
    absences: includeWorkforceDetails ? sources.absences.map(row => ({ ...row, startDate: new Date(row.startDate + 'T00:00:00.000Z'),
      endDate: new Date(row.endDate + 'T00:00:00.000Z') })) : [] };
}
