import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getProjectWorkflow,
  listProjectWorkflowLeaders,
  listProjectWorkflows,
  projectWorkflowErrorIssues,
  startProjectWorkflow,
  updateProjectWorkflow,
  type ProjectWorkflowPatch,
  type ProjectWorkflowSummary,
  type ProjectWorkflowStage
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { SearchBar } from '../../../components/ui/SearchBar';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { projectWorkflowMilestoneText, projectWorkflowsToColumns, WORKFLOW_STAGE_LABELS, WORKFLOW_STAGES } from '../../../utils/projectWorkflow';
import { ProjectWorkflowModal } from './ProjectWorkflowModal';

function ProjectCard({ item, selected, canManage, onSelect }: {
  item: ProjectWorkflowSummary;
  selected: boolean;
  canManage: boolean;
  onSelect: () => void;
}) {
  const workflow = item.workflow;
  const documentationLabel = workflow?.documentationReadiness.status === 'OK'
    ? 'OK'
    : workflow?.documentationReadiness.status === 'CRITICAL' ? 'crítica' : 'em andamento';
  const nextMilestone = workflow?.milestones.nextMilestone;
  const mobilizationStatus = workflow?.mobilizationAuthorization.status;
  return (
    <button className={`project-workflow-card ${selected ? 'selected' : ''}`} type="button" onClick={onSelect}>
      <span className="efetivo-eyebrow">{item.code}</span>
      <strong>{item.name}</strong>
      <span>{item.clientName || 'Cliente não informado'}</span>
      {workflow ? <>
        <small>{workflow.leader.name}</small>
        <small>{projectWorkflowMilestoneText(item)}{nextMilestone ? ` · próximo ${nextMilestone.label} em ${displayDateOnly(nextMilestone.date)}` : ''}</small>
        {workflow.milestones.dueMilestones.length ? <small className="project-workflow-deadline-alert">Prazos atingidos: {workflow.milestones.dueMilestones.map(key => key.replace('D', 'D-')).join(', ')}</small> : null}
        <small className={`project-workflow-commercial-badge is-${workflow.commercialReadiness.status.toLowerCase()}`}>Comercial: {workflow.commercialReadiness.status === 'RELEASED' ? 'liberado' : `${workflow.commercialReadiness.resolvedCount}/${workflow.commercialReadiness.totalCount}`}</small>
        <small className={`project-workflow-documentation-badge is-${workflow.documentationReadiness.status.toLowerCase()}`}>Documentação: {documentationLabel} · {workflow.documentationReadiness.completed}/{workflow.documentationReadiness.total}</small>
        {workflow.stage === 'MOBILIZATION_PLANNING' ? <small className="project-workflow-planning-badge">D-30: {workflow.planningReadiness.completed}/{workflow.planningReadiness.total} · {workflow.planningReadiness.percentage}%</small> : null}
        {['PREPARATION', 'READY_TO_MOBILIZE'].includes(workflow.stage) ? <small className="project-workflow-preparation-badge">D-15: {workflow.preparationReadiness.completed}/{workflow.preparationReadiness.total} · {workflow.preparationReadiness.percentage}%</small> : null}
        {workflow.stage === 'EXECUTION' ? <small className="project-workflow-execution-badge">Acompanhamento operacional ativo</small> : null}
        {workflow.mobilizationGate.deadlineStatus === 'ATTENTION' ? <small className="project-workflow-mobilization-risk is-attention">D-7 · {workflow.mobilizationGate.blockers.length} bloqueio(s)</small> : null}
        {workflow.mobilizationGate.deadlineStatus === 'RISK' ? <small className="project-workflow-mobilization-risk is-risk">Risco de mobilização · {workflow.mobilizationGate.blockers.length} bloqueio(s)</small> : null}
        {mobilizationStatus === 'AUTHORIZED' ? <small className="project-workflow-authorization-badge is-authorized">🔒 Mobilização autorizada</small> : null}
        {mobilizationStatus === 'SUSPENDED' ? <small className="project-workflow-authorization-badge is-suspended">Autorização suspensa</small> : null}
        {workflow.issueCount ? <em className={workflow.overdueIssueCount ? 'is-overdue' : ''}>{workflow.issueCount} pendência(s){workflow.overdueIssueCount ? ` · ${workflow.overdueIssueCount} vencida(s)` : ''}</em> : null}
      </> : <em>{canManage ? 'Iniciar handover' : 'Gestão ainda não iniciada'}</em>}
    </button>
  );
}

export function ProjectWorkflowBoard({ canManage, search, page, mobileStage, selectedProjectId, onSearchChange, onPageChange, onMobileStageChange, onProjectSelect }: {
  canManage: boolean;
  search: string;
  page: number;
  mobileStage: ProjectWorkflowStage;
  selectedProjectId?: string;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onMobileStageChange: (stage: ProjectWorkflowStage) => void;
  onProjectSelect: (projectId?: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['project-workflows', search, page], queryFn: () => listProjectWorkflows(search, page) });
  const leaders = useQuery({ queryKey: ['project-workflow-leaders'], queryFn: listProjectWorkflowLeaders });
  const detail = useQuery({
    queryKey: ['project-workflow', selectedProjectId],
    queryFn: () => getProjectWorkflow(selectedProjectId!),
    enabled: Boolean(selectedProjectId),
    placeholderData: undefined
  });
  const refresh = async (data: Awaited<ReturnType<typeof getProjectWorkflow>>) => {
    queryClient.setQueryData(['project-workflow', data.project.id], data);
    await queryClient.invalidateQueries({ queryKey: ['project-workflows'] });
  };
  const start = useMutation({
    mutationFn: (values: { leaderUserId: string; plannedMobilizationDate: string }) => startProjectWorkflow(selectedProjectId!, values),
    onSuccess: async data => { await refresh(data); toast('Handover iniciado.', 'success'); },
    onError: (error: Error) => toast(error.message, 'error')
  });
  const update = useMutation({
    mutationFn: (payload: ProjectWorkflowPatch) => updateProjectWorkflow(selectedProjectId!, payload),
    onSuccess: async data => { await refresh(data); toast('Gestão do projeto atualizada.', 'success'); },
    onError: (error: Error) => {
      const issues = projectWorkflowErrorIssues(error);
      toast([error.message, ...issues].join(' · '), 'error');
      if ((error as { code?: string }).code === 'PROJECT_WORKFLOW_VERSION_CONFLICT') void detail.refetch();
    }
  });
  if (list.isLoading) return <section className="page-card placeholder-copy">Carregando gestão de projetos…</section>;
  if (list.isError || !list.data) return <section className="page-card placeholder-copy"><p>Não foi possível carregar a gestão de projetos.</p><Button variant="secondary" onClick={() => void list.refetch()}>Tentar novamente</Button></section>;
  const columns = projectWorkflowsToColumns(list.data.items);
  const managedCount = list.data.items.filter(item => item.workflow).length;
  const overdueCount = list.data.items.reduce((sum, item) => sum + (item.workflow?.overdueIssueCount || 0), 0);
  return (
    <div className="efetivo-board project-workflow-board" data-project-workflow-board>
      <section className="page-card efetivo-summary-strip"><span><strong>{list.data.total}</strong> projetos elegíveis</span><span><strong>{managedCount}</strong> com gestão iniciada nesta página</span><span><strong>{overdueCount}</strong> pendências vencidas</span></section>
      <section className="page-card project-workflow-toolbar">
        <div><h2>Gestão de projetos</h2><p>Do handover à execução, com planejamento D-30, confirmação D-15, gates e acompanhamento operacional.</p></div>
        <SearchBar id="project-workflow-search" value={search} onChange={onSearchChange} placeholder="Buscar projeto, cliente ou código" count={{ shown: list.data.items.length, total: list.data.total }} />
        <div className="field-group project-workflow-mobile-stage"><label htmlFor="project-workflow-stage">Etapa exibida</label><select id="project-workflow-stage" value={mobileStage} onChange={event => onMobileStageChange(event.target.value as ProjectWorkflowStage)}>{WORKFLOW_STAGES.map(stage => <option value={stage} key={stage}>{WORKFLOW_STAGE_LABELS[stage]}</option>)}</select></div>
      </section>
      <section className="project-workflow-columns" aria-label="Fluxo de preparação dos projetos">
        {WORKFLOW_STAGES.map(stage => <div className={`project-workflow-column ${mobileStage === stage ? 'mobile-active' : ''}`} data-project-workflow-execution={stage === 'EXECUTION' ? true : undefined} key={stage}><header><strong>{WORKFLOW_STAGE_LABELS[stage]}</strong><span>{columns[stage].length}</span></header><div className="project-workflow-card-list">{columns[stage].map(item => <ProjectCard item={item} selected={selectedProjectId === item.id} canManage={canManage} onSelect={() => onProjectSelect(item.id)} key={item.id} />)}{columns[stage].length ? null : <p className="efetivo-kanban-empty">Nenhum projeto nesta etapa</p>}</div></div>)}
      </section>
      {list.data.total > list.data.pageSize ? <nav className="project-workflow-pagination" aria-label="Paginação dos projetos"><Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</Button><span>Página {page} de {Math.ceil(list.data.total / list.data.pageSize)}</span><Button variant="secondary" disabled={page * list.data.pageSize >= list.data.total} onClick={() => onPageChange(page + 1)}>Próxima</Button></nav> : null}
      <ProjectWorkflowModal detail={selectedProjectId ? detail.data || null : null} leaders={leaders.data || []} loading={Boolean(selectedProjectId && detail.isLoading)} error={Boolean(selectedProjectId && detail.isError)} saving={start.isPending || update.isPending} onRetry={() => void detail.refetch()} onClose={() => onProjectSelect(undefined)} onStart={values => start.mutate(values)} onPatch={payload => update.mutate(payload)} />
    </div>
  );
}
