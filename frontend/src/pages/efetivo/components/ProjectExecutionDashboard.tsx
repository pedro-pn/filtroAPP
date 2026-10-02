import { BrandLoading } from '../../../components/brand/BrandLoading';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';

import {
  makeProjectExecutionSchemas,
  PROJECT_EXECUTION_DEVIATION_CATEGORIES,
  PROJECT_EXECUTION_WEEKLY_CHECKS
} from '../../../../../shared/schemas/project-execution.js';
import {
  createProjectExecutionDeviation,
  getProjectExecutionDashboard,
  saveProjectExecutionWeeklyReview,
  updateProjectExecutionDeviationStatus,
  type ProjectExecutionDeviationInput,
  type ProjectExecutionDeviationStatus,
  type ProjectExecutionReportSummary,
  type ProjectExecutionWeeklyChecks,
  type ProjectExecutionWeeklyReviewWeek,
  type ProjectExecutionDashboard as DashboardData
} from '../../../api/projectWorkflow';
import { downloadReportPdf } from '../../../api/reports';
import { Button, Field, Input, Select, Textarea } from '../../../components/ui/ds';
import { MissionWeeklyProgressPanel } from '../../../components/projects/MissionWeeklyProgressPanel';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly, todayDateOnly } from '../../../utils/calendarGrid';
import { downloadBlob } from '../../../utils/download';
import { groupServicesByScope } from '../../../utils/plannedScopeGroups';
import '../ProjectExecutionDashboard.ds.css';

const schemas = makeProjectExecutionSchemas(z);
type DeviationValues = ProjectExecutionDeviationInput;
const PdfCanvasViewer = lazy(() => import('../../../components/projects/PdfCanvasViewer').then(module => ({ default: module.PdfCanvasViewer })));
const SERVICE_LABELS: Record<string, string> = { LIMPEZA_QUIMICA: 'Limpeza química', TESTE_PRESSAO: 'Teste de pressão', FLUSHING: 'Flushing', FILTRAGEM: 'Filtragem' };
const SYSTEM_LABELS: Record<string, string> = { TUBULACAO: 'Tubulações', OLEO: 'Óleo', SISTEMA: 'Sistemas completos' };
const REPORT_LABELS: Record<string, string> = { RDO: 'RDO', RDO_MAINTENANCE: 'RDO de manutenção', RDO_PRODUCTION: 'RDO de produção', RTP: 'RTP', RLQ: 'RLQ', RCPU: 'RCPU', RLM: 'RLM', RLF: 'RLF', RLI: 'RLI' };
const STATUS_LABELS_REPORT: Record<string, string> = { PENDING: 'Pendente de revisão', APPROVED: 'Aguardando assinatura', RETURNED: 'Devolvido', SIGNED: 'Assinado' };

const STATUS_LABELS: Record<ProjectExecutionDeviationStatus, string> = {
  ABERTO: 'Aberto',
  EM_TRIAGEM: 'Em triagem',
  EM_OBSERVACAO: 'Em observação',
  EM_ACAO: 'Em ação',
  FECHADO: 'Fechado',
  DIVULGADO: 'Divulgado'
};

const IMPACT_LABELS = { ALTO: 'Alto', MEDIO: 'Médio', BAIXO: 'Baixo' } as const;

function fmtPct(value: number | null) {
  return value == null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function fmtDate(value: string | null) {
  return value ? displayDateOnly(value) : '—';
}

function reportName(report: ProjectExecutionReportSummary) {
  return `${REPORT_LABELS[report.reportType] || report.reportType}${report.sequenceNumber ? ` ${report.sequenceNumber}` : ''}`;
}

function ExecutionOverview({ data }: { data: DashboardData }) {
  const schedule = data.schedule;
  const rdo = data.rdo;
  const hasPhysicalScope = Boolean(data.progress?.hasScope);
  const realizedPct = hasPhysicalScope ? data.progress?.progressPct ?? null : schedule.actualProgressPct;
  const realizedLabel = hasPhysicalScope ? 'Escopo realizado' : 'Avanço realizado';
  const plannedBarWidth = Math.min(100, Math.max(0, schedule.plannedProgressPct ?? 0));
  const realizedBarWidth = Math.min(100, Math.max(0, realizedPct ?? 0));
  return (
    <>
      <div className="project-execution-metrics" aria-label="Avanço da execução">
        <article><span>Prazo previsto</span><strong>{fmtPct(schedule.plannedProgressPct)}</strong><small>Parcela do prazo transcorrida</small></article>
        <article><span>{realizedLabel}</span><strong className={(realizedPct || 0) < (schedule.plannedProgressPct || 0) ? 'is-warning' : ''}>{fmtPct(realizedPct)}</strong><small>{hasPhysicalScope ? 'Avanço físico pelos RDOs' : schedule.progressMethod === 'MANUAL' ? 'Avanço manual' : 'Avanço pelos RDOs'}</small></article>
        <article><span>Dias transcorridos</span><strong>{schedule.elapsedDays ?? '—'} / {schedule.plannedDays ?? '—'}</strong><small>Desde {fmtDate(schedule.startDate)}</small></article>
        <article><span>Previsão de término</span><strong>{fmtDate(schedule.projectedEndDate || schedule.expectedEndDate)}</strong><small>{schedule.projectedEndDate ? `Planejado: ${fmtDate(schedule.expectedEndDate)}` : 'Pelo prazo planejado'}</small></article>
      </div>
      <div className="project-execution-progress-bars" aria-label="Comparativo de prazo e execução">
        <div><span>Prazo previsto</span><div role="progressbar" aria-label="Prazo previsto" aria-valuemin={0} aria-valuemax={100} aria-valuenow={schedule.plannedProgressPct == null ? undefined : plannedBarWidth}><i style={{ width: `${plannedBarWidth}%` }} /></div><strong>{fmtPct(schedule.plannedProgressPct)}</strong></div>
        <div><span>{realizedLabel}</span><div role="progressbar" aria-label={realizedLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={realizedPct == null ? undefined : realizedBarWidth}><i style={{ width: `${realizedBarWidth}%` }} /></div><strong>{fmtPct(realizedPct)}</strong></div>
        <p>Prazo previsto: período planejado já transcorrido. {realizedLabel}: {hasPhysicalScope ? 'avanço físico do escopo medido pelos RDOs' : 'avanço registrado para a obra'}.</p>
      </div>
      <section className="project-execution-rdo" aria-label="Acompanhamento dos RDOs">
        <header><div><h5>RDOs da missão</h5><p>Um RDO por dia de execução, com entrega em até 24 horas após o dia de trabalho.</p></div><span>Último RDO: {fmtDate(rdo.lastReportDate)}</span></header>
        <div className="project-execution-rdo-counts">
          <article><strong>{rdo.receivedCount}</strong><span>RDOs recebidos</span></article>
          <article className={rdo.overdueCount ? 'is-overdue' : ''}><strong>{rdo.overdueCount}</strong><span>RDOs atrasados</span></article>
        </div>
        {rdo.overdueCount ? <p className="project-execution-alert" role="status">RDO atrasado: {rdo.overdueCount} {rdo.overdueCount === 1 ? 'dia sem entrega' : 'dias sem entrega'} após o prazo de 24h. {rdo.overdueDates.length ? `Datas recentes: ${rdo.overdueDates.map(day => displayDateOnly(day)).join(', ')}.` : ''}</p> : null}
        <div className="project-execution-report-history"><strong>Últimos RDOs</strong>{rdo.recent.length ? <ul>{rdo.recent.map(report => <li key={report.id}><span>{reportName(report)} · {fmtDate(report.reportDate)}</span><small>{STATUS_LABELS_REPORT[report.status] || report.status}</small></li>)}</ul> : <p className="field-hint">Nenhum RDO registrado.</p>}</div>
      </section>
      <section className="project-execution-signatures" aria-label="Assinaturas dos relatórios">
        <header><div><h5>Relatórios e assinaturas</h5><p>{data.signatures.signedCount} assinado(s) · {data.signatures.pendingCount} sem assinatura.</p></div></header>
        {data.signatures.pendingCount ? <p className="project-execution-alert" role="status">Há {data.signatures.pendingCount} {data.signatures.pendingCount === 1 ? 'relatório não assinado' : 'relatórios não assinados'}.</p> : null}
        <div className="project-execution-signature-columns">
          <div><strong>Assinados</strong>{data.signatures.signedReports.length ? <ul>{data.signatures.signedReports.map(report => <li key={report.id}>{reportName(report)} · {fmtDate(report.reportDate)}</li>)}</ul> : <p className="field-hint">Nenhum relatório assinado.</p>}</div>
          <div><strong>Pendentes</strong>{data.signatures.pendingReports.length ? <ul>{data.signatures.pendingReports.map(report => <li key={report.id}>{reportName(report)} · {fmtDate(report.reportDate)} <small>{STATUS_LABELS_REPORT[report.status]}</small></li>)}</ul> : <p className="field-hint">Nenhuma pendência de assinatura.</p>}</div>
        </div>
      </section>
    </>
  );
}

function ExecutionScopeProgress({ data }: { data: DashboardData }) {
  const scope = data.scope?.services || [];
  const progress = data.progress;
  const progressGroups = progress?.scopeGroups || [{ scopeName: null, services: progress?.services || [] }];
  const overallProgressPct = progress?.hasScope ? progress.progressPct : data.schedule.actualProgressPct;
  return <section className="project-execution-scope-progress" aria-label="Escopo e avanço físico">
    <header><div><h5>Escopo e avanço físico</h5><p>Metas cadastradas e realizado dos RDOs, com o mesmo cálculo do Acompanhamento.</p></div><strong>{fmtPct(overallProgressPct)}</strong></header>
    <div className="project-execution-scope-columns">
      <details className="project-execution-scope-panel">
        <summary><span>Escopo cadastrado</span><small>{scope.length} serviço{scope.length === 1 ? '' : 's'}</small></summary>
        <div className="project-execution-scope-panel-body" role="region" aria-label="Serviços do escopo cadastrado" tabIndex={0}>
        {data.scope === null ? <p className="field-hint">Escopo indisponível no momento.</p> : scope.length ? groupServicesByScope(scope).map(group => <div className="project-execution-scope-group" key={group.scopeName ?? ''}>
        {scope.some(service => service.scopeName) ? <strong>Escopo: {group.scopeName || 'Sem escopo definido'}</strong> : null}
        {group.services.map((service, index) => <article key={service.id || index}>
          <div><strong>{SERVICE_LABELS[service.serviceType] || service.serviceType}</strong>{service.weight != null ? <small>peso {Number(service.weight).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</small> : null}</div>
          <ul>{service.systems.map((system, systemIndex) => <li key={systemIndex}>{system.projectSystemId ? `${system.equipment} · ${system.systemName} · ` : ''}{SYSTEM_LABELS[system.systemType] || system.systemType}{system.diameter ? ` · ${system.diameter} ${system.diameterUnit || 'pol'}` : ''}: {system.quantity ?? '—'} {system.unit || ''}</li>)}</ul>
        </article>)}
      </div>) : <p className="field-hint">Nenhum serviço cadastrado.</p>}
        {data.scope && (data.scope.normalHours.length || data.scope.overtime.length) ? <div className="project-execution-scope-hours"><strong>Horas previstas</strong><ul>{data.scope.normalHours.map((row, index) => <li key={`normal-${row.id || index}`}>Normais · {row.roleName || 'Equipe'}: {Number(row.hours).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h</li>)}{data.scope.overtime.map((row, index) => <li key={`extra-${row.id || index}`}>Extras · {row.roleName || 'Equipe'}: {Number(row.hours).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h</li>)}</ul></div> : null}
        </div>
      </details>
      <details className="project-execution-scope-panel">
        <summary><span>Avanço por serviço</span><small>{fmtPct(overallProgressPct)}</small></summary>
        <div className="project-execution-scope-panel-body" role="region" aria-label="Avanço por serviço" tabIndex={0}>
        {progress === null ? <p className="field-hint">Avanço físico indisponível no momento.</p> : progress.hasScope ? progressGroups.map(group => <div className="project-execution-scope-group" key={group.scopeName ?? ''}>
        {progress.scopeGroups ? <strong>Escopo: {group.scopeName || 'Sem escopo definido'}</strong> : null}
        {group.services.map((service, index) => <article key={index}>
          <div><strong>{SERVICE_LABELS[service.serviceType] || service.serviceType}</strong><small>peso {service.weight.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% · {fmtPct(service.executionPct)}</small></div>
          <ul>{service.systems.map((system, systemIndex) => <li key={systemIndex}>{system.projectSystemId ? `${system.equipment} · ${system.systemName} · ` : ''}{SYSTEM_LABELS[system.systemType] || system.systemType}{system.diameter ? ` · ${system.diameter} ${system.diameterUnit || 'pol'}` : ''}: {system.realizedQty ?? '—'} / {system.plannedQty ?? '—'} {system.unit || ''} · {fmtPct(system.pct)}</li>)}</ul>
        </article>)}
      </div>) : <p className="field-hint">Cadastre o escopo previsto para calcular o avanço físico.</p>}
        </div>
      </details>
    </div>
  </section>;
}

function ExecutionReportsDialog({ reports }: { reports: ProjectExecutionReportSummary[] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ report: ProjectExecutionReportSummary; blob: Blob } | null>(null);

  async function openPdf(report: ProjectExecutionReportSummary) {
    setOpeningId(report.id);
    try {
      setPreview({ report, blob: await downloadReportPdf(report.id) });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Não foi possível abrir o PDF.', 'error');
    } finally {
      setOpeningId(null);
    }
  }

  return <>
    <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Abrir relatórios</Button>
    <Modal open={open && !preview} onClose={() => setOpen(false)} appearance="design-system" title="Relatórios da missão" size="lg" fullscreenOnMobile={false} panelClassName="project-execution-reports-modal">
      <div className="project-execution-dialog"><p className="project-execution-dialog-intro">Selecione um relatório para pré-visualizar o PDF.</p>
        <div className="project-execution-dialog-list">{reports.length ? reports.map(report => <article key={report.id}><div><strong>{reportName(report)}</strong><span>{fmtDate(report.reportDate)} · {STATUS_LABELS_REPORT[report.status] || report.status}</span></div><Button variant="secondary" size="sm" disabled={Boolean(openingId)} onClick={() => void openPdf(report)}>{openingId === report.id ? 'Abrindo…' : 'Abrir PDF'}</Button></article>) : <p className="placeholder-copy">Nenhum relatório registrado para esta missão.</p>}</div>
      </div>
    </Modal>
    <Modal open={Boolean(preview)} onClose={() => setPreview(null)} appearance="design-system" title="Visualizar PDF" size="full" panelClassName="project-execution-pdf-modal">
      {preview ? <div className="project-execution-dialog"><div className="project-execution-pdf-toolbar"><p>{reportName(preview.report)} · {fmtDate(preview.report.reportDate)}</p><Button variant="secondary" size="sm" onClick={() => downloadBlob(preview.blob, `${reportName(preview.report)}.pdf`)}>Baixar PDF</Button></div><Suspense fallback={<BrandLoading label="Preparando visualizador" />}><PdfCanvasViewer blob={preview.blob} /></Suspense></div> : null}
    </Modal>
  </>;
}

function WeeklyReviewForm({ projectId, week, canVerify }: { projectId: string; week: ProjectExecutionWeeklyReviewWeek; canVerify: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [checks, setChecks] = useState<ProjectExecutionWeeklyChecks>(week.checks);
  const [note, setNote] = useState(week.note);
  useEffect(() => {
    setChecks(week.checks);
    setNote(week.note);
  }, [week.checks, week.note, week.weekStartDate]);
  const checkedCount = PROJECT_EXECUTION_WEEKLY_CHECKS.filter(item => checks[item.key]).length;
  const complete = checkedCount === PROJECT_EXECUTION_WEEKLY_CHECKS.length;
  const changed = PROJECT_EXECUTION_WEEKLY_CHECKS.some(item => checks[item.key] !== week.checks[item.key]) || note.trim() !== week.note;
  const save = useMutation({
    mutationFn: () => saveProjectExecutionWeeklyReview(projectId, { weekStartDate: week.weekStartDate, checks, note: note.trim() || null }),
    onSuccess: next => {
      queryClient.setQueryData(['project-execution', projectId], next);
      void queryClient.invalidateQueries({ queryKey: ['project-workflows'] });
      toast(complete ? 'Verificação semanal concluída.' : 'Andamento da verificação salvo.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });
  return <form className="project-execution-weekly-form" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
    <p>Semana de {displayDateOnly(week.weekStartDate)} · verificação prevista para quinta-feira, {displayDateOnly(week.dueDate)}.</p>
    <div className="project-execution-weekly-checks">
      {PROJECT_EXECUTION_WEEKLY_CHECKS.map(item => <label key={item.key} className={checks[item.key] ? 'is-checked' : ''}>
        <input type="checkbox" checked={checks[item.key]} disabled={!canVerify || save.isPending} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />
        <span>{item.label}</span>
      </label>)}
    </div>
    <Field id={`execution-weekly-note-${projectId}`} label="Observações da semana" disabled={!canVerify || save.isPending}>
      <Textarea rows={3} maxLength={2000} value={note} disabled={!canVerify || save.isPending} onChange={event => setNote(event.target.value)} placeholder="Registre dificuldades, paralisações, desvios, incidentes ou encaminhamentos relevantes." />
    </Field>
    <div className="project-execution-weekly-actions"><span>{checkedCount} de {PROJECT_EXECUTION_WEEKLY_CHECKS.length} itens verificados</span>{canVerify ? <Button type="submit" disabled={!changed || save.isPending}>{save.isPending ? 'Salvando…' : complete ? 'Concluir verificação' : 'Salvar andamento'}</Button> : <span>Aguardando um responsável pela gestão do projeto.</span>}</div>
  </form>;
}

function WeeklyExecutionReview({ projectId, data, readOnly }: { projectId: string; data: DashboardData; readOnly: boolean }) {
  const review = data.weeklyReview;
  const [selectedWeekStart, setSelectedWeekStart] = useState<string | null>(null);
  const selectedWeek = review.pending.find(week => week.weekStartDate === selectedWeekStart) || review.pending[0];
  const canVerify = review.permissions.canVerify && !readOnly;
  return <section className="project-execution-weekly" aria-label="Verificação semanal da execução">
    <header><div><h5>Verificação semanal do projeto</h5><p>Checklist dos responsáveis pela gestão do projeto, disponível a cada quinta-feira.</p></div><strong className={review.pendingCount ? 'is-pending' : ''}>{review.pendingCount ? `${review.pendingCount} pendente(s)` : review.active ? 'Em dia' : 'Histórico'}</strong></header>
    {review.pendingCount ? <p className="project-execution-alert" role="status">{review.pendingCount === 1 ? 'Há uma verificação semanal pendente.' : `Há ${review.pendingCount} verificações semanais pendentes.`} As semanas não concluídas permanecem disponíveis até a revisão.</p> : null}
    {selectedWeek ? <>
      {review.pending.length > 1 ? <Field id={`execution-weekly-period-${projectId}`} className="project-execution-weekly-period" label="Semana a verificar"><Select value={selectedWeek.weekStartDate} onChange={event => setSelectedWeekStart(event.target.value)}>{review.pending.map(week => <option key={week.weekStartDate} value={week.weekStartDate}>Quinta-feira, {displayDateOnly(week.dueDate)} · {week.checkedCount}/{PROJECT_EXECUTION_WEEKLY_CHECKS.length} itens</option>)}</Select></Field> : null}
      <WeeklyReviewForm key={selectedWeek.weekStartDate} projectId={projectId} week={selectedWeek} canVerify={canVerify} />
    </> : review.active ? <div className="project-execution-weekly-preview"><p>Nenhuma verificação pendente. Próxima revisão: quinta-feira, {fmtDate(review.nextDueDate)}.</p><strong>Itens da próxima verificação</strong><ul>{PROJECT_EXECUTION_WEEKLY_CHECKS.map(item => <li key={item.key}>{item.label}</li>)}</ul></div> : <p className="field-hint">A verificação semanal é realizada durante a etapa de execução.</p>}
    {review.recentCompleted.length ? <div className="project-execution-weekly-history"><strong>Últimas verificações concluídas</strong><ul>{review.recentCompleted.map(week => <li key={week.weekStartDate}><span>Semana de {displayDateOnly(week.weekStartDate)}</span><small>{week.completedBy?.name || 'Responsável não informado'} · {week.completedAt ? new Date(week.completedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</small></li>)}</ul></div> : null}
  </section>;
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
        <Field id="execution-deviation-category" label="Categoria" required errorText={errors.category?.message}><Select disabled={create.isPending} {...register('category')}>{PROJECT_EXECUTION_DEVIATION_CATEGORIES.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</Select></Field>
        <Field id="execution-deviation-impact" label="Impacto" required errorText={errors.impact?.message}><Select disabled={create.isPending} {...register('impact')}>{Object.entries(IMPACT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field>
        <Field id="execution-deviation-owner" label="Responsável" required errorText={errors.ownerName?.message}><Input disabled={create.isPending} {...register('ownerName')} /></Field>
        <Field id="execution-deviation-date" label="Data limite" required errorText={errors.dueDate?.message}><Input type="date" disabled={create.isPending} {...register('dueDate')} /></Field>
        <Field id="execution-deviation-description" className="project-execution-wide-field" label="Descrição" required errorText={errors.description?.message}><Textarea rows={3} disabled={create.isPending} {...register('description')} /></Field>
        <Field id="execution-deviation-action" className="project-execution-wide-field" label="Ação definida" required errorText={errors.action?.message}><Textarea rows={3} disabled={create.isPending} {...register('action')} /></Field>
        <Field id="execution-deviation-status" label="Status" required errorText={errors.status?.message}><Select disabled={create.isPending} {...register('status')}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field>
        <div className="project-execution-form-actions"><Button type="button" variant="secondary" disabled={create.isPending} onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? 'Registrando…' : 'Registrar desvio'}</Button></div>
      </form> : null}
      {data.deviations.length ? <div className="project-execution-deviation-list">{data.deviations.map(deviation => {
        const impact = deviation.impact || 'BAIXO';
        const status = deviation.status || 'ABERTO';
        return <details className={status === 'FECHADO' || status === 'DIVULGADO' ? 'is-closed' : ''} key={deviation.id}>
          <summary>
            <div><span>{deviation.number} · {deviation.origin || 'Origem não informada'}</span><strong>{deviation.description || 'Descrição não informada'}</strong><small>{STATUS_LABELS[status]} · Prazo: {fmtDate(deviation.actionDeadline)}</small></div>
            <span className={`project-execution-deviation-impact is-${impact.toLowerCase()}`}>{IMPACT_LABELS[impact]}</span>
            <span className="project-execution-deviation-toggle"><span>Ver detalhes</span><span>Ocultar detalhes</span></span>
          </summary>
          <div className="project-execution-deviation-detail">
            <Field id={`execution-deviation-${deviation.id}`} className="project-execution-deviation-status" label="Status" disabled={!data.permissions.canEdit || updateStatus.isPending}><Select value={status} disabled={!data.permissions.canEdit || updateStatus.isPending} onChange={event => updateStatus.mutate({ id: deviation.id, status: event.target.value as ProjectExecutionDeviationStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field>
            <p>{deviation.description || 'Descrição não informada'}</p>
            <dl><div><dt>Responsável</dt><dd>{deviation.actionOwner || '—'}</dd></div><div><dt>Prazo</dt><dd>{fmtDate(deviation.actionDeadline)}</dd></div><div><dt>Ação</dt><dd>{deviation.definedAction || '—'}</dd></div></dl>
          </div>
        </details>})}</div> : <p className="placeholder-copy">Nenhum desvio registrado para este projeto.</p>}
    </section>
  );
}

export function ProjectExecutionDashboard({ projectId, missionId, canManageTargets = false, readOnly = false }: { projectId: string; missionId?: string; canManageTargets?: boolean; readOnly?: boolean }) {
  const query = useQuery({ queryKey: ['project-execution', projectId], queryFn: () => getProjectExecutionDashboard(projectId) });
  const queryClient = useQueryClient();
  useEffect(() => {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
    let currentDay = formatter.format(new Date());
    const timer = window.setInterval(() => {
      const nextDay = formatter.format(new Date());
      if (nextDay === currentDay) return;
      currentDay = nextDay;
      void queryClient.invalidateQueries({ queryKey: ['project-execution', projectId] });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [projectId, queryClient]);
  if (query.isLoading) return <section className="project-execution-dashboard placeholder-copy"><BrandLoading label="Carregando painel de execução" /></section>;
  if (query.isError || !query.data) return <section className="project-execution-dashboard placeholder-copy"><p>Não foi possível carregar o painel de execução.</p><Button variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button></section>;
  const dashboard = readOnly ? { ...query.data, permissions: { ...query.data.permissions, canEdit: false } } : query.data;
  return (
    <section className="project-execution-dashboard" data-fv-ds="true" data-project-execution-dashboard>
      <header><div><h4>Dashboard de execução</h4><p>Escopo, avanço físico, RDOs, assinaturas e desvios da obra.</p></div><ExecutionReportsDialog key={projectId} reports={dashboard.reports} /></header>
      <ExecutionOverview data={dashboard} />
      <ExecutionScopeProgress data={dashboard} />
      {missionId ? <MissionWeeklyProgressPanel key={missionId} owner={{ area: 'efetivo', missionId }} canManage={canManageTargets && !readOnly} /> : null}
      <WeeklyExecutionReview projectId={projectId} data={dashboard} readOnly={readOnly} />
      <Deviations projectId={projectId} data={dashboard} />
    </section>
  );
}
