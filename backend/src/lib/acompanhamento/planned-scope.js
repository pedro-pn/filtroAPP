/*
 * Escopo previsto do projeto (módulo Acompanhamento) — quantitativo de serviços vendidos,
 * previsão de horas normais e extras. As horas vêm das propostas selecionadas,
 * com cadastro manual como fallback e conferência de divergências no cronograma.
 *
 * Cada conjunto enviado é substituído por inteiro; conjuntos omitidos são preservados.
 * Isso permite editar apenas as horas sem assumir a autoria manual do escopo importado.
 */

import prisma from '../prisma.js';
import { loadProposalScopes } from './proposal-scopes.js';
import { createHash } from 'node:crypto';
import { commercialTransaction, lockCommercialProject } from './commercial-contributions.js';
import { resolvePlannedSystem } from './project-systems.js';
import { normalizeRdoServiceType } from './avanco.js';
import { latestRealizedCorrections } from './realized-corrections.js';
import { assertDistinctScopeMeasurements } from './scope-groups.js';
import { loadPlannedHours, plannedHoursConflict } from './planned-hours.js';

// Tipos de serviço conhecidos (rótulos no front). Texto livre também é aceito.
export const PLANNED_SERVICE_TYPES = ['LIMPEZA_QUIMICA', 'TESTE_PRESSAO', 'FLUSHING', 'FILTRAGEM'];

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  const str = typeof value === 'string' ? value.trim() : '';
  return str || null;
}

export function buildPlannedScope(services, hours, { integral = false } = {}) {
  if (!hours) throw new Error('Projeto não encontrado.');
  const normalHours = integral ? hours.fullNormalHours ?? hours.normalHours : hours.normalHours;
  const overtime = integral ? hours.fullOvertime ?? hours.overtime : hours.overtime;
  const { hoursPlan } = hours;

  return {
    hoursPlan,
    services: services.map(s => ({
      id: s.id,
      contributionKey: s.contributionKey ?? null,
      serviceType: s.serviceType,
      scopeName: s.scopeName ?? null,
      weight: s.weight,
      note: s.note,
      systems: s.systems.map(sys => ({
        projectSystemId: sys.projectSystemId ?? null,
        equipment: sys.projectSystem?.equipment ?? null,
        systemName: sys.projectSystem?.name ?? null,
        systemType: sys.systemType,
        description: sys.description,
        diameter: sys.diameter,
        diameterUnit: sys.diameterUnit,
        quantity: sys.quantity,
        unit: sys.unit
      }))
    })),
    normalHours: normalHours.map(o => ({
      id: o.id,
      jobRoleId: o.jobRoleId,
      roleName: o.roleName ?? o.jobRole?.name ?? null,
      collaboratorCount: o.collaboratorCount,
      hours: o.hours
    })),
    overtime: overtime.map(o => ({
      id: o.id,
      jobRoleId: o.jobRoleId,
      roleName: o.roleName ?? o.jobRole?.name ?? null,
      collaboratorCount: o.collaboratorCount,
      hours: o.hours
    }))
  };
}

// Lê o escopo previsto de um projeto (serviços + horas normais + hora extra), pronto para o front.
export async function getPlannedScope(projectId) {
  const project = await prisma.project.findUnique({ where: { id: projectId },
    select: { id: true, commercialScopeImport: true } });
  if (!project) throw new Error('Projeto não encontrado.');

  const [services, hoursByProject] = await Promise.all([
    prisma.projectPlannedService.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { systems: { orderBy: [{ order: 'asc' }], include: { projectSystem: true } } }
    }),
    loadPlannedHours([projectId])
  ]);
  const hours = hoursByProject.get(projectId);
  return { ...buildPlannedScope(services, hours, { integral: true }), contributionsFingerprint: scopeEditFingerprint(services), commercialScopeImport: project.commercialScopeImport };
}

// Substitui os conjuntos enviados para o projeto (já validados pela rota).
export async function setPlannedScope(projectId, { services, normalHours, overtime, hoursFingerprint,
  commercialScopeFingerprint, contributionsFingerprint } = {}) {
  const editingServices = services !== undefined;
  if (editingServices) assertDistinctScopeMeasurements(services, normalizeRdoServiceType);
  const currentCorrections = latestRealizedCorrections(await prisma.projectRealizedCorrection.findMany({ where: { projectId } }));
  for (const correction of editingServices ? currentCorrections.values() : []) {
    if (correction.quantityM == null) continue;
    const tubeRows = services.filter(service => normalizeRdoServiceType(service.serviceType) === correction.serviceType)
      .flatMap(service => service.systems ?? []).filter(row => row.systemType === 'TUBULACAO');
    if (!tubeRows.some(row => Number(row.quantity) > 0) || tubeRows.some(row => row.projectSystemId || row.equipment || row.systemName)) {
      throw new Error('Há correções de metragem neste serviço. Restaure-as antes de trocar a meta global por metas por sistema ou remover o serviço.');
    }
  }
  const modes = new Map();
  for (const service of services ?? []) for (const row of service.systems ?? []) {
    const unitService = { SISTEMA: 'LIMPEZA_QUIMICA', MANGOTE: 'TESTE_PRESSAO' }[row.systemType];
    if (unitService && (normalizeRdoServiceType(service.serviceType) !== unitService
      || !row.equipment?.trim() || !row.systemName?.trim() || !Number.isSafeInteger(row.quantity)
      || row.quantity <= 0 || row.quantity > 999999999999)) {
      throw new Error(row.systemType === 'MANGOTE'
        ? 'Mangueiras por unidade exigem teste de pressão, equipamento do cliente, nome do sistema e quantidade inteira positiva.'
        : 'Sistemas por unidade exigem limpeza química, equipamento do cliente, nome do sistema e quantidade inteira positiva.');
    }
    const key = `${service.contributionKey || 'MAIN'}:${normalizeRdoServiceType(service.serviceType) ?? service.serviceType}:${row.systemType}`;
    const linked = Boolean(row.projectSystemId || row.equipment || row.systemName);
    if (modes.has(key) && modes.get(key) !== linked) throw new Error('Para o mesmo serviço e tipo de medição, preencha equipamento do cliente e sistema em todas as linhas ou mantenha todas globais. Não misture uma meta total com suas partes.');
    modes.set(key, linked);
  }
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new Error('Projeto não encontrado.');

  // Resolve o rótulo do cargo a partir do jobRoleId (snapshot em roleName), para as horas não
  // dependerem de o cargo continuar existindo depois.
  const roleIds = [...new Set([...(normalHours ?? []), ...(overtime ?? [])].map(o => o.jobRoleId).filter(Boolean))];
  const roles = roleIds.length
    ? await prisma.jobRole.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } })
    : [];
  const roleNameById = new Map(roles.map(r => [r.id, r.name]));

  await commercialTransaction(async (tx) => {
    await lockCommercialProject(tx, projectId);
    const currentServices = editingServices ? await tx.projectPlannedService.findMany({
      where: { projectId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { systems: { orderBy: { order: 'asc' }, include: { projectSystem: true } } }
    }) : [];
    if (editingServices && (contributionsFingerprint !== undefined || currentServices.some(row => row.contributionKey)) &&
        contributionsFingerprint !== scopeEditFingerprint(currentServices)) {
      throw Object.assign(new Error('Uma contribuição mudou. Atualize o cronograma antes de salvar.'), { status: 409 });
    }
    const existingKeys = new Set(currentServices.map(row => row.contributionKey).filter(Boolean));
    if ((services ?? []).some(row => row.contributionKey && !existingKeys.has(row.contributionKey))) {
      const context = await loadProposalScopes(projectId, tx);
      for (const option of context.options) existingKeys.add(option.key);
    }
    if ((services ?? []).some(row => row.contributionKey && !existingKeys.has(row.contributionKey))) {
      throw Object.assign(new Error('Contribuição de escopo desconhecida.'), { status: 409 });
    }
    const changedKeys = new Set();
    for (const key of new Set([...currentServices, ...(services ?? [])].map(row => row.contributionKey ?? null))) {
      if (JSON.stringify(canonicalServices(currentServices.filter(row => (row.contributionKey ?? null) === key))) !==
          JSON.stringify(canonicalServices((services ?? []).filter(row => (row.contributionKey ?? null) === key)))) changedKeys.add(key);
    }
    if (editingServices && commercialScopeFingerprint !== undefined) {
      const currentProject = await tx.project.findUnique({ where: { id: projectId },
        select: { commercialScopeImport: true } });
      if ((currentProject?.commercialScopeImport?.fingerprint ?? null) !== commercialScopeFingerprint) {
        throw Object.assign(new Error('O escopo comercial mudou. Atualize o cronograma antes de salvar.'), { status: 409 });
      }
    }
    const hours = (await loadPlannedHours([projectId], tx)).get(projectId);
    if (!hours) throw new Error('Projeto não encontrado.');
    if (hoursFingerprint && hours.hoursPlan.fingerprint !== hoursFingerprint) throw plannedHoursConflict();
    const editingHours = normalHours !== undefined || overtime !== undefined;
    if (editingHours && hours.hoursPlan.source === 'COMMERCIAL') {
      throw plannedHoursConflict('As horas são fornecidas pelo comercial. Atualize o cronograma antes de salvar.');
    }
    const resolvedSystems = new Map();
    // Reescreve somente os conjuntos enviados; horas isoladas preservam o escopo comercial.
    if (editingServices) for (const key of changedKeys) {
      await tx.projectPlannedService.deleteMany({ where: { projectId, contributionKey: key } });
    }
    if (normalHours !== undefined) await tx.projectPlannedNormalHours.deleteMany({ where: { projectId } });
    if (overtime !== undefined) await tx.projectPlannedOvertime.deleteMany({ where: { projectId } });

    for (const [index, s] of (services ?? []).entries()) {
      if (!changedKeys.has(s.contributionKey ?? null)) continue;
      const systems = [];
      for (const [sysIndex, sys] of (s.systems ?? []).entries()) {
        const identity = JSON.stringify([sys.projectSystemId || '', sys.equipment || '', sys.systemName || '']);
        if (!resolvedSystems.has(identity)) resolvedSystems.set(identity, await resolvePlannedSystem(tx, projectId, sys));
        systems.push({
          projectSystemId: resolvedSystems.get(identity),
          systemType: sys.systemType,
          description: text(sys.description),
          diameter: sys.systemType === 'TUBULACAO' ? text(sys.diameter) : null,
          diameterUnit: sys.systemType === 'TUBULACAO' && text(sys.diameter) ? (sys.diameterUnit || 'pol') : null,
          quantity: num(sys.quantity), unit: { TUBULACAO: 'M', OLEO: 'L', SISTEMA: 'UN', MANGOTE: 'UN' }[sys.systemType], order: sysIndex
        });
      }
      await tx.projectPlannedService.create({
        data: {
          projectId,
          contributionKey: s.contributionKey ?? null,
          serviceType: s.serviceType,
          scopeName: text(s.scopeName),
          weight: num(s.weight) ?? 1,
          note: s.note?.trim() || null,
          order: index,
          systems: { create: systems }
        }
      });
    }
    if (editingServices) for (const key of changedKeys) {
      const [source, proposalCode] = key?.split(':') || [];
      const additional = ['COMERCIAL_APP', 'ACCESS_IMPORT'].includes(source) ? await tx.projectAdditionalProposal.findUnique({
        where: { projectId_source_proposalCode: { projectId, source, proposalCode } }
      }) : null;
      if (additional) await tx.projectAdditionalProposal.update({ where: { id: additional.id },
        data: { scopeImport: { ...additional.scopeImport, status: 'MANUAL_OVERRIDE' } } });
      else await tx.project.update({ where: { id: projectId },
        data: { commercialScopeImport: { status: 'MANUAL_OVERRIDE' } } });
    }

    if (normalHours?.length) {
      await tx.projectPlannedNormalHours.createMany({
        data: normalHours.map((o, index) => {
          const jobRoleId = o.jobRoleId && roleNameById.has(o.jobRoleId) ? o.jobRoleId : null;
          return {
            projectId,
            jobRoleId,
            roleName: jobRoleId ? roleNameById.get(jobRoleId) : (o.roleName?.trim() || null),
            collaboratorCount: o.collaboratorCount ?? 1,
            hours: num(o.hours) ?? 0,
            order: index
          };
        })
      });
    }

    if (overtime?.length) {
      await tx.projectPlannedOvertime.createMany({
        data: overtime.map((o, index) => {
          const jobRoleId = o.jobRoleId && roleNameById.has(o.jobRoleId) ? o.jobRoleId : null;
          return {
            projectId,
            jobRoleId,
            roleName: jobRoleId ? roleNameById.get(jobRoleId) : (o.roleName?.trim() || null),
            collaboratorCount: o.collaboratorCount ?? 1,
            hours: num(o.hours) ?? 0,
            order: index
          };
        })
      });
    }
  });

  return getPlannedScope(projectId);
}

function canonicalServices(services) {
  return services.map(service => ({
    serviceType: service.serviceType, scopeName: text(service.scopeName),
    weight: num(service.weight) ?? 1, note: text(service.note),
    systems: (service.systems ?? []).map(row => ({
      projectSystemId: row.projectSystemId ?? null,
      equipment: text(row.equipment ?? row.projectSystem?.equipment),
      systemName: text(row.systemName ?? row.projectSystem?.name), systemType: row.systemType,
      description: text(row.description), diameter: row.systemType === 'TUBULACAO' ? text(row.diameter) : null,
      diameterUnit: row.systemType === 'TUBULACAO' && text(row.diameter) ? row.diameterUnit || 'pol' : null,
      quantity: num(row.quantity)
    }))
  }));
}
function scopeEditFingerprint(services) {
  return createHash('sha256').update(JSON.stringify(services.map(row =>
    [row.id, row.contributionKey ?? null, row.updatedAt]))).digest('hex');
}
