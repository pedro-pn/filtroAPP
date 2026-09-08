import { useCallback, useEffect, useRef, useState } from 'react';

import {
  addRdoMissionSuggestions,
  resolveRdoCollaboratorPrefill,
  resolveRdoMissionSuggestion,
  type RdoLastReportStatus
} from '../utils/rdoPlanningPrefill';

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every(id => right.includes(id));
}

export function useRdoPlanningPrefill({
  projectId,
  reportDate,
  currentCollaboratorIds,
  missionCollaboratorIds,
  lastReportCollaboratorIds,
  lastReportStatus,
  setCollaborators
}: {
  projectId: string | null;
  reportDate: string;
  currentCollaboratorIds: string[];
  missionCollaboratorIds: string[];
  lastReportCollaboratorIds: string[];
  lastReportStatus: RdoLastReportStatus;
  setCollaborators: (ids: string[]) => void;
}) {
  const touched = useRef(false);
  const automaticIds = useRef<string[]>([]);
  const selectionKey = `${projectId || ''}:${reportDate}`;
  const previousSelectionKey = useRef(selectionKey);
  const [source, setSource] = useState<'LAST_REPORT' | null>(null);
  const [dismissedMissionKey, setDismissedMissionKey] = useState('');
  const missionKey = missionCollaboratorIds.join(',');
  const lastReportKey = lastReportCollaboratorIds.join(',');
  const missionSuggestionKey = `${selectionKey}:${missionKey}`;

  useEffect(() => {
    const currentCollaboratorsWereAutomatic = sameIds(currentCollaboratorIds, automaticIds.current);
    if (previousSelectionKey.current !== selectionKey) {
      previousSelectionKey.current = selectionKey;
      touched.current = false;
      automaticIds.current = [];
      setSource(null);
    }
    if (!projectId || !reportDate || touched.current) return;
    const result = resolveRdoCollaboratorPrefill({
      currentCollaboratorIds: currentCollaboratorsWereAutomatic ? [] : currentCollaboratorIds,
      touched: false,
      lastReportStatus,
      lastReportCollaboratorIds: lastReportKey ? lastReportKey.split(',') : []
    });
    if (!['LAST_REPORT', 'EMPTY'].includes(result.source)) return;
    if (!sameIds(result.collaboratorIds, currentCollaboratorIds)) setCollaborators(result.collaboratorIds);
    automaticIds.current = result.collaboratorIds;
    setSource(result.source === 'LAST_REPORT' ? 'LAST_REPORT' : null);
  }, [projectId, reportDate, selectionKey, currentCollaboratorIds, lastReportKey, lastReportStatus, setCollaborators]);

  const teamSelectionSettled = touched.current || currentCollaboratorIds.length > 0 || !lastReportKey;
  const missionSuggestionCollaboratorIds = dismissedMissionKey === missionSuggestionKey
    ? []
    : resolveRdoMissionSuggestion({
      currentCollaboratorIds,
      missionCollaboratorIds: missionKey ? missionKey.split(',') : []
    });
  const canApplyMissionSuggestion = lastReportStatus !== 'PENDING' && teamSelectionSettled;

  const markTouched = useCallback(() => {
    touched.current = true;
    automaticIds.current = [];
    setSource(null);
  }, []);

  const applyMissionSuggestion = useCallback(() => {
    if (!canApplyMissionSuggestion || !missionSuggestionCollaboratorIds.length) return;
    const ids = addRdoMissionSuggestions(currentCollaboratorIds, missionSuggestionCollaboratorIds);
    touched.current = true;
    automaticIds.current = [];
    setCollaborators(ids);
    setSource(null);
    setDismissedMissionKey(missionSuggestionKey);
  }, [canApplyMissionSuggestion, currentCollaboratorIds, missionSuggestionCollaboratorIds, missionSuggestionKey, setCollaborators]);

  const dismissMissionSuggestion = useCallback(() => {
    setDismissedMissionKey(missionSuggestionKey);
  }, [missionSuggestionKey]);

  return {
    source,
    missionSuggestionCollaboratorIds,
    canApplyMissionSuggestion,
    markTouched,
    applyMissionSuggestion,
    dismissMissionSuggestion
  };
}
