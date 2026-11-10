import { createHash, randomUUID } from 'node:crypto';
import { seedLaborPerformanceFixture } from './labor-performance.js';

export async function seedHttpPerformanceFixture(database, { reportCount = 1200, scopeCount = 297 } = {}) {
  const labor = await seedLaborPerformanceFixture(database, { reportCount, servicesPerRdo: 4 });
  const { prefix, projectId } = labor;
  const projectIds = [projectId, prefix + '-secondary', prefix + '-hidden'];
  const userIds = ['admin', 'viewer', 'blocked'].map(profile => prefix + '-' + profile);
  const proposalIds = [];
  const groupId = prefix + '-group';
  const cleanup = async () => {
    await database.acompanhamentoMissionGroup.deleteMany({ where: { id: groupId } });
    await database.project.deleteMany({ where: { id: { in: projectIds.slice(1) } } });
    await labor.cleanup();
    await database.commercialProposal.deleteMany({ where: { id: { in: proposalIds } } });
    await database.user.deleteMany({ where: { id: { in: userIds } } });
  };
  try {
    const code = 100000000 + Math.floor(Math.random() * 800000000);
    for (let index = 0; index < 3; index++) {
      const proposal = await database.commercialProposal.create({ data: {
        codBd: code + index, codProp: code + index, salePrice: 100000, plannedCost: 60000,
        taxes: 10000, rawRow: {}, isComplete: true
      } });
      proposalIds.push(proposal.id);
      const metadata = { contractCode: String(code + index), commercialProposalCode: String(code + index),
        startDate: new Date('2026-09-01'), workdayHours: '08:48', managerOnly: index === 2,
        ...(index === 2 ? { distributionSettings: { acompanhamento: true } } : {}) };
      if (!index) await database.project.update({ where: { id: projectId }, data: metadata });
      else await database.project.create({ data: { id: projectIds[index], code: prefix + '-' + index,
        name: 'Projeto sintético', clientName: 'Cliente sintético', clientCnpj: '', location: 'Local', ...metadata } });
      await database.projectBudget.create({ data: { projectId: projectIds[index], sourceProposalCodBd: code + index,
        salePrice: 100000, plannedTotalCost: 60000, taxes: 10000, isComplete: true } });
    }
    for (let index = 0; index < scopeCount; index++) {
      await database.projectPlannedService.create({ data: { projectId, serviceType: 'TESTE_PRESSAO',
        scopeName: 'Escopo ' + index, weight: 1,
        systems: { create: { systemType: 'TUBULACAO', unit: 'M', quantity: 100 } } } });
    }
    await database.project.update({ where: { id: projectId }, data: {
      trackingDivisions: Array.from({ length: 11 }, (_, index) => ({ key: JSON.stringify(['DATE', 'period-' + index, null]),
        label: 'Período ' + index, startDate: '2026-09-' + String(index * 2 + 1).padStart(2, '0'),
        endDate: '2026-09-' + String(index * 2 + 2).padStart(2, '0'), mobilizationDate: '2026-09-01' }))
    } });
    const service = await database.reportService.findFirst({ where: { reportId: prefix + '-rdo-0' } });
    await database.reportService.update({ where: { id: service.id }, data: {
      finalized: true, extraData: { __scopeName: 'Escopo 0', tubes: [{ c: 300, lengthUnit: 'm' }] }
    } });
    await database.acompanhamentoMissionGroup.create({ data: { id: groupId, name: 'Grupo sintético',
      members: { create: projectIds.slice(0, 2).map((id, order) => ({ projectId: id, activeProjectId: id, order })) } } });
    const sessions = {};
    for (const [index, profile] of ['admin', 'viewer', 'blocked'].entries()) {
      await database.user.create({ data: { id: userIds[index], username: userIds[index], name: 'Pessoa sintética',
        passwordHash: 'synthetic-unused-login', accountType: profile === 'admin' ? 'ADMIN' : 'INTERNAL',
        role: profile === 'admin' ? 'MANAGER' : 'COLLABORATOR',
        ...(profile === 'viewer' ? { moduleRoles: { create: { module: 'ACOMPANHAMENTO', role: 'ACOMPANHAMENTO_VIEWER' } } } : {}) } });
      sessions[profile] = [];
      for (let session = 0; session < (profile === 'blocked' ? 1 : 2); session++) {
        const token = randomUUID();
        await database.userSession.create({ data: { userId: userIds[index],
          tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
        sessions[profile].push(token);
      }
    }
    return { ...labor, projectIds, groupId, sessions, scopeCount, cleanup,
      async workerWrite() {
        const projectBefore = await database.project.findUnique({ where: { id: projectId } });
        await database.reportService.update({ where: { id: service.id }, data: {
          extraData: { __scopeName: 'Escopo 0', tubes: [{ c: 600, lengthUnit: 'm' }] }
        } });
        const period = await database.pontoPeriodSummary.findFirst({ where: { importId: labor.importId, collaboratorId: prefix + '-person-0' } });
        const monthly = structuredClone(period.monthly);
        monthly['2026-09'].normalMinutes += 60;
        monthly['2026-09'].days[0].workedMinutes += 60;
        await database.pontoPeriodSummary.update({ where: { id: period.id }, data: { monthly, workedMinutes: period.workedMinutes + 60 } });
        await database.pontoPeriodSummary.create({ data: { importId: labor.importId,
          rawName: 'Pessoa sintética sem vínculo', normalizedName: 'pessoa sintetica sem vinculo',
          periodStart: period.periodStart, periodEnd: period.periodEnd, workedMinutes: 0 } });
        const projectAfter = await database.project.findUnique({ where: { id: projectId } });
        return { projectTimestampUnchanged: projectBefore.updatedAt.getTime() === projectAfter.updatedAt.getTime() };
      }
    };
  } catch (error) { await cleanup(); throw error; }
}
