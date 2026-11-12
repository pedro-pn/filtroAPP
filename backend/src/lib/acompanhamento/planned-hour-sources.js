import { Prisma } from '@prisma/client';

// Select parents through the protected client first. Child rows and role names
// are limited to those identities; no project filtering is reconstructed here.
// Read the same columns/order in one statement and preserve Decimal/UTC types.
export async function loadPlannedHourProjects(client, projectIds) {
  const projects = await client.project.findMany({
    where: { id: { in: projectIds }, deletedAt: null },
    select: { id: true, plannedHoursResolution: true, proposalPercentage: true }
  });
  if (!projects.length) return [];
  const ids = projects.map(row => row.id);
  const [sources] = await client.$queryRaw`
    /* planned-hours.children */
    WITH selected AS (SELECT unnest(${ids}::text[]) AS id)
    SELECT
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', h.id, 'projectId', h."projectId",
        'jobRoleId', h."jobRoleId", 'roleName', h."roleName", 'collaboratorCount', h."collaboratorCount",
        'hours', h.hours::text, 'note', h.note, 'order', h."order", 'createdAt', h."createdAt", 'updatedAt', h."updatedAt",
        'jobRole', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('name', r.name) END)
        ORDER BY h."order" ASC, h."createdAt" ASC), '[]'::jsonb)
        FROM "public"."ProjectPlannedNormalHours" h LEFT JOIN "public"."JobRole" r ON r.id = h."jobRoleId"
        WHERE h."projectId" IN (SELECT id FROM selected)) AS normal,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', h.id, 'projectId', h."projectId",
        'jobRoleId', h."jobRoleId", 'roleName', h."roleName", 'collaboratorCount', h."collaboratorCount",
        'hours', h.hours::text, 'note', h.note, 'order', h."order", 'createdAt', h."createdAt", 'updatedAt', h."updatedAt",
        'jobRole', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('name', r.name) END)
        ORDER BY h."order" ASC, h."createdAt" ASC), '[]'::jsonb)
        FROM "public"."ProjectPlannedOvertime" h LEFT JOIN "public"."JobRole" r ON r.id = h."jobRoleId"
        WHERE h."projectId" IN (SELECT id FROM selected)) AS overtime,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('projectId', b."projectId", 'source', b.source,
        'sourceProposalCodBd', b."sourceProposalCodBd", 'commercialAppProposalId', b."commercialAppProposalId")), '[]'::jsonb)
        FROM "public"."ProjectBudget" b WHERE b."projectId" IN (SELECT id FROM selected) AND b.version = 1) AS budgets,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('projectId', a."projectId", 'source', a.source,
        'sourceProposalCodBd', a."sourceProposalCodBd", 'commercialAppProposalId', a."commercialAppProposalId", 'metricInclusion', a."metricInclusion")), '[]'::jsonb)
        FROM "public"."ProjectAdditionalProposal" a WHERE a."projectId" IN (SELECT id FROM selected) AND a.active = true) AS additions
  `;
  const groups = (rows, convert = row => { const { projectId: _projectId, ...value } = row; return value; }) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.projectId)) map.set(row.projectId, []);
      map.get(row.projectId).push(convert(row));
    }
    return map;
  };
  const hour = row => ({ ...row, hours: new Prisma.Decimal(row.hours),
    createdAt: new Date(row.createdAt + 'Z'), updatedAt: new Date(row.updatedAt + 'Z') });
  const normal = groups(sources.normal, hour), overtime = groups(sources.overtime, hour);
  const budgets = groups(sources.budgets), additions = groups(sources.additions);
  return projects.map(row => ({ ...row, plannedNormalHours: normal.get(row.id) ?? [],
    plannedOvertime: overtime.get(row.id) ?? [], budgets: budgets.get(row.id) ?? [],
    additionalProposals: additions.get(row.id) ?? [] }));
}
