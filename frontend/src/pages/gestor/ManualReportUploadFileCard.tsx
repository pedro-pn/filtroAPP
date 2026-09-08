import {
  ManualReportOperationalFields,
  type ManualReportOperationalFieldsValue
} from '../../components/reports/ManualReportOperationalFields';
import type { Collaborator } from '../../types/domain';
import type { ManualReportCollaboratorReplicationPrompt } from './manualReportCollaboratorReplication';
import type { ManualReportUploadFileState } from './manualReportUploadFile';

interface ManualReportUploadFileCardProps {
  file: ManualReportUploadFileState;
  index: number;
  serviceReportSelected: boolean;
  showStandby: boolean;
  collaborators: Collaborator[];
  disabled: boolean;
  collaboratorPrompts: ManualReportCollaboratorReplicationPrompt[];
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<ManualReportUploadFileState>) => void;
  onOperationalChange: (
    file: ManualReportUploadFileState,
    patch: Partial<ManualReportOperationalFieldsValue>
  ) => void;
  onApplyPrompt: (prompt: ManualReportCollaboratorReplicationPrompt) => void;
  onDismissPrompt: (prompt: ManualReportCollaboratorReplicationPrompt) => void;
}

export function ManualReportUploadFileCard({
  file,
  index,
  serviceReportSelected,
  showStandby,
  collaborators,
  disabled,
  collaboratorPrompts,
  onRemove,
  onUpdate,
  onOperationalChange,
  onApplyPrompt,
  onDismissPrompt
}: ManualReportUploadFileCardProps) {
  const dateId = `manual-report-file-date-${file.id}`;
  const sequenceId = `manual-report-file-sequence-${file.id}`;
  const equipmentId = `manual-report-file-equipment-${file.id}`;
  const systemId = `manual-report-file-system-${file.id}`;

  return (
    <div className="manual-report-file-card">
      <div className="manual-report-file-header">
        <span className="manual-report-file-name">{index + 1}. {file.fileName}</span>
        <button
          className="mini-btn alt"
          type="button"
          disabled={disabled}
          onClick={() => onRemove(file.id)}
        >
          Remover
        </button>
      </div>
      <div className={`manual-report-file-fields ${serviceReportSelected ? 'with-service' : ''}`}>
        <div className="field-group">
          <label htmlFor={dateId}>Data</label>
          <input
            id={dateId}
            type="date"
            value={file.reportDate}
            onChange={event => onUpdate(file.id, { reportDate: event.target.value })}
            required
          />
        </div>
        <div className="field-group">
          <label htmlFor={sequenceId}>Número</label>
          <input
            id={sequenceId}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={file.sequenceNumber}
            onChange={event => onUpdate(file.id, { sequenceNumber: event.target.value.replace(/\D/g, '') })}
            placeholder="Automático"
          />
        </div>
        {serviceReportSelected ? (
          <>
            <div className="field-group">
              <label htmlFor={equipmentId}>Equipamento</label>
              <input
                id={equipmentId}
                value={file.serviceEquipment}
                onChange={event => onUpdate(file.id, { serviceEquipment: event.target.value })}
                placeholder="Equipamento do serviço"
              />
            </div>
            <div className="field-group">
              <label htmlFor={systemId}>Sistema</label>
              <input
                id={systemId}
                value={file.serviceSystem}
                onChange={event => onUpdate(file.id, { serviceSystem: event.target.value })}
                placeholder="Sistema do serviço"
              />
            </div>
          </>
        ) : null}
      </div>
      <ManualReportOperationalFields
        value={file}
        collaborators={collaborators}
        disabled={disabled}
        includeInactiveCollaborators
        showNightShift
        showStandby={showStandby}
        onChange={patch => onOperationalChange(file, patch)}
      />
      {collaboratorPrompts.map(prompt => {
        const names = prompt.collaboratorIds.map(id => (
          collaborators.find(collaborator => collaborator.id === id)?.name || id
        ));
        const team = prompt.field === 'collaboratorIds' ? 'equipe diurna' : 'equipe noturna';
        return (
          <div
            className="inline-success manual-report-collaborator-prompt"
            role="status"
            key={`${prompt.sourceFileId}-${prompt.field}`}
          >
            <span>{names.join(', ')}: replicar na {team} dos demais relatórios?</span>
            <div className="manual-report-collaborator-prompt-actions">
              <button
                className="mini-btn"
                type="button"
                disabled={disabled}
                onClick={() => onApplyPrompt(prompt)}
              >
                Aplicar nos demais?
              </button>
              <button
                className="mini-btn alt"
                type="button"
                disabled={disabled}
                onClick={() => onDismissPrompt(prompt)}
              >
                Agora não
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
