import { useEffect, useState, type FormEvent } from 'react';

import type { ProjectOperationalMissionSummary, ProjectWorkflowSummary } from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
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
    <Modal open={open} onClose={onClose} closeOnEscape={!saving} ariaLabelledBy="project-legacy-completion-title" ariaDescribedBy="project-legacy-completion-description" panelClassName="modal-card efetivo-detail-modal efetivo-modal">
      <form className="efetivo-modal-layout" onSubmit={submit}>
        <header className="efetivo-modal-header"><div><h3 id="project-legacy-completion-title">Encerrar projeto antigo</h3><p id="project-legacy-completion-description">{project.code} · {project.name}</p></div><button className="icon-button" type="button" aria-label="Fechar" disabled={saving} onClick={onClose}>×</button></header>
        <div className="efetivo-modal-body">
          <div className="field-group"><label htmlFor="project-legacy-completion-return-date">Data de desmobilização</label><input id="project-legacy-completion-return-date" type="date" min={mission.executionEndDate.slice(0, 10)} value={returnDate} disabled={saving} onChange={event => setReturnDate(event.target.value)} /><span className="field-hint">Opcional. Preencha somente se a desmobilização já aconteceu; a data será sincronizada com o cronograma do Planejamento.</span></div>
        </div>
        <footer className="efetivo-modal-footer"><Button variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Encerrando…' : 'Encerrar projeto'}</Button></footer>
      </form>
    </Modal>
  );
}
