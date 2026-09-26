import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';

import {
  createProjectManagementNote,
  createManualProjectCost,
  deleteManualProjectCost,
  getMissionGroupDetail,
  getProjectPlanningContext,
  getProjectDetail,
  getProjectProgress,
  listProjectManagementNotes,
  type ManualProjectCost,
  type ManualProjectCostPayload,
  type ProjectDetailCollaborator,
  type ProjectManagementNote,
} from '../../api/acompanhamentoComercial';
import { listProjectQualityDeviations, type ProjectDeviation } from '../../api/qualidade';
import { qualityDeviationProjects } from './projectQualityDeviations';
import { Modal } from '../ui/Modal';
import { ProjectScheduleEditor, type ScheduleEditorHandle } from './ProjectScheduleEditor';
import { ProjectAdditionalProposalsNovelty } from './ProjectAdditionalProposalsNovelty';
import { ProjectCollaboratorHoursDialog } from './ProjectCollaboratorHoursDialog';
import { ProjectManualCostNovelty } from './ProjectManualCostNovelty';
import { ProjectQualityDeviationsNovelty } from './ProjectQualityDeviationsNovelty';
import { ProjectProgressHistoryNovelty } from './ProjectProgressHistoryNovelty';
import { ProjectReportsDialog } from './ProjectReportsDialog';
import { ProjectRomaneiosDialog } from './ProjectRomaneiosDialog';
import { ProjectInvoicesSection } from './ProjectInvoicesSection';
import { ProjectStandbyHistoryDialog } from './ProjectStandbyHistoryDialog';
import { ProjectStandbyHistoryNovelty } from './ProjectStandbyHistoryNovelty';
import { ProjectWeeklyTargetNovelty } from './ProjectWeeklyTargetNovelty';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';
import { Card, Button, Badge, Alert, Field, Input, Select, Textarea, Skeleton, EmptyState } from '../ui/ds';
import { AppIcon } from '../icons/AppIcon';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { ProjectDetailPeople } from './ProjectDetailPeople';
import { ProjectDetailTaxes } from './ProjectDetailCosts';
import { ProjectDetailOverview } from './ProjectDetailOverview';
import { ProjectBillingSnapshot, ProjectFinancialSnapshot, ProjectTimeSnapshot, ProjectTimelineCard } from './ProjectDetailStory';
import { ProjectScopeDailyTable } from './ProjectScopeDailyTable';
import { brl, fmtDate, fmtDateTime, fmtPct, hasMoney, manualCostFormDefaultValues, manualCostFormResolver, manualCostFormValuesToPayload, formatBrlCurrencyInput, mutationErrorMessage, QUALITY_IMPACT_LABELS, QUALITY_STATUS_LABELS, QUALITY_DISPOSITION_LABELS, type ManualCostFormValues } from './projectDetailModel';
import './ProjectDetailDashboard.ds.css';
import type { AuthUser } from '../../types/auth';

const equipmentNameCollator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

// Dashboard detalhado de um projeto (aberto ao clicar num card da aba Projetos).
export function ProjectDetailDashboard({
  projectId,
  groupId,
  canManage = false,
  canManageManualCosts = false,
  canManageProjectNotes = false,
  progressHistoryNoveltyUser = null,
  onBack
}: {
  projectId?: string;
  groupId?: string;
  canManage?: boolean;
  canManageManualCosts?: boolean;
  canManageProjectNotes?: boolean;
  progressHistoryNoveltyUser?: Pick<AuthUser, 'id'> | null;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [scheduleProject, setScheduleProject] = useState<{ projectId: string; code: string } | null>(null);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [progressScopeKey, setProgressScopeKey] = useState('');
  const [progressEquipmentKey, setProgressEquipmentKey] = useState('');
  const [progressHistoryNoveltyActive, setProgressHistoryNoveltyActive] = useState(true);
  const [weeklyTargetNoveltyActive, setWeeklyTargetNoveltyActive] = useState(true);
  const [manualCostNoveltyActive, setManualCostNoveltyActive] = useState(true);
  const [qualityDeviationsNoveltyActive, setQualityDeviationsNoveltyActive] = useState(true);
  const [additionalProposalsNoveltyActive, setAdditionalProposalsNoveltyActive] = useState(true);
  const [standbyHistoryNoveltyActive, setStandbyHistoryNoveltyActive] = useState(true);
  const [standbyHistoryOpen, setStandbyHistoryOpen] = useState(false);
  const [hoursDetail, setHoursDetail] = useState<{
    collaborator: ProjectDetailCollaborator;
    source: 'POINT' | 'REPORT';
  } | null>(null);
  const [expandedQualityDeviationIds, setExpandedQualityDeviationIds] = useState<Set<string>>(() => new Set());
  const [manualCostFormOpen, setManualCostFormOpen] = useState(false);
  const [manualCostError, setManualCostError] = useState<string | null>(null);
  const [deletingManualCostId, setDeletingManualCostId] = useState<string | null>(null);
  const [projectNoteContent, setProjectNoteContent] = useState('');
  const [projectNoteError, setProjectNoteError] = useState<string | null>(null);
  const { control, register, handleSubmit, reset, formState: { errors } } = useForm<ManualCostFormValues>({
    defaultValues: manualCostFormDefaultValues,
    resolver: manualCostFormResolver
  });
  const scheduleRef = useRef<ScheduleEditorHandle>(null);
  const isGroup = Boolean(groupId);
  const detailKey = isGroup ? ['mission-group-detail', groupId] : ['project-detail', projectId];
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: detailKey,
    queryFn: () => isGroup ? getMissionGroupDetail(groupId!) : getProjectDetail(projectId!),
    ...acompanhamentoRefreshQueryOptions
  });
  const projectNotesKey = ['project-management-notes', projectId] as const;
  const {
    data: projectNotes = [],
    isLoading: projectNotesLoading,
    isError: projectNotesLoadError,
    refetch: refetchNotes
  } = useQuery<ProjectManagementNote[]>({
    queryKey: projectNotesKey,
    queryFn: () => listProjectManagementNotes(projectId!),
    enabled: !isGroup && Boolean(projectId)
  });
  const { data: projectProgress } = useQuery({
    queryKey: ['project-progress', projectId],
    queryFn: () => getProjectProgress(projectId!),
    enabled: !isGroup && Boolean(projectId),
    ...acompanhamentoRefreshQueryOptions
  });
  const planningReferenceDate = data?.header.lastRdoDate?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const { data: planningContext, isLoading: planningContextLoading, isError: planningContextError, refetch: refetchPlanning } = useQuery({
    queryKey: ['acompanhamento-planning-context', projectId, planningReferenceDate],
    queryFn: () => getProjectPlanningContext(projectId!, planningReferenceDate),
    enabled: !isGroup && Boolean(projectId && data)
  });
  const deviationProjects = qualityDeviationProjects(data, projectId, isGroup);
  const qualityDeviationQueries = useQueries({
    queries: deviationProjects.map(deviationProject => ({
      queryKey: ['qualidade', 'project-deviations', deviationProject.projectId],
      queryFn: () => listProjectQualityDeviations(deviationProject.projectId)
    }))
  });
  function toggleQualityDeviation(id: string) {
    setExpandedQualityDeviationIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const refreshCostViews = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: detailKey }),
      queryClient.invalidateQueries({ queryKey: ['project-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['project-cards'] }),
      queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] })
    ]);
  };
  const createManualCostMutation = useMutation({
    mutationFn: (payload: ManualProjectCostPayload) => {
      if (!projectId) throw new Error('Abra uma missão individual para adicionar custo manual.');
      return createManualProjectCost(projectId, payload);
    },
    onSuccess: async () => {
      setManualCostError(null);
      reset(manualCostFormDefaultValues);
      setManualCostFormOpen(false);
      await refreshCostViews();
    },
    onError: (error: unknown) => {
      setManualCostError(mutationErrorMessage(error, 'Não foi possível adicionar o custo manual.'));
    }
  });
  const deleteManualCostMutation = useMutation({
    mutationFn: (cost: ManualProjectCost) => deleteManualProjectCost(cost.projectId, cost.id),
    onMutate: (cost) => {
      setManualCostError(null);
      setDeletingManualCostId(cost.id);
    },
    onSuccess: async () => {
      await refreshCostViews();
    },
    onError: (error: unknown) => {
      setManualCostError(mutationErrorMessage(error, 'Não foi possível remover o custo manual.'));
    },
    onSettled: () => setDeletingManualCostId(null)
  });
  const createProjectNoteMutation = useMutation({
    mutationFn: (content: string) => {
      if (!projectId) throw new Error('Abra uma missão individual para adicionar a nota.');
      return createProjectManagementNote(projectId, content);
    },
    onSuccess: (note) => {
      queryClient.setQueryData<ProjectManagementNote[]>(projectNotesKey, current => [note, ...(current ?? [])]);
      setProjectNoteContent('');
      setProjectNoteError(null);
    },
    onError: (error: unknown) => {
      setProjectNoteError(mutationErrorMessage(error, 'Não foi possível adicionar a nota.'));
    }
  });
  const submitManualCost = handleSubmit(values => {
    if (!canManageManualCosts || isGroup || createManualCostMutation.isPending) return;
    setManualCostError(null);
    createManualCostMutation.mutate(manualCostFormValuesToPayload(values));
  });

  function submitProjectNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = projectNoteContent.trim();
    if (!canManageProjectNotes || isGroup || !content || createProjectNoteMutation.isPending) return;
    setProjectNoteError(null);
    createProjectNoteMutation.mutate(content);
  }

  function closeSchedule() {
    setScheduleProject(null);
    setScheduleDirty(false);
  }

  function openManualCostForm() {
    setManualCostError(null);
    setManualCostFormOpen(true);
  }

  function closeManualCostForm() {
    setManualCostError(null);
    reset(manualCostFormDefaultValues);
    setManualCostFormOpen(false);
  }

  if (!data) {
    return (
      <div className="fv-ds acp-detail">
        <div><Button size="sm" variant="secondary" iconLeft={<AppIcon icon={ArrowLeft} />} onClick={onBack}>Voltar</Button></div>
        {isError ? (
          <Alert tone="danger" title={isGroup ? 'Não foi possível carregar o agrupamento.' : 'Não foi possível carregar o projeto.'}
            action={<Button size="sm" variant="secondary" onClick={() => void refetch()}>Tentar novamente</Button>}>
            Tente novamente para consultar os dados.
          </Alert>
        ) : isLoading ? (
          <div className="acp-detail-loading" role="status" aria-label="Carregando detalhe do projeto">
            <Skeleton height={100} />
            <div className="acp-detail-loading-grid">{[0, 1, 2, 3].map(key => <Skeleton key={key} height={180} />)}</div>
          </div>
        ) : <EmptyState title="Projeto indisponível" description="Volte à lista para selecionar outro projeto." />}
      </div>
    );
  }

  const h = data.header;
  const equipamentos = [...(data.equipamentos ?? [])].sort((a, b) =>
    equipmentNameCollator.compare(a.name, b.name) || equipmentNameCollator.compare(a.code ?? '', b.code ?? '')
  );
  // Avanço por Escopo e/ou equipamento do cliente: o recorte troca o percentual, o ritmo e o
  // histórico. A combinação escolhida aponta para um recorte já calculado pelo backend.
  const progressFilters = isGroup ? null : data.progressFilters ?? null;
  const progressScopes = progressFilters?.scopes ?? [];
  const progressEquipments = progressFilters?.equipments ?? [];
  const activeScopeKey = progressScopes.some(item => item.key === progressScopeKey) ? progressScopeKey : '';
  const activeEquipmentKey = progressEquipments.some(item => item.key === progressEquipmentKey) ? progressEquipmentKey : '';
  const combinationAvailable = (scopeKey: string, equipmentKey: string) =>
    (!scopeKey && !equipmentKey) || progressFilters?.lookup[`${scopeKey}|${equipmentKey}`] !== undefined;
  const sliceIndex = progressFilters?.lookup[`${activeScopeKey}|${activeEquipmentKey}`];
  const selectedProgressSlice = progressFilters && typeof sliceIndex === 'number' ? progressFilters.slices[sliceIndex] : null;
  const progressFilterLabel = [
    progressScopes.find(item => item.key === activeScopeKey)?.name,
    progressEquipments.find(item => item.key === activeEquipmentKey)?.name
  ].filter(Boolean).join(' · ');
  const shownAvancoPct = selectedProgressSlice ? selectedProgressSlice.avancoPct : data.avancoPct;
  const shownProgressHistory = selectedProgressSlice ? selectedProgressSlice.progressHistory : data.progressHistory;
  const shownDailyProgressHistory = selectedProgressSlice ? selectedProgressSlice.dailyProgressHistory : data.dailyProgressHistory;
  const shownRequiredWeeklyProgress = selectedProgressSlice ? selectedProgressSlice.requiredWeeklyProgress : data.requiredWeeklyProgress;
  const changeProgressScope = (scopeKey: string) => {
    setProgressScopeKey(scopeKey);
    if (!combinationAvailable(scopeKey, activeEquipmentKey)) setProgressEquipmentKey('');
  };
  const manualCosts = data.manualCosts ?? [];
  const plannedCollaborators = planningContext?.collaborators ?? [];
  const showingPlannedCollaborators = !data.header.lastRdoDate && plannedCollaborators.length > 0;
  const collaborators: ProjectDetailCollaborator[] = showingPlannedCollaborators
    ? plannedCollaborators.map(collaborator => ({
      name: collaborator.name, role: collaborator.jobRole.name, horas: 0, horasLancadas: 0,
      horasApropriadas: null, horasDeslocamento: 0, diasApropriados: [], sobreposicaoHoras: 0,
      horasRelatoriosPorData: [], custo: null, custoHora: null, custoEstimadoRdo: null,
      custoHoraEstimadoRdo: null, custoDeslocamento: null
    })) : data.colaboradores;
  const canAddManualCost = canManageManualCosts && !isGroup && Boolean(projectId);
  const deviationCount = qualityDeviationQueries.length > 0 && qualityDeviationQueries.every(query => query.isSuccess)
    ? qualityDeviationQueries.reduce((count, query) => count + (query.data?.length ?? 0), 0) : null;
  const hasAdditionalProposalContribution = (data.budgetBreakdown?.additionals ?? []).some(item => (
    hasMoney(item.salePrice) || hasMoney(item.plannedTotalCost) || hasMoney(item.expectedProfit) || hasMoney(item.taxes)
  ));

  return (
    <>
    <div className="fv-ds acp-detail">
      <div className="acp-detail-bar">
        <Button type="button" size="sm" variant="secondary" iconLeft={<AppIcon icon={ArrowLeft} />} onClick={onBack}>Voltar</Button>
        {canManage && !isGroup ? (
          <Button type="button" size="sm" variant="primary" iconLeft={<AppIcon icon={CalendarDays} />} onClick={() => setScheduleProject({ projectId: projectId!, code: h.code })}>
            Editar cronograma
          </Button>
        ) : null}
      </div>

      {isError ? <Alert tone="warning" title="Não foi possível atualizar o projeto."
        action={<Button size="sm" variant="secondary" onClick={() => void refetch()}>Tentar novamente</Button>}>
        Os dados exibidos podem estar desatualizados.
      </Alert> : null}
      <Card padding="sm" className="acp-detail-header">
        <div className="acp-detail-hero-copy">
          <p className="acp-detail-eyebrow">Acompanhamento · {isGroup ? 'Grupo' : 'Missão'} {h.code}</p>
          <h1>{h.clientName || `${isGroup ? 'Grupo' : 'Missão'} ${h.code}`}</h1>
          <div className="acp-detail-header-meta">
            {h.proposalCode ? <span>Proposta <strong>{h.proposalCode}</strong></span> : null}
            <span>Último RDO <strong>{fmtDate(h.lastRdoDate)}</strong></span>
            <span>Início <strong>{fmtDate(data.footer.startDate)}</strong></span>
            {h.segment ? <Badge tone="neutral" multiline>{h.segment}</Badge> : null}
          </div>
          {data.alerts.length > 0 ? (
            <div className="acp-detail-alerts">
              {data.alerts.map((a, i) => <Badge key={i} tone={a.level === 'danger' ? 'danger' : 'warning'} multiline>{a.label}</Badge>)}
            </div>
          ) : null}
        </div>
        <div className="acp-detail-hero-progress">
          <span>Avanço · {progressFilterLabel || 'Escopo total'}</span>
          <strong>{fmtPct(shownAvancoPct)}</strong>
          <div className="acp-detail-hero-track" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, shownAvancoPct ?? 0))}%` }} /></div>
          <small>{shownAvancoPct == null ? 'Aguardando medição do escopo' : 'Meta do escopo: 100%'}</small>
        </div>
        {data.group ? (
          <div className="acp-detail-group-members" aria-label="Missões unificadas">
            {data.group.members.map(member => (
              <span key={member.projectId}>
                <strong>{member.code}</strong>
                {member.name || member.clientName ? <em>{member.name || member.clientName}</em> : null}
                {canManage ? (
                  <Button
                    type="button"
                    size="sm" variant="secondary" className="acp-detail-group-schedule"
                    onClick={() => setScheduleProject({ projectId: member.projectId, code: member.code })}
                  >
                    Cronograma
                  </Button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
      </Card>

      <ProjectDetailOverview
        data={data}
        progressPct={shownAvancoPct}
        progressHistory={shownProgressHistory}
        chartKey={`${activeScopeKey}|${activeEquipmentKey}`}
        target={shownRequiredWeeklyProgress}
        fallbackProgress={isGroup ? data.progressBreakdown : undefined}
        fallbackServices={!activeScopeKey && !activeEquipmentKey && projectProgress?.hasScope ? projectProgress.services : undefined}
        filterLabel={progressFilterLabel}
        teamCount={collaborators.length}
        teamIsPlanned={showingPlannedCollaborators}
        deviationCount={deviationCount}
        filters={progressFilters && (progressScopes.length > 0 || progressEquipments.length > 0) ? (
          <div className="acp-detail-progress-filters" aria-label="Filtrar avanço do projeto">
            <Field id="acp-progress-scope" label="Escopo" optionalText="">
              <Select size="sm" value={activeScopeKey} onChange={event => changeProgressScope(event.target.value)}>
                <option value="">Todos os escopos</option>
                {progressScopes.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
              </Select>
            </Field>
            <Field id="acp-progress-equipment" label="Equipamento do cliente" optionalText="">
              <Select size="sm" value={activeEquipmentKey} onChange={event => setProgressEquipmentKey(event.target.value)}>
                <option value="">Todos os equipamentos</option>
                {progressEquipments.filter(item => combinationAvailable(activeScopeKey, item.key)).map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
              </Select>
            </Field>
          </div>
        ) : null}
      />

      <div className="acp-detail-section-head" id="acp-execution">
        <p>Planejamento e execução</p><h2>Prazos com contexto</h2>
        <span>Datas, uso do tempo, avanço e escopo realizado no mesmo lugar.</span>
      </div>

      <ProjectTimelineCard data={data} />

      {!isGroup ? (
        <Card padding="sm" className="acp-detail-planning" data-acp-planning-context>
          <div>
            <span className="acp-detail-sub">Planejamento do Efetivo</span>
            {planningContextError ? <Alert tone="warning" title="Não foi possível carregar o planejamento."
              action={<Button size="sm" variant="secondary" onClick={() => void refetchPlanning()}>Tentar novamente</Button>} />
              : planningContextLoading ? <Skeleton height={48} />
              : planningContext ? (
                <>
                  <strong>{planningContext.collaborators.length} {planningContext.collaborators.length === 1 ? 'colaborador planejado' : 'colaboradores planejados'}</strong>
                  <p>
                    Execução de {fmtDate(planningContext.dates.executionStartDate)} a {fmtDate(planningContext.dates.executionEndDate)}
                    {' · '}plano rev. {planningContext.planRevision}
                  </p>
                </>
              ) : <p className="acp-detail-muted">Sem missão oficial vigente na data de referência.</p>}
          </div>
          {planningContext ? (
            <div className="acp-detail-planning-team">
              {planningContext.collaborators.map(collaborator => (
                <span key={collaborator.id}>{collaborator.name}<small>{collaborator.jobRole.name}</small></span>
              ))}
              {planningContext.needsReplanning ? <Badge tone="warning" multiline>Replanejamento necessário{planningContext.replanningReason ? `: ${planningContext.replanningReason}` : ''}</Badge> : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      <ProjectTimeSnapshot
        data={data}
        onOpenStandbyHistory={!isGroup ? () => setStandbyHistoryOpen(true) : undefined}
        reportsAction={!isGroup && projectId ? (
          <ProjectReportsDialog projectId={projectId} missionLabel={`Missão ${h.code} · ${h.clientName}`} />
        ) : null}
      />

      <div className="acp-detail-cols">
        {/* Custos e impostos */}
        <div className={`acp-detail-col${data.canViewProjectFinancials ? '' : ' is-restricted'}`} id="acp-financial">
          <div className="acp-detail-section-head">
            <p>Financeiro</p><h2>Gastos e retorno</h2>
            <span>Consumo, origem dos custos e impostos do projeto.</span>
          </div>
          <ProjectFinancialSnapshot data={data}>
            {(manualCosts.length > 0 || canAddManualCost || (canManageManualCosts && isGroup)) ? (
              <div className="acp-detail-manual-costs" data-acp-manual-costs>
                <div className="acp-detail-manual-costs-head">
                  <div className="acp-detail-sub">Custos manuais</div>
                  {canAddManualCost ? (
                    <Button
                      type="button"
                      size="sm" variant="secondary" className="acp-detail-manual-cost-toggle"
                      aria-controls="acp-manual-cost-form"
                      aria-expanded={manualCostFormOpen}
                      data-acp-manual-cost-add
                      onClick={manualCostFormOpen ? closeManualCostForm : openManualCostForm}
                    >
                      {manualCostFormOpen ? 'Cancelar' : 'Adicionar custo'}
                    </Button>
                  ) : null}
                </div>
                {manualCosts.length > 0 ? (
                  <ul className="acp-detail-manual-cost-list">
                    {manualCosts.map(cost => (
                      <li key={cost.id}>
                        <div>
                          <strong>{cost.description}</strong>
                          <span>
                            {isGroup && cost.projectCode ? `Missão ${cost.projectCode} · ` : ''}
                            {fmtDate(cost.costDate ?? cost.createdAt)}
                            {cost.createdBy?.name ? ` · ${cost.createdBy.name}` : ''}
                          </span>
                          {cost.note ? <em>{cost.note}</em> : null}
                        </div>
                        <div className="acp-detail-manual-cost-actions">
                          <strong>{brl(cost.amount)}</strong>
                          {canManageManualCosts ? (
                            <Button
                              type="button"
                              size="sm" variant="danger"
                              disabled={deleteManualCostMutation.isPending && deletingManualCostId === cost.id}
                              onClick={() => deleteManualCostMutation.mutate(cost)}
                            >
                              {deleteManualCostMutation.isPending && deletingManualCostId === cost.id ? 'Removendo…' : 'Excluir'}
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="acp-detail-muted">Nenhum custo manual lançado.</div>
                )}
                {manualCostError ? <Alert tone="danger">{manualCostError}</Alert> : null}

                {canAddManualCost && manualCostFormOpen ? (
                  <form id="acp-manual-cost-form" className="acp-detail-manual-cost-form" onSubmit={submitManualCost}>
                    <Field id="acp-manual-cost-description" label="Descrição" required errorText={errors.description?.message}>
                      <Input {...register('description')} maxLength={120} />
                    </Field>
                    <Field id="acp-manual-cost-amount" label="Valor" required errorText={errors.amount?.message}>
                      <Controller
                        name="amount"
                        control={control}
                        render={({ field }) => (
                          <Input
                            name={field.name}
                            ref={field.ref}
                            value={field.value}
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            aria-invalid={Boolean(errors.amount)}
                            required
                            onBlur={field.onBlur}
                            onChange={event => field.onChange(formatBrlCurrencyInput(event.target.value))}
                          />
                        )}
                      />
                    </Field>
                    <Field id="acp-manual-cost-date" label="Data" errorText={errors.costDate?.message}>
                      <Input {...register('costDate')} type="date" />
                    </Field>
                    <Field id="acp-manual-cost-note" label="Observação" className="acp-detail-form-wide" errorText={errors.note?.message}>
                      <Textarea {...register('note')} maxLength={500} rows={3} />
                    </Field>
                    <div className="acp-detail-actions acp-detail-form-wide">
                      <Button type="submit" size="sm" variant="primary" disabled={createManualCostMutation.isPending}>
                        {createManualCostMutation.isPending ? 'Salvando…' : 'Adicionar custo'}
                      </Button>
                    </div>
                  </form>
                ) : null}
              </div>
            ) : null}
          </ProjectFinancialSnapshot>
          {data.canViewProjectFinancials ? (
            <div className="acp-detail-financial-side">
              <ProjectBillingSnapshot data={data} />
              <ProjectDetailTaxes data={data} />
            </div>
          ) : null}
        </div>

      </div>

      {data.canViewProjectFinancials ? <ProjectInvoicesSection key={groupId || projectId} projectId={projectId} groupId={groupId} /> : null}

      <div className="acp-detail-section-head" id="acp-quality">
        <p>Qualidade e gestão</p><h2>Desvios que pedem ação</h2>
        <span>Impacto, situação e notas aparecem antes do texto completo.</span>
      </div>

      <div className={`acp-detail-quality-grid${isGroup ? ' is-group' : ''}`}>
      {deviationProjects.length > 0 ? (
        <Card padding="sm" className="acp-detail-block acp-detail-deviations" data-quality-project-deviations>
          <details className="acp-detail-deviations-details" open>
            <summary className="acp-detail-summary">Desvios</summary>
            <div className="acp-detail-deviations-toolbar">
              <a className="fv-button fv-button--secondary fv-button--sm" href="/qualidade?tab=registros">
                <span className="fv-button__label">Abrir Qualidade</span>
              </a>
            </div>
            <div className={`quality-deviation-projects${isGroup ? ' is-grouped' : ''}`}>
          {deviationProjects.map((deviationProject, projectIndex) => {
            const deviationQuery = qualityDeviationQueries[projectIndex];
            const deviations: ProjectDeviation[] = deviationQuery?.data ?? [];
            const projectLabel = deviationProject.name || deviationProject.clientName;
            const titleId = `quality-deviation-project-${projectIndex}`;
            return <section className="quality-deviation-project" key={deviationProject.projectId} aria-labelledby={isGroup ? titleId : undefined}>
              {isGroup ? <div className="quality-deviation-project-head">
                <h3 id={titleId}>Missão {deviationProject.code || 'sem código'}{projectLabel ? <span>{projectLabel}</span> : null}</h3>
                {!deviationQuery?.isLoading && !deviationQuery?.isError ? <Badge tone="neutral">{deviations.length} {deviations.length === 1 ? 'desvio' : 'desvios'}</Badge> : null}
              </div> : null}
          {deviationQuery?.isError ? (
            <Alert tone="warning" title="Não foi possível carregar os desvios."
              action={<Button size="sm" variant="secondary" onClick={() => void deviationQuery.refetch()}>Tentar novamente</Button>} />
          ) : deviationQuery?.isLoading ? <Skeleton height={64} /> : deviations.length === 0 ? (
            <div className="acp-detail-muted">Nenhum desvio registrado.</div>
          ) : (
            <ul className="acp-detail-deviation-list">
              {deviations.map(deviation => {
                const expanded = expandedQualityDeviationIds.has(deviation.id);
                const detailsId = `quality-deviation-${deviation.id}`;
                return (
                  <li key={deviation.id} className={expanded ? 'is-expanded' : ''}>
                    <div className="acp-detail-deviation-row">
                      <div className="acp-detail-deviation-main">
                        <strong>{deviation.number}</strong>
                        <span>{deviation.nature?.name || '—'}</span>
                        <small>{fmtDate(deviation.eventDate)}</small>
                      </div>
                      <div className="acp-detail-deviation-meta">
                        <Badge tone={deviation.impact === 'ALTO' ? 'danger' : deviation.impact === 'MEDIO' ? 'warning' : 'info'}>
                          {QUALITY_IMPACT_LABELS[deviation.impact] || deviation.impact}
                        </Badge>
                        <Badge tone="neutral" multiline>{QUALITY_STATUS_LABELS[deviation.status] || deviation.status}</Badge>
                        <Badge tone={deviation.recurrent ? 'warning' : 'neutral'}>
                          {deviation.occurrences12m}x 12m
                        </Badge>
                        <Button
                          type="button"
                          size="sm" variant="secondary" className="acp-detail-deviation-toggle"
                          aria-expanded={expanded}
                          aria-controls={detailsId}
                          onClick={() => toggleQualityDeviation(deviation.id)}
                        >
                          {expanded ? 'Recolher' : 'Ver mais'}
                        </Button>
                      </div>
                    </div>
                    {expanded ? (
                      <div id={detailsId} className="acp-detail-deviation-details">
                        <dl className="acp-detail-deviation-fields">
                          <div>
                            <dt>Disposição</dt>
                            <dd>{QUALITY_DISPOSITION_LABELS[deviation.disposition] || deviation.disposition}</dd>
                          </div>
                          <div>
                            <dt>Origem</dt>
                            <dd>{deviation.origin || '—'}</dd>
                          </div>
                          {deviation.linkedRnc ? (
                            <div>
                              <dt>RNC vinculada</dt>
                              <dd>{deviation.linkedRnc}</dd>
                            </div>
                          ) : null}
                          {deviation.actionDeadline ? (
                            <div>
                              <dt>Prazo da ação</dt>
                              <dd>{fmtDate(deviation.actionDeadline)}</dd>
                            </div>
                          ) : null}
                        </dl>
                        <div className="acp-detail-deviation-text">
                          <span>Descrição</span>
                          <p>{deviation.description}</p>
                        </div>
                        {deviation.definedAction || deviation.actionOwner ? (
                          <div className="acp-detail-deviation-text">
                            <span>Ação definida</span>
                            <p>
                              {deviation.definedAction || '—'}
                              {deviation.actionOwner ? ` · Responsável: ${deviation.actionOwner}` : ''}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          </section>;
          })}
            </div>
          </details>
        </Card>
      ) : null}

      {!isGroup ? (
        <Card padding="sm" className="acp-detail-notes" data-acp-project-notes aria-labelledby="acp-project-notes-title">
          <div className="acp-detail-notes-head">
            <h3 id="acp-project-notes-title">Notas da gestão</h3>
            <Badge tone="neutral">{projectNotes.length} {projectNotes.length === 1 ? 'nota' : 'notas'}</Badge>
          </div>

          {canManageProjectNotes ? (
            <form className="acp-detail-note-form" onSubmit={submitProjectNote}>
              <Field id="acp-project-note-content" label="Nova nota" optionalText="" className="acp-detail-note-field">
                <Textarea
                  value={projectNoteContent}
                  onChange={event => setProjectNoteContent(event.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="Adicionar uma nota…"
                  disabled={createProjectNoteMutation.isPending}
                />
              </Field>
              <Button
                type="submit"
                size="sm" variant="primary"
                disabled={!projectNoteContent.trim() || createProjectNoteMutation.isPending}
              >
                {createProjectNoteMutation.isPending ? 'Adicionando…' : 'Adicionar'}
              </Button>
            </form>
          ) : null}

          {projectNoteError ? <Alert tone="danger">{projectNoteError}</Alert> : null}
          {projectNotesLoadError ? (
            <Alert tone="warning" title="Não foi possível carregar as notas." action={<Button size="sm" variant="secondary" onClick={() => void refetchNotes()}>Tentar novamente</Button>} />
          ) : projectNotesLoading ? (
            <Skeleton height={64} />
          ) : projectNotes.length === 0 ? (
            <div className="acp-detail-muted">Nenhuma nota adicionada.</div>
          ) : (
            <ol className="acp-detail-note-list">
              {projectNotes.map(note => (
                <li key={note.id}>
                  <div className="acp-detail-note-meta">
                    <strong>{note.author.name}</strong>
                    <time dateTime={note.createdAt}>{fmtDateTime(note.createdAt)}</time>
                  </div>
                  <p>{note.content}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : null}
      </div>

      <div className="acp-detail-section-head" id="acp-resources">
        <p>Recursos e rastreabilidade</p><h2>Pessoas, equipamentos e escopo</h2>
        <span>Recursos de campo e evidências de execução agrupados por assunto.</span>
      </div>

      <Card padding="sm" className="acp-detail-block">
        <details className="acp-detail-equips-details" open>
          <summary className="acp-detail-summary">
            Equipamentos na obra ({equipamentos.length})
          </summary>
          {equipamentos.length === 0 ? (
            <div className="acp-detail-muted">Nenhum equipamento em obra.</div>
          ) : (
            <div className="acp-detail-equips-table-wrap">
              <table className="acp-detail-equips-table">
                <caption className="sr-only">Equipamentos na obra</caption>
                <thead><tr>
                  <th scope="col">Equipamento</th>
                  <th scope="col">Tempo na obra</th>
                  <th scope="col">Desde</th>
                </tr></thead>
                <tbody>{equipamentos.map((equipment, index) => (
                  <tr key={`${equipment.code ?? equipment.name}-${index}`}>
                    <th scope="row">
                      {equipment.code ? <span className="acp-detail-equip-code">{equipment.code}</span> : null}
                      <span>{equipment.name}</span>
                    </th>
                    <td>{equipment.days} dia{equipment.days === 1 ? '' : 's'}</td>
                    <td>{fmtDate(equipment.since)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </details>
        <div className="acp-det-romaneios-action">
          <ProjectRomaneiosDialog
            key={groupId || projectId}
            projectId={projectId}
            groupId={groupId}
            missionLabel={`${isGroup ? 'Missões' : 'Missão'} ${h.code}`}
          />
        </div>
      </Card>

      <ProjectDetailPeople data={data} isGroup={isGroup} collaborators={collaborators} showingPlannedCollaborators={showingPlannedCollaborators} onSelect={(collaborator, source) => setHoursDetail({ collaborator, source })} />

      <ProjectScopeDailyTable points={shownDailyProgressHistory} filterLabel={progressFilterLabel} />

    </div>

      {/* Diálogos de apoio compartilhados permanecem no lote A4. */}
      <ProjectStandbyHistoryDialog
        project={standbyHistoryOpen && !isGroup && projectId
          ? { projectId, code: h.code }
          : null}
        onClose={() => setStandbyHistoryOpen(false)}
      />

      <ProjectCollaboratorHoursDialog
        collaborator={hoursDetail?.collaborator ?? null}
        source={hoursDetail?.source}
        isGroup={isGroup}
        onSourceChange={source => setHoursDetail(current => current ? { ...current, source } : null)}
        onClose={() => setHoursDetail(null)}
      />

      <Modal open={scheduleProject !== null} onClose={closeSchedule} appearance="design-system" size="lg"
        panelClassName="acp-schedule-modal" title={`Cronograma — Missão ${scheduleProject?.code ?? h.code}`}
        footer={<div className="acp-schedule-modal__actions">
          <Button variant="secondary" onClick={closeSchedule}>Cancelar</Button>
          {canManage ? <Button variant="primary" disabled={!scheduleDirty} onClick={() => scheduleRef.current?.save()}>Salvar</Button> : null}
        </div>}>
        {scheduleProject ? <ProjectScheduleEditor key={scheduleProject.projectId} ref={scheduleRef}
          projectId={scheduleProject.projectId} canManage={canManage} onDirtyChange={setScheduleDirty} /> : null}
      </Modal>
      <ProjectProgressHistoryNovelty
        user={progressHistoryNoveltyUser}
        enabled={progressHistoryNoveltyActive}
        onSeen={() => setProgressHistoryNoveltyActive(false)}
      />
      <ProjectWeeklyTargetNovelty
        user={progressHistoryNoveltyUser}
        enabled={weeklyTargetNoveltyActive && !isGroup && Boolean(data.requiredWeeklyProgress)}
        onSeen={() => setWeeklyTargetNoveltyActive(false)}
      />
      <ProjectManualCostNovelty
        user={progressHistoryNoveltyUser}
        enabled={manualCostNoveltyActive && canAddManualCost}
        onSeen={() => setManualCostNoveltyActive(false)}
      />
      <ProjectQualityDeviationsNovelty
        user={progressHistoryNoveltyUser}
        enabled={qualityDeviationsNoveltyActive && deviationProjects.length > 0}
        onSeen={() => setQualityDeviationsNoveltyActive(false)}
      />
      <ProjectAdditionalProposalsNovelty
        user={progressHistoryNoveltyUser}
        enabled={additionalProposalsNoveltyActive && hasAdditionalProposalContribution}
        onSeen={() => setAdditionalProposalsNoveltyActive(false)}
      />
      <ProjectStandbyHistoryNovelty
        user={progressHistoryNoveltyUser}
        enabled={standbyHistoryNoveltyActive && !isGroup && Boolean(projectId)}
        onSeen={() => setStandbyHistoryNoveltyActive(false)}
      />
    </>
  );
}
