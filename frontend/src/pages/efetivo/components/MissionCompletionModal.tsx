import { useEffect, useState, type FormEvent } from 'react';

import type { PlanningMission } from '../../../api/efetivoPlanning';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';

export function MissionCompletionModal({ mission, open, saving, onClose, onConfirm }: {
  mission: PlanningMission | null;
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onConfirm: (returnDate: string | null) => void;
}) {
  const [returnDate, setReturnDate] = useState('');
  useEffect(() => {
    if (open) setReturnDate(mission?.returnDate?.slice(0, 10) || mission?.project.demobilizationDate?.slice(0, 10) || '');
  }, [mission, open]);
  if (!mission) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    onConfirm(returnDate || null);
  }

  return (
    <Modal open={open} onClose={onClose} closeOnEscape={!saving} ariaLabelledBy="mission-completion-title" ariaDescribedBy="mission-completion-description" panelClassName="modal-card efetivo-detail-modal efetivo-modal">
      <form className="efetivo-modal-layout" onSubmit={submit}>
        <header className="efetivo-modal-header"><div><h3 id="mission-completion-title">Concluir missão</h3><p id="mission-completion-description">{mission.project.code} · {mission.project.name}</p></div><button className="icon-button" type="button" aria-label="Fechar" disabled={saving} onClick={onClose}>×</button></header>
        <div className="efetivo-modal-body">
          <div className="field-group"><label htmlFor="mission-completion-return-date">Data de desmobilização</label><input id="mission-completion-return-date" type="date" min={mission.executionEndDate.slice(0, 10)} value={returnDate} disabled={saving} onChange={event => setReturnDate(event.target.value)} /><span className="field-hint">Opcional. Preencha somente se a desmobilização já aconteceu; a data será sincronizada com o cronograma do Planejamento.</span></div>
        </div>
        <footer className="efetivo-modal-footer"><Button variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Concluindo…' : 'Concluir missão'}</Button></footer>
      </form>
    </Modal>
  );
}
