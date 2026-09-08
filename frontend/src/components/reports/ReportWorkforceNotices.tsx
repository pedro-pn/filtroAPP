import type { OfficialMissionContext } from '../../api/reports';

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
        {prefilledFromLastReport ? <span className="pre-badge">último RDO</span> : null}
      </div>
      {planningContext?.needsReplanning ? (
        <div className="form-hint" role="status">
          A missão oficial está marcada para replanejamento{planningContext.replanningReason ? `: ${planningContext.replanningReason}` : '.'}
        </div>
      ) : null}
      {suggestedCollaborators.length ? (
        <div className="rdo-mission-team-suggestion" role="status">
          <strong>Colaboradores sugeridos pelo efetivo</strong>
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
          <div className="rdo-mission-team-suggestion-actions">
            <button className="mini-btn" type="button" disabled={!canApplyMissionSuggestion} onClick={onApplyMissionSuggestion}>
              Adicionar sugeridos
            </button>
            <button className="mini-btn alt" type="button" onClick={onDismissMissionSuggestion}>
              Manter equipe atual
            </button>
          </div>
        </div>
      ) : null}
      {absenceConflictCount ? (
        <div className={`field-group ${invalid ? 'field-invalid' : ''}`} data-invalid-target="header:workforceJustification" style={{ marginTop: 12 }}>
          <label htmlFor="rdo-workforce-justification">
            Justificativa de trabalho durante afastamento <span style={{ color: 'var(--rd)' }}>*</span>
          </label>
          <div className="form-hint" role="alert">
            {absenceConflictCount} conflito(s) de afastamento detectado(s). O registro real será preservado com esta justificativa.
          </div>
          <textarea
            id="rdo-workforce-justification"
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
