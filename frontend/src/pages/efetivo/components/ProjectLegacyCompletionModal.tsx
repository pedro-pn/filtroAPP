import { useEffect, useState, type FormEvent } from 'react';

import type { ProjectOperationalMissionSummary, ProjectWorkflowSummary } from '../../../api/projectWorkflow';
import { Button, Field, Input } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';

export function ProjectLegacyCompletionModal({ project, mission, open, saving, onClose, onConfirm }: {
  project: ProjectWorkflowSummary | null;
  mission: ProjectOperationalMissionSummary | null;
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onConfirm: (returnDate: string | null) => void;
}) {
  const [returnDate, setReturnDate] = useState('');
  useEffect(() => {
    if (open) setReturnDate(mission?.returnDate?.slice(0, 10) || '');
  }, [mission, open]);
  if (!project || !mission) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    onConfirm(returnDate || null);
  }

  return (
    <Modal open={open} onClose={onClose} closeOnEscape={!saving} appearance="design-system" title="Encerrar projeto antigo" size="sm" fullscreenOnMobile={false} panelClassName="efetivo-dialog" footer={<><Button variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="project-legacy-completion-form" loading={saving}>Encerrar projeto</Button></>}>
      <form id="project-legacy-completion-form" className="efetivo-dialog-form" onSubmit={submit}>
        <p className="efetivo-dialog-description">{project.code} · {project.name}</p>
        <Field id="project-legacy-completion-return-date" label="Data de desmobilização" helperText="Opcional. Preencha somente se a desmobilização já aconteceu; a data será sincronizada com o cronograma do Planejamento.">
          <Input type="date" min={mission.mobilizationDate.slice(0, 10)} value={returnDate} disabled={saving} onChange={event => setReturnDate(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
