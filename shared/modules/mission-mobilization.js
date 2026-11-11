const PRE_MOBILIZATION_STAGES = new Set([
  'HANDOVER', 'INITIAL_ANALYSIS', 'WAITING_PLANNING', 'MOBILIZATION_PLANNING', 'PREPARATION'
]);

export function missionAwaitsMobilization(mission) {
  if (mission.stage === 'STANDBY') return true;
  // Scenarios keep their own simulated stages, independently of the live project.
  if (mission.plan?.kind === 'SCENARIO') return false;
  const workflow = mission.project?.workflow;
  if (!workflow) return false;
  // Later stages also preserve legacy projects that predate the actual-date field.
  return PRE_MOBILIZATION_STAGES.has(workflow.stage)
    || (workflow.stage === 'MOBILIZATION' && !workflow.actualMobilizationDate);
}
