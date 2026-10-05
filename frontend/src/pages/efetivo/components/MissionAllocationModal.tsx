import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  addMissionAllocation,
  createMissionAllocationCycle,
  createMissionCycle,
  deleteMissionAllocationCycle,
  initializeMissionAllocationCycles,
  listPlanningJobRoles,
  planningErrorConflicts,
  removeMissionAllocation,
  updateMissionAllocationCycle,
  updateMissionCycle,
  type MobilizationCycle,
  type PlanningMission
} from '../../../api/efetivoPlanning';
import { Alert, Badge, Card, EmptyState } from '../../../components/ui/ds';
import { WorkflowButton as Button } from '../../../components/ui/WorkflowButton';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { RemoveIconButton } from '../../../components/ui/RemoveIconButton';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { refreshMissionPlanningQueries } from '../../../utils/efetivoPlanningQueries';
import { defaultNewAllocationPeriod, missionAllocationPeriod, missionAllocationsOn, missionCyclePeriods } from '../../../utils/missionAllocationPeriod';
import { MissionPeriodFields, type MissionPeriodDraft } from './MissionPeriodFields';
import { MissionTeamSelector } from './MissionTeamSelector';
import '../EfetivoTeam.ds.css';

type PeriodDraft = MissionPeriodDraft;
type EditingCycle = { scope: 'MISSION' | 'ALLOCATION'; allocationId?: string; cycleId: string; draft: PeriodDraft };
type PendingDelete = { allocationId: string; cycle: MobilizationCycle; collaboratorName: string };
const EMPTY_IDS: string[] = [];

function missionBounds(mission: PlanningMission) {
  return {
    mobilizationDate: (mission.cycles?.find(cycle => cycle.isDefault)?.mobilizationDate || mission.mobilizationDate).slice(0, 10),
    demobilizationDate: (mission.returnDate || mission.executionEndDate).slice(0, 10)
  };
}

function emptyPeriod(): PeriodDraft {
  return { mobilizationDate: '', demobilizationDate: '' };
}

function validCycle(draft: PeriodDraft) {
  return Boolean(draft.mobilizationDate && (!draft.demobilizationDate || draft.demobilizationDate >= draft.mobilizationDate));
}

function cycleDraft(cycle: MobilizationCycle): PeriodDraft {
  return {
    mobilizationDate: cycle.mobilizationDate.slice(0, 10),
    demobilizationDate: cycle.demobilizationDate?.slice(0, 10) || ''
  };
}

function noEmbeddedClose() {}

export function MissionAllocationModal({ mission, open, canManage, onClose = noEmbeddedClose, onPlanningMutated, embedded = false, readOnly = false, allowCycleChanges = true, mobilizationConfirmed = true }: {
  mission: PlanningMission | null;
  open: boolean;
  canManage?: boolean;
  onClose?: () => void;
  onPlanningMutated?: () => void | Promise<void>;
  embedded?: boolean;
  readOnly?: boolean;
  allowCycleChanges?: boolean;
  mobilizationConfirmed?: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [pendingInactiveAction, setPendingInactiveAction] = useState<{ names: string[]; confirm: () => void } | null>(null);
  const [period, setPeriod] = useState<PeriodDraft>(emptyPeriod());
  const [missionCycleDraft, setMissionCycleDraft] = useState<PeriodDraft>(emptyPeriod());
  const [allocationCycleDraft, setAllocationCycleDraft] = useState<PeriodDraft>(emptyPeriod());
  const [addingCycleAllocationId, setAddingCycleAllocationId] = useState<string | null>(null);
  const [editingCycle, setEditingCycle] = useState<EditingCycle | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const editCycleTrigger = useRef<HTMLButtonElement | null>(null);
  const addCycleTrigger = useRef<HTMLButtonElement | null>(null);
  const canManageTeam = canManage ?? !readOnly;
  const canChangeCycles = canManageTeam && allowCycleChanges;
  const canEditCycles = canManageTeam && (allowCycleChanges || mission?.stage === 'MOBILIZATION');
  const independentIndividualDates = ['MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT', 'FINISHED'].includes(mission?.stage || '');
  const requestedPeriod = mission && !allowCycleChanges ? missionBounds(mission) : period;
  const validPeriod = Boolean(mission && requestedPeriod.mobilizationDate
    && requestedPeriod.mobilizationDate >= missionBounds(mission).mobilizationDate
    && requestedPeriod.mobilizationDate <= missionBounds(mission).demobilizationDate
    && (!requestedPeriod.demobilizationDate || (requestedPeriod.demobilizationDate >= requestedPeriod.mobilizationDate
      && requestedPeriod.demobilizationDate <= missionBounds(mission).demobilizationDate)));

  useEffect(() => {
    if (!open || !mission) return;
    setPeriod(defaultNewAllocationPeriod(mission, allowCycleChanges));
    setMissionCycleDraft(emptyPeriod());
    setAllocationCycleDraft(emptyPeriod());
    setAddingCycleAllocationId(null);
    setEditingCycle(null);
    setTeamPickerOpen(false);
    setPendingDelete(null);
    setPendingInactiveAction(null);
  }, [allowCycleChanges, mission, open]);

  useEffect(() => {
    if (!canManageTeam) {
      setTeamPickerOpen(false);
    }
    if (!canChangeCycles) {
      setAddingCycleAllocationId(null);
      setPendingDelete(null);
    }
    if (!canEditCycles) {
      setEditingCycle(null);
      setPendingInactiveAction(null);
    }
  }, [canManageTeam, canChangeCycles, canEditCycles]);

  useEffect(() => {
    if (!open || editingCycle || !editCycleTrigger.current) return;
    const frame = requestAnimationFrame(() => editCycleTrigger.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editingCycle, open]);
  useEffect(() => {
    if (!open || addingCycleAllocationId || !addCycleTrigger.current) return;
    const frame = requestAnimationFrame(() => addCycleTrigger.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [addingCycleAllocationId, open]);

  const roles = useQuery({ queryKey: ['efetivo-planning-job-roles'], queryFn: listPlanningJobRoles, enabled: open && canManageTeam });
  const invalidate = () => refreshMissionPlanningQueries(queryClient, onPlanningMutated);
  const showPlanningError = (error: Error) => {
    const conflict = planningErrorConflicts(error)?.[0];
    toast(conflict
      ? `${error.message} ${conflict.collaboratorName}: ${displayDateOnly(conflict.startDate)} a ${displayDateOnly(conflict.endDate)}.`
      : error.message, 'error');
  };
  const add = useMutation({
    mutationFn: (payload: { collaboratorId: string; jobRoleId: string; mobilizationDate: string; demobilizationDate?: string; allowMissionOverlap: boolean; allowInactiveCollaborator: boolean }) => addMissionAllocation(mission!.id, payload),
    onSuccess: async () => {
      await invalidate();
      toast('Pessoa alocada.', 'success');
    },
    onError: showPlanningError
  });
  const remove = useMutation({
    mutationFn: (allocationId: string) => removeMissionAllocation(mission!.id, allocationId),
    onSuccess: async () => { await invalidate(); toast('Alocação removida.', 'success'); },
    onError: showPlanningError
  });
  const createProjectCycle = useMutation({
    mutationFn: ({ draft, allowInactiveCollaborator }: { draft: PeriodDraft; allowInactiveCollaborator: boolean }) => createMissionCycle(mission!.id, {
      mobilizationDate: draft.mobilizationDate,
      demobilizationDate: draft.demobilizationDate || null,
      allowInactiveCollaborator
    }),
    onSuccess: async () => { await invalidate(); setMissionCycleDraft(emptyPeriod()); toast('Ciclo do projeto criado.', 'success'); },
    onError: showPlanningError
  });
  const updateCycle = useMutation({
    mutationFn: ({ editing, allowInactiveCollaborator }: { editing: EditingCycle; allowInactiveCollaborator: boolean }) => editing.scope === 'MISSION'
      ? updateMissionCycle(mission!.id, editing.cycleId, {
        mobilizationDate: editing.draft.mobilizationDate,
        demobilizationDate: editing.draft.demobilizationDate || null,
        allowInactiveCollaborator
      })
      : updateMissionAllocationCycle(mission!.id, editing.allocationId!, editing.cycleId, {
        mobilizationDate: editing.draft.mobilizationDate,
        demobilizationDate: editing.draft.demobilizationDate || null,
        allowInactiveCollaborator
      }),
    onSuccess: async () => { await invalidate(); setEditingCycle(null); toast('Ciclo atualizado.', 'success'); },
    onError: showPlanningError
  });
  const initializeCycles = useMutation({
    mutationFn: (allocationId: string) => initializeMissionAllocationCycles(mission!.id, allocationId),
    onSuccess: async () => { await invalidate(); toast('Ciclos individuais criados a partir do projeto.', 'success'); },
    onError: showPlanningError
  });
  const createPersonCycle = useMutation({
    mutationFn: ({ allocationId, draft, allowInactiveCollaborator }: { allocationId: string; draft: PeriodDraft; allowInactiveCollaborator: boolean }) => createMissionAllocationCycle(mission!.id, allocationId, {
      mobilizationDate: draft.mobilizationDate,
      demobilizationDate: draft.demobilizationDate || null,
      allowInactiveCollaborator
    }),
    onSuccess: async () => {
      await invalidate();
      setAddingCycleAllocationId(null);
      setAllocationCycleDraft(emptyPeriod());
      toast('Ciclo individual criado.', 'success');
    },
    onError: showPlanningError
  });
  const deletePersonCycle = useMutation({
    mutationFn: ({ allocationId, cycleId }: { allocationId: string; cycleId: string }) => deleteMissionAllocationCycle(mission!.id, allocationId, cycleId),
    onSuccess: async () => { await invalidate(); setPendingDelete(null); toast('Ciclo individual removido.', 'success'); },
    onError: showPlanningError
  });

  const counts = useMemo(() => {
    if (!mission) return new Map<string, number>();
    const referenceDate = missionCyclePeriods(mission).at(-1)?.endDate
      || (mission.returnDate || mission.executionEndDate).slice(0, 10);
    const allocations = missionAllocationsOn(mission, referenceDate);
    return new Map(mission.demands.map(demand => [
      demand.jobRoleId,
      allocations.filter(item => item.jobRoleId === demand.jobRoleId).length
    ]));
  }, [mission]);

  const busy = add.isPending || remove.isPending || createProjectCycle.isPending
    || updateCycle.isPending || initializeCycles.isPending || createPersonCycle.isPending || deletePersonCycle.isPending;

  if (!mission) return null;
  const bounds = missionBounds(mission);
  const projectCycles = mission.cycles || [];
  const openProjectCycle = projectCycles.find(cycle => !cycle.demobilizationDate) || null;
  const confirmInactiveCycle = (allocationId: string | undefined, action: (confirmed: boolean) => void) => {
    const inactive = mission.allocations.filter(allocation => allocation.collaborator?.isActive === false
      && (allocationId ? allocation.id === allocationId : !allocation.cycles?.length));
    if (inactive.length) {
      setPendingInactiveAction({ names: inactive.map(allocation => allocation.collaborator!.name), confirm: () => action(true) });
    } else action(false);
  };
  const cycleEditor = (scope: 'MISSION' | 'ALLOCATION', cycle: MobilizationCycle, allocationId?: string) => {
    const active = (scope === 'ALLOCATION' ? canEditCycles : canChangeCycles) && editingCycle?.scope === scope && editingCycle.cycleId === cycle.id;
    if (!active) return null;
    return <div className="efetivo-team-cycle-editor">
      <MissionPeriodFields id={'edit-cycle-' + cycle.id} value={editingCycle.draft} min={scope === 'ALLOCATION' && independentIndividualDates ? '' : bounds.mobilizationDate} max={mission.stage === 'EXECUTION' || (scope === 'ALLOCATION' && independentIndividualDates) ? undefined : bounds.demobilizationDate} optionalEnd disabled={busy}
        startDisabled={scope === 'MISSION' && cycle.isDefault}
        onChange={draft => setEditingCycle(current => current ? { ...current, draft } : current)} />
      <div className="efetivo-team-actions">
        <Button workflowAppearance={embedded} variant="secondary" size="sm" disabled={busy} onClick={() => setEditingCycle(null)}>Cancelar</Button>
        <Button workflowAppearance={embedded} variant="primary" size="sm" loading={updateCycle.isPending} disabled={busy || !validCycle(editingCycle.draft)} onClick={() => confirmInactiveCycle(allocationId, allowInactiveCollaborator => updateCycle.mutate({ editing: { ...editingCycle, allocationId }, allowInactiveCollaborator }))}>
          {scope === 'ALLOCATION' || cycle.demobilizationDate ? 'Salvar ciclo' : 'Registrar desmobilização'}
        </Button>
      </div>
    </div>;
  };
  const renderCycle = (cycle: MobilizationCycle, index: number, allocation?: PlanningMission['allocations'][number], inherited = false) => (
    <article className="efetivo-team-cycle-row" key={cycle.id} data-cycle-id={cycle.id} data-cycle-state={cycle.isDefault && !mobilizationConfirmed ? 'pending' : cycle.demobilizationDate ? 'closed' : 'open'}>
      <div className="efetivo-team-cycle-summary">
        <div className="efetivo-team-cycle-heading">
          <strong>Ciclo {index + 1}</strong>
          <Badge tone={cycle.demobilizationDate ? 'neutral' : 'info'}>{cycle.isDefault && !mobilizationConfirmed ? 'Mobilização pendente' : cycle.demobilizationDate ? 'Encerrado' : 'Em aberto'}</Badge>
        </div>
        <p>{cycle.isDefault && !mobilizationConfirmed ? 'Mobilização prevista: ' : ''}{displayDateOnly(cycle.mobilizationDate)} a {cycle.demobilizationDate ? displayDateOnly(cycle.demobilizationDate) : 'desmobilização não registrada'}</p>
      </div>
      {(allocation ? canEditCycles : canChangeCycles) && !inherited ? <div className="efetivo-team-actions">
        <Button workflowAppearance={embedded} variant="secondary" size="sm" disabled={busy} onClick={event => { editCycleTrigger.current = event.currentTarget; setEditingCycle({ scope: allocation ? 'ALLOCATION' : 'MISSION', allocationId: allocation?.id, cycleId: cycle.id, draft: cycleDraft(cycle) }); }}>{allocation || cycle.demobilizationDate ? 'Editar' : 'Registrar desmobilização'}</Button>
        {allocation && canChangeCycles ? (embedded ? <Button workflowAppearance variant="danger" disabled={busy} onClick={() => setPendingDelete({ allocationId: allocation.id, cycle, collaboratorName: allocation.collaborator?.name || 'Colaborador' })}>Remover ciclo</Button> : <RemoveIconButton label={`Remover ciclo ${index + 1}`} disabled={busy} onClick={() => setPendingDelete({ allocationId: allocation.id, cycle, collaboratorName: allocation.collaborator?.name || 'Colaborador' })} />) : null}
      </div> : null}
      {!inherited ? cycleEditor(allocation ? 'ALLOCATION' : 'MISSION', cycle, allocation?.id) : null}
    </article>
  );

  const content = (
        <div className={`efetivo-team-stack efetivo-team-v2${embedded ? ' project-workflow-team-cycles' : ''}`} data-fv-ds={embedded ? '' : undefined} data-project-workflow-team-cycles={embedded || undefined}>
          {!embedded ? <p className="efetivo-dialog-description" id="mission-allocation-description">{mission.project.name} · {displayDateOnly(mission.mobilizationDate)} a {displayDateOnly(mission.returnDate || mission.executionEndDate)}</p> : null}
          {embedded ? <div className="project-workflow-team-cycles-overview" aria-label="Resumo da equipe e dos ciclos">
            <div><span>Período previsto da programação</span><strong>{displayDateOnly(mission.mobilizationDate)} a {displayDateOnly(mission.executionEndDate)}</strong></div>
            <div><span>Equipe vinculada</span><strong>{mission.allocations.length} colaborador(es)</strong></div>
            <div><span>Ciclos do projeto</span><strong>{projectCycles.length}</strong></div>
          </div> : null}
          {!canManageTeam ? embedded
            ? <p className="efetivo-team-help">Somente consulta · A equipe e os ciclos podem ser alterados pelo gestor do Efetivo.</p>
            : <Alert tone="info" title="Somente consulta">Você pode consultar a equipe e os ciclos. Alterações são feitas pelo gestor do Efetivo.</Alert> : null}
          <section className="efetivo-team-section efetivo-team-project-cycles" aria-labelledby="mission-project-cycles-title">
            <header><h3 id="mission-project-cycles-title">Ciclos do projeto</h3><p>Períodos em que a missão esteve mobilizada. A equipe herda estes ciclos por padrão.</p></header>
            <p className="efetivo-team-help">Desmobilização prevista: {displayDateOnly(mission.executionEndDate)}. Apenas a desmobilização efetiva registrada manualmente encerra um ciclo. A mobilização do ciclo padrão é confirmada ou corrigida na etapa Mobilização.</p>
            <div className="efetivo-team-cycle-list">
              {projectCycles.length ? projectCycles.map((cycle, index) => renderCycle(cycle, index)) : <p className="efetivo-team-help">Nenhum ciclo do projeto registrado.</p>}
            </div>
            {canChangeCycles ? <div className="efetivo-team-cycle-editor efetivo-team-new-project-cycle">
              <MissionPeriodFields id="new-project-cycle" value={missionCycleDraft} min={bounds.mobilizationDate} max={mission.stage === 'EXECUTION' ? undefined : bounds.demobilizationDate} startLabel="Nova mobilização" optionalEnd disabled={busy || Boolean(openProjectCycle)} onChange={setMissionCycleDraft} />
              <div className="efetivo-team-actions"><Button workflowAppearance={embedded} variant="primary" size="sm" loading={createProjectCycle.isPending} disabled={busy || Boolean(openProjectCycle) || !validCycle(missionCycleDraft)} onClick={() => confirmInactiveCycle(undefined, allowInactiveCollaborator => createProjectCycle.mutate({ draft: missionCycleDraft, allowInactiveCollaborator }))}>Adicionar ciclo</Button></div>
            </div> : null}
            {canChangeCycles && openProjectCycle ? <Alert tone="warning" role="status">Há uma mobilização aberta. Registre a desmobilização desse ciclo antes de adicionar outra.</Alert> : null}
          </section>

          <section className="efetivo-team-section" aria-labelledby="mission-team-allocation-title">
            <header><h3 id="mission-team-allocation-title">Equipe e alocações</h3><p>Consulte todos os colaboradores por disponibilidade. Os cargos previstos servem como referência.</p></header>
            <div className="efetivo-team-role-summary" aria-label="Cobertura da equipe por cargo">
              {mission.demands.map(demand => <Badge tone={(counts.get(demand.jobRoleId) || 0) < demand.requiredCount ? 'warning' : 'neutral'} key={demand.jobRoleId}>{demand.jobRole?.name || 'Cargo'}: {counts.get(demand.jobRoleId) || 0}/{demand.requiredCount} previsto(s)</Badge>)}
            </div>
            {canManageTeam ? <div className="efetivo-team-allocation-form">
              <h4>Adicionar colaboradores</h4>
              {allowCycleChanges ? <MissionPeriodFields id="allocation-initial" value={period} min={bounds.mobilizationDate} max={bounds.demobilizationDate} startLabel="Data de início/mobilização" endLabel="Data de saída/desmobilização" optionalEnd disabled={busy} onChange={setPeriod} /> : null}
              {!validPeriod ? <Alert tone="info">Informe uma data de entrada dentro do período da missão para consultar os colaboradores.</Alert>
                : roles.isError ? <Alert tone="danger" title="Não foi possível carregar os cargos" action={{ label: 'Tentar novamente', onClick: () => { void roles.refetch(); } }}>As datas preenchidas foram mantidas.</Alert> : null}
              <div className="efetivo-team-actions efetivo-allocation-add-actions">
                <Button workflowAppearance={embedded} variant="primary" size="sm" loading={add.isPending} disabled={busy || !validPeriod || roles.isError} onClick={() => setTeamPickerOpen(true)}>Adicionar colaborador à equipe</Button>
              </div>
            </div> : null}
            {canManageTeam && allowCycleChanges ? <p className="efetivo-team-help">Sem data de saída, a participação vai até o fim previsto da missão. Os ciclos individuais podem ser ajustados abaixo sem apagar o histórico.</p> : null}
            <div className="efetivo-team-stack" role="group" aria-labelledby="mission-allocated-team-title">
              <h4 id="mission-allocated-team-title">Equipe alocada <span className="efetivo-team-help">({mission.allocations.length})</span></h4>
              {mission.allocations.length ? mission.allocations.map(allocation => {
                const ownCycles = allocation.cycles || [];
                const inherited = ownCycles.length === 0 && !allocation.mobilizationDate && !allocation.demobilizationDate;
                const visibleCycles: MobilizationCycle[] = inherited ? projectCycles : ownCycles;
                const allocationPeriod = missionAllocationPeriod(allocation, mission);
                const openCycle = ownCycles.find(cycle => !cycle.demobilizationDate) || null;
                const adding = canChangeCycles && addingCycleAllocationId === allocation.id;
                return <Card padding="sm" className="efetivo-team-person-card" key={allocation.id} data-allocation-id={allocation.id}>
                  <header className="efetivo-team-person-heading">
                    <div><h4>{allocation.collaborator?.name || 'Colaborador'}</h4><p>{allocation.jobRole?.name || allocation.collaborator?.role || 'Cargo não informado'}</p></div>
                    <Badge tone={inherited ? 'neutral' : 'info'}>{inherited ? 'Segue os ciclos do projeto' : 'Ciclos individuais'}</Badge>
                  </header>
                  {!mission.demands.some(demand => demand.jobRoleId === allocation.jobRoleId) ? <Badge tone="warning">Cargo fora do planejamento</Badge> : null}
                  {allocation.collaborator?.isActive === false ? <Badge tone="warning">Colaborador inativo</Badge> : null}
                  {allocation.allowMissionOverlap ? <Badge tone="warning">Sobreposição confirmada</Badge> : null}
                  {canManageTeam ? <div className="efetivo-team-actions">
                    {canEditCycles && inherited ? <Button workflowAppearance={embedded} variant="secondary" size="sm" loading={initializeCycles.isPending && initializeCycles.variables === allocation.id} disabled={busy} onClick={() => initializeCycles.mutate(allocation.id)}>Personalizar ciclos</Button>
                      : canChangeCycles && !inherited ? <Button workflowAppearance={embedded} variant="secondary" size="sm" disabled={busy || Boolean(openCycle)} onClick={event => { addCycleTrigger.current = event.currentTarget; setAddingCycleAllocationId(allocation.id); setAllocationCycleDraft(emptyPeriod()); }}>Novo ciclo individual</Button> : null}
                    {embedded ? <Button workflowAppearance variant="danger" aria-label={`Remover ${allocation.collaborator?.name || 'colaborador'} da equipe`} loading={remove.isPending && remove.variables === allocation.id} disabled={busy} onClick={() => remove.mutate(allocation.id)}>Remover da equipe</Button> : <RemoveIconButton label={`Remover ${allocation.collaborator?.name || 'colaborador'} da equipe`} loading={remove.isPending && remove.variables === allocation.id} disabled={busy} onClick={() => remove.mutate(allocation.id)} />}
                  </div> : null}
                  <div className="efetivo-team-cycle-list">
                    {visibleCycles.length ? visibleCycles.map((cycle, index) => renderCycle(cycle, index, allocation, inherited))
                      : <p className="efetivo-team-help">Período de participação: {displayDateOnly(allocationPeriod.startDate)} a {displayDateOnly(allocationPeriod.endDate)}.<br />Nenhum ciclo {inherited ? 'do projeto' : 'individual'} registrado.</p>}
                  </div>
                  {adding ? <div className="efetivo-team-cycle-editor">
                    <MissionPeriodFields id={'new-person-cycle-' + allocation.id} value={allocationCycleDraft} min={independentIndividualDates ? '' : bounds.mobilizationDate} max={independentIndividualDates ? undefined : bounds.demobilizationDate} startLabel="Nova mobilização" optionalEnd disabled={busy} onChange={setAllocationCycleDraft} />
                    <div className="efetivo-team-actions"><Button workflowAppearance={embedded} variant="secondary" size="sm" disabled={busy} onClick={() => setAddingCycleAllocationId(null)}>Cancelar</Button><Button workflowAppearance={embedded} variant="primary" size="sm" loading={createPersonCycle.isPending} disabled={busy || !validCycle(allocationCycleDraft)} onClick={() => confirmInactiveCycle(allocation.id, allowInactiveCollaborator => createPersonCycle.mutate({ allocationId: allocation.id, draft: allocationCycleDraft, allowInactiveCollaborator }))}>Adicionar ciclo</Button></div>
                  </div> : null}
                  {canChangeCycles && openCycle ? <Alert tone="warning" role="status">{allocation.collaborator?.name} ainda está mobilizado. Registre a desmobilização antes de criar outro ciclo.</Alert> : null}
                </Card>;
              }) : <EmptyState title="Nenhuma pessoa alocada" description={canManageTeam ? 'Selecione um colaborador para compor a equipe.' : 'A equipe desta missão ainda não foi definida.'} />}
            </div>
          </section>
        </div>
  );

  return (
    <>
      {embedded ? content : <Modal open={open} onClose={onClose} appearance="design-system" size="lg" fullscreenOnMobile={false}
        title={'Equipe · ' + mission.project.code} ariaDescribedBy="mission-allocation-description"
        panelClassName="efetivo-dialog efetivo-team-v2 efetivo-team-management-dialog"
        closeOnEscape={!busy} showCloseButton={!busy}
        footer={<Button workflowAppearance={embedded} variant="secondary" size="sm" disabled={busy} onClick={onClose}>Fechar</Button>}>{content}</Modal>}
      {canManageTeam && teamPickerOpen ? <MissionTeamSelector
        mission={mission}
        planId={mission.planId}
        roles={roles.data || []}
        selectedIds={EMPTY_IDS}
        excludedIds={mission.allocations.map(allocation => allocation.collaboratorId)}
        allocationPeriods={[]}
        startDate={requestedPeriod.mobilizationDate}
        endDate={requestedPeriod.demobilizationDate || bounds.demobilizationDate}
        loading={roles.isLoading}
        disabled={busy}
        autoOpen
        singleSelection
        minSelected={1}
        onAllocationPeriodsChange={() => {}}
        onCancel={() => setTeamPickerOpen(false)}
        onChange={(_ids, overlapIds, inactiveIds, selected) => {
          setTeamPickerOpen(false);
          const collaborator = selected[0];
          if (!collaborator?.jobRoleId) {
            toast('Selecione um colaborador com cargo operacional ativo.', 'error');
            return;
          }
          add.mutate({
            collaboratorId: collaborator.id,
            jobRoleId: collaborator.jobRoleId,
            mobilizationDate: requestedPeriod.mobilizationDate,
            ...(requestedPeriod.demobilizationDate ? { demobilizationDate: requestedPeriod.demobilizationDate } : {}),
            allowMissionOverlap: overlapIds.includes(collaborator.id),
            allowInactiveCollaborator: inactiveIds.includes(collaborator.id)
          });
        }}
      /> : null}
      <ConfirmDialog appearance="design-system" open={canEditCycles && Boolean(pendingInactiveAction)} title="Registrar histórico de colaboradores inativos?" description="Este ciclo inclui colaboradores inativos. Confirme o registro das datas de mobilização e desmobilização para manter o histórico da missão." highlight={pendingInactiveAction?.names.join(', ')} confirmLabel="Confirmar e salvar" confirmDisabled={busy} danger={false} onConfirm={() => { if (!canEditCycles || busy) return; const action = pendingInactiveAction; setPendingInactiveAction(null); action?.confirm(); }} onCancel={() => setPendingInactiveAction(null)} />
      <ConfirmDialog appearance="design-system" open={canChangeCycles && Boolean(pendingDelete)} title="Remover este ciclo individual?" description="O período deixará de contar como mobilizado. Se este for o último ciclo próprio, o colaborador voltará a seguir os ciclos gerais do projeto." highlight={pendingDelete ? `${pendingDelete.collaboratorName} · ${displayDateOnly(pendingDelete.cycle.mobilizationDate)}` : undefined} confirmLabel={deletePersonCycle.isPending ? 'Removendo…' : 'Remover ciclo'} confirmDisabled={busy} danger onConfirm={() => canChangeCycles && !busy && pendingDelete && deletePersonCycle.mutate({ allocationId: pendingDelete.allocationId, cycleId: pendingDelete.cycle.id })} onCancel={() => { if (!busy) setPendingDelete(null); }} />
    </>
  );
}
