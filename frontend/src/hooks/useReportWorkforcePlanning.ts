import { useQuery } from '@tanstack/react-query';

import {
  checkReportWorkforceAvailability,
  getReportCollaboratorPrefill,
  getReportPlanningContext
} from '../api/reports';

export function useReportWorkforceAvailability({
  reportDate,
  collaboratorIds,
  enabled
}: {
  reportDate: string;
  collaboratorIds: string[];
  enabled: boolean;
}) {
  return useQuery({
    queryKey: [
      'workforce',
      'report-availability',
      reportDate,
      [...collaboratorIds].sort().join(',')
    ],
    queryFn: () =>
      checkReportWorkforceAvailability(collaboratorIds, reportDate),
    enabled: Boolean(enabled && reportDate && collaboratorIds.length),
    staleTime: 15_000
  });
}

export function useReportWorkforcePlanning({
  projectId,
  reportDate,
  collaboratorIds,
  enabled
}: {
  projectId: string | null;
  reportDate: string;
  collaboratorIds: string[];
  enabled: boolean;
}) {
  const planning = useQuery({
    queryKey: ['reports', 'planning-context', projectId, reportDate],
    queryFn: () => getReportPlanningContext(projectId!, reportDate),
    enabled: Boolean(enabled && projectId && reportDate),
    staleTime: 30_000
  });
  const lastReportPrefill = useQuery({
    queryKey: ['reports', 'collaborator-prefill', projectId, reportDate],
    queryFn: () => getReportCollaboratorPrefill(projectId!, reportDate),
    enabled: Boolean(enabled && projectId && reportDate),
    staleTime: 30_000
  });
  const availability = useReportWorkforceAvailability({
    reportDate,
    collaboratorIds,
    enabled
  });
  const workforceConflicts = availability.data?.conflicts || [];
  return {
    planningContext: planning.data || null,
    lastReportPrefill: lastReportPrefill.data || null,
    lastReportPrefillStatus: lastReportPrefill.isSuccess
      ? lastReportPrefill.data
        ? ('FOUND' as const)
        : ('EMPTY' as const)
      : lastReportPrefill.isError
        ? ('ERROR' as const)
        : ('PENDING' as const),
    absenceConflicts: workforceConflicts.filter(
      (conflict) => conflict.policy === 'REQUIRE_JUSTIFICATION'
    ),
    serverHoliday: Boolean(
      availability.data?.holidays?.some(
        (holiday) => holiday.date === reportDate
      )
    )
  };
}
