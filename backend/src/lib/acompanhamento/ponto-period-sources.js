// The import scope already read the creation dates used by mergePontoPeriods.
// Attach them without repeating an Import relation query for every period.
export function withPontoImportDates(periodRows, imports) {
  const byId = new Map(imports.map(item => [item.id, item.createdAt]));
  return periodRows.map(row => ({
    ...row, import: { createdAt: byId.get(row.importId) ?? row.import?.createdAt }
  }));
}

// Keep the period parent query and its order. Only the selected collaborator
// identity/history are joined into one read; no project-owned data or personal
// fields such as CPF, email or signatures are selected.
export async function loadMonthlyPontoPeriods(database, importIds) {
  const periods = await database.pontoPeriodSummary.findMany({
    where: { importId: { in: importIds }, collaboratorId: { not: null } }
  });
  const ids = [...new Set(periods.map(row => row.collaboratorId))];
  const rows = ids.length ? await database.$queryRaw`
    /* labor.period-collaborators */
    SELECT c.id, c.name, c."jobRoleId", COALESCE((
      SELECT jsonb_agg(jsonb_build_object('jobRoleId', h."jobRoleId", 'effectiveDate', h."effectiveDate")
        ORDER BY h."effectiveDate" ASC)
      FROM "public"."CollaboratorJobRoleHistory" h WHERE h."collaboratorId" = c.id
    ), '[]'::jsonb) AS "jobRoleHistory"
    FROM "public"."Collaborator" c WHERE c.id = ANY(${ids}::text[])
  ` : [];
  const byId = new Map(rows.map(row => [row.id, { ...row,
    jobRoleHistory: row.jobRoleHistory.map(history => ({ ...history,
      effectiveDate: new Date(history.effectiveDate + 'T00:00:00.000Z')
    }))
  }]));
  return periods.map(row => ({ ...row, collaborator: byId.get(row.collaboratorId) ?? null }));
}
