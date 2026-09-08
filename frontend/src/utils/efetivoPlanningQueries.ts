import type { QueryClient } from '@tanstack/react-query';

type PlanningQueryClient = Pick<QueryClient, 'invalidateQueries'>;
type PlanningMutationListener = () => void | Promise<void>;

const MISSION_QUERY_KEYS = [
  ['efetivo-planning-missions'],
  ['efetivo-planning-missions-pending'],
  ['efetivo-planning-overview'],
  ['efetivo-planning-calendar']
] as const;

export async function refreshMissionPlanningQueries(
  queryClient: PlanningQueryClient,
  onPlanningMutated?: PlanningMutationListener
) {
  await Promise.all(
    MISSION_QUERY_KEYS.map(queryKey => queryClient.invalidateQueries({ queryKey }))
  );
  await onPlanningMutated?.();
}
