import { useState, type FormEvent } from 'react';

import { PROJECT_WORKFLOW_LEGACY_SUMMARY_STAGES, projectWorkflowVisibleStages } from '../../../../../shared/schemas/project-workflow.js';
import type { ProjectWorkflow, ProjectWorkflowLegacySummaryConversionInput, ProjectWorkflowLegacySummaryStage } from '../../../api/projectWorkflow';
import { Button, Field, Select, Textarea } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';
import { WORKFLOW_STAGE_LABELS } from '../../../utils/projectWorkflow';

export function ProjectWorkflowAdminSummaryDialog({ workflow, projectLabel, saving, onClose, onConfirm }: {
  workflow: ProjectWorkflow;
  projectLabel: string;
  saving: boolean;
  onClose: () => void;
  onConfirm: (payload: ProjectWorkflowLegacySummaryConversionInput) => void;
}) {
  const stages = (PROJECT_WORKFLOW_LEGACY_SUMMARY_STAGES as readonly ProjectWorkflowLegacySummaryStage[])
    .filter(stage => projectWorkflowVisibleStages(workflow.executedAtHeadquarters === true).includes(stage));
  const [stage, setStage] = useState<ProjectWorkflowLegacySummaryStage | ''>(
    stages.includes(workflow.stage as ProjectWorkflowLegacySummaryStage) ? workflow.stage as ProjectWorkflowLegacySummaryStage : ''
  );
  const [reason, setReason] = useState('');
  if (!workflow.permissions.canConvertLegacySummary) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !stage || !reason.trim()) return;
    onConfirm({ version: workflow.version, stage, reason: reason.trim() });
  }

  return (
    <Modal open onClose={onClose} closeOnEscape={!saving} showCloseButton={!saving}
      appearance="design-system" title="Converter para fluxo resumido" size="sm" fullscreenOnMobile={false}
      panelClassName="efetivo-dialog" ariaDescribedBy="admin-summary-description"
      footer={<>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="project-admin-summary-form" loading={saving} disabled={saving || !stage || !reason.trim()}>Converter e mover</Button>
      </>}
    >
      <form id="project-admin-summary-form" className="efetivo-dialog-form" onSubmit={submit}>
        <p className="efetivo-dialog-description"><strong>{projectLabel}</strong></p>
        <p id="admin-summary-description" className="efetivo-dialog-description">
          O projeto será colocado diretamente na etapa escolhida, dispensando os bloqueios de avanço. As etapas anteriores serão tratadas como não aplicáveis no fluxo resumido. Os dados e o histórico serão preservados.
        </p>
        <Field id="admin-summary-stage" label="Etapa de destino" required>
          <Select value={stage} disabled={saving} onChange={event => setStage(event.target.value as ProjectWorkflowLegacySummaryStage | '')}>
            <option value="">Selecione</option>
            {stages.map(item => <option key={item} value={item}>{WORKFLOW_STAGE_LABELS[item]}</option>)}
          </Select>
        </Field>
        <Field id="admin-summary-reason" label="Motivo da conversão" required helperText="O motivo ficará registrado no histórico do projeto.">
          <Textarea value={reason} maxLength={1000} disabled={saving} onChange={event => setReason(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
