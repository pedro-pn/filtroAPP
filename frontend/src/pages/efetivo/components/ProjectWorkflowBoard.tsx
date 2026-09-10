import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent
} from 'react';

import {
  createPlanningMission,
  listPendingMissionProjects,
  listPlanningCoordinators,
  listPlanningJobRoles,
  listPlanningMissions,
  movePlanningMission,
  type MissionInput,
  type MissionStage,
  type PendingMissionProject,
  type PlanningMission
} from '../../../api/efetivoPlanning';
import {
  getProjectWorkflow,
  listProjectWorkflowLeaders,
  listProjectWorkflows,
  projectWorkflowErrorIssues,
  startProjectWorkflow,
  updateProjectWorkflow,
  type ProjectOperationalMissionSummary,
  type ProjectWorkflowPatch,
  type ProjectWorkflowStage,
  type ProjectWorkflowSummary
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { SearchBar } from '../../../components/ui/SearchBar';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { refreshMissionPlanningQueries } from '../../../utils/efetivoPlanningQueries';
import { missionPendencies } from '../../../utils/missionPendencies';
import {
  cloneProjectKanbanColumns,
  moveProjectInColumns,
  PROJECT_KANBAN_STAGE_LABELS,
  PROJECT_KANBAN_STAGES,
  projectStageInColumns,
  projectWorkflowMilestoneText,
  projectWorkflowStageOptions,
  projectWorkflowsToColumns,
  type ProjectKanbanColumns,
  type ProjectKanbanStage
} from '../../../utils/projectWorkflow';
import {
  createPointerDragGhost,
  movePointerDragGhost,
  scrollReorderContainerEdge,
  setReorderDragImage,
  type PointerDragState
} from '../../../utils/reorderDrag';
import { MissionAllocationModal } from './MissionAllocationModal';
import { MissionFormModal } from './MissionFormModal';
import { ProjectLegacyCompletionModal } from './ProjectLegacyCompletionModal';
import { ProjectWorkflowModal } from './ProjectWorkflowModal';

type DragState = { projectId: string; snapshot: ProjectKanbanColumns };
type PendingTouch = {
  pointerId: number;
  projectId: string;
  card: HTMLElement;
  x: number;
  y: number;
  timer: number;
};
type CompletionTarget = {
  project: ProjectWorkflowSummary;
  mission: ProjectOperationalMissionSummary;
  order: number;
  snapshot: ProjectKanbanColumns;
};
type ManagedMove = {
  project: ProjectWorkflowSummary;
  target: ProjectWorkflowStage;
  patch: Extract<ProjectWorkflowPatch, { action: 'accept' | 'stage' }>;
  snapshot: ProjectKanbanColumns;
};
type LegacyMove = {
  project: ProjectWorkflowSummary;
  stage: MissionStage;
  order: number;
  returnDate?: string | null;
  snapshot: ProjectKanbanColumns;
};

const INTERACTIVE_SELECTOR = 'select, button, input, textarea, a, label, option';
const TOUCH_HOLD_MS = 320;
const TOUCH_HOLD_TOLERANCE = 10;
const OPERATIONAL_STAGE_LABELS: Record<MissionStage, string> = {
  STANDBY: 'Stand by',
  MOBILIZATION: 'Mobilização',
  EXECUTION: 'Execução',
  FINAL_MEASUREMENT: 'Medição final',
  FINISHED: 'Finalizada'
};
const LEGACY_PROJECT_STAGE_TO_MISSION: Partial<Record<ProjectKanbanStage, MissionStage>> = {
  HANDOVER: 'STANDBY',
  MOBILIZATION: 'MOBILIZATION',
  EXECUTION: 'EXECUTION',
  FINAL_MEASUREMENT: 'FINAL_MEASUREMENT',
  FINISHED: 'FINISHED'
};
const LEGACY_PROJECT_STAGES = Object.keys(LEGACY_PROJECT_STAGE_TO_MISSION) as ProjectKanbanStage[];

function initials(name: string) {
  return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toLocaleUpperCase('pt-BR');
}

function moveOptions(item: ProjectWorkflowSummary): ProjectKanbanStage[] {
  if (!item.workflow) return LEGACY_PROJECT_STAGES;
  if (item.workflow.stage === 'HANDOVER') return ['HANDOVER', 'INITIAL_ANALYSIS'];
  return [item.workflow.stage, ...projectWorkflowStageOptions(item.workflow.stage)];
}

function ProjectCard({
  item,
  stage,
  selected,
  expanded,
  dragging,
  moveAllowed,
  moving,
  teamLoading,
  canProgramTeam,
  programmingLoading,
  onSelect,
  onToggleTeam,
  onManageTeam,
  onProgramTeam,
  onMove,
  onMouseDown,
  onDragStart,
  onDragEnd,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel
}: {
  item: ProjectWorkflowSummary;
  stage: ProjectKanbanStage;
  selected: boolean;
  expanded: boolean;
  dragging: boolean;
  moveAllowed: boolean;
  moving: boolean;
  teamLoading: boolean;
  canProgramTeam: boolean;
  programmingLoading: boolean;
  onSelect: () => void;
  onToggleTeam: () => void;
  onManageTeam: () => void;
  onProgramTeam: () => void;
  onMove: (stage: ProjectKanbanStage) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
}) {
  const workflow = item.workflow;
  const mission = item.operationalMission;
  const documentationLabel = workflow?.documentationReadiness.status === 'OK'
    ? 'OK'
    : workflow?.documentationReadiness.status === 'CRITICAL' ? 'crítica' : 'em andamento';
  const nextMilestone = workflow?.milestones.nextMilestone;
  const mobilizationStatus = workflow?.mobilizationAuthorization.status;
  const responsibleName = mission?.headquartersResponsibleName || workflow?.leader.name || '';
  const responsibleRole = mission
    ? mission.headquartersResponsibleRole || 'Cargo da conta não informado'
    : 'Líder de Projetos';
  const options = moveOptions(item);
  const cardClassName = [
    'project-workflow-card',
    selected ? 'selected' : '',
    dragging ? 'drag-source' : '',
    moveAllowed ? 'draggable' : ''
  ].filter(Boolean).join(' ');

  return (
    <article
      className={cardClassName}
      data-project-kanban-card
      data-project-id={item.id}
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      aria-grabbed={dragging}
      draggable={moveAllowed && !moving}
      title={moveAllowed ? 'Arraste para mover de etapa; Escape cancela' : 'Você não tem permissão para mover este projeto'}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      onMouseDown={onMouseDown}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="project-workflow-card-head">
        {moveAllowed ? <span className="efetivo-drag-grip" aria-hidden="true">⋮⋮</span> : <span className="efetivo-lock" aria-hidden="true">●</span>}
        <span className="efetivo-eyebrow">{item.code}</span>
      </div>
      <strong>{item.name}</strong>
      <span>{item.clientName || 'Cliente não informado'} · {item.location || 'Local não informado'}</span>
      <dl className="project-workflow-card-summary">
        <div>
          <dt>{stage === 'HANDOVER' ? 'Previsão de mobilização' : 'Mobilização'}</dt>
          <dd>{mission?.mobilizationDate
            ? displayDateOnly(mission.mobilizationDate)
            : workflow?.plannedMobilizationDate ? displayDateOnly(workflow.plannedMobilizationDate) : 'Não informada'}</dd>
        </div>
        <div><dt>Participantes</dt><dd>{mission?.participantCount || 0}</dd></div>
      </dl>
      {workflow ? <small>Líder do projeto: {workflow.leader.name}</small> : null}
      {responsibleName ? (
        <div className="efetivo-mission-owner">
          <i aria-hidden="true">{initials(responsibleName)}</i>
          <span>
            <small>{mission ? 'LÍDER VINCULADO' : 'LÍDER DO PROJETO'}</small>
            <strong>{responsibleName}</strong>
            <b>{responsibleRole}</b>
          </span>
        </div>
      ) : <small>Líder ainda não vinculado</small>}
      {workflow ? <>
        <small>
          {projectWorkflowMilestoneText(item)}
          {workflow.stage !== 'DEMOBILIZATION' && nextMilestone ? ' · próximo ' + nextMilestone.label + ' em ' + displayDateOnly(nextMilestone.date) : ''}
        </small>
        {workflow.milestones.dueMilestones.length ? (
          <small className="project-workflow-deadline-alert">
            Prazos atingidos: {workflow.milestones.dueMilestones.map(key => key.replace('D', 'D-')).join(', ')}
          </small>
        ) : null}
        <small className={'project-workflow-commercial-badge is-' + workflow.commercialReadiness.status.toLowerCase()}>
          Comercial: {workflow.commercialReadiness.status === 'RELEASED'
            ? 'liberado'
            : workflow.commercialReadiness.resolvedCount + '/' + workflow.commercialReadiness.totalCount}
        </small>
        <small className={'project-workflow-documentation-badge is-' + workflow.documentationReadiness.status.toLowerCase()}>
          Documentação: {documentationLabel} · {workflow.documentationReadiness.completed}/{workflow.documentationReadiness.total}
        </small>
        {workflow.stage === 'MOBILIZATION_PLANNING' ? (
          <small className="project-workflow-planning-badge">
            D-30: {workflow.planningReadiness.completed}/{workflow.planningReadiness.total} · {workflow.planningReadiness.percentage}%
          </small>
        ) : null}
        {['PREPARATION', 'READY_TO_MOBILIZE'].includes(workflow.stage) ? (
          <small className="project-workflow-preparation-badge">
            D-15: {workflow.preparationReadiness.completed}/{workflow.preparationReadiness.total} · {workflow.preparationReadiness.percentage}%
          </small>
        ) : null}
        {workflow.stage === 'EXECUTION' ? <small className="project-workflow-execution-badge">Acompanhamento operacional ativo</small> : null}
        {workflow.stage === 'MOBILIZATION' ? <small className="project-workflow-execution-badge">Mobilização operacional em andamento</small> : null}
        {workflow.stage === 'DEMOBILIZATION' ? <small className="project-workflow-execution-badge">Desmobilização: {workflow.demobilizationReadiness.completed}/{workflow.demobilizationReadiness.total} · {workflow.demobilizationReadiness.percentage}%</small> : null}
        {workflow.mobilizationGate.deadlineStatus === 'ATTENTION' ? (
          <small className="project-workflow-mobilization-risk is-attention">D-7 · {workflow.mobilizationGate.blockers.length} bloqueio(s)</small>
        ) : null}
        {workflow.mobilizationGate.deadlineStatus === 'RISK' ? (
          <small className="project-workflow-mobilization-risk is-risk">Risco de mobilização · {workflow.mobilizationGate.blockers.length} bloqueio(s)</small>
        ) : null}
        {workflow.stage !== 'DEMOBILIZATION' && mobilizationStatus === 'AUTHORIZED' ? <small className="project-workflow-authorization-badge is-authorized">🔒 Mobilização autorizada</small> : null}
        {workflow.stage !== 'DEMOBILIZATION' && mobilizationStatus === 'SUSPENDED' ? <small className="project-workflow-authorization-badge is-suspended">Autorização suspensa</small> : null}
        {workflow.issueCount ? (
          <em className={workflow.overdueIssueCount ? 'is-overdue' : ''}>
            {workflow.issueCount} pendência(s){workflow.overdueIssueCount ? ' · ' + workflow.overdueIssueCount + ' vencida(s)' : ''}
          </em>
        ) : null}
        {mission
          ? <small>Programação: {OPERATIONAL_STAGE_LABELS[mission.stage]} · {mission.participantCount} participante(s)</small>
          : <small>Programação operacional pendente</small>}
      </> : <>
        <em>{mission ? 'Fluxo legado · ' + OPERATIONAL_STAGE_LABELS[mission.stage] : 'Gestão ainda não iniciada'}</em>
        {mission ? <small>{mission.participantCount} participante(s) · gestão ainda não iniciada</small> : null}
      </>}
      {expanded && mission ? (
        <div className="efetivo-kanban-details">
          <span>Participantes da missão · {mission.participantCount}</span>
          {mission.allocations.length ? mission.allocations.map(allocation => (
            <div key={allocation.id}>
              <i aria-hidden="true">{initials(allocation.collaborator?.name || '')}</i>
              <strong>
                {allocation.collaborator?.name || 'Colaborador'}
                {allocation.collaboratorId === mission.headquartersResponsibleCollaboratorId ? <em>Líder</em> : null}
              </strong>
              <small>{allocation.jobRole?.name || allocation.collaborator?.role || 'Função não informada'}</small>
            </div>
          )) : <p>Nenhum colaborador alocado ainda.</p>}
        </div>
      ) : null}
      <div className="efetivo-kanban-team-actions">
        {mission ? (
          <button
            className="efetivo-team-toggle"
            type="button"
            aria-expanded={expanded}
            onClick={event => { event.stopPropagation(); onToggleTeam(); }}
          >
            {expanded ? 'Ocultar equipe' : 'Ver líder e equipe (' + mission.participantCount + ')'}
          </button>
        ) : <span />}
        {mission ? (
          <button
            className="efetivo-kanban-team-manage"
            type="button"
            disabled={teamLoading}
            onClick={event => { event.stopPropagation(); onManageTeam(); }}
          >
            {teamLoading ? 'Carregando equipe…' : 'Equipe e ciclos'}
          </button>
        ) : (
          <button
            className="efetivo-kanban-team-manage"
            type="button"
            disabled={!canProgramTeam || programmingLoading}
            title={canProgramTeam ? undefined : 'Somente o gestor do Efetivo pode criar a programação.'}
            onClick={event => { event.stopPropagation(); onProgramTeam(); }}
          >
            {programmingLoading ? 'Carregando programação…' : 'Programar equipe'}
          </button>
        )}
      </div>
      {moveAllowed ? (
        <div className="field-group project-workflow-card-move-select" onClick={event => event.stopPropagation()}>
          <label htmlFor={'project-stage-' + item.id}>Mover para</label>
          <select
            id={'project-stage-' + item.id}
            value={stage}
            disabled={moving}
            onChange={event => onMove(event.target.value as ProjectKanbanStage)}
          >
            {options.map(option => <option value={option} key={option}>{PROJECT_KANBAN_STAGE_LABELS[option]}</option>)}
          </select>
        </div>
      ) : null}
    </article>
  );
}

export function ProjectWorkflowBoard({
  canManage,
  search,
  page,
  mobileStage,
  selectedProjectId,
  onSearchChange,
  onPageChange,
  onMobileStageChange,
  onProjectSelect
}: {
  canManage: boolean;
  search: string;
  page: number;
  mobileStage: ProjectKanbanStage;
  selectedProjectId?: string;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onMobileStageChange: (stage: ProjectKanbanStage) => void;
  onProjectSelect: (projectId?: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: ['project-workflows', search, page],
    queryFn: () => listProjectWorkflows(search, page)
  });
  const planningMissions = useQuery({
    queryKey: ['efetivo-planning-missions', 'kanban'],
    queryFn: () => listPlanningMissions()
  });
  const pendingMissionProjects = useQuery({
    queryKey: ['efetivo-planning-missions-pending', 'official'],
    queryFn: () => listPendingMissionProjects()
  });
  const planningRoles = useQuery({
    queryKey: ['efetivo-planning-job-roles'],
    queryFn: listPlanningJobRoles
  });
  const planningCoordinators = useQuery({
    queryKey: ['efetivo-planning-coordinators'],
    queryFn: listPlanningCoordinators
  });
  const leaders = useQuery({
    queryKey: ['project-workflow-leaders'],
    queryFn: listProjectWorkflowLeaders
  });
  const detail = useQuery({
    queryKey: ['project-workflow', selectedProjectId],
    queryFn: () => getProjectWorkflow(selectedProjectId!),
    enabled: Boolean(selectedProjectId),
    placeholderData: undefined
  });
  const [columns, setColumns] = useState<ProjectKanbanColumns>(() => projectWorkflowsToColumns([]));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ProjectKanbanStage | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [teamMissionId, setTeamMissionId] = useState<string | null>(null);
  const [missionFormProjectId, setMissionFormProjectId] = useState<string | null>(null);
  const [completionTarget, setCompletionTarget] = useState<CompletionTarget | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointerRef = useRef<(PointerDragState & { drag: DragState; card: HTMLElement }) | null>(null);
  const pendingTouchRef = useRef<PendingTouch | null>(null);
  const interactiveMouseRef = useRef(false);
  const suppressCardClickUntilRef = useRef(0);

  useEffect(() => {
    if (list.data) setColumns(projectWorkflowsToColumns(list.data.items));
  }, [list.data]);

  const teamMission = (planningMissions.data || []).find(mission => mission.id === teamMissionId) || null;
  const missionFormProject = (pendingMissionProjects.data || [])
    .find(project => project.id === missionFormProjectId) || null;

  useEffect(() => {
    if (!teamMissionId || planningMissions.isFetching || teamMission) return;
    toast('Não foi possível carregar a equipe e os ciclos desta programação.', 'error');
    setTeamMissionId(null);
  }, [planningMissions.isFetching, teamMission, teamMissionId, toast]);

  useEffect(() => {
    if (!missionFormProjectId || pendingMissionProjects.isFetching || missionFormProject) return;
    toast('Não foi possível carregar os dados necessários para programar esta equipe.', 'error');
    setMissionFormProjectId(null);
  }, [missionFormProject, missionFormProjectId, pendingMissionProjects.isFetching, toast]);

  function clearPendingTouch() {
    if (pendingTouchRef.current) window.clearTimeout(pendingTouchRef.current.timer);
    pendingTouchRef.current = null;
  }

  function endDrag() {
    if (pointerRef.current) {
      pointerRef.current.ghost.remove();
      pointerRef.current.card.style.touchAction = '';
      pointerRef.current = null;
    }
    dragRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
    suppressCardClickUntilRef.current = Date.now() + 350;
  }

  useEffect(() => {
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !dragRef.current) return;
      event.preventDefault();
      setColumns(dragRef.current.snapshot);
      endDrag();
    }
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, []);

  useEffect(() => () => {
    clearPendingTouch();
    endDrag();
  }, []);

  const refresh = async (data: Awaited<ReturnType<typeof getProjectWorkflow>>) => {
    queryClient.setQueryData(['project-workflow', data.project.id], data);
    await queryClient.invalidateQueries({ queryKey: ['project-workflows'] });
  };

  const start = useMutation({
    mutationFn: (values: { leaderUserId: string; plannedMobilizationDate: string }) => startProjectWorkflow(selectedProjectId!, values),
    onSuccess: async data => {
      await refresh(data);
      toast('Handover iniciado.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });

  const update = useMutation({
    mutationFn: (payload: ProjectWorkflowPatch) => updateProjectWorkflow(selectedProjectId!, payload),
    onSuccess: async data => {
      await refresh(data);
      toast('Gestão do projeto atualizada.', 'success');
    },
    onError: (error: Error) => {
      const issues = projectWorkflowErrorIssues(error);
      toast([...new Set([error.message, ...issues])].join(' · '), 'error');
      if ((error as { code?: string }).code === 'PROJECT_WORKFLOW_VERSION_CONFLICT') void detail.refetch();
    }
  });

  const createMission = useMutation({
    mutationFn: (payload: MissionInput) => createPlanningMission(payload),
    onSuccess: async (_, payload) => {
      await refreshMissionPlanningQueries(queryClient, () => (
        queryClient.invalidateQueries({ queryKey: ['project-workflows'] })
      ));
      await queryClient.invalidateQueries({ queryKey: ['commercial-revisions', payload.projectId] });
      setMissionFormProjectId(null);
      toast('Programação da equipe salva.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });

  const managedMove = useMutation({
    mutationFn: ({ project, patch }: ManagedMove) => updateProjectWorkflow(project.id, patch),
    onSuccess: async (data, variables) => {
      queryClient.setQueryData(['project-workflow', data.project.id], data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['efetivo-planning-missions'] })
      ]);
      onMobileStageChange(variables.target);
      toast('Etapa do projeto atualizada.', 'success');
    },
    onError: async (error: Error, variables) => {
      setColumns(variables.snapshot);
      const issues = projectWorkflowErrorIssues(error);
      toast([...new Set([error.message, ...issues])].join(' · '), 'error');
      await queryClient.invalidateQueries({ queryKey: ['project-workflows'] });
      if ((error as { code?: string }).code === 'PROJECT_WORKFLOW_VERSION_CONFLICT' && selectedProjectId === variables.project.id) {
        void detail.refetch();
      }
    }
  });

  const moveLegacyMission = useMutation({
    mutationFn: ({ project, stage, order, returnDate }: LegacyMove) => {
      const mission = project.operationalMission!;
      return movePlanningMission(mission.id, mission.version, stage, order, returnDate);
    },
    onSuccess: async (_, variables) => {
      setCompletionTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['project-workflow', variables.project.id] }),
        queryClient.invalidateQueries({ queryKey: ['efetivo-planning-missions'] })
      ]);
      const projectStage = Object.entries(LEGACY_PROJECT_STAGE_TO_MISSION)
        .find(([, missionStage]) => missionStage === variables.stage)?.[0] || 'HANDOVER';
      onMobileStageChange(projectStage as ProjectKanbanStage);
      toast('Etapa do projeto antigo atualizada.', 'success');
    },
    onError: async (error: Error, variables) => {
      setColumns(variables.snapshot);
      setCompletionTarget(null);
      toast(error.message, 'error');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['efetivo-planning-missions'] })
      ]);
    }
  });

  function projectById(projectId: string) {
    return PROJECT_KANBAN_STAGES.flatMap(stage => columns[stage]).find(item => item.id === projectId);
  }

  function fullMission(summary: ProjectOperationalMissionSummary | null | undefined): PlanningMission | null {
    if (!summary) return null;
    return (planningMissions.data || []).find(mission => mission.id === summary.id) || null;
  }

  function canMoveProject(project: ProjectWorkflowSummary) {
    if (managedMove.isPending || moveLegacyMission.isPending) return false;
    if (!project.workflow) return Boolean(canManage && project.operationalMission);
    return project.workflow.stage === 'HANDOVER' ? project.permissions.canAccept : project.permissions.canEdit;
  }

  function legacyOrder(stage: MissionStage) {
    if (planningMissions.data) {
      return planningMissions.data.filter(mission => mission.stage === stage && mission.scheduleStatus !== 'CANCELLED').length;
    }
    const projectStage = Object.entries(LEGACY_PROJECT_STAGE_TO_MISSION)
      .find(([, missionStage]) => missionStage === stage)?.[0] as ProjectKanbanStage | undefined;
    return projectStage
      ? columns[projectStage].filter(project => !project.workflow && project.operationalMission).length
      : 0;
  }

  function requestMove(
    project: ProjectWorkflowSummary,
    target: ProjectKanbanStage,
    snapshot = cloneProjectKanbanColumns(columns)
  ) {
    const current = projectStageInColumns(columns, project.id);
    if (!current || current === target) return;

    if (project.workflow) {
      if (project.workflow.stage === 'HANDOVER') {
        if (target !== 'INITIAL_ANALYSIS') {
          toast('Movimentação bloqueada: assuma o handover e conclua o gate antes de seguir para outra etapa.', 'error');
          return;
        }
        if (!project.permissions.canAccept) {
          toast('Movimentação bloqueada: somente o Líder de Projetos definido pode assumir o handover.', 'error');
          return;
        }
        setColumns(moveProjectInColumns(columns, project.id, target));
        managedMove.mutate({
          project,
          target,
          patch: { action: 'accept', version: project.workflow.version },
          snapshot
        });
        return;
      }
      if (!project.permissions.canEdit) {
        toast('Movimentação bloqueada: somente o gestor ou o Líder de Projetos pode alterar esta etapa.', 'error');
        return;
      }
      if (target === 'FINAL_MEASUREMENT' || target === 'FINISHED') {
        toast('Movimentação bloqueada: o fechamento técnico e a medição ainda serão ligados ao fluxo gerenciado em uma próxima entrega.', 'error');
        return;
      }
      const allowedTargets = projectWorkflowStageOptions(project.workflow.stage);
      if (!allowedTargets.includes(target)) {
        const labels = allowedTargets.map(stageOption => PROJECT_KANBAN_STAGE_LABELS[stageOption]).join(' ou ');
        toast(
          'Movimentação bloqueada: a partir de ' + PROJECT_KANBAN_STAGE_LABELS[project.workflow.stage]
            + ', mova para ' + (labels || 'a próxima etapa pelo detalhe do projeto') + '.',
          'error'
        );
        return;
      }
      setColumns(moveProjectInColumns(columns, project.id, target));
      managedMove.mutate({
        project,
        target,
        patch: { action: 'stage', version: project.workflow.version, stage: target },
        snapshot
      });
      return;
    }

    const mission = project.operationalMission;
    if (!canManage || !mission) {
      toast(
        'Movimentação bloqueada: '
          + (mission ? 'você não possui permissão para alterar este projeto' : 'crie a programação operacional ou inicie o handover')
          + '.',
        'error'
      );
      return;
    }
    const targetMissionStage = LEGACY_PROJECT_STAGE_TO_MISSION[target];
    if (!targetMissionStage) {
      toast('Movimentação bloqueada: esta é uma etapa do novo fluxo de gestão. Inicie o handover para utilizá-la.', 'error');
      return;
    }
    const detailedMission = fullMission(mission);
    const blockers = detailedMission
      ? missionPendencies(detailedMission)
      : mission.scheduleStatus === 'CONFIRMED' ? [] : ['Confirmar a programação'];
    if (blockers.length) {
      toast('Movimentação bloqueada: ' + blockers.join(' · ') + '.', 'error');
      return;
    }
    const order = legacyOrder(targetMissionStage);
    if (targetMissionStage === 'FINISHED' && mission.stage !== 'FINISHED') {
      setCompletionTarget({ project, mission, order, snapshot });
      return;
    }
    setColumns(moveProjectInColumns(columns, project.id, target));
    moveLegacyMission.mutate({ project, stage: targetMissionStage, order, snapshot });
  }

  function beginDrag(projectId: string) {
    const drag = { projectId, snapshot: cloneProjectKanbanColumns(columns) };
    suppressCardClickUntilRef.current = Number.POSITIVE_INFINITY;
    dragRef.current = drag;
    setDraggingId(projectId);
    return drag;
  }

  function targetFromPoint(x: number, y: number) {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-project-kanban-stage]');
    return target?.dataset.projectKanbanStage as ProjectKanbanStage | undefined;
  }

  function dropProject(stage: ProjectKanbanStage) {
    const projectId = dragRef.current?.projectId;
    const snapshot = dragRef.current?.snapshot;
    const project = projectId ? projectById(projectId) : null;
    const sourceStage = projectId && snapshot ? projectStageInColumns(snapshot, projectId) : null;
    if (project && snapshot && sourceStage !== stage) {
      onProjectSelect(project.id);
      requestMove(project, stage, snapshot);
    }
    endDrag();
  }

  function startTouchDrag(pending: PendingTouch) {
    const drag = beginDrag(pending.projectId);
    const ghost = createPointerDragGhost(pending.card, pending.x, pending.y, 'efetivo-kanban-ghost');
    ghost.pointerId = pending.pointerId;
    pointerRef.current = { ...ghost, drag, card: pending.card };
    pending.card.style.touchAction = 'none';
    try {
      pending.card.setPointerCapture(pending.pointerId);
    } catch {
      // O ponteiro pode ter sido encerrado antes do início do arraste.
    }
    pendingTouchRef.current = null;
  }

  function onPointerStart(event: PointerEvent<HTMLElement>, project: ProjectWorkflowSummary) {
    if (event.pointerType === 'mouse' || !canMoveProject(project) || pointerRef.current) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    const card = event.currentTarget;
    clearPendingTouch();
    const pending: PendingTouch = {
      pointerId: event.pointerId,
      projectId: project.id,
      card,
      x: event.clientX,
      y: event.clientY,
      timer: 0
    };
    pending.timer = window.setTimeout(() => startTouchDrag(pending), TOUCH_HOLD_MS);
    pendingTouchRef.current = pending;
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const pending = pendingTouchRef.current;
    if (pending && pending.pointerId === event.pointerId) {
      if (
        Math.abs(event.clientX - pending.x) > TOUCH_HOLD_TOLERANCE
        || Math.abs(event.clientY - pending.y) > TOUCH_HOLD_TOLERANCE
      ) {
        clearPendingTouch();
      }
      return;
    }
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    event.preventDefault();
    movePointerDragGhost(pointer, event.clientX, event.clientY);
    scrollReorderContainerEdge(
      document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.project-workflow-card-list') ?? null,
      event.clientY
    );
    setDropTarget(targetFromPoint(event.clientX, event.clientY) || null);
  }

  function finishPointer(event: PointerEvent<HTMLElement>, cancelled = false) {
    if (pendingTouchRef.current?.pointerId === event.pointerId) clearPendingTouch();
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const target = targetFromPoint(event.clientX, event.clientY);
    if (cancelled || !target) {
      setColumns(pointer.drag.snapshot);
      endDrag();
      return;
    }
    dropProject(target);
  }

  function onCardDragStart(event: DragEvent<HTMLElement>, project: ProjectWorkflowSummary) {
    if (
      !canMoveProject(project)
      || interactiveMouseRef.current
      || (event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)
    ) {
      event.preventDefault();
      return;
    }
    beginDrag(project.id);
    event.dataTransfer.effectAllowed = 'move';
    setReorderDragImage(event, '[data-project-kanban-card]', 'efetivo-kanban-ghost');
  }

  function onCardDragEnd() {
    if (dragRef.current) setColumns(dragRef.current.snapshot);
    endDrag();
  }

  function moveLegacyFromDetail(stage: MissionStage, returnDate?: string | null) {
    const project = list.data?.items.find(item => item.id === selectedProjectId);
    if (!project?.operationalMission) return;
    const target = (
      Object.entries(LEGACY_PROJECT_STAGE_TO_MISSION)
        .find(([, missionStage]) => missionStage === stage)?.[0] || 'HANDOVER'
    ) as ProjectKanbanStage;
    const snapshot = cloneProjectKanbanColumns(columns);
    setColumns(moveProjectInColumns(columns, project.id, target));
    moveLegacyMission.mutate({ project, stage, order: legacyOrder(stage), returnDate, snapshot });
  }

  if (list.isLoading) {
    return <section className="page-card placeholder-copy">Carregando gestão de projetos…</section>;
  }
  if (list.isError || !list.data) {
    return (
      <section className="page-card placeholder-copy">
        <p>Não foi possível carregar a gestão de projetos.</p>
        <Button variant="secondary" onClick={() => void list.refetch()}>Tentar novamente</Button>
      </section>
    );
  }

  const managedCount = list.data.items.filter(item => item.workflow).length;
  const overdueCount = list.data.items.reduce((sum, item) => sum + (item.workflow?.overdueIssueCount || 0), 0);
  const movingProjectId = managedMove.variables?.project.id || moveLegacyMission.variables?.project.id;

  return (
    <div className="efetivo-board project-workflow-board" data-project-workflow-board>
      <section className="page-card efetivo-summary-strip">
        <span><strong>{list.data.total}</strong> projetos elegíveis</span>
        <span><strong>{managedCount}</strong> com gestão iniciada nesta página</span>
        <span><strong>{overdueCount}</strong> pendências vencidas</span>
      </section>
      <section className="page-card project-workflow-toolbar">
        <div>
          <h2>Evolução dos projetos</h2>
          <p>Fluxo único do handover ao encerramento. Arraste o projeto entre etapas; se houver um bloqueio, o sistema informa exatamente o que precisa ser resolvido.</p>
        </div>
        <SearchBar
          id="project-workflow-search"
          value={search}
          onChange={onSearchChange}
          placeholder="Buscar projeto, cliente ou código"
          count={{ shown: list.data.items.length, total: list.data.total }}
        />
        <div className="field-group project-workflow-mobile-stage">
          <label htmlFor="project-workflow-stage">Etapa exibida</label>
          <select
            id="project-workflow-stage"
            value={mobileStage}
            onChange={event => onMobileStageChange(event.target.value as ProjectKanbanStage)}
          >
            {PROJECT_KANBAN_STAGES.map(stage => (
              <option value={stage} key={stage}>{PROJECT_KANBAN_STAGE_LABELS[stage]}</option>
            ))}
          </select>
        </div>
      </section>
      <section
        className={'project-workflow-columns' + (draggingId ? ' is-dragging' : '')}
        aria-label="Evolução única dos projetos"
      >
        {PROJECT_KANBAN_STAGES.map(stage => (
          <div
            className={[
              'project-workflow-column',
              mobileStage === stage ? 'mobile-active' : '',
              dropTarget === stage ? 'drop-target' : ''
            ].filter(Boolean).join(' ')}
            data-project-kanban-stage={stage}
            data-project-workflow-execution={stage === 'EXECUTION' ? true : undefined}
            key={stage}
            onDragOver={event => {
              if (!dragRef.current) return;
              event.preventDefault();
              scrollReorderContainerEdge(
                event.currentTarget.querySelector<HTMLElement>('.project-workflow-card-list'),
                event.clientY
              );
              setDropTarget(stage);
            }}
            onDrop={event => {
              event.preventDefault();
              dropProject(stage);
            }}
          >
            <header>
              <strong>{PROJECT_KANBAN_STAGE_LABELS[stage]}</strong>
              <span>{columns[stage].length}</span>
            </header>
            <div className="project-workflow-card-list">
              {columns[stage].map(item => (
                <ProjectCard
                  item={item}
                  stage={stage}
                  selected={selectedProjectId === item.id}
                  expanded={expandedId === item.id}
                  dragging={draggingId === item.id}
                  moveAllowed={canMoveProject(item)}
                  moving={movingProjectId === item.id}
                  teamLoading={teamMissionId === item.operationalMission?.id && planningMissions.isFetching}
                  canProgramTeam={canManage}
                  programmingLoading={missionFormProjectId === item.id && pendingMissionProjects.isFetching}
                  onSelect={() => {
                    if (Date.now() >= suppressCardClickUntilRef.current) onProjectSelect(item.id);
                  }}
                  onToggleTeam={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  onManageTeam={() => {
                    if (!item.operationalMission) return;
                    setTeamMissionId(item.operationalMission.id);
                    if (planningMissions.isError) void planningMissions.refetch();
                  }}
                  onProgramTeam={() => {
                    if (!canManage) return;
                    setMissionFormProjectId(item.id);
                    if (pendingMissionProjects.isError) void pendingMissionProjects.refetch();
                  }}
                  onMove={target => requestMove(item, target)}
                  onMouseDown={event => {
                    interactiveMouseRef.current = Boolean(
                      (event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)
                    );
                  }}
                  onDragStart={event => onCardDragStart(event, item)}
                  onDragEnd={onCardDragEnd}
                  onPointerDown={event => onPointerStart(event, item)}
                  onPointerMove={onPointerMove}
                  onPointerUp={event => finishPointer(event)}
                  onPointerCancel={event => finishPointer(event, true)}
                  key={item.id}
                />
              ))}
              {columns[stage].length
                ? null
                : <p className="efetivo-kanban-empty">Nenhum projeto nesta etapa</p>}
            </div>
          </div>
        ))}
      </section>
      {list.data.total > list.data.pageSize ? (
        <nav className="project-workflow-pagination" aria-label="Paginação dos projetos">
          <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</Button>
          <span>Página {page} de {Math.ceil(list.data.total / list.data.pageSize)}</span>
          <Button
            variant="secondary"
            disabled={page * list.data.pageSize >= list.data.total}
            onClick={() => onPageChange(page + 1)}
          >
            Próxima
          </Button>
        </nav>
      ) : null}
      <MissionAllocationModal
        mission={teamMission}
        open={Boolean(teamMissionId && teamMission)}
        onClose={() => setTeamMissionId(null)}
        onPlanningMutated={() => queryClient.invalidateQueries({ queryKey: ['project-workflows'] })}
      />
      {canManage ? (
        <MissionFormModal
          open={Boolean(missionFormProjectId && missionFormProject)}
          mission={null}
          project={missionFormProject as PendingMissionProject | null}
          roles={planningRoles.data || []}
          rolesLoading={planningRoles.isLoading}
          coordinators={planningCoordinators.data || []}
          coordinatorsLoading={planningCoordinators.isLoading}
          saving={createMission.isPending}
          onClose={() => setMissionFormProjectId(null)}
          onSubmit={payload => createMission.mutate(payload)}
        />
      ) : null}
      <ProjectLegacyCompletionModal
        project={completionTarget?.project || null}
        mission={completionTarget?.mission || null}
        open={Boolean(completionTarget)}
        saving={moveLegacyMission.isPending}
        onClose={() => {
          if (!moveLegacyMission.isPending) setCompletionTarget(null);
        }}
        onConfirm={returnDate => {
          if (!completionTarget) return;
          const { project, order, snapshot } = completionTarget;
          setColumns(moveProjectInColumns(columns, project.id, 'FINISHED'));
          moveLegacyMission.mutate({ project, stage: 'FINISHED', order, returnDate, snapshot });
        }}
      />
      <ProjectWorkflowModal
        detail={selectedProjectId ? detail.data || null : null}
        leaders={leaders.data || []}
        loading={Boolean(selectedProjectId && detail.isLoading)}
        error={Boolean(selectedProjectId && detail.isError)}
        saving={start.isPending || update.isPending || createMission.isPending || managedMove.isPending || moveLegacyMission.isPending}
        onRetry={() => void detail.refetch()}
        onClose={() => onProjectSelect(undefined)}
        onStart={values => start.mutate(values)}
        onPatch={payload => update.mutate(payload)}
        onMoveLegacyMission={moveLegacyFromDetail}
        onOpenTeamProgramming={() => {
          if (!detail.data) return;
          const mission = detail.data.project.operationalMission;
          onProjectSelect(undefined);
          if (mission) {
            setTeamMissionId(mission.id);
            if (planningMissions.isError) void planningMissions.refetch();
            return;
          }
          if (!canManage) {
            toast('Somente o gestor do Efetivo pode criar a programação.', 'error');
            return;
          }
          setMissionFormProjectId(detail.data.project.id);
          if (pendingMissionProjects.isError) void pendingMissionProjects.refetch();
        }}
      />
    </div>
  );
}
