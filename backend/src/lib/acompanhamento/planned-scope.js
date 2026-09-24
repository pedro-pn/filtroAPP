/*
 * Escopo previsto do projeto (módulo Acompanhamento) — quantitativo de serviços vendidos,
 * previsão de horas normais e extras. As horas vêm das propostas selecionadas,
 * com cadastro manual como fallback e conferência de divergências no cronograma.
 *
 * A edição é "substituição total": o front envia o conjunto completo de serviços e de horas; o backend
 * reescreve as linhas do projeto numa transação (mesmo modelo de UX do cronograma — salvar tudo).
 */

import prisma from '../prisma.js';
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

export function buildPlannedScope(services, hours) {
  if (!hours) throw new Error('Projeto não encontrado.');
  const { normalHours, overtime, hoursPlan } = hours;

  return {
    hoursPlan,
    services: services.map(s => ({
      id: s.id,
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
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
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
  return buildPlannedScope(services, hours);
}

// Substitui todo o escopo previsto do projeto pelos conjuntos informados (já validados pela rota).
export async function setPlannedScope(projectId, { services = [], normalHours, overtime, hoursFingerprint } = {}) {
  assertDistinctScopeMeasurements(services, normalizeRdoServiceType);
  const currentCorrections = latestRealizedCorrections(await prisma.projectRealizedCorrection.findMany({ where: { projectId } }));
  for (const correction of currentCorrections.values()) {
    if (correction.quantityM == null) continue;
    const tubeRows = services.filter(service => normalizeRdoServiceType(service.serviceType) === correction.serviceType)
      .flatMap(service => service.systems ?? []).filter(row => row.systemType === 'TUBULACAO');
    if (!tubeRows.some(row => Number(row.quantity) > 0) || tubeRows.some(row => row.projectSystemId || row.equipment || row.systemName)) {
      throw new Error('Há correções de metragem neste serviço. Restaure-as antes de trocar a meta global por metas por sistema ou remover o serviço.');
    }
  }
  const modes = new Map();
  for (const service of services) for (const row of service.systems ?? []) {
    if (row.systemType === 'SISTEMA' && (normalizeRdoServiceType(service.serviceType) !== 'LIMPEZA_QUIMICA'
      || !row.equipment?.trim() || !row.systemName?.trim() || !Number.isSafeInteger(row.quantity)
      || row.quantity <= 0 || row.quantity > 999999999999)) {
      throw new Error('Sistemas por unidade exigem limpeza química, equipamento do cliente, nome do sistema e quantidade inteira positiva.');
    }
    const key = `${normalizeRdoServiceType(service.serviceType) ?? service.serviceType}:${row.systemType}`;
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

  await prisma.$transaction(async (tx) => {
    const hours = (await loadPlannedHours([projectId], tx)).get(projectId);
    if (!hours) throw new Error('Projeto não encontrado.');
    if (hoursFingerprint && hours.hoursPlan.fingerprint !== hoursFingerprint) throw plannedHoursConflict();
    const editingHours = normalHours !== undefined || overtime !== undefined;
    if (editingHours && hours.hoursPlan.source === 'COMMERCIAL') {
      throw plannedHoursConflict('As horas são fornecidas pelo comercial. Atualize o cronograma antes de salvar.');
    }
    const resolvedSystems = new Map();
    // Apaga os serviços (cascata derruba os sistemas) e as horas, depois recria tudo.
    await tx.projectPlannedService.deleteMany({ where: { projectId } });
    if (normalHours !== undefined) await tx.projectPlannedNormalHours.deleteMany({ where: { projectId } });
    if (overtime !== undefined) await tx.projectPlannedOvertime.deleteMany({ where: { projectId } });

    for (const [index, s] of services.entries()) {
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
          quantity: num(sys.quantity), unit: { TUBULACAO: 'M', OLEO: 'L', SISTEMA: 'UN' }[sys.systemType], order: sysIndex
        });
      }
      await tx.projectPlannedService.create({
        data: {
          projectId,
          serviceType: s.serviceType,
          scopeName: text(s.scopeName),
          weight: num(s.weight) ?? 1,
          note: s.note?.trim() || null,
          order: index,
          systems: { create: systems }
        }
      });
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
  }, { timeout: 30000, isolationLevel: 'Serializable' });

  return getPlannedScope(projectId);
}
