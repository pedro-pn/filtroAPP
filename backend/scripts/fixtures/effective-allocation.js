// Synthetic companion to the labor/HTTP fixture. The caller owns this setup
// and must clean it up before deleting the parent projects/collaborators.
export async function seedEffectiveAllocationFixture(database, fixture) {
  const prefix = fixture.prefix + '-effective';
  const extraProjects = ['unallocated', 'draft', 'deleted'].map(name => prefix + '-' + name);
  const planIds = ['official', 'scenario', 'inactive'].map(name => prefix + '-' + name);
  const userId = prefix + '-responsible';
  const cleanup = async () => {
    await database.efetivoPlan.deleteMany({ where: { id: { in: planIds } } });
    await database.project.deleteMany({ where: { id: { in: extraProjects } } });
    await database.user.deleteMany({ where: { id: userId } });
  };
  const date = day => new Date(Date.UTC(2026, 8, day));
  try {
    await database.user.create({ data: { id: userId, username: userId, name: 'Responsável sintético', role: 'MANAGER', accountType: 'INTERNAL', passwordHash: 'synthetic-unused-login' } });
    await database.project.createMany({ data: extraProjects.map(id => ({ id, code: id, name: 'Projeto sintético', clientName: 'Cliente sintético',
      clientCnpj: '', contractCode: id, location: 'Local', mobilizationDate: date(1), demobilizationDate: date(30) })) });
    await database.efetivoPlan.createMany({ data: [
      { id: planIds[0], kind: 'OFFICIAL', status: 'ACTIVE', name: 'Oficial sintético' },
      { id: planIds[1], kind: 'SCENARIO', status: 'DRAFT', name: 'Cenário sintético' },
      { id: planIds[2], kind: 'OFFICIAL', status: 'SUPERSEDED', name: 'Anterior sintético' }
    ] });
    const missionIds = ['allocated', 'unallocated', 'draft', 'deleted', 'scenario', 'inactive'].map(name => prefix + '-' + name + '-mission');
    await database.efetivoMissionPlan.createMany({ data: missionIds.map((id, index) => ({
      id, planId: index < 4 ? planIds[0] : planIds[index - 3], projectId: index === 0 || index >= 4 ? fixture.projectId : extraProjects[index - 1],
      scheduleStatus: index === 2 ? 'DRAFT' : 'CONFIRMED', deletedAt: index === 3 ? date(1) : null,
      headquartersResponsibleUserId: userId, headquartersResponsibleName: 'Responsável sintético', headquartersResponsibleRole: 'Gestor',
      mobilizationDate: date(1), executionStartDate: date(1), executionEndDate: date(28), returnDate: date(30)
    })) });
    const allocationIds = Array.from({ length: 8 }, (_, index) => prefix + '-allocation-' + index);
    await database.efetivoMissionAllocation.createMany({ data: allocationIds.map((id, index) => ({
      id, missionId: missionIds[index < 4 ? 0 : index - 2], collaboratorId: fixture.prefix + '-person-' + index,
      jobRoleId: fixture.prefix + '-role', jobRoleNameSnapshot: 'Cargo sintético', deletedAt: index === 3 ? date(1) : null,
      ...(index === 2 ? { mobilizationDate: date(12), demobilizationDate: date(16) } : {})
    })) });
    await database.efetivoMissionCycle.createMany({ data: [
      { id: prefix + '-general-1', missionId: missionIds[0], mobilizationDate: date(1), demobilizationDate: date(10) },
      { id: prefix + '-general-2', missionId: missionIds[0], mobilizationDate: date(20), demobilizationDate: null }
    ] });
    await database.efetivoAllocationCycle.createMany({ data: [
      { id: prefix + '-individual-1', allocationId: allocationIds[0], mobilizationDate: date(2), demobilizationDate: date(4) },
      { id: prefix + '-individual-2', allocationId: allocationIds[0], mobilizationDate: date(24), demobilizationDate: null }
    ] });
    return { prefix, projectIds: extraProjects, planIds, missionIds, allocationIds, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
