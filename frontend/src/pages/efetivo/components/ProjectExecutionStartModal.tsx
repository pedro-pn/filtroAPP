import { useEffect, useState, type FormEvent } from 'react';

import type { ProjectWorkflowProject } from '../../../api/projectWorkflow';
import { Alert, Button, Field, Input } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { projectExecutionStartSuggestion } from '../../../utils/projectExecutionStart';

export function ProjectExecutionStartModal({ project, plannedStartDate, executedAtHeadquarters, saving, onClose, onConfirm }: {
  project: ProjectWorkflowProject;
  plannedStartDate: string | null;
  executedAtHeadquarters: boolean;
  saving: boolean;
  onClose: () => void;
  onConfirm: (startDate: string) => void;
}) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const { suggestedStartDate: suggested, futureDate } = projectExecutionStartSuggestion(project, plannedStartDate, today);
  const minDate = executedAtHeadquarters ? undefined : project.mobilizationDate?.slice(0, 10);
  const [startDate, setStartDate] = useState(suggested);
  useEffect(() => setStartDate(suggested), [project.id, suggested]);
  const dateError = startDate > today
    ? 'O início real não pode estar no futuro. Informe a data em que a execução realmente começou.'
    : startDate && minDate && startDate < minDate
      ? 'O início real não pode ser anterior à mobilização efetiva.'
      : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (startDate && !dateError && !saving) onConfirm(startDate);
  }

  return (
    <Modal open onClose={onClose} closeOnEscape={!saving} appearance="design-system" title="Confirmar início da execução" size="sm" fullscreenOnMobile={false} panelClassName="efetivo-dialog" footer={<><Button variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="project-execution-start-form" loading={saving} disabled={!startDate || Boolean(dateError)}>Confirmar e iniciar execução</Button></>}>
      <form id="project-execution-start-form" className="efetivo-dialog-form" onSubmit={submit}>
        <p className="efetivo-dialog-description">{project.code} · {project.name}</p>
        {futureDate ? <Alert tone="info" title={`Início previsto para ${displayDateOnly(futureDate)}`}>
          Essa data ainda está no futuro. Informe quando a execução realmente começou. Se os serviços ainda não começaram, cancele a movimentação.
        </Alert> : null}
        <Field id="project-execution-start-date" label="Início real da execução" required errorText={dateError} helperText="Confirme ou corrija a data em que os serviços começaram. Ela será registrada no cronograma do Acompanhamento.">
          <Input type="date" required min={minDate} max={today} value={startDate} disabled={saving} onChange={event => setStartDate(event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
