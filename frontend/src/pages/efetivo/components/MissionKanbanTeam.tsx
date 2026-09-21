import type { PlanningMission } from '../../../api/efetivoPlanning';
import { missionFinalAllocations } from '../../../utils/missionAllocationPeriod';

function initials(name: string) {
  return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toLocaleUpperCase('pt-BR');
}

/** The same always-visible team summary for active and cancelled missions. */
export function MissionKanbanTeam({ mission }: { mission: PlanningMission }) {
  const allocations = missionFinalAllocations(mission);
  return (
    <>
      <div className="efetivo-mission-owner">
        <i aria-hidden="true">{initials(mission.headquartersResponsibleName || '')}</i>
        <span>
          <small>LÍDER VINCULADO</small>
          <strong>{mission.headquartersResponsibleName || 'Líder não vinculado'}</strong>
          <b>{mission.headquartersResponsibleRole || 'Cargo da conta não informado'}</b>
        </span>
      </div>
      <div className="efetivo-kanban-details">
        <span>Participantes da missão · {allocations.length}</span>
        {allocations.length ? allocations.map(allocation => (
          <div key={allocation.id}>
            <i aria-hidden="true">{initials(allocation.collaborator?.name || '')}</i>
            <strong>
              {allocation.collaborator?.name || 'Colaborador'}
              {allocation.collaboratorId === mission.headquartersResponsibleCollaboratorId ? <em>Líder</em> : null}
            </strong>
            <small>{allocation.jobRole?.name || allocation.collaborator?.role || 'Cargo não informado'}</small>
          </div>
        )) : <p>Nenhum colaborador alocado ainda.</p>}
      </div>
    </>
  );
}
