import { useQuery } from '@tanstack/react-query';

import { getProjectStats, type ProjectStatsParams } from '../api/statistics';
import { useAuth } from '../auth/AuthContext';
import { queryKeys } from './queryKeys';

export function useProjectStats(params: ProjectStatsParams) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.projectStats(params, user?.id),
    queryFn: () => getProjectStats(params),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(params.from && params.to)
  });
}
