import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';

import {
  createProjectManagementNote,
  createManualProjectCost,
  deleteManualProjectCost,
  getMissionGroupDetail,
  getPlannedScope,
  getProjectPlanningContext,
  getProjectDetail,
  listProjectManagementNotes,
  type ManualProjectCost,
  type ManualProjectCostPayload,
  type ProjectDetailCollaborator,
  type ProjectManagementNote,
} from '../../api/acompanhamentoComercial';
import { listProjectQualityDeviations, type ProjectDeviation } from '../../api/qualidade';
import { qualityDeviationProjects } from './projectQualityDeviations';
import { HelpTip } from '../ui/HelpTip';
import { Modal } from '../ui/Modal';
import { PortalTip } from '../ui/PortalTip';
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
import { ProjectDetailCosts, ProjectDetailTaxes } from './ProjectDetailCosts';
import { ProgressHistoryChart } from './ProjectDetailHistory';
import { ProjectProgressBreakdown } from './ProjectProgressBreakdown';
import { MetricBar, WorkedHoursMetric, RequiredWeeklyProgressCard, PlannedScopeView } from './ProjectDetailVisuals';
import { brl, fmtDate, fmtDateTime, fmtPct, fmtHM, hasMoney, manualCostFormDefaultValues, manualCostFormResolver, manualCostFormValuesToPayload, formatBrlCurrencyInput, mutationErrorMessage, QUALITY_IMPACT_LABELS, QUALITY_STATUS_LABELS, QUALITY_DISPOSITION_LABELS, DAY_META, type ManualCostFormValues } from './projectDetailModel';
import './ProjectDetailDashboard.ds.css';
import type { AuthUser } from '../../types/auth';

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
  const { data: scope, isLoading: scopeLoading, isError: scopeError, refetch: refetchScope } = useQuery({
    queryKey: ['planned-scope', projectId],
    queryFn: () => getPlannedScope(projectId!),
    enabled: !isGroup && Boolean(projectId)
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
  const equipamentos = data.equipamentos ?? [];
  const effectiveScope = data.plannedScope ?? scope;
  const workedHours = data.workedHours ?? {
    normalWorkedHours: 0,
    overtimeWorkedHours: 0,
    totalWorkedHours: 0,
    plannedTotalHours: null,
    normalPct: null,
    overtimePct: null,
    totalPct: null,
    roleCounts: []
  };
  const progressSuffix = data.avancoMethod === 'MANUAL'
    ? ' (manual)'
    : data.avancoMethod === 'GROUP_SCOPE' || data.avancoMethod === 'GROUP_WEIGHTED' || data.avancoMethod === 'GROUP_AVERAGE'
      ? ' (consolidado)'
      : '';
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
        <div>
          <p className="acp-detail-eyebrow">{isGroup ? 'Agrupamento de missões' : 'Detalhe do projeto'}</p>
          <h1>{isGroup ? 'Grupo' : 'Missão'} {h.code}</h1>
          <p className="acp-detail-client">{h.clientName}</p>
        </div>
        <div className="acp-detail-header-meta">
          {h.proposalCode ? <span>Proposta <strong>{h.proposalCode}</strong></span> : null}
          <span>Última atualização <strong>{fmtDate(h.lastRdoDate)}</strong></span>
          {h.segment ? <Badge tone="neutral" multiline>{h.segment}</Badge> : null}
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
        {data.alerts.length > 0 ? (
          <div className="acp-detail-alerts">
            {data.alerts.map((a, i) => <Badge key={i} tone={a.level === 'danger' ? 'danger' : 'warning'} multiline>{a.label}</Badge>)}
          </div>
        ) : null}
      </Card>

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

      <div className="acp-detail-cols">
        {/* Prazo, execução e escopo */}
        <div className="acp-detail-col">
          <Card padding="sm" className="acp-detail-block">
            <MetricBar
              label="Dias corridos"
              help="Dias de calendário desde o início da obra até a data de referência: hoje para projetos em andamento; último RDO para projetos arquivados."
              value={data.diasCorridos.pct}
              caption={`${data.diasCorridos.elapsed ?? '—'}/${data.diasCorridos.planned ?? '—'}${data.diasCorridos.pct != null ? ` · ${data.diasCorridos.pct}%` : ''}`}
            />
            <MetricBar
              label="Dias trabalhados"
              help="Dias com RDO registrado, sobre os dias trabalhados previstos no comercial."
              value={data.diasTrabalhados.pct}
              caption={`${data.diasTrabalhados.worked}/${data.diasTrabalhados.planned ?? '—'}${data.diasTrabalhados.pct != null ? ` · ${data.diasTrabalhados.pct}%` : ''}`}
            />
            <WorkedHoursMetric data={workedHours} />
          </Card>

          <Card padding="sm" className="acp-detail-block">
            {progressFilters && (progressScopes.length > 0 || progressEquipments.length > 0) ? (
              <div className="acp-detail-progress-filters" aria-label="Filtrar avanço do projeto">
                <Field id="acp-progress-scope" label="Escopo" optionalText="">
                  <Select size="sm" value={activeScopeKey} onChange={event => changeProgressScope(event.target.value)}>
                    <option value="">Todos os escopos</option>
                    {progressScopes.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
                  </Select>
                </Field>
                <Field id="acp-progress-equipment" label="Equipamento / UG" optionalText="">
                  <Select size="sm" value={activeEquipmentKey} onChange={event => setProgressEquipmentKey(event.target.value)}>
                    <option value="">Todos os equipamentos</option>
                    {progressEquipments.filter(item => combinationAvailable(activeScopeKey, item.key)).map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
                  </Select>
                </Field>
              </div>
            ) : null}
            <MetricBar label={`Avanço do escopo${progressFilterLabel ? ` · ${progressFilterLabel}` : progressSuffix}`} value={shownAvancoPct} caption={fmtPct(shownAvancoPct)}
              help="Quanto do escopo vendido já foi executado: cruza o realizado dos RDOs com o previsto, ponderado pelo peso de cada serviço. O filtro considera apenas as metas e o realizado do recorte escolhido." />
            <RequiredWeeklyProgressCard key={`${activeScopeKey}|${activeEquipmentKey}`} target={shownRequiredWeeklyProgress} />
            <ProgressHistoryChart key={`${activeScopeKey}|${activeEquipmentKey}`} points={shownProgressHistory} />
            {!isGroup && projectId ? <details className="acp-detail-progress-breakdown">
              <summary>Previsto × realizado por UG e sistema</summary>
              <ProjectProgressBreakdown projectId={projectId}
                filter={progressFilters ? { scopeKey: activeScopeKey, equipmentKey: activeEquipmentKey } : undefined}
                progressPct={selectedProgressSlice ? selectedProgressSlice.avancoPct : undefined} />
            </details> : null}

            <div className="acp-detail-two">
              <div className="acp-detail-standby-kpi">
                <span className="acp-detail-kpi-label"><HelpTip help="Número de dias com parada (standby) registrada nos relatórios de execução.">Standby</HelpTip></span>
                <strong>{data.standby.count}</strong>
                <span className="acp-detail-kpi-sub">dia(s)</span>
                {!isGroup ? (
                  <Button
                    type="button"
                    size="sm" variant="secondary" className="acp-detail-standby-trigger"
                    aria-haspopup="dialog"
                    data-acp-standby-history-trigger
                    onClick={() => setStandbyHistoryOpen(true)}
                  >
                    Ver histórico
                  </Button>
                ) : null}
              </div>
              <div><span className="acp-detail-kpi-label"><HelpTip help="Soma das horas-homem de stand-by de todos os relatórios de execução do projeto, multiplicando o tempo pela equipe do turno.">Hora total parada</HelpTip></span><strong>{fmtHM(data.standby.minutes)}</strong></div>
            </div>

            <div className="acp-detail-sub"><HelpTip help="Status dos dias mais recentes com relatório de execução: verde = trabalhado, amarelo = trabalhado com standby, vermelho = totalmente parado (standby cobrindo a jornada). Passe o mouse para ver as horas.">Últimos dias</HelpTip></div>
            <div className="acp-detail-dots">
              {data.ultimosDias.length === 0 ? (
                <span className="acp-detail-muted">Sem relatórios de execução.</span>
              ) : data.ultimosDias.map((d, i) => (
                <PortalTip
                  key={i}
                  triggerClassName="acp-detail-dot-wrap"
                  ariaLabel={`${fmtDate(d.date)}: ${DAY_META[d.status].label}`}
                  content={(
                    <>
                      <div className="acp-detail-tip-date">{fmtDate(d.date)}</div>
                      <div className="acp-detail-tip-status">
                        <span className={`acp-detail-tip-dot ${DAY_META[d.status].cls}`} />{DAY_META[d.status].label}
                      </div>
                      <div className="acp-detail-tip-row"><span>Trabalhado</span><strong>{fmtHM(d.workedMinutes)}</strong></div>
                      <div className="acp-detail-tip-row"><span>Standby</span><strong>{fmtHM(d.standbyMinutes)}</strong></div>
                    </>
                  )}
                >
                  <span className={`acp-detail-dot ${DAY_META[d.status].cls}`} />
                </PortalTip>
              ))}
            </div>

            <div className="acp-detail-two">
              <div><span className="acp-detail-kpi-label"><HelpTip help="Total de horas extras-homem identificadas nos relatórios de execução do projeto, multiplicando a HE pela equipe do turno.">Horas extras</HelpTip></span><strong>{fmtHM(data.overtimeMinutes)}</strong></div>
            </div>
          </Card>
          <Card padding="sm" className="acp-detail-block">
            <div className="acp-detail-sub"><HelpTip help="Escopo vendido informado manualmente (aba Cronograma): serviços, sistemas e quantitativos, com o peso de cada serviço no avanço.">Escopo cadastrado</HelpTip></div>
            {scopeLoading && !data.plannedScope ? <Skeleton height={64} />
              : scopeError && !data.plannedScope ? <Alert tone="warning" title="Não foi possível carregar o escopo."
              action={<Button size="sm" variant="secondary" onClick={() => void refetchScope()}>Tentar novamente</Button>} />
              : <PlannedScopeView scope={effectiveScope} />}
            {!isGroup && projectId ? (
              <div className="acp-detail-reports-action">
                <ProjectReportsDialog
                  projectId={projectId}
                  missionLabel={`Missão ${h.code} · ${h.clientName}`}
                />
              </div>
            ) : null}
          </Card>
        </div>


        {/* Custos e impostos */}
        <div className="acp-detail-col">
          <ProjectDetailCosts data={data}>
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
          </ProjectDetailCosts>

          {data.canViewProjectFinancials ? <ProjectDetailTaxes data={data} /> : null}
        </div>


      </div>

      {data.canViewProjectFinancials ? <ProjectInvoicesSection key={groupId || projectId} projectId={projectId} groupId={groupId} /> : null}

      {deviationProjects.length > 0 ? (
        <Card padding="sm" className="acp-detail-block acp-detail-deviations" data-quality-project-deviations>
          <div className="acp-detail-deviations-head">
            <div className="acp-detail-sub">Desvios</div>
            <a className="acp-detail-link" href="/qualidade?tab=registros">Abrir Qualidade</a>
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

      <Card padding="sm" className="acp-detail-block">
        <details className="acp-detail-equips-details" open>
          <summary className="acp-detail-summary">
            Equipamentos na obra ({equipamentos.length})
          </summary>
          {equipamentos.length === 0 ? (
            <div className="acp-detail-muted">Nenhum equipamento em obra.</div>
          ) : (
            <div className="acp-detail-equips-grid">
              {equipamentos.map((e, i) => (
                <div className="acp-detail-equip-item" key={`${e.name}-${i}`}>
                  <span>{e.code ? `${e.code} — ${e.name}` : e.name}</span>
                  <strong>{e.days} dia{e.days === 1 ? '' : 's'}</strong>
                  <small>desde {fmtDate(e.since)}</small>
                </div>
              ))}
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

      <Card padding="sm" className="acp-detail-footer">
        <div><span><HelpTip help="Data de mobilização, cadastrada manualmente no cronograma.">Mobilização</HelpTip></span><strong>{fmtDate(data.footer.mobilizationDate)}</strong></div>
        <div><span><HelpTip help="Data de início real, cadastrada manualmente no cronograma.">Início</HelpTip></span><strong>{fmtDate(data.footer.startDate)}</strong></div>
        <div><span><HelpTip help="Início + dias corridos previstos no comercial.">Previsão de término</HelpTip></span><strong>{fmtDate(data.footer.expectedEndDate)}</strong></div>
        <div><span><HelpTip help="Estimativa realista: projeta o término pela velocidade de avanço acumulada até a data de referência dos dias corridos.">Previsão pelo ritmo</HelpTip></span><strong>{fmtDate(data.footer.projectedEndByPace)}</strong></div>
      </Card>

    </div>

      {/* Cronograma e diálogos compartilhados mantêm a fronteira legada até A3b/A4. */}
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
        onClose={() => setHoursDetail(null)}
      />

      <Modal open={scheduleProject !== null} onClose={closeSchedule} ariaLabelledBy="acp-detail-schedule-title" panelClassName="modal-card acp-manage-card">
        <div className="acp-manage">
          <div className="acp-manage-head">
            <div className="sec" id="acp-detail-schedule-title">Cronograma — Missão {scheduleProject?.code ?? h.code}</div>
            <button className="mini-btn alt" type="button" onClick={closeSchedule} aria-label="Fechar">✕</button>
          </div>
          <div className="acp-manage-body">
            {scheduleProject ? (
              <ProjectScheduleEditor
                key={scheduleProject.projectId}
                ref={scheduleRef}
                projectId={scheduleProject.projectId}
                canManage={canManage}
                onDirtyChange={setScheduleDirty}
              />
            ) : null}
          </div>
          <div className="acp-manage-foot">
            <button type="button" className="mini-btn alt" onClick={closeSchedule}>Cancelar</button>
            <button type="button" className="mini-btn" disabled={!scheduleDirty} onClick={() => scheduleRef.current?.save()}>Salvar</button>
          </div>
        </div>
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
