import { useQuery } from '@tanstack/react-query';

import { getGestorBootstrap, getNewReportBootstrap, getReportDetailBootstrap } from '../api/bootstrap';
import { useAuth } from '../auth/AuthContext';
import { queryKeys } from './queryKeys';

export function useNewReportBootstrap() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.newReportBootstrap(user?.id),
    queryFn: getNewReportBootstrap
  });
}

export function useReportDetailBootstrap(reportId: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.reportDetailBootstrap(reportId, user?.id),
    queryFn: () => getReportDetailBootstrap(reportId),
    enabled: enabled && !!reportId
  });
}

export function useGestorBootstrap() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.gestorBootstrap(user?.id),
    queryFn: getGestorBootstrap
  });
}
