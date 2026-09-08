import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

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
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { SearchCombobox } from '../../../components/ui/SearchCombobox';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { refreshMissionPlanningQueries } from '../../../utils/efetivoPlanningQueries';
import { missionAllocationsOn, missionCyclePeriods } from '../../../utils/missionAllocationPeriod';
import { filterCollaboratorsByActivity, type CollaboratorActivityFilter } from '../../../utils/missionTeam';

type PeriodDraft = { mobilizationDate: string; demobilizationDate: string };
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

export function MissionAllocationModal({ mission, open, onClose, onPlanningMutated }: {
  mission: PlanningMission | null;
  open: boolean;
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

  const eligible = useQuery({
    queryKey: ['efetivo-eligible', mission?.id, selectedRoleId, period.mobilizationDate, period.demobilizationDate, activityFilter],
    queryFn: () => listEligibleCollaborators(mission!.id, selectedRoleId, { ...period, includeInactive: activityFilter !== 'ACTIVE' }),
    enabled: open && Boolean(mission && selectedRoleId && validPeriod)
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

  if (!mission) return null;
  const bounds = missionBounds(mission);
  const projectCycles = mission.cycles || [];
  const openProjectCycle = projectCycles.find(cycle => !cycle.demobilizationDate) || null;
  const submitAdd = () => {
    if (!selectedCandidate) return;
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
    const active = editingCycle?.scope === scope && editingCycle.cycleId === cycle.id;
    if (!active) return null;
    return <div className="efetivo-cycle-editor">
      <label className="field-group"><span>Mobilização</span><input type="date" min={bounds.mobilizationDate} max={bounds.demobilizationDate} value={editingCycle.draft.mobilizationDate} onChange={event => setEditingCycle(current => current ? { ...current, draft: { ...current.draft, mobilizationDate: event.target.value } } : current)} /></label>
      <label className="field-group"><span>Desmobilização</span><input type="date" min={editingCycle.draft.mobilizationDate || bounds.mobilizationDate} max={bounds.demobilizationDate} value={editingCycle.draft.demobilizationDate} onChange={event => setEditingCycle(current => current ? { ...current, draft: { ...current.draft, demobilizationDate: event.target.value } } : current)} /></label>
      <Button variant="secondary" disabled={updateCycle.isPending} onClick={() => setEditingCycle(null)}>Cancelar</Button>
      <Button disabled={updateCycle.isPending || !validCycle(editingCycle.draft)} onClick={() => confirmInactiveCycle(allocationId, allowInactiveCollaborator => updateCycle.mutate({ editing: { ...editingCycle, allocationId }, allowInactiveCollaborator }))}>{updateCycle.isPending ? 'Salvando…' : cycle.demobilizationDate ? 'Salvar ciclo' : 'Registrar desmobilização'}</Button>
    </div>;
  };

  return (
    <>
      <Modal open={open} onClose={onClose} ariaLabelledBy="mission-allocation-title" panelClassName="modal-card efetivo-detail-modal efetivo-modal">
        <div className="efetivo-modal-layout">
          <header className="efetivo-modal-header"><div><h3 id="mission-allocation-title">Equipe · {mission.project.code}</h3><p>{displayDateOnly(mission.mobilizationDate)} a {displayDateOnly(mission.returnDate || mission.executionEndDate)}</p></div><button className="icon-button" aria-label="Fechar" type="button" onClick={onClose}>×</button></header>
          <div className="efetivo-modal-body">
            <section className="efetivo-cycle-section">
              <header><div><strong>Ciclos do projeto</strong><span>Períodos em que a missão esteve mobilizada. A equipe herda estes ciclos por padrão.</span></div></header>
              <div className="efetivo-cycle-list">{projectCycles.map((cycle, index) => <article key={cycle.id}>
                <div><strong>Ciclo {index + 1}</strong><span>{displayDateOnly(cycle.mobilizationDate)} a {cycle.demobilizationDate ? displayDateOnly(cycle.demobilizationDate) : 'Em aberto'}</span></div>
                <Button variant="secondary" onClick={() => setEditingCycle({ scope: 'MISSION', cycleId: cycle.id, draft: cycleDraft(cycle) })}>{cycle.demobilizationDate ? 'Editar' : 'Registrar desmobilização'}</Button>
                {cycleEditor('MISSION', cycle)}
              </article>)}</div>
              <div className="efetivo-cycle-add">
                <label className="field-group"><span>Nova mobilização</span><input type="date" min={bounds.mobilizationDate} max={bounds.demobilizationDate} value={missionCycleDraft.mobilizationDate} onChange={event => setMissionCycleDraft(current => ({ ...current, mobilizationDate: event.target.value }))} /></label>
                <label className="field-group"><span>Desmobilização (opcional)</span><input type="date" min={missionCycleDraft.mobilizationDate || bounds.mobilizationDate} max={bounds.demobilizationDate} value={missionCycleDraft.demobilizationDate} onChange={event => setMissionCycleDraft(current => ({ ...current, demobilizationDate: event.target.value }))} /></label>
                <Button disabled={createProjectCycle.isPending || Boolean(openProjectCycle) || !validCycle(missionCycleDraft)} onClick={() => confirmInactiveCycle(undefined, allowInactiveCollaborator => createProjectCycle.mutate({ draft: missionCycleDraft, allowInactiveCollaborator }))}>Adicionar ciclo</Button>
              </div>
              {openProjectCycle ? <p className="efetivo-cycle-warning">Há uma mobilização aberta. Registre a desmobilização desse ciclo antes de adicionar outra.</p> : null}
            </section>

            <div className="efetivo-demand-summary">{mission.demands.map(demand => <button className={selectedRoleId === demand.jobRoleId ? 'active' : ''} type="button" key={demand.jobRoleId} onClick={() => { setRoleId(demand.jobRoleId); setCollaboratorId(''); }}><strong>{demand.jobRole?.name}</strong><span>{counts.get(demand.jobRoleId) || 0}/{demand.requiredCount}</span></button>)}</div>
            <div className="efetivo-allocation-add">
              <label className="field-group" htmlFor="allocation-activity-filter"><span>Situação cadastral</span><select id="allocation-activity-filter" value={activityFilter} disabled={add.isPending} onChange={event => { setActivityFilter(event.target.value as CollaboratorActivityFilter); setCollaboratorId(''); }}><option value="ACTIVE">Ativos</option><option value="INACTIVE">Inativos</option><option value="ALL">Todos</option></select></label>
              <SearchCombobox label="Colaborador" value={collaboratorId} onChange={setCollaboratorId} loading={eligible.isFetching} disabled={!selectedRoleId || add.isPending || !validPeriod} options={candidates.map(item => ({ value: item.id, label: item.name, description: [item.requiresInactiveConfirmation ? 'Inativo · registro histórico exige confirmação' : '', item.requiresMissionOverlapConfirmation ? 'Já está em outra missão neste período · exige confirmação' : ''].filter(Boolean).join(' · ') || 'Disponível no período' }))} />
              <div className="efetivo-allocation-period-fields">
                <label className="field-group" htmlFor="allocation-mobilization-date"><span>Mobilização inicial</span><input id="allocation-mobilization-date" type="date" min={bounds.mobilizationDate} max={bounds.demobilizationDate} value={period.mobilizationDate} onChange={event => setPeriod(current => ({ ...current, mobilizationDate: event.target.value }))} /></label>
                <label className="field-group" htmlFor="allocation-demobilization-date"><span>Desmobilização inicial</span><input id="allocation-demobilization-date" type="date" min={period.mobilizationDate || bounds.mobilizationDate} max={bounds.demobilizationDate} value={period.demobilizationDate} onChange={event => setPeriod(current => ({ ...current, demobilizationDate: event.target.value }))} /></label>
              </div>
              <div className="efetivo-allocation-add-actions"><Button variant="secondary" disabled={auto.isPending || activityFilter === 'INACTIVE'} onClick={() => auto.mutate()}>{auto.isPending ? 'Alocando…' : 'Alocar disponíveis'}</Button><Button disabled={!selectedCandidate || eligible.isFetching || add.isPending || !validPeriod} onClick={submitAdd}>{add.isPending ? 'Alocando…' : 'Adicionar à equipe'}</Button></div>
            </div>
            {activityFilter !== 'ACTIVE' ? <p className="efetivo-cycle-warning">Colaboradores inativos podem ser incluídos para registrar o histórico de mobilização e desmobilização, mediante confirmação.</p> : null}
            <p className="field-hint">Ao usar as datas gerais, o colaborador seguirá todos os ciclos do projeto. Personalize abaixo somente quando a participação dele for diferente.</p>
            <div className="efetivo-compact-list efetivo-allocation-period-list">{mission.allocations.length ? mission.allocations.map(allocation => {
              const ownCycles = allocation.cycles || [];
              const inherited = ownCycles.length === 0 && !allocation.mobilizationDate && !allocation.demobilizationDate;
              const visibleCycles: MobilizationCycle[] = inherited ? projectCycles : ownCycles;
              const openCycle = ownCycles.find(cycle => !cycle.demobilizationDate) || null;
              const adding = addingCycleAllocationId === allocation.id;
              return <article key={allocation.id} className="efetivo-allocation-cycle-card">
                <div><strong>{allocation.collaborator?.name}</strong><span>{allocation.jobRole?.name || allocation.collaborator?.role}</span>{allocation.collaborator?.isActive === false ? <small className="efetivo-overlap-badge">Colaborador inativo</small> : null}{allocation.allowMissionOverlap ? <small className="efetivo-overlap-badge">Sobreposição confirmada</small> : null}</div>
                <div className="efetivo-allocation-row-actions"><Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(allocation.id)}>Remover da equipe</Button></div>
                <div className="efetivo-person-cycle-panel">
                  <header><strong>{inherited ? 'Segue os ciclos do projeto' : 'Ciclos individuais'}</strong>{inherited ? <Button variant="secondary" disabled={initializeCycles.isPending} onClick={() => initializeCycles.mutate(allocation.id)}>Personalizar ciclos</Button> : <Button variant="secondary" disabled={Boolean(openCycle)} onClick={() => { setAddingCycleAllocationId(allocation.id); setAllocationCycleDraft(emptyPeriod()); }}>Novo ciclo individual</Button>}</header>
                  <div className="efetivo-cycle-list">{visibleCycles.length ? visibleCycles.map((cycle, index) => <article key={cycle.id}>
                    <div><strong>Ciclo {index + 1}</strong><span>{displayDateOnly(cycle.mobilizationDate)} a {cycle.demobilizationDate ? displayDateOnly(cycle.demobilizationDate) : 'Em aberto'}</span></div>
                    {!inherited ? <div className="efetivo-cycle-actions"><Button variant="secondary" onClick={() => setEditingCycle({ scope: 'ALLOCATION', allocationId: allocation.id, cycleId: cycle.id, draft: cycleDraft(cycle) })}>{cycle.demobilizationDate ? 'Editar' : 'Registrar desmobilização'}</Button><Button variant="danger" onClick={() => setPendingDelete({ allocationId: allocation.id, cycle, collaboratorName: allocation.collaborator?.name || 'Colaborador' })}>Remover ciclo</Button></div> : null}
                    {!inherited ? cycleEditor('ALLOCATION', cycle, allocation.id) : null}
                  </article>) : <p className="placeholder-copy">Nenhum ciclo individual registrado.</p>}</div>
                  {adding ? <div className="efetivo-cycle-add">
                    <label className="field-group"><span>Nova mobilização</span><input type="date" min={bounds.mobilizationDate} max={bounds.demobilizationDate} value={allocationCycleDraft.mobilizationDate} onChange={event => setAllocationCycleDraft(current => ({ ...current, mobilizationDate: event.target.value }))} /></label>
                    <label className="field-group"><span>Desmobilização (opcional)</span><input type="date" min={allocationCycleDraft.mobilizationDate || bounds.mobilizationDate} max={bounds.demobilizationDate} value={allocationCycleDraft.demobilizationDate} onChange={event => setAllocationCycleDraft(current => ({ ...current, demobilizationDate: event.target.value }))} /></label>
                    <Button variant="secondary" onClick={() => setAddingCycleAllocationId(null)}>Cancelar</Button><Button disabled={!validCycle(allocationCycleDraft) || createPersonCycle.isPending} onClick={() => confirmInactiveCycle(allocation.id, allowInactiveCollaborator => createPersonCycle.mutate({ allocationId: allocation.id, draft: allocationCycleDraft, allowInactiveCollaborator }))}>Adicionar ciclo</Button>
                  </div> : null}
                  {openCycle ? <p className="efetivo-cycle-warning">{allocation.collaborator?.name} ainda está mobilizado. Registre a desmobilização antes de criar outro ciclo.</p> : null}
                </div>
              </article>;
            }) : <p className="placeholder-copy">Nenhuma pessoa alocada.</p>}</div>
          </div>
          <footer className="efetivo-modal-footer"><Button variant="secondary" onClick={onClose}>Fechar</Button></footer>
        </div>
      </Modal>
      <ConfirmDialog open={Boolean(pendingOverlap)} title={pendingOverlap?.requiresInactiveConfirmation ? 'Registrar histórico de colaborador inativo?' : 'Confirmar colaborador em mais de uma missão?'} description={[
        pendingOverlap?.requiresInactiveConfirmation ? 'O colaborador está inativo. Confirme a inclusão para registrar o histórico de mobilização e desmobilização.' : '',
        pendingOverlap?.requiresMissionOverlapConfirmation ? 'O colaborador já possui outra missão durante parte deste período. Ao confirmar, as duas alocações permanecerão ativas e o aviso ficará registrado.' : ''
      ].filter(Boolean).join(' ')} highlight={pendingOverlap?.name} confirmLabel={add.isPending ? 'Confirmando…' : pendingOverlap?.requiresInactiveConfirmation ? 'Confirmar inclusão' : 'Confirmar sobreposição'} confirmDisabled={add.isPending} danger={false} onConfirm={() => pendingOverlap && add.mutate({ allowMissionOverlap: pendingOverlap.requiresMissionOverlapConfirmation, allowInactiveCollaborator: pendingOverlap.requiresInactiveConfirmation })} onCancel={() => setPendingOverlap(null)} />
      <ConfirmDialog open={Boolean(pendingInactiveAction)} title="Registrar histórico de colaboradores inativos?" description="Este ciclo inclui colaboradores inativos. Confirme o registro das datas de mobilização e desmobilização para manter o histórico da missão." highlight={pendingInactiveAction?.names.join(', ')} confirmLabel="Confirmar e salvar" danger={false} onConfirm={() => { const action = pendingInactiveAction; setPendingInactiveAction(null); action?.confirm(); }} onCancel={() => setPendingInactiveAction(null)} />
      <ConfirmDialog open={Boolean(pendingDelete)} title="Remover este ciclo individual?" description="O período deixará de contar como mobilizado. Se este for o último ciclo próprio, o colaborador voltará a seguir os ciclos gerais do projeto." highlight={pendingDelete ? `${pendingDelete.collaboratorName} · ${displayDateOnly(pendingDelete.cycle.mobilizationDate)}` : undefined} confirmLabel={deletePersonCycle.isPending ? 'Removendo…' : 'Remover ciclo'} confirmDisabled={deletePersonCycle.isPending} danger onConfirm={() => pendingDelete && deletePersonCycle.mutate({ allocationId: pendingDelete.allocationId, cycleId: pendingDelete.cycle.id })} onCancel={() => setPendingDelete(null)} />
    </>
  );
}
