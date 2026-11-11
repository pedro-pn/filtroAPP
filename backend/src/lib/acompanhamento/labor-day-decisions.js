// `projects` is the complete parent selection from getProjectAllocationContext,
// already protected by this client's access/channel scope. Reuse those IDs for
// both project-owned tables; confirmed day parents themselves are global.
// Unique collaborator/date review rows and sorted project sets preserve the
// existing manual override / confirmed review precedence.
export async function loadLaborDayDecisions(database, { from, to, projects }) {
  const ids = projects.map(row => row.id);
  const first = new Date(from).toISOString().slice(0, 10), until = new Date(to).toISOString().slice(0, 10);
  const [row] = await database.$queryRaw`
    /* labor.day-decisions */
    WITH visible_projects AS (SELECT unnest(${ids}::text[]) AS id),
      bounds AS (SELECT ${first}::date AS first_day, ${until}::date AS until_day)
    SELECT
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('collaboratorId', o."collaboratorId", 'workDate', o."workDate", 'projectId', o."projectId")), '[]'::jsonb)
        FROM "public"."PontoDayProjectOverride" o, bounds b
        WHERE o."workDate" >= b.first_day AND o."workDate" < b.until_day
          AND o."projectId" IN (SELECT id FROM visible_projects)) AS overrides,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('collaboratorId', d."collaboratorId", 'date', d."workDate", 'kind', d.kind,
        'projectIds', (SELECT COALESCE(jsonb_agg(p."projectId" ORDER BY p."projectId"), '[]'::jsonb)
          FROM "public"."AllocationReviewDayProject" p WHERE p."dayId" = d.id AND p."projectId" IN (SELECT id FROM visible_projects)))), '[]'::jsonb)
        FROM "public"."AllocationReviewDay" d, bounds b
        WHERE d."workDate" >= b.first_day AND d."workDate" < b.until_day
          AND EXISTS (SELECT 1 FROM "public"."AllocationReviewRow" r WHERE r.id = d."rowId" AND r."confirmedAt" IS NOT NULL)) AS reviews
  `;
  return { manualDayOverrides: row.overrides.map(item => ({ ...item, workDate: new Date(item.workDate + 'T00:00:00.000Z') })),
    confirmedReviewDays: row.reviews.map(day => ({ ...day, projectIds: day.projectIds.sort() })) };
}
