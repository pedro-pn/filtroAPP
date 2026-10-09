import { hasModuleRole } from '../module-roles.js';

export function databookError(message, statusCode = 422) {
  return Object.assign(new Error(message), { statusCode });
}

export function databookPermissions(user, project) {
  const internal = user && user.accountType !== 'CLIENT';
  const administrator = internal && user.accountType === 'ADMIN';
  const rdoManager = internal && hasModuleRole(user, 'rdo:manager');
  const moduleManager = internal && hasModuleRole(user, ['efetivo:manager', 'acompanhamento:manager']);
  const reader = internal && hasModuleRole(user, [
    'rdo:coordinator', 'acompanhamento:viewer', 'acompanhamento:manager',
    'efetivo:manager', 'efetivo:viewer', 'efetivo:commercial', 'efetivo:operations',
    'efetivo:assets', 'efetivo:supplies', 'efetivo:administrative', 'efetivo:qsms'
  ]);
  const canRead = Boolean(project && !project.deletedAt && internal
    && (administrator || rdoManager || reader)
    && (!project.managerOnly || administrator || rdoManager));
  return { canRead, canGenerate: canRead && Boolean(administrator || rdoManager || moduleManager) };
}

export const databookDate = value => value ? new Date(value).toISOString().slice(0, 10) : null;

export function databookPeriodWhere(startDate, endDate) {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: new Date(`${startDate}T00:00:00.000Z`), lt: end };
}

export function defaultDatabookPeriod(reports) {
  const dates = reports.filter(report => !report.deletedAt && ['RDO', 'RDO_MAINTENANCE', 'RDO_PRODUCTION'].includes(report.reportType))
    .map(report => databookDate(report.reportDate)).filter(Boolean).sort();
  return { startDate: dates[0] || null, endDate: dates.at(-1) || null };
}
