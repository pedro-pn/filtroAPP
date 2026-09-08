import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  autoAllocateMission,
  createPlanningMission,
  deletePlanningMission,
  listPendingMissionProjects,
  listPlanningCoordinators,
  listPlanningJobRoles,
  listPlanningMissions,
  updatePlanningMission,
  type MissionInput,
  type MissionScheduleStatus,
  type PendingMissionProject,
  type PlanningMission
} from '../../../api/efetivoPlanning';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { SearchBar } from '../../../components/ui/SearchBar';
import { useToast } from '../../../components/ui/ToastContext';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { refreshMissionPlanningQueries } from '../../../utils/efetivoPlanningQueries';
import { missionPendencies, PENDING_PROJECT_PENDENCIES } from '../../../utils/missionPendencies';
import { missionCoveredDemand, missionFinalAllocations, missionRolePeakCount } from '../../../utils/missionAllocationPeriod';
import { MissionAllocationModal } from './MissionAllocationModal';
import { MissionFormModal } from './MissionFormModal';
import { MissionExecutionPanel } from './MissionExecutionPanel';

const statusLabel = { CONFIRMED: 'Confirmada', CANCELLED: 'Cancelada' } as const;

type FormTarget = { mission: PlanningMission | null; project: PendingMissionProject | null };

function matchesSearch(search: string, ...values: Array<string | null | undefined>) {
  if (!search) return true;
  return values.filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'));
}

export function MissionsBoard({ canManage, planId, status, search, selectedMissionId, onSearchChange, onStatusChange, onMissionSelect, onPlanningMutated }: {
  canManage: boolean;
  planId?: string;
  status?: MissionScheduleStatus;
  search: string;
  selectedMissionId?: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: MissionScheduleStatus | undefined) => void;
  onMissionSelect?: (missionId: string) => void;
  onPlanningMutated?: () => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [allocating, setAllocating] = useState<PlanningMission | null>(null);
  const [deleting, setDeleting] = useState<PlanningMission | null>(null);
  const missions = useQuery({ queryKey: ['efetivo-planning-missions', planId || 'official', status || 'all'], queryFn: () => listPlanningMissions({ planId, status }) });
  const pending = useQuery({ queryKey: ['efetivo-planning-missions-pending', planId || 'official'], queryFn: () => listPendingMissionProjects({ planId }) });
  const roles = useQuery({ queryKey: ['efetivo-planning-job-roles'], queryFn: listPlanningJobRoles });
  const coordinators = useQuery({ queryKey: ['efetivo-planning-coordinators'], queryFn: listPlanningCoordinators });
  useEffect(() => {
    if (!allocating || !missions.data) return;
    const refreshed = missions.data.find(mission => mission.id === allocating.id);
    if (refreshed && refreshed !== allocating) setAllocating(refreshed);
  }, [allocating, missions.data]);
  const refresh = async () => {
    await refreshMissionPlanningQueries(queryClient, onPlanningMutated);
  };
  const save = useMutation({
    mutationFn: (payload: MissionInput) => formTarget?.mission
      ? updatePlanningMission(formTarget.mission.id, formTarget.mission.version, payload)
      : createPlanningMission(payload),
    onSuccess: async (_, payload) => { await refresh(); await queryClient.invalidateQueries({ queryKey: ['commercial-revisions', payload.projectId] }); setFormTarget(null); toast('Programação salva.', 'success'); },
    onError: (error: Error) => toast(error.message, 'error')
  });
  const autoAllocate = useMutation({
    mutationFn: (missionId: string) => autoAllocateMission(missionId),
    onSuccess: async result => { await refresh(); toast(result.remainingDeficits.length ? 'Equipe preenchida parcialmente; ainda há vagas sem pessoas.' : 'Vagas preenchidas com pessoas disponíveis.', result.remainingDeficits.length ? 'error' : 'success'); },
    onError: (error: Error) => toast(error.message, 'error')
  });
  const remove = useMutation({ mutationFn: (id: string) => deletePlanningMission(id), onSuccess: async () => { await refresh(); setDeleting(null); toast('Programação removida.', 'success'); }, onError: (error: Error) => toast(error.message, 'error') });

  const pendingProjects = useMemo(
    () => (status ? [] : (pending.data || []).filter(project => matchesSearch(search, project.code, project.name, project.clientName, project.location))),
    [pending.data, search, status]
  );
  const rows = useMemo(
    () => (missions.data || []).filter(mission => matchesSearch(search, mission.project.code, mission.project.name, mission.project.clientName)),
    [missions.data, search]
  );
  const incompleteMissions = rows.filter(mission => missionPendencies(mission).length > 0).length;
  const totalPendencies = pendingProjects.length + incompleteMissions;
  const totalShown = pendingProjects.length + rows.length;
  const totalAvailable = (pending.data || []).length + (missions.data?.length || 0);
  const confirmedCount = rows.filter(mission => mission.scheduleStatus === 'CONFIRMED').length;
  const plannedPositions = rows.reduce((sum, mission) => sum + mission.demands.reduce((total, demand) => total + demand.requiredCount, 0), 0);
  const openPositions = rows.reduce((sum, mission) => sum + Math.max(0, mission.demands.reduce((total, demand) => total + demand.requiredCount, 0) - missionCoveredDemand(mission)), 0);

  return (
    <div className="efetivo-board" data-efetivo-missions>
      <section className="page-card efetivo-list-toolbar">
        <SearchBar value={search} onChange={onSearchChange} placeholder="Buscar missão, projeto ou cliente" count={{ shown: totalShown, total: totalAvailable }} />
        <div className="field-group">
          <label htmlFor="mission-status-filter">Situação</label>
          <select id="mission-status-filter" value={status || ''} onChange={event => onStatusChange((event.target.value || undefined) as MissionScheduleStatus | undefined)}>
            <option value="">Todas</option>
            <option value="CONFIRMED">Confirmada</option>
            <option value="CANCELLED">Cancelada</option>
          </select>
        </div>
      </section>
      <section className="page-card efetivo-summary-strip" data-efetivo-mission-summary>
        <span><strong>{confirmedCount}</strong> confirmadas</span>
        <span><strong>{plannedPositions}</strong> posições planejadas</span>
        <span className={openPositions ? 'danger' : ''}><strong>{openPositions}</strong> posições pendentes</span>
        <span><strong>{pendingProjects.length}</strong> projetos sem programação</span>
      </section>
      {totalPendencies ? (
        <section className="page-card efetivo-pending-banner" role="status" data-efetivo-pending-banner>
          <strong>{totalPendencies} {totalPendencies === 1 ? 'missão pendente' : 'missões pendentes'}</strong>
          <p>As missões vêm dos projetos cadastrados. Abra cada card destacado em amarelo e complete líder, datas, equipe e confirmação.</p>
        </section>
      ) : null}
      {missions.isLoading || pending.isLoading ? <section className="page-card placeholder-copy">Carregando missões…</section>
        : missions.isError || pending.isError ? <section className="page-card placeholder-copy">Não foi possível carregar as missões.</section>
          : totalShown ? (
            <div className="efetivo-mission-grid">
              {pendingProjects.map(project => (
                <article
                  className="page-card efetivo-mission-card efetivo-mission-pending"
                  data-project-id={project.id}
                  data-efetivo-pending-card
                  key={project.id}
                  onClick={() => { if (canManage) setFormTarget({ mission: null, project }); }}
                >
                  <header>
                    <div><span className="efetivo-eyebrow">{project.code}</span><h2>{project.name}</h2><p>{project.clientName || 'Sem cliente'} · {project.location || 'Sem local'}</p></div>
                    <span className="efetivo-status status-pending">Aguardando programação</span>
                  </header>
                  <p className="efetivo-pending-note">Projeto cadastrado ainda sem programação operacional — não entra no calendário nem na capacidade enquanto estiver assim.</p>
                  <ul className="efetivo-pending-list">{PENDING_PROJECT_PENDENCIES.map(item => <li key={item}>{item}</li>)}</ul>
                  <footer>
                    <span>Mobilização do projeto: <strong>{project.mobilizationDate ? displayDateOnly(project.mobilizationDate) : 'não informada'}</strong></span>
                    <div className="efetivo-action-row">{canManage ? <Button onClick={() => setFormTarget({ mission: null, project })}>Completar programação</Button> : <span className="field-hint">Somente o gestor do Efetivo completa a programação.</span>}</div>
                  </footer>
                </article>
              ))}
              {rows.map(mission => {
                const required = mission.demands.reduce((sum, demand) => sum + demand.requiredCount, 0);
                const finalAllocations = missionFinalAllocations(mission);
                const pendencies = missionPendencies(mission);
                return (
                  <article
                    className={`page-card efetivo-mission-card ${pendencies.length ? 'efetivo-mission-pending' : ''} ${selectedMissionId === mission.id ? 'selected' : ''}`}
                    data-mission-id={mission.id}
                    key={mission.id}
                    onClick={() => onMissionSelect?.(mission.id)}
                  >
                    <header>
                      <div><span className="efetivo-eyebrow">{mission.project.code}</span><h2>{mission.project.name}</h2><p>{mission.project.clientName} · {mission.project.location}</p></div>
                      {mission.scheduleStatus === 'DRAFT' ? null : <span className={`efetivo-status status-${mission.scheduleStatus.toLocaleLowerCase('pt-BR')}`}>{statusLabel[mission.scheduleStatus]}</span>}
                    </header>
                    <dl>
                      <div><dt>Mobilização</dt><dd>{displayDateOnly(mission.mobilizationDate)}</dd></div>
                      <div><dt>Execução</dt><dd>{displayDateOnly(mission.executionStartDate)}–{displayDateOnly(mission.executionEndDate)}</dd></div>
                      <div><dt>Desmobilização</dt><dd>{displayDateOnly(mission.returnDate)}</dd></div>
                      <div><dt>Participantes</dt><dd>{finalAllocations.length}</dd></div>
                    </dl>
                    <div className="efetivo-demand-chips">{mission.demands.map(demand => {
                      const allocated = missionRolePeakCount(mission, demand.jobRoleId);
                      return <span className={allocated < demand.requiredCount ? 'missing' : ''} key={demand.jobRoleId}><i style={{ background: demand.jobRole?.calendarColor || 'var(--mu)' }} aria-hidden="true" />{demand.jobRole?.name}: <strong>{allocated}/{demand.requiredCount}</strong></span>;
                    })}</div>
                    <p className={`efetivo-team-status ${required - missionCoveredDemand(mission) > 0 ? 'danger' : 'success'}`}>{required - missionCoveredDemand(mission) > 0 ? `${required - missionCoveredDemand(mission)} vagas ainda precisam de pessoas nos ciclos da missão` : 'Equipe completa e sem conflitos'}</p>
                    {pendencies.length ? <ul className="efetivo-pending-list">{pendencies.map(item => <li key={item}>{item}</li>)}</ul> : null}
                    {!planId && selectedMissionId === mission.id ? <MissionExecutionPanel missionId={mission.id} /> : null}
                    <footer>
                      <span>Líder: <strong>{mission.headquartersResponsibleName}</strong></span>
                      <div className="efetivo-action-row efetivo-mission-card-actions">
                        <Button variant="secondary" onClick={() => setAllocating(mission)}>Equipe</Button>
                        {canManage && required > missionCoveredDemand(mission) ? <Button variant="secondary" disabled={autoAllocate.isPending} onClick={() => autoAllocate.mutate(mission.id)}>{autoAllocate.isPending ? 'Alocando…' : 'Alocar disponíveis'}</Button> : null}
                        {canManage ? <><Button variant="mini" onClick={() => setFormTarget({ mission, project: null })}>Editar</Button><Button variant="danger" onClick={() => setDeleting(mission)}>Remover</Button></> : null}
                      </div>
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : <section className="page-card placeholder-copy">Nenhuma missão neste recorte.</section>}
      {canManage ? <MissionFormModal open={Boolean(formTarget)} mission={formTarget?.mission || null} project={formTarget?.project || null} planId={planId} roles={roles.data || []} rolesLoading={roles.isLoading} coordinators={coordinators.data || []} coordinatorsLoading={coordinators.isLoading} saving={save.isPending} onClose={() => setFormTarget(null)} onSubmit={payload => save.mutate(payload)} /> : null}
      <MissionAllocationModal mission={allocating} open={Boolean(allocating)} onClose={() => setAllocating(null)} onPlanningMutated={onPlanningMutated} />
      <ConfirmDialog open={Boolean(deleting)} title="Remover programação?" description="A exclusão é lógica e a trilha permanece na auditoria; o projeto volta a aparecer como missão pendente." highlight={deleting ? `${deleting.project.code} · ${deleting.project.name}` : undefined} confirmLabel={remove.isPending ? 'Removendo…' : 'Remover'} onConfirm={() => { if (deleting) remove.mutate(deleting.id); }} onCancel={() => setDeleting(null)} />
    </div>
  );
}
