import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  addMissionAllocation,
  autoAllocateMission,
  createMissionAllocationCycle,
  createMissionCycle,
  deleteMissionAllocationCycle,
  initializeMissionAllocationCycles,
  listEligibleCollaborators,
  planningErrorConflicts,
  removeMissionAllocation,
  updateMissionAllocationCycle,
  updateMissionCycle,
  type EligibleMissionCollaborator,
  type MobilizationCycle,
  type PlanningMission
} from '../../../api/efetivoPlanning';
import { Alert, Badge, Button, Card, EmptyState, Field, Select } from '../../../components/ui/ds';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { SearchCombobox } from '../../../components/ui/SearchCombobox';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { refreshMissionPlanningQueries } from '../../../utils/efetivoPlanningQueries';
import { missionAllocationPeriod, missionAllocationsOn, missionCyclePeriods } from '../../../utils/missionAllocationPeriod';
import { MissionPeriodFields, type MissionPeriodDraft } from './MissionPeriodFields';
import '../EfetivoTeam.ds.css';
import { filterCollaboratorsByActivity, type CollaboratorActivityFilter } from '../../../utils/missionTeam';

type PeriodDraft = MissionPeriodDraft;
type EditingCycle = { scope: 'MISSION' | 'ALLOCATION'; allocationId?: string; cycleId: string; draft: PeriodDraft };
type PendingDelete = { allocationId: string; cycle: MobilizationCycle; collaboratorName: string };

function missionBounds(mission: PlanningMission) {
  return {
    mobilizationDate: mission.mobilizationDate.slice(0, 10),
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

export function MissionAllocationModal({ mission, open, canManage, onClose, onPlanningMutated }: {
  mission: PlanningMission | null;
  open: boolean;
  canManage: boolean;
  onClose: () => void;
  onPlanningMutated?: () => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [roleId, setRoleId] = useState('');
  const [collaboratorId, setCollaboratorId] = useState('');
  const [activityFilter, setActivityFilter] = useState<CollaboratorActivityFilter>('ACTIVE');
  const [pendingInactiveAction, setPendingInactiveAction] = useState<{ names: string[]; confirm: () => void } | null>(null);
  const [period, setPeriod] = useState<PeriodDraft>(emptyPeriod());
  const [missionCycleDraft, setMissionCycleDraft] = useState<PeriodDraft>(emptyPeriod());
  const [allocationCycleDraft, setAllocationCycleDraft] = useState<PeriodDraft>(emptyPeriod());
  const [addingCycleAllocationId, setAddingCycleAllocationId] = useState<string | null>(null);
  const [editingCycle, setEditingCycle] = useState<EditingCycle | null>(null);
  const [pendingOverlap, setPendingOverlap] = useState<EligibleMissionCollaborator | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const editCycleTrigger = useRef<HTMLButtonElement | null>(null);
  const addCycleTrigger = useRef<HTMLButtonElement | null>(null);
  const selectedRoleId = roleId || mission?.demands[0]?.jobRoleId || '';
  const validPeriod = Boolean(period.mobilizationDate && period.demobilizationDate
    && period.mobilizationDate <= period.demobilizationDate);

  useEffect(() => {
    if (!open || !mission) return;
    setPeriod(missionBounds(mission));
    setMissionCycleDraft(emptyPeriod());
    setAllocationCycleDraft(emptyPeriod());
    setAddingCycleAllocationId(null);
    setEditingCycle(null);
    setPendingOverlap(null);
    setPendingDelete(null);
    setPendingInactiveAction(null);
  }, [mission, open]);

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

  const eligible = useQuery({
    queryKey: ['efetivo-eligible', mission?.id, selectedRoleId, period.mobilizationDate, period.demobilizationDate, activityFilter],
    queryFn: () => listEligibleCollaborators(mission!.id, selectedRoleId, { ...period, includeInactive: activityFilter !== 'ACTIVE' }),
    enabled: open && canManage && Boolean(mission && selectedRoleId && validPeriod)
  });
  const candidates = filterCollaboratorsByActivity(eligible.data || [], activityFilter);
  const selectedCandidate = candidates.find(item => item.id === collaboratorId) || null;
  const invalidate = () => refreshMissionPlanningQueries(queryClient, onPlanningMutated);
  const showPlanningError = (error: Error) => {
    const conflict = planningErrorConflicts(error)?.[0];
    toast(conflict
      ? `${error.message} ${conflict.collaboratorName}: ${displayDateOnly(conflict.startDate)} a ${displayDateOnly(conflict.endDate)}.`
      : error.message, 'error');
  };
  const add = useMutation({
    mutationFn: ({ allowMissionOverlap, allowInactiveCollaborator }: { allowMissionOverlap: boolean; allowInactiveCollaborator: boolean }) => addMissionAllocation(mission!.id, {
      collaboratorId,
      jobRoleId: selectedRoleId,
      ...period,
      allowMissionOverlap,
      allowInactiveCollaborator
    }),
    onSuccess: async () => {
      await invalidate();
      setCollaboratorId('');
      setPendingOverlap(null);
      toast('Pessoa alocada.', 'success');
    },
    onError: showPlanningError
  });
  const remove = useMutation({
    mutationFn: (allocationId: string) => removeMissionAllocation(mission!.id, allocationId),
    onSuccess: async () => { await invalidate(); toast('Alocação removida.', 'success'); },
    onError: showPlanningError
  });
  const auto = useMutation({
    mutationFn: () => autoAllocateMission(mission!.id),
    onSuccess: async result => {
      await invalidate();
      toast(result.remainingDeficits.length ? 'Equipe preenchida parcialmente; ainda há déficit.' : 'Vagas preenchidas com pessoas disponíveis.', result.remainingDeficits.length ? 'error' : 'success');
    },
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

  const busy = add.isPending || remove.isPending || auto.isPending || createProjectCycle.isPending
    || updateCycle.isPending || initializeCycles.isPending || createPersonCycle.isPending || deletePersonCycle.isPending;

  if (!mission) return null;
  const bounds = missionBounds(mission);
  const projectCycles = mission.cycles || [];
  const openProjectCycle = projectCycles.find(cycle => !cycle.demobilizationDate) || null;
  const submitAdd = () => {
    if (!canManage || busy || !selectedCandidate || !validPeriod || eligible.isError) return;
    if (selectedCandidate.requiresMissionOverlapConfirmation || selectedCandidate.requiresInactiveConfirmation) {
      setPendingOverlap(selectedCandidate);
      return;
    }
    add.mutate({ allowMissionOverlap: false, allowInactiveCollaborator: false });
  };
  const confirmInactiveCycle = (allocationId: string | undefined, action: (confirmed: boolean) => void) => {
    const inactive = mission.allocations.filter(allocation => allocation.collaborator?.isActive === false
      && (allocationId ? allocation.id === allocationId : !allocation.cycles?.length));
    if (inactive.length) {
      setPendingInactiveAction({ names: inactive.map(allocation => allocation.collaborator!.name), confirm: () => action(true) });
    } else action(false);
  };
  const cycleEditor = (scope: 'MISSION' | 'ALLOCATION', cycle: MobilizationCycle, allocationId?: string) => {
    const active = canManage && editingCycle?.scope === scope && editingCycle.cycleId === cycle.id;
    if (!active) return null;
    return <div className="efetivo-team-cycle-editor">
      <MissionPeriodFields id={'edit-cycle-' + cycle.id} value={editingCycle.draft} min={bounds.mobilizationDate} max={bounds.demobilizationDate} optionalEnd disabled={busy}
        onChange={draft => setEditingCycle(current => current ? { ...current, draft } : current)} />
      <div className="efetivo-team-actions">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditingCycle(null)}>Cancelar</Button>
        <Button variant="primary" size="sm" loading={updateCycle.isPending} disabled={busy || !validCycle(editingCycle.draft)} onClick={() => confirmInactiveCycle(allocationId, allowInactiveCollaborator => updateCycle.mutate({ editing: { ...editingCycle, allocationId }, allowInactiveCollaborator }))}>
          {cycle.demobilizationDate ? 'Salvar ciclo' : 'Registrar desmobilização'}
        </Button>
      </div>
    </div>;
  };
  const renderCycle = (cycle: MobilizationCycle, index: number, allocation?: PlanningMission['allocations'][number], inherited = false) => (
    <article className="efetivo-team-cycle-row" key={cycle.id} data-cycle-id={cycle.id} data-cycle-state={cycle.demobilizationDate ? 'closed' : 'open'}>
      <div className="efetivo-team-cycle-summary">
        <div className="efetivo-team-cycle-heading">
          <strong>Ciclo {index + 1}</strong>
          <Badge tone={cycle.demobilizationDate ? 'neutral' : 'info'}>{cycle.demobilizationDate ? 'Encerrado' : 'Em aberto'}</Badge>
        </div>
        <p>{displayDateOnly(cycle.mobilizationDate)} a {cycle.demobilizationDate ? displayDateOnly(cycle.demobilizationDate) : 'desmobilização não registrada'}</p>
      </div>
      {canManage && !inherited ? <div className="efetivo-team-actions">
        <Button variant="secondary" size="sm" disabled={busy} onClick={event => { editCycleTrigger.current = event.currentTarget; setEditingCycle({ scope: allocation ? 'ALLOCATION' : 'MISSION', allocationId: allocation?.id, cycleId: cycle.id, draft: cycleDraft(cycle) }); }}>{cycle.demobilizationDate ? 'Editar' : 'Registrar desmobilização'}</Button>
        {allocation ? <Button variant="danger" size="sm" disabled={busy} onClick={() => setPendingDelete({ allocationId: allocation.id, cycle, collaboratorName: allocation.collaborator?.name || 'Colaborador' })}>Remover ciclo</Button> : null}
      </div> : null}
      {!inherited ? cycleEditor(allocation ? 'ALLOCATION' : 'MISSION', cycle, allocation?.id) : null}
    </article>
  );

  return (
    <>
      <Modal open={open} onClose={onClose} appearance="design-system" size="lg" fullscreenOnMobile={false}
        title={'Equipe · ' + mission.project.code} ariaDescribedBy="mission-allocation-description"
        panelClassName="efetivo-dialog efetivo-team-v2 efetivo-team-management-dialog"
        closeOnEscape={!busy} showCloseButton={!busy}
        footer={<Button variant="secondary" size="sm" disabled={busy} onClick={onClose}>Fechar</Button>}>
        <div className="efetivo-team-stack">
          <p className="efetivo-dialog-description" id="mission-allocation-description">{mission.project.name} · {displayDateOnly(mission.mobilizationDate)} a {displayDateOnly(mission.returnDate || mission.executionEndDate)}</p>
          {!canManage ? <Alert tone="info" title="Somente consulta">Você pode consultar a equipe e os ciclos. Alterações são feitas pelo gestor do Efetivo.</Alert> : null}
          <section className="efetivo-team-section efetivo-team-project-cycles" aria-labelledby="mission-project-cycles-title">
            <header><h3 id="mission-project-cycles-title">Ciclos do projeto</h3><p>Períodos em que a missão esteve mobilizada. A equipe herda estes ciclos por padrão.</p></header>
            <div className="efetivo-team-cycle-list">
              {projectCycles.length ? projectCycles.map((cycle, index) => renderCycle(cycle, index)) : <p className="efetivo-team-help">Nenhum ciclo do projeto registrado.</p>}
            </div>
            {canManage ? <div className="efetivo-team-cycle-editor efetivo-team-new-project-cycle">
              <MissionPeriodFields id="new-project-cycle" value={missionCycleDraft} min={bounds.mobilizationDate} max={bounds.demobilizationDate} startLabel="Nova mobilização" optionalEnd disabled={busy || Boolean(openProjectCycle)} onChange={setMissionCycleDraft} />
              <div className="efetivo-team-actions"><Button variant="primary" size="sm" loading={createProjectCycle.isPending} disabled={busy || Boolean(openProjectCycle) || !validCycle(missionCycleDraft)} onClick={() => confirmInactiveCycle(undefined, allowInactiveCollaborator => createProjectCycle.mutate({ draft: missionCycleDraft, allowInactiveCollaborator }))}>Adicionar ciclo</Button></div>
            </div> : null}
            {openProjectCycle ? <Alert tone="warning" role="status">Há uma mobilização aberta. Registre a desmobilização desse ciclo antes de adicionar outra.</Alert> : null}
          </section>

          <section className="efetivo-team-section" aria-labelledby="mission-team-allocation-title">
            <header><h3 id="mission-team-allocation-title">Equipe e alocações</h3><p>Ao usar as datas gerais, o colaborador seguirá todos os ciclos do projeto. Personalize somente quando a participação dele for diferente.</p></header>
            <div className="efetivo-team-role-summary" aria-label="Cobertura da equipe por cargo">
              {mission.demands.map(demand => <Badge tone={(counts.get(demand.jobRoleId) || 0) < demand.requiredCount ? 'warning' : 'neutral'} key={demand.jobRoleId}>{demand.jobRole?.name || 'Cargo'}: {counts.get(demand.jobRoleId) || 0}/{demand.requiredCount}</Badge>)}
            </div>
            {canManage ? <div className="efetivo-team-allocation-form">
              <h4>Adicionar colaboradores</h4>
              <Field id="allocation-role" label="Cargo" optionalText="">
                <Select size="sm" value={selectedRoleId} disabled={busy || !mission.demands.length} onChange={event => { setRoleId(event.target.value); setCollaboratorId(''); }}>
                  {!mission.demands.length ? <option value="">Nenhum cargo planejado</option> : null}
                  {mission.demands.map(demand => <option key={demand.jobRoleId} value={demand.jobRoleId}>{demand.jobRole?.name || 'Cargo'} ({counts.get(demand.jobRoleId) || 0}/{demand.requiredCount})</option>)}
                </Select>
              </Field>
              <Field id="allocation-activity-filter" label="Situação cadastral" optionalText="">
                <Select size="sm" value={activityFilter} disabled={busy} onChange={event => { setActivityFilter(event.target.value as CollaboratorActivityFilter); setCollaboratorId(''); }}><option value="ACTIVE">Ativos</option><option value="INACTIVE">Inativos</option><option value="ALL">Todos</option></Select>
              </Field>
              <MissionPeriodFields id="allocation-initial" value={period} min={bounds.mobilizationDate} max={bounds.demobilizationDate} startLabel="Mobilização inicial" endLabel="Desmobilização inicial" disabled={busy} onChange={setPeriod} />
              <SearchCombobox id="allocation-collaborator" label="Colaborador" value={collaboratorId} onChange={setCollaboratorId} loading={eligible.isLoading}
                disabled={!selectedRoleId || busy || !validPeriod || eligible.isError}
                emptyText="Nenhum colaborador encontrado para este cargo e período."
                options={candidates.map(item => ({ value: item.id, label: item.name, description: [item.requiresInactiveConfirmation ? 'Inativo · registro histórico exige confirmação' : '', item.requiresMissionOverlapConfirmation ? 'Já está em outra missão neste período · exige confirmação' : ''].filter(Boolean).join(' · ') || 'Disponível no período' }))} />
              {!validPeriod ? <Alert tone="info">Informe o período de participação para consultar os colaboradores.</Alert>
                : eligible.isError ? <Alert tone="danger" title="Não foi possível consultar os colaboradores" action={{ label: 'Tentar novamente', onClick: () => { void eligible.refetch(); } }}>As datas preenchidas foram mantidas.</Alert> : null}
              <div className="efetivo-team-actions efetivo-allocation-add-actions">
                <Button variant="secondary" size="sm" loading={auto.isPending} disabled={busy || activityFilter === 'INACTIVE'} onClick={() => auto.mutate()}>Alocar disponíveis</Button>
                <Button variant="primary" size="sm" loading={add.isPending} disabled={!selectedCandidate || busy || !validPeriod || eligible.isError || eligible.isLoading} onClick={submitAdd}>Adicionar à equipe</Button>
              </div>
            </div> : null}
            {canManage && activityFilter !== 'ACTIVE' ? <Alert tone="info">Colaboradores inativos podem ser incluídos para registrar o histórico de mobilização e desmobilização, mediante confirmação.</Alert> : null}
            <div className="efetivo-team-stack" role="group" aria-labelledby="mission-allocated-team-title">
              <h4 id="mission-allocated-team-title">Equipe alocada <span className="efetivo-team-help">({mission.allocations.length})</span></h4>
              {mission.allocations.length ? mission.allocations.map(allocation => {
                const ownCycles = allocation.cycles || [];
                const inherited = ownCycles.length === 0 && !allocation.mobilizationDate && !allocation.demobilizationDate;
                const visibleCycles: MobilizationCycle[] = inherited ? projectCycles : ownCycles;
                const allocationPeriod = missionAllocationPeriod(allocation, mission);
                const openCycle = ownCycles.find(cycle => !cycle.demobilizationDate) || null;
                const adding = canManage && addingCycleAllocationId === allocation.id;
                return <Card padding="sm" className="efetivo-team-person-card" key={allocation.id} data-allocation-id={allocation.id}>
                  <header className="efetivo-team-person-heading">
                    <div><h4>{allocation.collaborator?.name || 'Colaborador'}</h4><p>{allocation.jobRole?.name || allocation.collaborator?.role || 'Cargo não informado'}</p></div>
                    <Badge tone={inherited ? 'neutral' : 'info'}>{inherited ? 'Segue os ciclos do projeto' : 'Ciclos individuais'}</Badge>
                  </header>
                  {allocation.collaborator?.isActive === false ? <Badge tone="warning">Colaborador inativo</Badge> : null}
                  {allocation.allowMissionOverlap ? <Badge tone="warning">Sobreposição confirmada</Badge> : null}
                  {canManage ? <div className="efetivo-team-actions">
                    {inherited ? <Button variant="secondary" size="sm" loading={initializeCycles.isPending && initializeCycles.variables === allocation.id} disabled={busy} onClick={() => initializeCycles.mutate(allocation.id)}>Personalizar ciclos</Button>
                      : <Button variant="secondary" size="sm" disabled={busy || Boolean(openCycle)} onClick={event => { addCycleTrigger.current = event.currentTarget; setAddingCycleAllocationId(allocation.id); setAllocationCycleDraft(emptyPeriod()); }}>Novo ciclo individual</Button>}
                    <Button variant="danger" size="sm" loading={remove.isPending && remove.variables === allocation.id} disabled={busy} onClick={() => remove.mutate(allocation.id)}>Remover da equipe</Button>
                  </div> : null}
                  <div className="efetivo-team-cycle-list">
                    {visibleCycles.length ? visibleCycles.map((cycle, index) => renderCycle(cycle, index, allocation, inherited))
                      : <p className="efetivo-team-help">Período de participação: {displayDateOnly(allocationPeriod.startDate)} a {displayDateOnly(allocationPeriod.endDate)}.<br />Nenhum ciclo {inherited ? 'do projeto' : 'individual'} registrado.</p>}
                  </div>
                  {adding ? <div className="efetivo-team-cycle-editor">
                    <MissionPeriodFields id={'new-person-cycle-' + allocation.id} value={allocationCycleDraft} min={bounds.mobilizationDate} max={bounds.demobilizationDate} startLabel="Nova mobilização" optionalEnd disabled={busy} onChange={setAllocationCycleDraft} />
                    <div className="efetivo-team-actions"><Button variant="secondary" size="sm" disabled={busy} onClick={() => setAddingCycleAllocationId(null)}>Cancelar</Button><Button variant="primary" size="sm" loading={createPersonCycle.isPending} disabled={busy || !validCycle(allocationCycleDraft)} onClick={() => confirmInactiveCycle(allocation.id, allowInactiveCollaborator => createPersonCycle.mutate({ allocationId: allocation.id, draft: allocationCycleDraft, allowInactiveCollaborator }))}>Adicionar ciclo</Button></div>
                  </div> : null}
                  {openCycle ? <Alert tone="warning" role="status">{allocation.collaborator?.name} ainda está mobilizado. Registre a desmobilização antes de criar outro ciclo.</Alert> : null}
                </Card>;
              }) : <EmptyState title="Nenhuma pessoa alocada" description={canManage ? 'Selecione um colaborador ou aloque as pessoas disponíveis.' : 'A equipe desta missão ainda não foi definida.'} />}
            </div>
          </section>
        </div>
      </Modal>
      <ConfirmDialog appearance="design-system" open={canManage && Boolean(pendingOverlap)} title={pendingOverlap?.requiresInactiveConfirmation ? 'Registrar histórico de colaborador inativo?' : 'Confirmar colaborador em mais de uma missão?'} description={[
        pendingOverlap?.requiresInactiveConfirmation ? 'O colaborador está inativo. Confirme a inclusão para registrar o histórico de mobilização e desmobilização.' : '',
        pendingOverlap?.requiresMissionOverlapConfirmation ? 'O colaborador já possui outra missão durante parte deste período. Ao confirmar, as duas alocações permanecerão ativas e o aviso ficará registrado.' : ''
      ].filter(Boolean).join(' ')} highlight={pendingOverlap?.name} confirmLabel={add.isPending ? 'Confirmando…' : pendingOverlap?.requiresInactiveConfirmation ? 'Confirmar inclusão' : 'Confirmar sobreposição'} confirmDisabled={busy} danger={false} onConfirm={() => canManage && !busy && pendingOverlap && add.mutate({ allowMissionOverlap: pendingOverlap.requiresMissionOverlapConfirmation, allowInactiveCollaborator: pendingOverlap.requiresInactiveConfirmation })} onCancel={() => { if (!busy) setPendingOverlap(null); }} />
      <ConfirmDialog appearance="design-system" open={canManage && Boolean(pendingInactiveAction)} title="Registrar histórico de colaboradores inativos?" description="Este ciclo inclui colaboradores inativos. Confirme o registro das datas de mobilização e desmobilização para manter o histórico da missão." highlight={pendingInactiveAction?.names.join(', ')} confirmLabel="Confirmar e salvar" confirmDisabled={busy} danger={false} onConfirm={() => { if (!canManage || busy) return; const action = pendingInactiveAction; setPendingInactiveAction(null); action?.confirm(); }} onCancel={() => setPendingInactiveAction(null)} />
      <ConfirmDialog appearance="design-system" open={canManage && Boolean(pendingDelete)} title="Remover este ciclo individual?" description="O período deixará de contar como mobilizado. Se este for o último ciclo próprio, o colaborador voltará a seguir os ciclos gerais do projeto." highlight={pendingDelete ? `${pendingDelete.collaboratorName} · ${displayDateOnly(pendingDelete.cycle.mobilizationDate)}` : undefined} confirmLabel={deletePersonCycle.isPending ? 'Removendo…' : 'Remover ciclo'} confirmDisabled={busy} danger onConfirm={() => canManage && !busy && pendingDelete && deletePersonCycle.mutate({ allocationId: pendingDelete.allocationId, cycleId: pendingDelete.cycle.id })} onCancel={() => { if (!busy) setPendingDelete(null); }} />
    </>
  );
}
