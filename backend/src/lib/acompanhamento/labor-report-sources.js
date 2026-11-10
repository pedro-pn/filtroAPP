// A configuração do projeto pode conter centenas de preferências de colaboradores.
// O cálculo global já a carrega uma vez; não a repetir em cada linha de RDO.
export function laborReportQuery(periodStart, periodEndExclusive, { includeProject = false } = {}) {
  return {
    where: {
      deletedAt: null,
      OR: [
        { reportType: 'RDO' },
        {
          reportDate: { gte: periodStart, lt: periodEndExclusive },
          OR: [
            { daytimeWorkedMinutes: { gt: 0 } },
            { nighttimeWorkedMinutes: { gt: 0 } },
            { services: { some: { startTime: { not: null }, endTime: { not: null } } } }
          ]
        }
      ]
    },
    select: {
      reportType: true, sequenceNumber: true, projectId: true, reportDate: true,
      daytimeWorkedMinutes: true, nighttimeWorkedMinutes: true,
      collaborators: { select: { collaboratorId: true } },
      // RDO hours always come from their recorded totals, including zero.
      // Interval fallback is used only by service reports; keep the parent
      // selection/order intact while filtering unnecessary child rows.
      services: { where: { report: { reportType: { not: 'RDO' } } }, select: { startTime: true, endTime: true } },
      ...(includeProject ? { project: { select: {
        code: true, offshore: true, laborSleepModeByCollaborator: true, mobilizationDate: true
      } } } : {})
    }
  };
}

export async function loadLaborReportSources({ database, periodStart, periodEnd, projects }) {
  const from = new Date(Date.UTC(new Date(periodStart).getUTCFullYear(), 0, 1));
  const to = new Date(Date.UTC(new Date(periodEnd).getUTCFullYear() + 1, 0, 1));
  const endExclusive = new Date(new Date(periodEnd).getTime() + 86400000);
  const query = laborReportQuery(periodStart, endExclusive);
  query.select.id = true;
  // A nested service selection binds every historical RDO ID even though none
  // of its intervals are used. Read the period's service intervals directly;
  // keep the parent query/order and nominal RDO evidence unchanged.
  delete query.select.services;
  delete query.select.collaborators;
  const annualWhere = {
    deletedAt: null, reportType: { not: 'RDO' },
    reportDate: { gte: from, lt: to }, project: { offshore: true }
  };
  const reportsPromise = Promise.resolve(database.report.findMany(query));
  const annualReportsPromise = Promise.resolve(database.report.findMany({
    where: annualWhere, select: { id: true, projectId: true, reportDate: true }
  }));
  // Use the exact parents already selected, including their original order.
  // A single bound text[] avoids both historical placeholder expansion and
  // repeating the report/service predicates. Never interpolate IDs into SQL.
  const collaboratorsPromise = Promise.all([reportsPromise, annualReportsPromise]).then(sources => {
    const ids = new Set();
    for (const rows of sources) for (const row of rows) ids.add(row.id);
    const reportIds = [...ids];
    return reportIds.length ? database.$queryRaw`
      SELECT "reportId", "collaboratorId"
      FROM "public"."ReportCollaborator"
      WHERE "reportId" = ANY(${reportIds}::text[])
    ` : [];
  });
  const [reports, offshoreOtherReports, collaborators, serviceIntervals, projectRows] = await Promise.all([
    reportsPromise,
    annualReportsPromise,
    collaboratorsPromise,
    database.reportService.findMany({
      where: {
        startTime: { not: null }, endTime: { not: null },
        report: { deletedAt: null, reportType: { not: 'RDO' }, reportDate: { gte: periodStart, lt: endExclusive } }
      },
      select: { reportId: true, startTime: true, endTime: true }
    }),
    projects
  ]);
  const projectsById = new Map(projectRows.map(project => [project.id, project]));
  const collaboratorsByReportId = new Map();
  for (const { reportId, collaboratorId } of collaborators) {
    if (!collaboratorsByReportId.has(reportId)) collaboratorsByReportId.set(reportId, []);
    collaboratorsByReportId.get(reportId).push({ collaboratorId });
  }
  const servicesByReportId = new Map();
  for (const { reportId, startTime, endTime } of serviceIntervals) {
    if (!servicesByReportId.has(reportId)) servicesByReportId.set(reportId, []);
    servicesByReportId.get(reportId).push({ startTime, endTime });
  }
  const withProject = ({ id, ...report }) => ({ ...report,
    collaborators: collaboratorsByReportId.get(id) || [],
    project: report.project ?? projectsById.get(report.projectId)
  });
  const rdoReports = reports.map(report => withProject({ ...report, services: servicesByReportId.get(report.id) || [] }));
  return {
    reports: rdoReports,
    // Os RDOs de qualquer data continuam na primeira leitura, pois são evidência
    // para as janelas legadas. A consulta anual adicional só precisa dos outros tipos.
    offshoreReports: [
      ...rdoReports.filter(report => report.reportType === 'RDO' && new Date(report.reportDate) >= from && new Date(report.reportDate) < to),
      ...offshoreOtherReports.map(withProject)
    ].filter(report => report.project?.offshore)
  };
}
