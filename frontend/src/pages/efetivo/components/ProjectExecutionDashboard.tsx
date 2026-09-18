import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';

import {
  makeProjectExecutionSchemas,
  PROJECT_EXECUTION_DEVIATION_CATEGORIES,
  PROJECT_EXECUTION_REPORT_TYPES
} from '../../../../../shared/schemas/project-execution.js';
import {
  createProjectExecutionDeviation,
  getProjectExecutionDashboard,
  updateProjectExecutionDeviationStatus,
  updateProjectExecutionReportTargets,
  type ProjectExecutionDeviationInput,
  type ProjectExecutionDeviationStatus,
  type ProjectExecutionReportTargetInput
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly, todayDateOnly } from '../../../utils/calendarGrid';

const schemas = makeProjectExecutionSchemas(z);
type TargetValues = { targets: ProjectExecutionReportTargetInput[] };
type DeviationValues = ProjectExecutionDeviationInput;

const STATUS_LABELS: Record<ProjectExecutionDeviationStatus, string> = {
  ABERTO: 'Aberto',
  EM_TRIAGEM: 'Em triagem',
  EM_OBSERVACAO: 'Em observação',
  EM_ACAO: 'Em ação',
  FECHADO: 'Fechado',
  DIVULGADO: 'Divulgado'
};

const IMPACT_LABELS = { ALTO: 'Alto', MEDIO: 'Médio', BAIXO: 'Baixo' } as const;

function fieldClass(error?: unknown) {
  return `field-group ${error ? 'field-invalid' : ''}`;
}

function fmtPct(value: number | null) {
  return value == null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function fmtDate(value: string | null) {
  return value ? displayDateOnly(value) : '—';
}

function targetDefaults(data?: Awaited<ReturnType<typeof getProjectExecutionDashboard>>): TargetValues {
  return {
    targets: PROJECT_EXECUTION_REPORT_TYPES.map(definition => {
      const current = data?.technicalReports.find(item => item.reportType === definition.key);
      return {
        reportType: definition.key,
        expectedCount: current?.expectedCount || 0,
        ...(definition.source === 'MANUAL' ? { completedCount: current?.issuedCount || 0 } : {})
      };
    })
  };
}

function ExecutionOverview({ data }: { data: Awaited<ReturnType<typeof getProjectExecutionDashboard>> }) {
  const schedule = data.schedule;
  const rdo = data.rdo;
  return (
    <>
      <div className="project-execution-metrics" aria-label="Avanço da execução">
        <article><span>Previsto</span><strong>{fmtPct(schedule.plannedProgressPct)}</strong><small>Prazo consumido</small></article>
        <article><span>Realizado</span><strong className={(schedule.actualProgressPct || 0) < (schedule.plannedProgressPct || 0) ? 'is-warning' : ''}>{fmtPct(schedule.actualProgressPct)}</strong><small>{schedule.progressMethod === 'MANUAL' ? 'Avanço manual' : 'Avanço pelos RDOs'}</small></article>
        <article><span>Dias transcorridos</span><strong>{schedule.elapsedDays ?? '—'} / {schedule.plannedDays ?? '—'}</strong><small>Desde {fmtDate(schedule.startDate)}</small></article>
        <article><span>Previsão de término</span><strong>{fmtDate(schedule.projectedEndDate || schedule.expectedEndDate)}</strong><small>{schedule.projectedEndDate ? `Planejado: ${fmtDate(schedule.expectedEndDate)}` : 'Pelo prazo planejado'}</small></article>
      </div>
      <div className="project-execution-progress-bars">
        <div><span>Previsto</span><div><i style={{ width: `${Math.min(100, Math.max(0, schedule.plannedProgressPct || 0))}%` }} /></div></div>
        <div><span>Realizado</span><div><i style={{ width: `${Math.min(100, Math.max(0, schedule.actualProgressPct || 0))}%` }} /></div></div>
      </div>
      <section className="project-execution-rdo" aria-label="Acompanhamento dos RDOs">
        <header><div><h5>Diário e evidências</h5><p>Contagens dos RDOs não excluídos desta obra.</p></div><span>Último RDO: {fmtDate(rdo.lastReportDate)}</span></header>
        <div>
          <article><strong>{rdo.receivedCount}</strong><span>Recebidos</span></article>
          <article><strong>{rdo.releasedToClientCount}</strong><span>Liberados ao cliente</span></article>
          <article><strong>{rdo.signedCount}</strong><span>Assinados</span></article>
          <article><strong>{rdo.pendingOrReturnedCount}</strong><span>Pendentes/devolvidos</span></article>
          <article><strong>{rdo.withQuantitiesCount}</strong><span>Com quantitativos</span></article>
          <article><strong>{rdo.evidenceCount}</strong><span>Evidências em {rdo.withEvidenceCount} RDO(s)</span></article>
        </div>
      </section>
    </>
  );
}

function ReportTargets({ projectId, data }: { projectId: string; data: Awaited<ReturnType<typeof getProjectExecutionDashboard>> }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<TargetValues>({
    resolver: zodResolver(schemas.reportTargets) as Resolver<TargetValues>,
    defaultValues: targetDefaults(data)
  });
  useEffect(() => reset(targetDefaults(data)), [data, reset]);
  const mutation = useMutation({
    mutationFn: (values: TargetValues) => updateProjectExecutionReportTargets(projectId, values.targets),
    onSuccess: next => {
      queryClient.setQueryData(['project-execution', projectId], next);
      toast('Metas de relatórios atualizadas.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });
  return (
    <section className="project-execution-reports">
      <header><div><h5>Relatórios técnicos</h5><p>Emitidos automaticamente pelo módulo de Relatórios; RLR permanece manual até ganhar uma fonte integrada.</p></div></header>
      <div className="project-execution-report-grid">
        {data.technicalReports.map(report => <article className={report.missingCount ? 'is-missing' : ''} key={report.reportType}>
          <header><strong>{report.label}</strong><span>{report.issuedCount}/{report.expectedCount || '—'}</span></header>
          <p>{report.source === 'MANUAL' ? 'Contagem manual' : `${report.approvedCount} aprovado(s) · ${report.signedCount} assinado(s)`}</p>
          {report.returnedCount ? <small>{report.returnedCount} devolvido(s)</small> : report.missingCount ? <small>{report.missingCount} entrega(s) ainda faltante(s)</small> : <small>{report.expectedCount ? 'Meta atendida' : 'Meta ainda não definida'}</small>}
        </article>)}
      </div>
      {data.permissions.canEdit ? <form className="project-execution-target-form" noValidate onSubmit={handleSubmit(values => mutation.mutate(values))}>
        <div className="project-execution-target-grid">
          {PROJECT_EXECUTION_REPORT_TYPES.map((definition, index) => <div className="project-execution-target-row" key={definition.key}>
            <input type="hidden" value={definition.key} {...register(`targets.${index}.reportType`)} />
            <div className={fieldClass(errors.targets?.[index]?.expectedCount)}><label htmlFor={`execution-target-${definition.key}`}>Meta {definition.label}</label><input id={`execution-target-${definition.key}`} type="number" min="0" max="9999" disabled={mutation.isPending} aria-invalid={Boolean(errors.targets?.[index]?.expectedCount)} {...register(`targets.${index}.expectedCount`, { valueAsNumber: true })} />{errors.targets?.[index]?.expectedCount ? <span className="field-error">{errors.targets[index]?.expectedCount?.message}</span> : null}</div>
            {definition.source === 'MANUAL' ? <div className={fieldClass(errors.targets?.[index]?.completedCount)}><label htmlFor={`execution-completed-${definition.key}`}>Realizado {definition.label}</label><input id={`execution-completed-${definition.key}`} type="number" min="0" max="9999" disabled={mutation.isPending} aria-invalid={Boolean(errors.targets?.[index]?.completedCount)} {...register(`targets.${index}.completedCount`, { valueAsNumber: true })} />{errors.targets?.[index]?.completedCount ? <span className="field-error">{errors.targets[index]?.completedCount?.message}</span> : null}</div> : null}
          </div>)}
        </div>
        <div className="project-workflow-inline-actions"><Button type="submit" variant="mini" disabled={mutation.isPending || !isDirty}>{mutation.isPending ? 'Salvando…' : 'Salvar metas'}</Button></div>
      </form> : null}
    </section>
  );
}

function Deviations({ projectId, data }: { projectId: string; data: Awaited<ReturnType<typeof getProjectExecutionDashboard>> }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const defaults: DeviationValues = { category: 'PRAZO', description: '', ownerName: '', dueDate: todayDateOnly(), impact: 'MEDIO', action: '', status: 'ABERTO' };
  const { register, handleSubmit, reset, formState: { errors } } = useForm<DeviationValues>({
    resolver: zodResolver(schemas.deviationCreate) as Resolver<DeviationValues>,
    defaultValues: defaults
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['project-execution', projectId] });
  const create = useMutation({
    mutationFn: (values: DeviationValues) => createProjectExecutionDeviation(projectId, values),
    onSuccess: async () => {
      await refresh();
      reset({ ...defaults, dueDate: todayDateOnly() });
      setFormOpen(false);
      toast('Desvio registrado também no módulo Qualidade.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProjectExecutionDeviationStatus }) => updateProjectExecutionDeviationStatus(projectId, id, status),
    onSuccess: async () => { await refresh(); toast('Status do desvio atualizado.', 'success'); },
    onError: (error: Error) => toast(error.message, 'error')
  });
  return (
    <section className="project-execution-deviations" data-project-execution-deviations>
      <header><div><h5>Desvios do projeto</h5><p>Registros compartilhados com o módulo Qualidade.</p></div>{data.permissions.canEdit ? <Button variant="secondary" onClick={() => setFormOpen(value => !value)}>⚠️ Registrar desvio</Button> : null}</header>
      {formOpen ? <form className="project-execution-deviation-form" noValidate onSubmit={handleSubmit(values => create.mutate(values))}>
        <div className={fieldClass(errors.category)}><label htmlFor="execution-deviation-category">Categoria *</label><select id="execution-deviation-category" disabled={create.isPending} aria-invalid={Boolean(errors.category)} {...register('category')}>{PROJECT_EXECUTION_DEVIATION_CATEGORIES.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select>{errors.category ? <span className="field-error">{errors.category.message}</span> : null}</div>
        <div className={fieldClass(errors.impact)}><label htmlFor="execution-deviation-impact">Impacto *</label><select id="execution-deviation-impact" disabled={create.isPending} aria-invalid={Boolean(errors.impact)} {...register('impact')}>{Object.entries(IMPACT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{errors.impact ? <span className="field-error">{errors.impact.message}</span> : null}</div>
        <div className={fieldClass(errors.ownerName)}><label htmlFor="execution-deviation-owner">Responsável *</label><input id="execution-deviation-owner" disabled={create.isPending} aria-invalid={Boolean(errors.ownerName)} {...register('ownerName')} />{errors.ownerName ? <span className="field-error">{errors.ownerName.message}</span> : null}</div>
        <div className={fieldClass(errors.dueDate)}><label htmlFor="execution-deviation-date">Data limite *</label><input id="execution-deviation-date" type="date" disabled={create.isPending} aria-invalid={Boolean(errors.dueDate)} {...register('dueDate')} />{errors.dueDate ? <span className="field-error">{errors.dueDate.message}</span> : null}</div>
        <div className={`${fieldClass(errors.description)} project-execution-wide-field`}><label htmlFor="execution-deviation-description">Descrição *</label><textarea id="execution-deviation-description" rows={3} disabled={create.isPending} aria-invalid={Boolean(errors.description)} {...register('description')} />{errors.description ? <span className="field-error">{errors.description.message}</span> : null}</div>
        <div className={`${fieldClass(errors.action)} project-execution-wide-field`}><label htmlFor="execution-deviation-action">Ação definida *</label><textarea id="execution-deviation-action" rows={3} disabled={create.isPending} aria-invalid={Boolean(errors.action)} {...register('action')} />{errors.action ? <span className="field-error">{errors.action.message}</span> : null}</div>
        <div className={fieldClass(errors.status)}><label htmlFor="execution-deviation-status">Status *</label><select id="execution-deviation-status" disabled={create.isPending} aria-invalid={Boolean(errors.status)} {...register('status')}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{errors.status ? <span className="field-error">{errors.status.message}</span> : null}</div>
        <div className="project-execution-form-actions"><Button type="button" variant="secondary" disabled={create.isPending} onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? 'Registrando…' : 'Registrar desvio'}</Button></div>
      </form> : null}
      {data.deviations.length ? <div className="project-execution-deviation-list">{data.deviations.map(deviation => {
        const impact = deviation.impact || 'BAIXO';
        const status = deviation.status || 'ABERTO';
        return <article className={status === 'FECHADO' || status === 'DIVULGADO' ? 'is-closed' : ''} key={deviation.id}>
        <header><div><span>{deviation.number} · {deviation.origin || 'Origem não informada'}</span><strong>{deviation.description || 'Descrição não informada'}</strong></div><span className={`is-${impact.toLowerCase()}`}>{IMPACT_LABELS[impact]}</span></header>
        <dl><div><dt>Responsável</dt><dd>{deviation.actionOwner || '—'}</dd></div><div><dt>Prazo</dt><dd>{fmtDate(deviation.actionDeadline)}</dd></div><div><dt>Ação</dt><dd>{deviation.definedAction || '—'}</dd></div></dl>
        <div className="project-execution-deviation-status"><label htmlFor={`execution-deviation-${deviation.id}`}>Status</label><select id={`execution-deviation-${deviation.id}`} value={status} disabled={!data.permissions.canEdit || updateStatus.isPending} onChange={event => updateStatus.mutate({ id: deviation.id, status: event.target.value as ProjectExecutionDeviationStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      </article>})}</div> : <p className="placeholder-copy">Nenhum desvio registrado para este projeto.</p>}
    </section>
  );
}

export function ProjectExecutionDashboard({ projectId, readOnly = false }: { projectId: string; readOnly?: boolean }) {
  const query = useQuery({ queryKey: ['project-execution', projectId], queryFn: () => getProjectExecutionDashboard(projectId) });
  if (query.isLoading) return <section className="project-execution-dashboard placeholder-copy">Carregando painel de execução…</section>;
  if (query.isError || !query.data) return <section className="project-execution-dashboard placeholder-copy"><p>Não foi possível carregar o painel de execução.</p><Button variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button></section>;
  const dashboard = readOnly ? { ...query.data, permissions: { ...query.data.permissions, canEdit: false } } : query.data;
  return (
    <section className="project-execution-dashboard" data-project-execution-dashboard>
      <header><div><h4>Dashboard de execução</h4><p>Avanço, diário, documentos técnicos e desvios consolidados no projeto.</p></div></header>
      <ExecutionOverview data={dashboard} />
      <ReportTargets projectId={projectId} data={dashboard} />
      <Deviations projectId={projectId} data={dashboard} />
    </section>
  );
}
