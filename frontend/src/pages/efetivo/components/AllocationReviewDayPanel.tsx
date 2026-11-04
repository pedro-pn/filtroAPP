import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import type {
  AllocationReviewKind,
  AllocationReviewValue,
  ReviewDayView,
  ReviewProject,
  ReviewRowView,
  SaveReviewDayItem
} from '../../../api/allocationReview';
import { Alert, Badge, Button, Field, Textarea } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';
import { SearchCombobox } from '../../../components/ui/SearchCombobox';
import {
  ABSENCE_ALERT_KINDS,
  IDLE_KINDS,
  KIND_LABELS,
  SOURCE_STATE_LABELS,
  formatDayMonth,
  formatFullDate,
  formatHours,
  pendingText,
  projectFullLabel,
  sameValue
} from './allocationReviewPresentation';

const WEEKDAY = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

interface ChoiceOption {
  key: string;
  value: AllocationReviewValue | null; // null = escolha com projeto livre (outro projeto / viagem)
  label: string;
  detail: string | null;
  tags: string[];
  special?: 'PROJECT_OTHER' | 'TRAVEL_OTHER';
}

const formSchema = z.object({
  choice: z.string().min(1, 'Escolha onde o colaborador esteve.'),
  otherProjectId: z.string(),
  extraProjectId: z.string(),
  travelProjectId: z.string(),
  repeat: z.array(z.string()),
  note: z.string().max(500, 'Use no máximo 500 caracteres.')
});
type FormValues = z.infer<typeof formSchema>;

function optionKey(value: AllocationReviewValue) {
  return `${value.kind}:${[...value.projectIds].sort().join(',')}`;
}

function projectsLabel(projectIds: string[], projectsById: Map<string, ReviewProject>) {
  return projectIds.map(id => projectFullLabel(projectsById.get(id), id)).join(' + ');
}

function cnpjLabel(projectIds: string[], projectsById: Map<string, ReviewProject>) {
  const values = [...new Set(projectIds.map(id => projectsById.get(id)?.clientCnpj).filter(Boolean))];
  return values.length ? `CNPJ ${values.join(' · ')}` : 'CNPJ não cadastrado';
}

function buildChoiceOptions(day: ReviewDayView, projectsById: Map<string, ReviewProject>): ChoiceOption[] {
  const options = new Map<string, ChoiceOption>();
  const push = (value: AllocationReviewValue | null, tag: string) => {
    if (!value || value.kind === 'NONE') return;
    if ((value.kind === 'PROJECT' || value.kind === 'TRAVEL') && !value.projectIds.length) return;
    const key = optionKey(value);
    const existing = options.get(key);
    if (existing) {
      if (!existing.tags.includes(tag)) existing.tags.push(tag);
      return;
    }
    const isProject = value.kind === 'PROJECT' || value.kind === 'TRAVEL';
    options.set(key, {
      key,
      value,
      label: isProject
        ? `${value.kind === 'TRAVEL' ? 'Viagem para ' : ''}${projectsLabel(value.projectIds, projectsById)}`
        : KIND_LABELS[value.kind],
      detail: isProject ? cnpjLabel(value.projectIds, projectsById) : null,
      tags: [tag]
    });
  };
  if (day.saved) push(day.value, 'atual');
  push(day.suggestion, 'sugestão do app');
  const rdoProjects = [...new Set(day.sources.rdo.reports.map(report => report.projectId))];
  if (rdoProjects.length) push({ kind: 'PROJECT', projectIds: rdoProjects }, 'pelo RDO');
  for (const id of day.sources.efetivo.projectIds) push({ kind: 'PROJECT', projectIds: [id] }, 'pelo Efetivo');
  if (day.sources.manualProjectIds.length) push({ kind: 'PROJECT', projectIds: day.sources.manualProjectIds }, 'ajuste manual');
  for (const id of day.candidateProjectIds) push({ kind: 'PROJECT', projectIds: [id] }, 'nas fontes');
  for (const kind of IDLE_KINDS) push({ kind, projectIds: [] }, '');
  const list = [...options.values()].map(option => ({ ...option, tags: option.tags.filter(Boolean) }));
  list.push({ key: 'TRAVEL_OTHER', value: null, label: 'Viagem para outro projeto…', detail: null, tags: [], special: 'TRAVEL_OTHER' });
  list.push({ key: 'PROJECT_OTHER', value: null, label: 'Outro projeto…', detail: null, tags: [], special: 'PROJECT_OTHER' });
  return list;
}

function SourceLine({ title, state, children }: { title: string; state: 'confirms' | 'diverges' | 'none'; children: React.ReactNode }) {
  const icon = state === 'confirms' ? '✓' : state === 'diverges' ? '!' : '–';
  return (
    <div className={`allocation-review-source is-${state}`}>
      <span className="allocation-review-source__icon" aria-hidden="true">{icon}</span>
      <div>
        <strong>{title}</strong> <span className="sr-only">({SOURCE_STATE_LABELS[state]})</span>
        <p>{children}</p>
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  row: ReviewRowView | null;
  day: ReviewDayView | null;
  weekClosed: boolean;
  projects: ReviewProject[];
  projectsById: Map<string, ReviewProject>;
  saving: boolean;
  onClose: () => void;
  onSave: (items: SaveReviewDayItem[]) => void;
  onDiscard: (day: ReviewDayView) => void;
}

export function AllocationReviewDayPanel({ open, row, day, weekClosed, projects, projectsById, saving, onClose, onSave, onDiscard }: Props) {
  const options = useMemo(() => (day ? buildChoiceOptions(day, projectsById) : []), [day, projectsById]);
  const readOnly = !row || !day || row.confirmed || weekClosed || day.isFuture || !day.eligible;
  const initialChoice = useMemo(() => {
    if (!day?.value || day.value.kind === 'NONE') return '';
    return options.find(option => option.value && sameValue(option.value, day.value))?.key || '';
  }, [day, options]);
  const followingDays = useMemo(() => {
    if (!row || !day) return [];
    return row.days.filter(item => item.date > day.date && item.eligible && !item.isFuture);
  }, [day, row]);

  const { control, register, handleSubmit, reset, setError, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { choice: initialChoice, otherProjectId: '', extraProjectId: '', travelProjectId: '', repeat: [], note: day?.note || '' }
  });
  useEffect(() => {
    if (open) reset({ choice: initialChoice, otherProjectId: '', extraProjectId: '', travelProjectId: '', repeat: [], note: day?.note || '' });
  }, [day, initialChoice, open, reset]);
  const choice = useWatch({ control, name: 'choice' });
  const selected = options.find(option => option.key === choice) || null;

  const activeProjects = useMemo(() => projects
    .filter(project => project.isActive || day?.candidateProjectIds.includes(project.id))
    .map(project => ({
      value: project.id,
      label: `${project.code} · ${project.name}`,
      description: [project.clientName, project.clientCnpj ? `CNPJ ${project.clientCnpj}` : 'CNPJ não cadastrado'].filter(Boolean).join(' · ')
    })), [day, projects]);

  const pendingAbsenceAlert = Boolean(selected?.value && ABSENCE_ALERT_KINDS.has(selected.value.kind)
    && !day?.sources.absence && day && !sameValue(selected.value, day.suggestion));

  function submit(values: FormValues) {
    if (!row || !day) return;
    const option = options.find(item => item.key === values.choice);
    if (!option) {
      setError('choice', { message: 'Escolha onde o colaborador esteve.' });
      return;
    }
    let kind: AllocationReviewKind;
    let projectIds: string[];
    if (option.special === 'PROJECT_OTHER') {
      if (!values.otherProjectId) {
        setError('otherProjectId', { message: 'Escolha o projeto.' });
        return;
      }
      kind = 'PROJECT';
      projectIds = [...new Set([values.otherProjectId, values.extraProjectId].filter(Boolean))];
    } else if (option.special === 'TRAVEL_OTHER') {
      if (!values.travelProjectId) {
        setError('travelProjectId', { message: 'Escolha o projeto de destino.' });
        return;
      }
      kind = 'TRAVEL';
      projectIds = [values.travelProjectId];
    } else {
      kind = option.value!.kind as AllocationReviewKind;
      projectIds = option.value!.projectIds;
    }
    const note = values.note.trim() || null;
    const dates = [day.date, ...values.repeat];
    onSave(dates.map(date => ({ collaboratorId: row.collaborator.id, date, kind, projectIds, note })));
  }

  if (!row || !day) return null;
  const [year, month, dayOfMonth] = day.date.split('-').map(Number);
  const weekday = WEEKDAY[new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay()];
  const { ponto, rdo, efetivo, absence } = day.sources;
  const saveLabel = day.pending ? 'Confirmar escolha' : 'Salvar';

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnEscape={!saving}
      appearance="design-system"
      title={row.collaborator.name}
      size="md"
      panelClassName="efetivo-dialog allocation-review-panel"
      ariaDescribedBy="allocation-review-panel-date"
      footer={<>
        {day.saved && !readOnly ? (
          <Button variant="ghost" size="sm" onClick={() => onDiscard(day)} disabled={saving}>Voltar para a sugestão</Button>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>{readOnly ? 'Fechar' : 'Cancelar'}</Button>
        {!readOnly ? <Button variant="primary" size="sm" type="submit" form="allocation-review-day-form" loading={saving}>{saveLabel}</Button> : null}
      </>}
    >
      <p id="allocation-review-panel-date" className="allocation-review-panel__subtitle">
        {row.collaborator.jobRole ? `${row.collaborator.jobRole} · ` : ''}{weekday}, {formatFullDate(day.date)}
      </p>

      {day.pending && day.pendingReason === 'NO_INFORMATION' ? (
        <Alert tone="danger" title="Sem informação">{day.reasons.join(' ')} Informe onde ele esteve.</Alert>
      ) : day.pending ? (
        <Alert tone="warning" title={day.pendingReason === 'PLAN_ONLY' ? 'Confirme o planejamento' : 'As fontes não batem'}>
          {day.reasons.join(' ')} {day.pendingReason === 'DIVERGENCE' ? 'A sugestão segue o RDO quando ele existe.' : ''}
        </Alert>
      ) : null}
      {day.sourceChangedAfterReview ? (
        <Alert tone="info" title="A fonte mudou depois de conferido">Ponto, RDO ou planejamento mudaram depois da conferência. A conferência continua valendo; revise se for preciso.</Alert>
      ) : null}
      {readOnly && row.confirmed && !weekClosed ? (
        <Alert tone="info">A semana deste colaborador já foi conferida. Desfaça a conferência na linha para editar.</Alert>
      ) : null}
      {weekClosed ? <Alert tone="info">A semana está fechada. Só um administrador pode reabrir.</Alert> : null}

      <section className="allocation-review-panel__section" aria-labelledby="allocation-review-sources-title">
        <h3 id="allocation-review-sources-title">O que o app encontrou</h3>
        <SourceLine title="Ponto Mais" state={ponto.state}>
          {ponto.normalHours + ponto.he70Hours + ponto.he100Hours > 0 || ponto.tags.length
            ? <>{formatHours(ponto.normalHours)} normais{ponto.he70Hours ? ` · HE70 ${formatHours(ponto.he70Hours)}` : ''}{ponto.he100Hours ? ` · HE100 ${formatHours(ponto.he100Hours)}` : ''} · {ponto.tags.length ? `etiqueta ${ponto.tags.map(tag => `“${tag}”`).join(', ')}` : 'sem etiqueta'}</>
            : 'Sem marcação no dia'}
        </SourceLine>
        <SourceLine title="RDO" state={rdo.state}>
          {rdo.reports.length
            ? rdo.reports.map(report => `RDO${report.number != null ? ` nº ${report.number}` : ''} de ${projectFullLabel(projectsById.get(report.projectId), report.projectId)}${report.status === 'PENDING' ? ' (pendente)' : ''}`).join('; ')
            : 'Não aparece em nenhum RDO do dia'}
        </SourceLine>
        <SourceLine title="Planejamento do Efetivo" state={efetivo.state}>
          {efetivo.projectIds.length ? `Alocado em ${projectsLabel(efetivo.projectIds, projectsById)}` : 'Sem alocação planejada'}
          {absence ? ` · ${KIND_LABELS[(absence.type === 'FADIGA_OFFSHORE' || absence.type === 'ASO' ? 'AFASTAMENTO' : absence.type) as AllocationReviewKind] || absence.type} cadastrada` : ''}
        </SourceLine>
        <p className="allocation-review-panel__hint">Horário de entrada e saída não fica guardado no app; só as horas e as etiquetas do ponto.</p>
      </section>

      <form id="allocation-review-day-form" className="efetivo-dialog-form" noValidate onSubmit={handleSubmit(submit)}>
        <fieldset className="allocation-review-options" disabled={readOnly}>
          <legend>Onde ele esteve</legend>
          {options.map(option => (
            <label key={option.key} className={`allocation-review-option${choice === option.key ? ' is-checked' : ''}`}>
              <input type="radio" value={option.key} {...register('choice')} />
              <span className="allocation-review-option__label">
                {option.label}
                {option.tags.map(tag => <Badge key={tag} tone="brand">{tag}</Badge>)}
              </span>
              {option.detail ? <span className="allocation-review-option__detail">{option.detail}</span> : null}
            </label>
          ))}
          {errors.choice ? <p className="field-error" role="alert">{errors.choice.message}</p> : null}
        </fieldset>

        {selected?.special === 'PROJECT_OTHER' ? (
          <>
            <Controller control={control} name="otherProjectId" render={({ field }) => (
              <SearchCombobox id="allocation-review-other-project" label="Projeto" value={field.value} options={activeProjects} onChange={field.onChange} placeholder="Buscar por código, nome ou cliente" emptyText="Nenhum projeto encontrado." error={errors.otherProjectId?.message} required variant="select" />
            )} />
            <Controller control={control} name="extraProjectId" render={({ field }) => (
              <SearchCombobox id="allocation-review-extra-project" label="Dividir o dia com outro projeto (opcional)" value={field.value} options={activeProjects} onChange={field.onChange} placeholder="Só se trabalhou em dois projetos no dia" emptyText="Nenhum projeto encontrado." variant="select" />
            )} />
            <p className="allocation-review-panel__hint">Com dois projetos no mesmo dia, as horas são divididas entre eles.</p>
          </>
        ) : null}
        {selected?.special === 'TRAVEL_OTHER' ? (
          <>
            <Controller control={control} name="travelProjectId" render={({ field }) => (
              <SearchCombobox id="allocation-review-travel-project" label="Viajando para" value={field.value} options={activeProjects} onChange={field.onChange} placeholder="Buscar projeto de destino" emptyText="Nenhum projeto encontrado." error={errors.travelProjectId?.message} required variant="select" />
            )} />
            <p className="allocation-review-panel__hint">Conta como custo do projeto de destino e leva o CNPJ dele.</p>
          </>
        ) : null}
        {selected?.value?.kind === 'TRAVEL' ? <p className="allocation-review-panel__hint">Viagem conta como custo do projeto de destino.</p> : null}

        {pendingAbsenceAlert ? (
          <Alert tone="info" title={`Não há ${KIND_LABELS[selected!.value!.kind].toLowerCase()} cadastrada neste dia`}>
            Quando a linha for conferida, os administradores do Efetivo recebem um aviso para fazer o cadastro.
          </Alert>
        ) : null}

        {!readOnly && followingDays.length ? (
          <fieldset className="allocation-review-repeat">
            <legend>Repetir nos dias seguintes</legend>
            <div className="allocation-review-repeat__chips">
              {followingDays.map(item => (
                <label key={item.date} className="allocation-review-chip">
                  <input type="checkbox" value={item.date} {...register('repeat')} />
                  <span>{WEEKDAY[new Date(`${item.date}T00:00:00.000Z`).getUTCDay()].slice(0, 3)} {formatDayMonth(item.date)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <Field id="allocation-review-note" label="Observação" errorText={errors.note?.message}>
          <Textarea rows={2} placeholder="Ex.: ponto marcado na obra errada" disabled={readOnly} {...register('note')} />
        </Field>
        {day.pending ? <p className="sr-only">Pendência: {pendingText(day)}</p> : null}
      </form>
    </Modal>
  );
}
