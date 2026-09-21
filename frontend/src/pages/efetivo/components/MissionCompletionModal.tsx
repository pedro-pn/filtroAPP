import { useEffect, useState, type FormEvent } from 'react';

import type { PlanningMission } from '../../../api/efetivoPlanning';
import { Button, Field, Input } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';
import '../EfetivoDialogs.css';

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
    <Modal
      open={open}
      onClose={onClose}
      closeOnEscape={!saving}
      showCloseButton={!saving}
      appearance="design-system"
      title="Concluir missão"
      size="sm"
      fullscreenOnMobile={false}
      ariaDescribedBy="mission-completion-description"
      panelClassName="efetivo-dialog"
      footer={<>
        <Button variant="secondary" size="sm" disabled={saving} onClick={onClose}>Cancelar</Button>
        <Button variant="primary" size="sm" type="submit" form="mission-completion-form" loading={saving} loadingLabel="Concluindo missão">Concluir missão</Button>
      </>}
    >
      <form id="mission-completion-form" className="efetivo-dialog-form" onSubmit={submit}>
        <p className="efetivo-dialog-description" id="mission-completion-description">{mission.project.code} · {mission.project.name}</p>
        <Field id="mission-completion-return-date" label="Data de desmobilização" optionalText="" helperText="Opcional. Preencha somente se a desmobilização já aconteceu; a data será sincronizada com o cronograma do Planejamento.">
          <Input size="sm" type="date" min={mission.executionEndDate.slice(0, 10)} value={returnDate} disabled={saving} onChange={event => setReturnDate(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
