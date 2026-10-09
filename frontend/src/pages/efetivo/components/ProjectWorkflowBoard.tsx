import { BrandLoading } from '../../../components/brand/BrandLoading';
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
  deletePlanningMission,
  listPendingMissionProjects,
  listPlanningJobRoles,
  listPlanningMissions,
  movePlanningMission,
  updatePlanningMission,
  type MissionInput,
  type MissionScheduleStatus,
  type MissionStage,
  type PendingMissionProject,
  type PlanningMission
} from '../../../api/efetivoPlanning';
import {
  getProjectWorkflow,
  listProjectWorkflowLeaders,
  listProjectWorkflows,
  projectWorkflowErrorIssues,
  startLegacyProjectWorkflowSummary,
  startProjectWorkflow,
  updateProjectWorkflow,
  type ProjectOperationalMissionSummary,
  type ProjectWorkflowLegacySummaryInput,
  type ProjectWorkflowPatch,
  type ProjectWorkflowProject,
  type ProjectWorkflowStage,
  type ProjectWorkflowSummary
} from '../../../api/projectWorkflow';
import { Button } from '../../../components/ui/Button';
import { RemoveIconButton } from '../../../components/ui/RemoveIconButton';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { SearchBar } from '../../../components/ui/SearchBar';
import { useToast } from '../../../components/ui/ToastContext';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { refreshMissionPlanningQueries } from '../../../utils/efetivoPlanningQueries';
import { missionPendencies } from '../../../utils/missionPendencies';
import {
  cloneProjectKanbanColumns,
  canDefineInitialProjectTeam,
  canViewProjectTeamCycles,
  moveProjectInColumns,
  PROJECT_KANBAN_STAGE_LABELS,
  PROJECT_KANBAN_STAGES,
  projectStageInColumns,
  projectWorkflowNextStagePreview,
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
import { buildInitialTeamContext } from '../../../utils/initialTeamContext';
import { missionTeamAllocationPeriod, selectedMissionCollaboratorIds, type InitialTeamContext } from '../../../utils/missionTeam';
import { InitialTeamAvailabilityModal } from './MissionFormModal';
import { ProjectLegacyCompletionModal } from './ProjectLegacyCompletionModal';
import { ProjectExecutionStartModal } from './ProjectExecutionStartModal';
import { ProjectWorkflowModal } from './ProjectWorkflowModal';

type DragState = { projectId: string; snapshot: ProjectKanbanColumns };
type BlockedMoveFocus = { projectId: string; stage: ProjectWorkflowStage; count: number; token: number };
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
type ExecutionStartTarget = {
  project: ProjectWorkflowProject;
  plannedStartDate: string | null;
  executedAtHeadquarters: boolean;
  patch: Extract<ProjectWorkflowPatch, { action: 'stage' }>;
  move?: ManagedMove;
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
const LEGACY_PROJECT_STAGE_TO_MISSION: Partial<Record<ProjectKanbanStage, MissionStage>> = {
  HANDOVER: 'STANDBY',
  MOBILIZATION: 'MOBILIZATION',
  EXECUTION: 'EXECUTION',
  FINAL_MEASUREMENT: 'FINAL_MEASUREMENT',
  FINISHED: 'FINISHED'
};
const LEGACY_PROJECT_STAGES = Object.keys(LEGACY_PROJECT_STAGE_TO_MISSION) as ProjectKanbanStage[];

function compactWorkflowError(error: Error, action: string) {
  const count = new Set(projectWorkflowErrorIssues(error)).size;
  return count ? `${action}: ${count} pendência${count === 1 ? '' : 's'}. Confira a etapa aberta no planejamento.` : error.message;
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toLocaleUpperCase('pt-BR');
}

// Líder, datas e equipe são canônicos do fluxo de gestão (Handover, análise inicial e planejamento D-30):
// a única coisa que falta ao Kanban é confirmar ou cancelar a missão, então o restante do payload viaja
// inalterado a partir dos dados atuais da própria missão.
function missionInputFromExisting(mission: PlanningMission, scheduleStatus: Exclude<MissionScheduleStatus, 'DRAFT'>): MissionInput {
  return {
    projectId: mission.projectId,
    scheduleStatus,
    headquartersResponsibleUserId: mission.headquartersResponsibleUserId,
    mobilizationDate: mission.mobilizationDate.slice(0, 10),
    executionStartDate: mission.executionStartDate.slice(0, 10),
    executionEndDate: mission.executionEndDate.slice(0, 10),
    returnDate: mission.returnDate ? mission.returnDate.slice(0, 10) : null,
    collaboratorIds: selectedMissionCollaboratorIds(mission),
    allocationPeriods: mission.allocations.map(allocation => {
      const period = missionTeamAllocationPeriod(allocation, mission);
      return { collaboratorId: allocation.collaboratorId, mobilizationDate: period.startDate, demobilizationDate: period.endDate };
    })
  };
}

function moveOptions(item: ProjectWorkflowSummary): ProjectKanbanStage[] {
  if (!item.workflow) return LEGACY_PROJECT_STAGES;
  if (item.workflow.stage === 'HANDOVER') return ['HANDOVER', 'INITIAL_ANALYSIS'];
  return [item.workflow.stage, ...projectWorkflowStageOptions(item.workflow.stage, item.workflow.executedAtHeadquarters === true)];
}

function ProjectCard({
  item,
  stage,
  selected,
  expanded,
  dragging,
  moveAllowed,
  moving,
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
  const stageEnteredAt = workflow?.stageTimeline?.[stage]?.enteredAt
    || (stage === 'INITIAL_ANALYSIS' ? workflow?.acceptedAt : null)
    || (stage === 'FINISHED' ? workflow?.closedAt : null);
  const stageEntryDate = stageEnteredAt
    ? new Date(stageEnteredAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : null;
  const nextStage = projectWorkflowNextStagePreview(item, stage);
  const nextStageTiming = nextStage?.daysUntil == null
    ? nextStage?.date ? `Prevista para ${displayDateOnly(nextStage.date)}` : 'Sem data prevista'
    : nextStage.daysUntil > 0
      ? `Em ${nextStage.daysUntil} ${nextStage.daysUntil === 1 ? 'dia' : 'dias'}`
      : nextStage.daysUntil === 0
        ? 'Prevista para hoje'
        : `Previsão vencida há ${Math.abs(nextStage.daysUntil)} ${nextStage.daysUntil === -1 ? 'dia' : 'dias'}`;
  const options = moveOptions(item);
  const initialTeamAvailable = canDefineInitialProjectTeam(stage);
  const teamCyclesAvailable = canViewProjectTeamCycles(stage);
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
      <strong className="project-workflow-card-name" title={item.name}>{item.name}</strong>
      <dl className="project-workflow-card-summary">
        <div><dt>Alocados</dt><dd>{mission?.participantCount || 0}</dd></div>
        <div><dt>Nesta etapa desde</dt><dd>{stageEntryDate || 'Sem registro'}</dd></div>
        <div className="project-workflow-card-summary-next">
          <dt>Próxima etapa</dt>
          <dd>{nextStage ? PROJECT_KANBAN_STAGE_LABELS[nextStage.stage] : stage === 'FINISHED' ? 'Concluído' : 'A definir'}</dd>
          {nextStage ? <small className={nextStage.daysUntil != null && nextStage.daysUntil < 0 ? 'is-overdue' : undefined}>{nextStageTiming}</small> : null}
        </div>
      </dl>
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
            {expanded ? 'Ocultar equipe' : 'Equipe (' + mission.participantCount + ')'}
          </button>
        ) : <span />}
        {mission && teamCyclesAvailable ? (
          <button
            className="efetivo-kanban-team-manage"
            type="button"
            onClick={event => { event.stopPropagation(); onManageTeam(); }}
          >
            Equipe e ciclos
          </button>
        ) : initialTeamAvailable ? (
          <button
            className="efetivo-kanban-team-manage"
            type="button"
            disabled={!canProgramTeam || programmingLoading}
            title={canProgramTeam || stage === 'MOBILIZATION_PLANNING' ? undefined : 'Somente o gestor do Efetivo pode definir ou editar a equipe inicial.'}
            onClick={event => { event.stopPropagation(); onProgramTeam(); }}
          >
            {programmingLoading ? 'Carregando equipe…' : stage === 'MOBILIZATION_PLANNING' ? 'Equipe e ciclos' : mission ? 'Editar equipe inicial' : 'Definir equipe inicial'}
          </button>
        ) : null}
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
  const debouncedSearch = useDebouncedValue(search, 200);
  const list = useQuery({
    queryKey: ['project-workflows', debouncedSearch, page],
    queryFn: () => listProjectWorkflows(debouncedSearch, page),
    enabled: search === debouncedSearch
  });
  useEffect(() => {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
    let currentDay = formatter.format(new Date());
    const timer = window.setInterval(() => {
      const nextDay = formatter.format(new Date());
      if (nextDay === currentDay) return;
      currentDay = nextDay;
      void queryClient.invalidateQueries({ queryKey: ['project-workflows'] });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [queryClient]);
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
  const [visibleList, setVisibleList] = useState(() => list.data);
  const [columns, setColumns] = useState<ProjectKanbanColumns>(() => projectWorkflowsToColumns(list.data?.items || []));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ProjectKanbanStage | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [missionFormProjectId, setMissionFormProjectId] = useState<string | null>(null);
  const [teamContextLoadingProjectId, setTeamContextLoadingProjectId] = useState<string | null>(null);
  const [teamContext, setTeamContext] = useState<InitialTeamContext | undefined>(undefined);
  const [completionTarget, setCompletionTarget] = useState<CompletionTarget | null>(null);
  const [executionStartTarget, setExecutionStartTarget] = useState<ExecutionStartTarget | null>(null);
  const [blockedMoveFocus, setBlockedMoveFocus] = useState<BlockedMoveFocus | null>(null);
  const [deletingMissionId, setDeletingMissionId] = useState<string | null>(null);
  const [showCancelledMissions, setShowCancelledMissions] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const pointerRef = useRef<(PointerDragState & { drag: DragState; card: HTMLElement }) | null>(null);
  const pendingTouchRef = useRef<PendingTouch | null>(null);
  const interactiveMouseRef = useRef(false);
  const suppressCardClickUntilRef = useRef(0);

  useEffect(() => {
    if (!list.data || list.isFetching || search !== debouncedSearch) return;
    setVisibleList(list.data);
    setColumns(projectWorkflowsToColumns(list.data.items));
  }, [debouncedSearch, list.data, list.isFetching, search]);

  const missionFormMission = (planningMissions.data || [])
    .find(mission => mission.projectId === missionFormProjectId) || null;
  const missionFormProject = (pendingMissionProjects.data || [])
    .find(project => project.id === missionFormProjectId) || null;
  const deletingMission = (planningMissions.data || []).find(mission => mission.id === deletingMissionId) || null;
  // Uma missão cancelada some do card do projeto e das etapas que exigem programação oficial (mobilização,
  // execução, encerramento), mas nada é apagado: `listPlanningMissions` continua trazendo o registro completo.
  const cancelledMissions = (planningMissions.data || []).filter(mission => mission.scheduleStatus === 'CANCELLED');
  // A etapa do projeto (`workflow.stage`) nunca é tocada ao cancelar: o card só some da coluna enquanto
  // cancelado, e reativar o traz de volta exatamente para onde estava, sem precisar guardar nada à parte.
  const cancelledProjectIds = new Set(cancelledMissions.map(mission => mission.projectId));

  useEffect(() => {
    if (!missionFormProjectId
      || planningMissions.isFetching
      || pendingMissionProjects.isFetching
      || missionFormMission
      || missionFormProject) return;
    toast('Não foi possível carregar os dados necessários para programar esta equipe.', 'error');
    setMissionFormProjectId(null);
  }, [missionFormMission, missionFormProject, missionFormProjectId, pendingMissionProjects.isFetching, planningMissions.isFetching, toast]);

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
    interactiveMouseRef.current = false;
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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project-workflows'] }),
      queryClient.invalidateQueries({ queryKey: ['project-closeout', data.project.id] }),
      queryClient.invalidateQueries({ queryKey: ['efetivo-planning-availability'] })
    ]);
  };

  const refreshExecutionStart = async (projectId: string) => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['project-execution', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['commercial-revisions', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['project-progress', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] }),
    queryClient.invalidateQueries({ queryKey: ['project-cards'] }),
    queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] })
  ]);

  const start = useMutation({
    mutationFn: (values: { leaderUserId: string; plannerUserId: string; plannedMobilizationDate?: string }) => startProjectWorkflow(selectedProjectId!, values),
    onSuccess: async data => {
      await refresh(data);
      toast('Handover iniciado.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });

  const startLegacySummary = useMutation({
    mutationFn: (payload: ProjectWorkflowLegacySummaryInput) => startLegacyProjectWorkflowSummary(selectedProjectId!, payload),
    onSuccess: async data => {
      await refresh(data);
      await queryClient.invalidateQueries({ queryKey: ['efetivo-planning-missions'] });
      toast('Gestão resumida iniciada.', 'success');
    },
    onError: (error: Error) => {
      toast(compactWorkflowError(error, 'Não foi possível iniciar a gestão'), 'error');
    }
  });

  const update = useMutation({
    mutationFn: (payload: ProjectWorkflowPatch) => updateProjectWorkflow(selectedProjectId!, payload),
    onSuccess: async (data, payload) => {
      await refresh(data);
      if (payload.action === 'stage' && payload.stage === 'EXECUTION') await refreshExecutionStart(data.project.id);
      setBlockedMoveFocus(null);
      toast('Gestão do projeto atualizada.', 'success');
    },
    onError: (error: Error) => {
      toast(compactWorkflowError(error, 'Não foi possível atualizar o projeto'), 'error');
      if ((error as { code?: string }).code === 'PROJECT_WORKFLOW_VERSION_CONFLICT') void detail.refetch();
    }
  });

  const saveInitialTeam = useMutation({
    mutationFn: ({ mission, payload }: { mission: PlanningMission | null; payload: MissionInput }) => mission
      ? updatePlanningMission(mission.id, mission.version, payload)
      : createPlanningMission(payload),
    onSuccess: async (_, variables) => {
      const projectId = variables.payload.projectId;
      await refreshMissionPlanningQueries(queryClient);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-workflows'] }),
        queryClient.fetchQuery({
          queryKey: ['project-workflow', projectId],
          queryFn: () => getProjectWorkflow(projectId)
        }),
        queryClient.invalidateQueries({ queryKey: ['commercial-revisions', projectId] })
      ]);
      setMissionFormProjectId(null);
      onProjectSelect(projectId);
      toast(variables.mission ? 'Equipe inicial atualizada.' : 'Equipe inicial definida.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });

  // Confirmar/cancelar é a única informação que a equipe inicial (acima) não cobre; o resto da missão
  // (líder, datas, equipe) é sempre canônico do fluxo de gestão e não tem mais um diálogo próprio de edição.
  const setMissionStatus = useMutation({
    mutationFn: ({ mission, status }: { mission: PlanningMission; status: Exclude<MissionScheduleStatus, 'DRAFT'> }) =>
      updatePlanningMission(mission.id, mission.version, missionInputFromExisting(mission, status)),
    onSuccess: async (_, variables) => {
      await refreshMissionPlanningQueries(queryClient);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['project-workflow', variables.mission.projectId] })
      ]);
      toast(variables.status === 'CONFIRMED' ? 'Missão confirmada.' : 'Missão cancelada.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });
  const removeMission = useMutation({
    mutationFn: (mission: PlanningMission) => deletePlanningMission(mission.id),
    onSuccess: async (_, mission) => {
      await refreshMissionPlanningQueries(queryClient);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['project-workflow', mission.projectId] })
      ]);
      setDeletingMissionId(null);
      toast('Programação removida.', 'success');
    },
    onError: (error: Error) => toast(error.message, 'error')
  });

  const managedMove = useMutation({
    mutationFn: ({ project, patch }: ManagedMove) => updateProjectWorkflow(project.id, patch),
    onSuccess: async (data, variables) => {
      setBlockedMoveFocus(null);
      queryClient.setQueryData(['project-workflow', data.project.id], data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['efetivo-planning-missions'] }),
        queryClient.invalidateQueries({ queryKey: ['efetivo-planning-availability'] })
      ]);
      if (variables.target === 'EXECUTION') await refreshExecutionStart(data.project.id);
      onMobileStageChange(variables.target);
      toast('Etapa do projeto atualizada.', 'success');
    },
    onError: async (error: Error, variables) => {
      setColumns(variables.snapshot);
      const count = new Set(projectWorkflowErrorIssues(error)).size;
      if (variables.project.workflow && count) {
        setBlockedMoveFocus({ projectId: variables.project.id, stage: variables.project.workflow.stage, count, token: Date.now() });
      }
      onProjectSelect(variables.project.id);
      toast(compactWorkflowError(error, 'Movimentação bloqueada'), 'error');
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
        queryClient.invalidateQueries({ queryKey: ['efetivo-planning-missions'] }),
        queryClient.invalidateQueries({ queryKey: ['efetivo-planning-availability'] })
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
    if (project.workflow.stage === 'HANDOVER') return project.permissions.canAccept;
    if (project.workflow.stage === 'FINISHED') return project.permissions.canReopen;
    return project.permissions.canEdit;
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
          onProjectSelect(project.id);
          toast('Movimentação bloqueada: assuma o handover e conclua o gate antes de seguir para outra etapa.', 'error');
          return;
        }
        if (!project.permissions.canAccept) {
          onProjectSelect(project.id);
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
      if (project.workflow.stage === 'FINISHED') {
        onProjectSelect(project.id);
        if (!project.permissions.canReopen) {
          toast('Movimentação bloqueada: somente o gestor, o Líder de Projetos ou o Gestor de Contrato pode reabrir este projeto.', 'error');
        } else if (target !== 'FINAL_MEASUREMENT') {
          toast('Movimentação bloqueada: um projeto encerrado volta primeiro para Documentação / medição.', 'error');
        } else {
          toast('Informe a justificativa no detalhe para reabrir o projeto.', 'info');
        }
        return;
      }
      if (!project.permissions.canEdit) {
        onProjectSelect(project.id);
        toast('Movimentação bloqueada: somente o gestor, o Líder de Projetos ou o Gestor de Contrato pode alterar esta etapa.', 'error');
        return;
      }
      if (target === 'FINISHED') {
        if (!project.workflow.closureGate.ready) {
          setBlockedMoveFocus({ projectId: project.id, stage: 'FINAL_MEASUREMENT', count: project.workflow.closureGate.blockers.length, token: Date.now() });
          onProjectSelect(project.id);
          const count = project.workflow.closureGate.blockers.length;
          toast(`Movimentação bloqueada: ${count} pendência${count === 1 ? '' : 's'}. Confira Documentação / medição no planejamento.`, 'error');
          return;
        }
      }
      const allowedTargets = projectWorkflowStageOptions(project.workflow.stage, project.workflow.executedAtHeadquarters === true);
      if (!allowedTargets.includes(target)) {
        onProjectSelect(project.id);
        const labels = allowedTargets.map(stageOption => PROJECT_KANBAN_STAGE_LABELS[stageOption]).join(' ou ');
        toast(
          'Movimentação bloqueada: a partir de ' + PROJECT_KANBAN_STAGE_LABELS[project.workflow.stage]
            + ', mova para ' + (labels || 'a próxima etapa pelo detalhe do projeto') + '.',
          'error'
        );
        return;
      }
      if (target === 'EXECUTION') {
        const patch: ExecutionStartTarget['patch'] = { action: 'stage', version: project.workflow.version, stage: target };
        setExecutionStartTarget({
          project,
          plannedStartDate: project.workflow.plannedExecutionStartDate,
          executedAtHeadquarters: project.workflow.executedAtHeadquarters === true,
          patch,
          move: { project, target, patch, snapshot }
        });
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
      onProjectSelect(project.id);
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
      onProjectSelect(project.id);
      toast('Movimentação bloqueada: esta é uma etapa do novo fluxo de gestão. Inicie o handover para utilizá-la.', 'error');
      return;
    }
    const detailedMission = fullMission(mission);
    const blockers = detailedMission
      ? missionPendencies(detailedMission)
      : mission.scheduleStatus === 'CONFIRMED' ? [] : ['Confirmar a programação'];
    if (blockers.length) {
      onProjectSelect(project.id);
      toast(`Movimentação bloqueada: ${blockers.length} pendência${blockers.length === 1 ? '' : 's'} na programação da missão.`, 'error');
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
    const startedFromInteractiveControl = interactiveMouseRef.current;
    interactiveMouseRef.current = false;
    if (
      !canMoveProject(project)
      || startedFromInteractiveControl
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

  const isSearchPending = search !== debouncedSearch || list.isFetching || Boolean(list.data && list.data !== visibleList);
  const toolbar = (
    <section className="page-card project-workflow-toolbar" key="workflow-toolbar">
      <div>
        <h2>Evolução dos projetos</h2>
        <p>Fluxo único do handover ao encerramento. Arraste o projeto entre etapas; se houver um bloqueio, o sistema informa exatamente o que precisa ser resolvido.</p>
      </div>
      <SearchBar
        id="project-workflow-search"
        value={search}
        onChange={onSearchChange}
        loading={isSearchPending}
        placeholder="Buscar projeto, cliente ou código"
        count={visibleList ? { shown: visibleList.items.length, total: visibleList.total } : null}
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
      {cancelledMissions.length ? (
        <button
          type="button"
          className="project-workflow-link project-workflow-cancelled-toggle"
          aria-pressed={showCancelledMissions}
          data-project-workflow-cancelled-toggle
          onClick={() => setShowCancelledMissions(open => !open)}
        >
          {showCancelledMissions ? 'Ocultar missões canceladas' : 'Ver missões canceladas'}
        </button>
      ) : null}
    </section>
  );

  if (!visibleList && list.isError) {
    return <div className="efetivo-board project-workflow-board" data-project-workflow-board>{toolbar}<section className="page-card placeholder-copy"><p>Não foi possível carregar a gestão de projetos.</p><Button variant="secondary" onClick={() => void list.refetch()}>Tentar novamente</Button></section></div>;
  }
  if (!visibleList) {
    return <div className="efetivo-board project-workflow-board" data-project-workflow-board>{toolbar}<section className="page-card placeholder-copy"><BrandLoading label="Carregando gestão de projetos" /></section></div>;
  }

  const managedCount = visibleList.items.filter(item => item.workflow).length;
  const overdueCount = visibleList.items.reduce((sum, item) => sum + (item.workflow?.overdueIssueCount || 0), 0);
  const weeklyPendingCount = visibleList.items.reduce((sum, item) => sum + (item.workflow?.weeklyReviewPendingCount || 0), 0);
  const movingProjectId = (managedMove.isPending ? managedMove.variables?.project.id : undefined)
    || (moveLegacyMission.isPending ? moveLegacyMission.variables?.project.id : undefined);

  return (
    <div className="efetivo-board project-workflow-board" data-project-workflow-board>
      <section className="page-card efetivo-summary-strip">
        <span><strong>{visibleList.total}</strong> projetos elegíveis</span>
        <span><strong>{managedCount}</strong> com gestão iniciada nesta página</span>
        <span><strong>{overdueCount}</strong> pendências vencidas</span>
        {weeklyPendingCount ? <span><strong>{weeklyPendingCount}</strong> verificações semanais pendentes</span> : null}
      </section>
      {toolbar}
      {list.isError ? <section className="page-card placeholder-copy" role="alert">Não foi possível atualizar os projetos. <Button variant="secondary" onClick={() => void list.refetch()}>Tentar novamente</Button></section> : null}
      {showCancelledMissions && cancelledMissions.length ? (
        <section className="page-card project-workflow-cancelled-missions" data-project-workflow-cancelled-missions>
          <header>
            <h3>Missões canceladas</h3>
            <p>Líder, datas e equipe continuam salvos. Reative para o projeto voltar a exigir a programação oficial nas etapas de mobilização, execução e encerramento.</p>
          </header>
          <div className="project-workflow-cancelled-list">
            {cancelledMissions.map(mission => (
              <article className="page-card project-workflow-cancelled-card" key={mission.id}>
                <div>
                  <strong>{mission.project.code} · {mission.project.name}</strong>
                  <span>{mission.project.clientName || 'Sem cliente'} · {displayDateOnly(mission.mobilizationDate)} a {displayDateOnly(mission.executionEndDate)}</span>
                  <small>{mission.allocations.length} participante(s)</small>
                </div>
                {canManage ? (
                  <div className="efetivo-action-row">
                    <Button variant="secondary" disabled={setMissionStatus.isPending} onClick={() => setMissionStatus.mutate({ mission, status: 'CONFIRMED' })}>Reativar</Button>
                    <RemoveIconButton label={`Remover missão ${mission.project.code}`} disabled={removeMission.isPending} onClick={() => setDeletingMissionId(mission.id)} />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section
        className={'project-workflow-columns' + (draggingId ? ' is-dragging' : '')}
        aria-label="Evolução única dos projetos"
        aria-busy={isSearchPending}
      >
        {PROJECT_KANBAN_STAGES.map(stage => {
          // Enquanto a missão está cancelada, o projeto some da coluna e só aparece em "Cancelados"; a etapa
          // em si não muda, então reativar o traz de volta para cá sem precisar restaurar nada.
          const visibleItems = columns[stage].filter(item => !cancelledProjectIds.has(item.id));
          return (
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
              <span>{visibleItems.length}</span>
            </header>
            <div className="project-workflow-card-list">
              {visibleItems.map(item => (
                <ProjectCard
                  item={item}
                  stage={stage}
                  selected={selectedProjectId === item.id}
                  expanded={expandedId === item.id}
                  dragging={draggingId === item.id}
                  moveAllowed={canMoveProject(item)}
                  moving={movingProjectId === item.id}
                  canProgramTeam={stage === 'MOBILIZATION_PLANNING' || canManage}
                  programmingLoading={Boolean(teamContextLoadingProjectId) || (missionFormProjectId === item.id && (pendingMissionProjects.isFetching || planningMissions.isFetching))}
                  onSelect={() => {
                    if (Date.now() >= suppressCardClickUntilRef.current) onProjectSelect(item.id);
                  }}
                  onToggleTeam={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  onManageTeam={() => {
                    if (!canViewProjectTeamCycles(stage) || !item.operationalMission) return;
                    onProjectSelect(item.id);
                  }}
                  onProgramTeam={() => {
                    if (!canDefineInitialProjectTeam(stage)) return;
                    if (stage === 'MOBILIZATION_PLANNING') {
                      onProjectSelect(item.id);
                      return;
                    }
                    if (!canManage) return;
                    setTeamContextLoadingProjectId(item.id);
                    void queryClient.fetchQuery({
                      queryKey: ['project-workflow', item.id],
                      queryFn: () => getProjectWorkflow(item.id)
                    }).then(projectDetail => {
                      if (!projectDetail.workflow) throw new Error('Inicie a gestão do projeto antes de definir a equipe.');
                      setTeamContext(buildInitialTeamContext(projectDetail.workflow));
                      setMissionFormProjectId(item.id);
                      if (pendingMissionProjects.isError) void pendingMissionProjects.refetch();
                      if (planningMissions.isError) void planningMissions.refetch();
                    }).catch((error: Error) => toast(error.message, 'error'))
                      .finally(() => setTeamContextLoadingProjectId(null));
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
              {visibleItems.length
                ? null
                : <p className="efetivo-kanban-empty">Nenhum projeto nesta etapa</p>}
            </div>
          </div>
          );
        })}
      </section>
      {visibleList.total > visibleList.pageSize ? (
        <nav className="project-workflow-pagination" aria-label="Paginação dos projetos">
          <Button variant="secondary" disabled={isSearchPending || visibleList.page <= 1} onClick={() => onPageChange(visibleList.page - 1)}>Anterior</Button>
          <span>Página {visibleList.page} de {Math.ceil(visibleList.total / visibleList.pageSize)}</span>
          <Button
            variant="secondary"
            disabled={isSearchPending || visibleList.page * visibleList.pageSize >= visibleList.total}
            onClick={() => onPageChange(visibleList.page + 1)}
          >
            Próxima
          </Button>
        </nav>
      ) : null}
      {canManage ? (
        <InitialTeamAvailabilityModal
          open={Boolean(missionFormProjectId && (missionFormMission || missionFormProject))}
          mission={missionFormMission}
          project={missionFormMission ? null : missionFormProject as PendingMissionProject | null}
          context={teamContext}
          roles={planningRoles.data || []}
          rolesLoading={planningRoles.isLoading}
          saving={saveInitialTeam.isPending}
          onClose={() => { setMissionFormProjectId(null); setTeamContext(undefined); }}
          onSubmit={payload => saveInitialTeam.mutate({ mission: missionFormMission, payload })}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deletingMissionId && deletingMission)}
        title="Remover programação?"
        description="A exclusão é lógica e a trilha permanece na auditoria; o projeto volta a aparecer como missão pendente."
        highlight={deletingMission ? `${deletingMission.project.code} · ${deletingMission.project.name}` : undefined}
        confirmLabel={removeMission.isPending ? 'Removendo…' : 'Remover'}
        onConfirm={() => { if (deletingMission) removeMission.mutate(deletingMission); }}
        onCancel={() => setDeletingMissionId(null)}
      />
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
        blockedMoveFocus={blockedMoveFocus}
        leaders={leaders.data || []}
        loading={Boolean(selectedProjectId && detail.isLoading)}
        error={Boolean(selectedProjectId && detail.isError)}
        saving={start.isPending || startLegacySummary.isPending || update.isPending || saveInitialTeam.isPending || managedMove.isPending || moveLegacyMission.isPending}
        onRetry={() => void detail.refetch()}
        onClose={() => { setBlockedMoveFocus(null); onProjectSelect(undefined); }}
        onStart={values => start.mutate(values)}
        onPatch={payload => {
          if (payload.action === 'stage' && payload.stage === 'EXECUTION' && detail.data?.workflow) {
            setExecutionStartTarget({
              project: detail.data.project,
              plannedStartDate: detail.data.workflow.plannedExecutionStartDate,
              executedAtHeadquarters: detail.data.workflow.executedAtHeadquarters === true,
              patch: payload
            });
          } else update.mutate(payload);
        }}
        onStartLegacySummary={payload => startLegacySummary.mutate(payload)}
        legacySummaryMission={
          detail.data?.project.operationalMission
            ? (planningMissions.data || []).find(mission => mission.id === detail.data!.project.operationalMission!.id) || null
            : null
        }
        legacySummaryRoles={planningRoles.data || []}
        planningMission={(planningMissions.data || []).find(mission => mission.id === detail.data?.project.operationalMission?.id) || null}
        planningMissionLoading={planningMissions.isLoading || planningMissions.isFetching}
        onTeamCyclesMutated={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['project-workflows'] }),
            queryClient.invalidateQueries({ queryKey: ['project-workflow', selectedProjectId] })
          ]);
        }}
        onOpenTeamProgramming={() => {
          if (!detail.data) return;
          const stage = detail.data.workflow?.stage;
          onProjectSelect(undefined);
          if (!stage || !canDefineInitialProjectTeam(stage)) return;
          if (!canManage) {
            toast('Somente o gestor do Efetivo pode criar a programação.', 'error');
            return;
          }
          setTeamContext(detail.data.workflow ? buildInitialTeamContext(detail.data.workflow) : undefined);
          setMissionFormProjectId(detail.data.project.id);
          if (pendingMissionProjects.isError) void pendingMissionProjects.refetch();
          if (planningMissions.isError) void planningMissions.refetch();
        }}
        canManageMission={canManage}
        missionStatusSaving={setMissionStatus.isPending}
        onSetMissionStatus={status => {
          const missionId = detail.data?.project.operationalMission?.id;
          const mission = missionId ? (planningMissions.data || []).find(item => item.id === missionId) : undefined;
          if (!mission) {
            toast('Não foi possível carregar os dados desta programação.', 'error');
            if (planningMissions.isError) void planningMissions.refetch();
            return;
          }
          setMissionStatus.mutate({ mission, status });
        }}
      />
      {executionStartTarget ? <ProjectExecutionStartModal
        project={executionStartTarget.project}
        plannedStartDate={executionStartTarget.plannedStartDate}
        executedAtHeadquarters={executionStartTarget.executedAtHeadquarters}
        saving={update.isPending || managedMove.isPending}
        onClose={() => {
          if (!update.isPending && !managedMove.isPending) setExecutionStartTarget(null);
        }}
        onConfirm={startDate => {
          const patch = { ...executionStartTarget.patch, startDate };
          const callbacks = { onSuccess: () => setExecutionStartTarget(null), onError: () => setExecutionStartTarget(null) };
          if (executionStartTarget.move) {
            const move = executionStartTarget.move;
            setColumns(moveProjectInColumns(columns, move.project.id, 'EXECUTION'));
            managedMove.mutate({ ...move, patch }, callbacks);
          } else update.mutate(patch, callbacks);
        }}
      /> : null}
    </div>
  );
}
