import { createHash } from 'node:crypto';
import prisma from '../prisma.js';
import { normalizeRdoServiceType } from './service-types.js';
import { extractServiceMeasurements } from './realized-measurements.js';
import { resolveProjectSystem } from './project-systems.js';
import { diameterKey } from './system-progress.js';
import { withNativeMeasurementLinks } from './native-measurement-links.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const canonical = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// Ignora apenas apresentação/anexos. Alterar a medição ou o serviço exige rever seu vínculo;
// recriar os IDs na edição do RDO não transfere o vínculo para outra atividade.
export function contributionServiceKey(service) {
  const extra = Object.fromEntries(Object.entries(service.extraData || {})
    .filter(([key]) => !['__uploads__', '__ongoingKey', '__serviceLinkKey', '__sourceServiceId', 'serviceId'].includes(key)));
  return hash([service.serviceType, service.equipmentId ?? null, service.system ?? null, service.material ?? null, extra]);
}
export const contributionReportVersion = report => hash([report.updatedAt, report.services, report.contributionAssignments]);

export async function loadProposalScopes(projectId, client = prisma, suppliedProject) {
  const project = suppliedProject || await client.project.findFirst({ where: { id: projectId, deletedAt: null } });
  if (!project) throw fail(404, 'Projeto não encontrado.');
  const [budget, additions, planned] = await Promise.all([
    client.projectBudget.findUnique({ where: { projectId_version: { projectId, version: 1 } } }),
    client.projectAdditionalProposal.findMany({ where: { projectId }, orderBy: [{ proposalCode: 'asc' }] }),
    suppliedProject?.plannedServices ? Promise.resolve(suppliedProject.plannedServices) : client.projectPlannedService.findMany({ where: { projectId }, orderBy: { order: 'asc' }, include: { systems: { include: { projectSystem: true } } } })
  ]);
  const refs = [budget, ...additions].filter(Boolean);
  const [access, app] = await Promise.all([
    client.commercialProposal.findMany({ where: { codBd: { in: refs.map(r => r.sourceProposalCodBd).filter(Number.isInteger) } } }),
    client.commercialAppProposal.findMany({ where: { externalId: { in: refs.map(r => r.commercialAppProposalId).filter(Boolean) } } })
  ]);
  const option = (row, main = false) => {
    const proposal = row.source === 'COMERCIAL_APP' ? app.find(p => p.externalId === row.commercialAppProposalId)
      : access.find(p => p.codBd === row.sourceProposalCodBd);
    const code = String(proposal?.proposalCode ?? proposal?.codProp ?? row.proposalCode ?? project.commercialProposalCode ?? '').trim();
    const key = code ? `${row.source}:${code}` : 'MAIN';
    return { key, proposalCode: code || null, source: row.source || 'MANUAL', kind: main ? 'MAIN' : 'ADDITIONAL',
      revision: proposal?.revisionNumber ?? proposal?.nRev ?? null,
      parentProposalCode: main ? null : String(proposal?.parentProposalCode ?? proposal?.parentCodProp ?? ''),
      label: `${main ? 'Principal' : 'Adicional'}${code ? ` ${code}` : ''}${proposal ? ` · Rev. ${proposal.revisionNumber ?? proposal.nRev}` : ''} · ${row.source || 'Manual'}` };
  };
  const main = budget ? option(budget, true) : { key: 'MAIN', proposalCode: null, source: 'MANUAL', kind: 'MAIN', revision: null, parentProposalCode: null, label: 'Escopo principal / manual' };
  const options = [main, ...additions.filter(row => row.active).map(row => option(row))];
  for (const item of options) item.version = hash([item, planned.filter(service => (service.contributionKey || main.key) === item.key)]);
  // Escopo manual/legado sem origem permanece na principal. Nunca migra para um adicional.
  const plannedKey = service => service.contributionKey || main.key;
  return { project, options, main, planned, plannedKey, hasRetired: additions.some(row => !row.active) };
}

export function selectProposalScope(context, key) {
  if (!key || key === 'ALL') return null;
  if (typeof key !== 'string' || key.length > 200) throw fail(400, 'Proposta inválida.');
  const selected = context.options.find(option => option.key === key);
  if (!selected) throw fail(409, 'A proposta não está selecionada neste projeto. Atualize a seleção.');
  return selected;
}

export function resolveServiceContribution(service, report, context) {
  const assignment = report.contributionAssignments?.[contributionServiceKey(service)];
  if (assignment?.projectId && assignment.projectId !== context.project.id) return { key: null, method: 'MANUAL' };
  if (assignment) return { key: assignment.contributionKey || null, method: 'MANUAL' };
  if (context.hasRetired) return { key: null, method: 'INFERRED' };
  if (context.options.length === 1) return { key: context.main.key, method: 'INFERRED' };
  const covered = new Set(context.planned.map(context.plannedKey));
  if (context.options.some(option => !covered.has(option.key))) return { key: null, method: 'INFERRED' };
  const type = normalizeRdoServiceType(service.serviceType) || service.serviceType;
  const candidates = context.planned.filter(row => (normalizeRdoServiceType(row.serviceType) || row.serviceType) === type);
  const registry = [...new Map(context.planned.flatMap(row => row.systems || []).filter(row => row.projectSystem)
    .map(row => [row.projectSystem.id, row.projectSystem])).values()];
  const measurements = service.reconciledMeasurements || extractServiceMeasurements(service, type);
  const keysFor = measurement => {
    const match = resolveProjectSystem(registry, { ...measurement, serviceType: type });
    if (!match) return new Set();
    return new Set(candidates.filter(row => !row.systems.length || row.systems.some(system => (!system.projectSystemId || system.projectSystemId === match.id)
      && system.systemType === measurement.systemType
      && (system.systemType !== 'TUBULACAO' || !system.diameter || diameterKey(system.diameter, system.diameterUnit) === measurement.bitola)))
      .map(context.plannedKey));
  };
  if (measurements.length) {
    const owners = measurements.map(keysFor);
    if (owners.every(keys => keys.size === 1) && new Set(owners.map(keys => [...keys][0])).size === 1) {
      return { key: [...owners[0]][0], method: 'INFERRED' };
    }
  }
  // Um tipo só é suficiente quando todas as metas daquele tipo pertencem à mesma proposta.
  const keys = new Set(candidates.map(context.plannedKey));
  return { key: keys.size === 1 ? [...keys][0] : null, method: 'INFERRED' };
}

export function reportServicesWithContributions(report, context) {
  return withNativeMeasurementLinks((report.services || []).map(service => ({ ...service, report })))
    .map(service => ({ ...service, contribution: resolveServiceContribution(service, report, context) }));
}

export async function assignReportContribution(projectId, reportId, { serviceKey, contributionKey, version, reason }, userId, client = prisma) {
  if (!version || !serviceKey || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw fail(400, 'Informe o vínculo, a versão e o motivo da alteração.');
  return client.$transaction(async tx => {
    // Mesma ordem de bloqueio da seleção comercial: projeto antes dos dados dependentes.
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
    const context = await loadProposalScopes(projectId, tx);
    if (contributionKey) selectProposalScope(context, contributionKey);
    if (contributionKey === 'ALL') throw fail(400, 'Escolha uma proposta específica.');
    const report = await tx.report.findFirst({ where: { id: reportId, projectId, deletedAt: null }, include: { services: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
    if (!report) throw fail(404, 'Relatório não encontrado neste projeto.');
    if (contributionReportVersion(report) !== version) throw fail(409, 'O relatório ou seus vínculos mudaram. Atualize antes de salvar.');
    if (!report.services.some(service => contributionServiceKey(service) === serviceKey)) throw fail(409, 'Serviço alterado ou removido. Atualize os vínculos.');
    if (report.specialConditions?.parentRdoId) throw fail(409, 'Vincule o serviço no RDO de origem deste relatório técnico.');
    const assignments = { ...(report.contributionAssignments || {}) };
    const previous = assignments[serviceKey];
    const audit = { projectId, contributionKey: contributionKey || null, userId, reason: reason.trim(), at: new Date().toISOString() };
    assignments[serviceKey] = { ...audit, history: [...(previous?.history || []), audit] };
    const updated = await tx.report.updateMany({ where: { id: reportId, updatedAt: report.updatedAt }, data: { contributionAssignments: assignments, updatedAt: report.updatedAt } });
    if (updated.count !== 1) throw fail(409, 'O relatório mudou. Atualize antes de salvar.');
    return { saved: true };
  });
}
