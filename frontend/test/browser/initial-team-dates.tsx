import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import type { MissionInput, PendingMissionProject, PlanningJobRole, PlanningMission } from '../../src/api/efetivoPlanning';
import { InitialTeamAvailabilityModal } from '../../src/pages/efetivo/components/MissionFormModal';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import type { InitialTeamContext } from '../../src/utils/missionTeam';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';
import '../../src/pages/efetivo/efetivo.css';

const mode = new URLSearchParams(window.location.search).get('mode');
// Reproduz o projeto 5782: datas do projeto antigo e uma nova mobilização em outubro.
const project: PendingMissionProject = {
  id: 'project-5782', code: '5782', name: 'CBSI Araucária', clientName: null, location: null,
  mobilizationDate: '2026-04-12T03:00:00Z', startDate: '2026-04-13T03:00:00Z',
  demobilizationDate: mode === 'empty' ? null : '2026-08-14T03:00:00Z', registrationPending: false
};
const role: PlanningJobRole = {
  id: 'role', name: 'Especialista em Operações', isOperational: true,
  calendarColor: '#64748B', continuousWorkLimitDays: null
};
const context: InitialTeamContext = {
  leaderUserId: 'leader', leaderName: 'Líder', mobilizationDate: '2026-10-13',
  executionStartDate: '2026-10-13', executionEndDate: mode === 'complete' ? '2026-11-30' : '',
  plannedRoles: [{ id: role.id, name: role.name, requiredCount: 1, roleIds: [role.id] }]
};
const mission: PlanningMission | null = mode === 'edit' ? {
  id: 'mission', planId: 'official', projectId: project.id, project,
  scheduleStatus: 'CONFIRMED', stage: 'STANDBY', headquartersResponsibleUserId: 'leader',
  headquartersResponsibleName: 'Líder', headquartersResponsibleRole: '', headquartersResponsibleCollaboratorId: null,
  mobilizationDate: '2026-09-07', executionStartDate: '2026-09-08', executionEndDate: '2026-11-26',
  returnDate: '2026-12-01', version: 1, kanbanOrder: 0, allocations: [], demands: [], cycles: []
} : null;
const people = ['Ana', 'Bruno'].map((name, index) => ({
  id: `c${index + 1}`, name, role: role.name, jobRoleId: role.id, isActive: true,
  admissionDate: null, terminationDate: null, status: 'FREE', vacationAlert: null
}));
const requests: { url: string; params: unknown }[] = [];
Object.assign(window, { initialTeamRequests: requests });
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  requests.push({ url, params: config.params });
  const data = url.endsWith('/collaborators') ? people : [];
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};

function Fixture() {
  const [open, setOpen] = useState(true);
  const [payload, setPayload] = useState<MissionInput | null>(null);
  return <>
    <button onClick={() => setOpen(true)}>Definir equipe inicial</button>
    <output data-testid="initial-team-payload">{JSON.stringify(payload)}</output>
    <InitialTeamAvailabilityModal open={open} mission={mission} project={mission ? null : project}
      context={context} roles={[role]} rolesLoading={false} saving={false}
      onClose={() => setOpen(false)} onSubmit={value => { setPayload(value); setOpen(false); }} />
  </>;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode><ThemeProvider><QueryClientProvider client={client}><Fixture /></QueryClientProvider></ThemeProvider></React.StrictMode>);
