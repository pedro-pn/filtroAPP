import type { ReportSummary } from '../types/domain';
import type { RdoLastReportStatus } from '../utils/rdoPlanningPrefill';
import { useRdoPlanningPrefill } from './useRdoPlanningPrefill';
import { useReportWorkforcePlanning } from './useReportWorkforcePlanning';

export function useReportWorkforcePrefill({
  projectId,
  reportDate,
  collaboratorIds,
  effectiveServiceOnly,
  historicalLastReport,
  historyLoaded,
  setCollaborators
}: {
  projectId: string | null;
  reportDate: string;
  collaboratorIds: string[];
  effectiveServiceOnly: boolean;
  historicalLastReport: ReportSummary | null;
  historyLoaded: boolean;
  setCollaborators: (ids: string[]) => void;
}) {
  const workforce = useReportWorkforcePlanning({
    projectId,
    reportDate,
    collaboratorIds,
    enabled: !effectiveServiceOnly
  });
  const historyStatus: RdoLastReportStatus = historyLoaded
    ? (historicalLastReport ? 'FOUND' : 'EMPTY')
    : 'PENDING';
  const lastReportStatus: RdoLastReportStatus = (
    effectiveServiceOnly || workforce.lastReportPrefillStatus === 'ERROR'
  )
    ? historyStatus
    : workforce.lastReportPrefillStatus;
  const lastReportCollaboratorIds = workforce.lastReportPrefillStatus === 'FOUND'
    ? (workforce.lastReportPrefill?.collaboratorIds || [])
    : (historicalLastReport?.collaborators || []).map(link => link.collaboratorId).filter(Boolean);
  const prefill = useRdoPlanningPrefill({
    projectId,
    reportDate,
    currentCollaboratorIds: collaboratorIds,
    missionCollaboratorIds: workforce.planningContext?.collaborators.map(item => item.id) || [],
    lastReportCollaboratorIds,
    lastReportStatus,
    setCollaborators
  });

  return {
    planningContext: workforce.planningContext,
    absenceConflicts: workforce.absenceConflicts,
    serverHoliday: workforce.serverHoliday,
    collaboratorPrefillSource: prefill.source,
    missionSuggestionCollaboratorIds: prefill.missionSuggestionCollaboratorIds,
    canApplyMissionSuggestion: prefill.canApplyMissionSuggestion,
    markCollaboratorsTouched: prefill.markTouched,
    applyMissionSuggestion: prefill.applyMissionSuggestion,
    dismissMissionSuggestion: prefill.dismissMissionSuggestion
  };
}
