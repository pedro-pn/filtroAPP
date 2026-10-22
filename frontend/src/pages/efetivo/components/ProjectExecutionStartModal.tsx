import { useEffect, useState, type FormEvent } from 'react';

import type { ProjectWorkflowProject } from '../../../api/projectWorkflow';
import { Alert, Button, Field, Input, Select } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { projectExecutionStartSuggestion, projectReportOperatorOptions } from '../../../utils/projectExecutionStart';

export function ProjectExecutionStartModal({ project, plannedStartDate, executedAtHeadquarters, saving, onClose, onConfirm }: {
  project: ProjectWorkflowProject;
  plannedStartDate: string | null;
  executedAtHeadquarters: boolean;
  saving: boolean;
  onClose: () => void;
  onConfirm: (startDate: string, operatorId?: string) => void;
}) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const { suggestedStartDate: suggested, futureDate } = projectExecutionStartSuggestion(project, plannedStartDate, today);
  const minDate = executedAtHeadquarters ? undefined : project.mobilizationDate?.slice(0, 10);
  const [startDate, setStartDate] = useState(suggested);
  const operators = projectReportOperatorOptions(project);
  const suggestedOperator = operators.find(operator => operator.id === project.operatorId)?.id
    || (operators.length === 1 ? operators[0].id : '');
  const [operatorId, setOperatorId] = useState(suggestedOperator);
  useEffect(() => setStartDate(suggested), [project.id, suggested]);
  useEffect(() => setOperatorId(suggestedOperator), [project.id, suggestedOperator]);
  const validOperator = !operators.length || operators.some(operator => operator.id === operatorId);
  const dateError = startDate > today
    ? 'O início real não pode estar no futuro. Informe a data em que a execução realmente começou.'
    : startDate && minDate && startDate < minDate
      ? 'O início real não pode ser anterior à mobilização efetiva.'
      : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (startDate && !dateError && validOperator && !saving) onConfirm(startDate, operators.length ? operatorId : undefined);
  }

  return (
    <Modal open onClose={onClose} closeOnEscape={!saving} appearance="design-system" title="Confirmar início da execução" size="sm" fullscreenOnMobile={false} panelClassName="efetivo-dialog" footer={<><Button variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="project-execution-start-form" loading={saving} disabled={!startDate || Boolean(dateError) || !validOperator}>Confirmar e iniciar execução</Button></>}>
      <form id="project-execution-start-form" className="efetivo-dialog-form" onSubmit={submit}>
        <p className="efetivo-dialog-description">{project.code} · {project.name}</p>
        {futureDate ? <Alert tone="info" title={`Início previsto para ${displayDateOnly(futureDate)}`}>
          Essa data ainda está no futuro. Informe quando a execução realmente começou. Se os serviços ainda não começaram, cancele a movimentação.
        </Alert> : null}
        <Field id="project-execution-start-date" label="Início real da execução" required errorText={dateError} helperText="Confirme ou corrija a data em que os serviços começaram. Ela será registrada no cronograma do Acompanhamento.">
          <Input type="date" required min={minDate} max={today} value={startDate} disabled={saving} onChange={event => setStartDate(event.target.value)} />
        </Field>
        {operators.length ? <Field id="project-execution-report-operator" label="Operador responsável" required helperText="Será o responsável pelo relatório deste projeto. Todos os colaboradores da missão com conta interna ativa e acesso ao Relatório também poderão acessar e preencher os relatórios.">
          <Select required value={operatorId} disabled={saving || !operators.length} onChange={event => setOperatorId(event.target.value)}>
            <option value="">Selecionar colaborador…</option>
            {operators.map(operator => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
          </Select>
        </Field> : <Alert tone="warning" title="Execução sem operador de campo para os relatórios">A equipe não possui colaborador com conta ativa e acesso ao Relatório. O Gestor de Contrato será definido como responsável padrão e administradores e gestores serão notificados da falta de operador.</Alert>}
      </form>
    </Modal>
  );
}
