// The same official/active/confirmed predicate applies to both allocation reads
// and projects that must be excluded from legacy schedule-window fallback.
export const officialMissionWhere = Object.freeze({
  deletedAt: null, scheduleStatus: 'CONFIRMED', plan: { kind: 'OFFICIAL', status: 'ACTIVE' }
});

function cyclesByParent(rows, parentKey) {
  const result = new Map();
  for (const { [parentKey]: parentId, ...cycle } of rows) {
    if (!result.has(parentId)) result.set(parentId, []);
    result.get(parentId).push(cycle);
  }
  return result;
}

// Request-owned sources. Read missions once for both their allocation metadata
// and the full exclusion set, including confirmed missions with no allocations.
// Explicit child reads avoid Prisma's empty nested-relation SELECTs. Keep all
// cycle dates/IDs and actual plan state; allocationPeriods still decides precedence.
export async function loadOfficialAllocationSources(database) {
  const [allocations, missions] = await Promise.all([
    database.efetivoMissionAllocation.findMany({
      where: { deletedAt: null, mission: officialMissionWhere },
      select: {
        id: true, missionId: true, collaboratorId: true, deletedAt: true,
        mobilizationDate: true, demobilizationDate: true
      }
    }),
    database.efetivoMissionPlan.findMany({
      where: officialMissionWhere,
      select: {
        id: true, planId: true, projectId: true, scheduleStatus: true, deletedAt: true,
        mobilizationDate: true, executionEndDate: true, returnDate: true
      }
    })
  ]);
  const allocatedMissionIds = new Set(allocations.map(row => row.missionId));
  const allocatedMissions = missions.filter(row => allocatedMissionIds.has(row.id));
  const missionIds = allocatedMissions.map(row => row.id);
  const planIds = [...new Set(allocatedMissions.map(row => row.planId))];
  const [allocationCycles, missionCycles, plans] = await Promise.all([
    allocations.length ? database.efetivoAllocationCycle.findMany({
      where: { allocationId: { in: allocations.map(row => row.id) } },
      select: { id: true, allocationId: true, mobilizationDate: true, demobilizationDate: true }
    }) : [],
    missionIds.length ? database.efetivoMissionCycle.findMany({
      where: { missionId: { in: missionIds } },
      select: { id: true, missionId: true, mobilizationDate: true, demobilizationDate: true }
    }) : [],
    planIds.length ? database.efetivoPlan.findMany({
      where: { id: { in: planIds } }, select: { id: true, kind: true, status: true }
    }) : []
  ]);
  const cyclesByAllocation = cyclesByParent(allocationCycles, 'allocationId');
  const cyclesByMission = cyclesByParent(missionCycles, 'missionId');
  const plansById = new Map(plans.map(({ id, ...plan }) => [id, plan]));
  // A plan removed between reads cannot become an allocation with unknown
  // eligibility. The next request re-reads the complete official predicate.
  const missionsById = new Map(allocatedMissions.filter(mission => plansById.has(mission.planId))
    .map(({ planId, ...mission }) => [mission.id, {
      ...mission, cycles: cyclesByMission.get(mission.id) || [], plan: plansById.get(planId)
    }]));
  return {
    allocations: allocations.map(({ missionId, ...allocation }) => ({
      ...allocation, cycles: cyclesByAllocation.get(allocation.id) || [], mission: missionsById.get(missionId) ?? null
    })),
    missionProjectIds: new Set(missions.map(mission => mission.projectId))
  };
}
