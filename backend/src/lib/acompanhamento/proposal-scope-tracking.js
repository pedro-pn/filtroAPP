import prisma from '../prisma.js';
import { addRealizedService, buildProgress, isServiceFinalized } from './avanco.js';
import { contributionReportVersion, contributionServiceKey, loadProposalScopes, reportServicesWithContributions } from './proposal-scopes.js';

export async function getProposalScopeTracking(projectId, client = prisma) {
  const context = await loadProposalScopes(projectId, client);
  const reports = await client.report.findMany({ where: { projectId, deletedAt: null, status: { in: ['APPROVED', 'SIGNED'] } },
    orderBy: [{ reportDate: 'desc' }, { sequenceNumber: 'desc' }], include: { services: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, measurementLinks: true } });
  const source = reports.filter(report => report.reportType === 'RDO' || !report.specialConditions?.parentRdoId);
  const rows = source.flatMap(report => {
    const groups = new Map();
    for (const service of reportServicesWithContributions(report, context)) {
      const key = contributionServiceKey(service);
      if (groups.has(key)) { groups.get(key).count++; continue; }
      groups.set(key, { reportId: report.id, reportType: report.reportType, number: report.sequenceNumber,
        date: report.reportDate, version: contributionReportVersion(report), serviceKey: key, serviceType: service.serviceType,
        system: [service.system, service.extraData?.drawingsTags].filter(Boolean).join(' · '), contributionKey: service.contribution.key,
        method: service.contribution.method, count: 1 });
    }
    return [...groups.values()];
  });
  const scopes = context.options.map(option => {
    const planned = context.planned.filter(service => context.plannedKey(service) === option.key);
    const realized = new Map();
    for (const report of source) for (const service of reportServicesWithContributions(report, context)) {
      if (service.contribution.key === option.key && isServiceFinalized(service)) addRealizedService(realized, service);
    }
    return { ...option, progress: buildProgress(planned, realized), serviceCount: planned.length };
  });
  return { scopes, services: rows, pending: rows.filter(row => !row.contributionKey).reduce((n, row) => n + row.count, 0) };
}
