import type { OfficialMissionContext } from '../../api/reports';
import { Alert, Badge, Button, Textarea } from '../ui/ds';

export function ReportWorkforceNotices({
  planningContext,
  prefilledFromLastReport,
  missionSuggestionCollaboratorIds,
  canApplyMissionSuggestion,
  absenceConflictCount,
  workforceJustification,
  invalid,
  onApplyMissionSuggestion,
  onDismissMissionSuggestion,
  onJustificationChange
}: {
  planningContext: OfficialMissionContext | null;
  prefilledFromLastReport: boolean;
  missionSuggestionCollaboratorIds: string[];
  canApplyMissionSuggestion: boolean;
  absenceConflictCount: number;
  workforceJustification: string;
  invalid: boolean;
  onApplyMissionSuggestion: () => void;
  onDismissMissionSuggestion: () => void;
  onJustificationChange: (value: string) => void;
}) {
  const suggestedCollaborators = (planningContext?.collaborators || [])
    .filter(collaborator => missionSuggestionCollaboratorIds.includes(collaborator.id));

  return (
    <>
      <div className="section-title">
        Equipe diurna
        {prefilledFromLastReport ? <Badge tone="info">último RDO</Badge> : null}
      </div>
      {planningContext?.needsReplanning ? (
        <Alert className="rdo-workforce-alert" tone="warning">
          A missão oficial está marcada para replanejamento{planningContext.replanningReason ? `: ${planningContext.replanningReason}` : '.'}
        </Alert>
      ) : null}
      {suggestedCollaborators.length ? (
        <Alert
          className="rdo-workforce-alert"
          tone="info"
          title="Colaboradores sugeridos pelo efetivo"
          action={
            <div className="rdo-mission-team-suggestion-actions">
              <Button variant="primary" size="sm" disabled={!canApplyMissionSuggestion} onClick={onApplyMissionSuggestion}>
                Adicionar sugeridos
              </Button>
              <Button variant="secondary" size="sm" onClick={onDismissMissionSuggestion}>
                Manter equipe atual
              </Button>
            </div>
          }
        >
          <ul className="rdo-mission-team-suggestion-list" aria-label="Colaboradores sugeridos">
            {suggestedCollaborators.map(collaborator => (
              <li key={collaborator.id}>
                <span className="rdo-mission-team-suggestion-marker" aria-hidden="true">✓</span>
                <strong>{collaborator.name}</strong>
              </li>
            ))}
          </ul>
          <small>
            {canApplyMissionSuggestion
              ? 'A equipe atual foi mantida. Estes colaboradores só serão adicionados se você aceitar.'
              : 'Consultando a equipe do último RDO. A sugestão não será aplicada automaticamente.'}
          </small>
        </Alert>
      ) : null}
      {absenceConflictCount ? (
        <div className={`field-group ${invalid ? 'field-invalid' : ''}`} data-invalid-target="header:workforceJustification" style={{ marginTop: 12, marginBottom: 20 }}>
          <label htmlFor="rdo-workforce-justification">
            Justificativa de trabalho durante afastamento <span style={{ color: 'var(--rd)' }}>*</span>
          </label>
          <Alert className="rdo-workforce-alert" tone="warning">
            {absenceConflictCount} conflito(s) de afastamento detectado(s). O registro real será preservado com esta justificativa.
          </Alert>
          <Textarea
            id="rdo-workforce-justification"
            invalid={invalid}
            value={workforceJustification}
            onChange={event => onJustificationChange(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Explique por que houve trabalho durante o afastamento registrado."
          />
        </div>
      ) : null}
    </>
  );
}
