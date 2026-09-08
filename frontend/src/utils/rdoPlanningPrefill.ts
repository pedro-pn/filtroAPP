import { z } from 'zod';

export const rdoWorkforceJustificationSchema = z.object({
  requiresJustification: z.boolean(),
  workforceJustification: z.string().trim().max(2000, 'Use até 2.000 caracteres.')
}).superRefine((value, context) => {
  if (value.requiresJustification && !value.workforceJustification) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workforceJustification'],
      message: 'Justifique o trabalho registrado durante o afastamento.'
    });
  }
});

export interface RdoPlanningPrefillInput {
  currentCollaboratorIds: string[];
  touched: boolean;
  lastReportStatus: RdoLastReportStatus;
  lastReportCollaboratorIds?: string[];
}

export type RdoLastReportStatus = 'PENDING' | 'FOUND' | 'EMPTY';

export function resolveRdoCollaboratorPrefill(input: RdoPlanningPrefillInput) {
  if (input.touched) return { collaboratorIds: input.currentCollaboratorIds, source: 'TOUCHED' as const };
  if (input.currentCollaboratorIds.length) return { collaboratorIds: input.currentCollaboratorIds, source: 'CURRENT' as const };
  if (input.lastReportStatus === 'PENDING') {
    return { collaboratorIds: [], source: 'WAITING' as const };
  }
  if (input.lastReportStatus === 'FOUND') {
    const collaboratorIds = [...new Set(input.lastReportCollaboratorIds || [])];
    return {
      collaboratorIds,
      source: collaboratorIds.length ? 'LAST_REPORT' as const : 'EMPTY' as const
    };
  }
  return { collaboratorIds: [], source: 'EMPTY' as const };
}

export function resolveRdoMissionSuggestion(input: {
  currentCollaboratorIds: string[];
  missionCollaboratorIds: string[];
}) {
  const currentCollaboratorIds = new Set(input.currentCollaboratorIds);
  return [...new Set(input.missionCollaboratorIds)]
    .filter(collaboratorId => !currentCollaboratorIds.has(collaboratorId));
}

export function addRdoMissionSuggestions(
  currentCollaboratorIds: string[],
  suggestedCollaboratorIds: string[]
) {
  return [...new Set([...currentCollaboratorIds, ...suggestedCollaboratorIds])];
}
