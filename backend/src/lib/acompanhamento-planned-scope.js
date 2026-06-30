/*
 * Escopo previsto do projeto (módulo Acompanhamento) — quantitativo de serviços vendidos e
 * previsão de hora extra. Hoje é preenchido manualmente no cronograma; idealmente viria do banco
 * comercial, que ainda não carrega esses campos.
 *
 * A edição é "substituição total": o front envia o conjunto completo de serviços e de HE; o backend
 * reescreve as linhas do projeto numa transação (mesmo modelo de UX do cronograma — salvar tudo).
 */

import prisma from './prisma.js';

// Tipos de serviço conhecidos (rótulos no front). Texto livre também é aceito.
export const PLANNED_SERVICE_TYPES = ['LIMPEZA_QUIMICA', 'TESTE_PRESSAO', 'FLUSHING', 'FILTRAGEM'];

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Lê o escopo previsto de um projeto (serviços + hora extra), pronto para o front.
export async function getPlannedScope(projectId) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new Error('Projeto não encontrado.');

  const [services, overtime] = await Promise.all([
    prisma.projectPlannedService.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }]
    }),
    prisma.projectPlannedOvertime.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { jobRole: { select: { id: true, name: true } } }
    })
  ]);

  return {
    services: services.map(s => ({
      id: s.id,
      serviceType: s.serviceType,
      tubingQty: s.tubingQty,
      tubingUnit: s.tubingUnit,
      oilLiters: s.oilLiters,
      reservoirQty: s.reservoirQty,
      reservoirUnit: s.reservoirUnit,
      note: s.note
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

// Substitui todo o escopo previsto do projeto pelos conjuntos informados (já validados pela rota).
export async function setPlannedScope(projectId, { services = [], overtime = [] } = {}) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new Error('Projeto não encontrado.');

  // Resolve o rótulo do cargo a partir do jobRoleId (snapshot em roleName), para a HE não depender
  // de o cargo continuar existindo depois.
  const roleIds = [...new Set(overtime.map(o => o.jobRoleId).filter(Boolean))];
  const roles = roleIds.length
    ? await prisma.jobRole.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } })
    : [];
  const roleNameById = new Map(roles.map(r => [r.id, r.name]));

  await prisma.$transaction(async (tx) => {
    await tx.projectPlannedService.deleteMany({ where: { projectId } });
    await tx.projectPlannedOvertime.deleteMany({ where: { projectId } });

    if (services.length) {
      await tx.projectPlannedService.createMany({
        data: services.map((s, index) => ({
          projectId,
          serviceType: s.serviceType,
          tubingQty: num(s.tubingQty),
          tubingUnit: s.tubingUnit ?? null,
          oilLiters: num(s.oilLiters),
          reservoirQty: num(s.reservoirQty),
          reservoirUnit: s.reservoirUnit ?? null,
          note: s.note?.trim() || null,
          order: index
        }))
      });
    }

    if (overtime.length) {
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
