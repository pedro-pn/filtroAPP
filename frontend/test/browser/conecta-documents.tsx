import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import type { PlanningCollaborator, PlanningJobRole } from '../../src/api/efetivoPlanning';
import type { ProjectWorkflow, ProjectWorkflowPatch } from '../../src/api/projectWorkflow';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { MissionTeamSelector } from '../../src/pages/efetivo/components/MissionTeamSelector';
import { ProjectWorkflowDefinitiveTeam } from '../../src/pages/efetivo/components/ProjectWorkflowPreparationPanels';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';
import '../../src/pages/efetivo/efetivo.css';

const options = new URLSearchParams(location.search);
const role = { id: 'role', name: 'Técnico', isActive: true, isOperational: true } as PlanningJobRole;
const people = ['Ana', 'Bruno', 'Carla'].map((name, index) => ({ id: `c${index + 1}`, name, role: role.name, jobRoleId: role.id,
  isActive: true, admissionDate: null, terminationDate: null, status: 'FREE', plannedUtilization90d: null, vacationAlert: null })) as PlanningCollaborator[];
const reads: unknown[] = [], writes: ProjectWorkflowPatch[] = [];
Object.assign(window, { conectaReads: reads, conectaWrites: writes });
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  let data: unknown = [];
  if (url.endsWith('/collaborators/rh')) {
    reads.push(config.params);
    if (options.has('error')) throw new Error('Falha de consulta simulada.');
    data = { source: 'CONECTA', date: config.params.date, endDate: config.params.endDate,
      sync: { status: options.has('stale') ? 'STALE' : 'OK', lastSuccessfulAt: '2026-11-17T12:00:00Z', lastAttemptAt: '2026-11-17T12:00:00Z' },
      collaborators: String(config.params.ids).split(',').map(collaboratorId => ({ collaboratorId,
        state: collaboratorId === 'c3' ? 'UNMAPPED' : collaboratorId === 'c2' ? 'EMPTY' : 'AVAILABLE',
        items: collaboratorId !== 'c1' ? [] : [
          { id: '11111111-1111-4111-8111-111111111111', category: 'TRAINING', title: 'NR-35', typeCode: 'NR-35', issuedOn: '2025-11-20', expiresOn: '2026-11-20',
            hasNoExpiry: false, status: config.params.date > '2026-11-20' ? 'EXPIRED' : 'VALID', expiresDuringMission: config.params.date <= '2026-11-20' && config.params.endDate > '2026-11-20', revision: 3,
            sourceUpdatedAt: '2026-11-17T12:00:00Z', synchronizedAt: '2026-11-17T12:00:00Z', evidence: { fileName: 'nr35-teste.pdf', contentType: 'application/pdf' } },
          { id: '22222222-2222-4222-8222-222222222222', category: 'EXAM', title: 'ASO', typeCode: 'ASO', issuedOn: null, expiresOn: null,
            hasNoExpiry: false, status: 'UNKNOWN', expiresDuringMission: false, revision: 1, evidence: null }
        ] })) };
  } else if (url.endsWith('/evidence')) {
    if (options.has('fileError')) throw new Error('A documentação foi atualizada. Atualize a consulta.');
    data = { url: new URL('./conecta-documents.html?certificate=1', location.href).href, expiresAt: new Date(Date.now() + 300_000).toISOString(), fileName: 'nr35-teste.pdf' };
  } else if (url.endsWith('/collaborators')) data = people;
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};

function Fixture() {
  const [date, setDate] = useState('2026-11-17');
  const [ids, setIds] = useState(['c1', 'c2']);
  const [periods, setPeriods] = useState<Array<{ collaboratorId: string; mobilizationDate: string; demobilizationDate: string }>>([]);
  const [lastWrite, setLastWrite] = useState('');
  const members = people.filter(person => ids.includes(person.id)).map(person => ({ allocationId: 'allocation-' + person.id, collaboratorId: person.id, name: person.name, role: person.role,
    periods: [{ startDate: periods.find(period => period.collaboratorId === person.id)?.mobilizationDate || date, endDate: '2026-11-25' }],
    checks: [{ key: 'DOCUMENTS_CHECKED', label: 'Documentação conferida', status: 'PENDING', source: 'MANUAL', canEdit: true }] }));
  const workflow = { version: 1, plannedMobilizationDate: date, demobilizationDate: '2026-11-25', teamPreparation: { defined: true, members },
    preparationReadiness: { sections: [{ key: 'D15_TEAM', completed: 0, total: members.length, percentage: 0 }] } } as unknown as ProjectWorkflow;
  return <main className="project-workflow-modal" style={{ maxWidth: 1000, margin: '1rem auto', padding: '1rem' }}>
    <h1>Planejamento da missão — documentação</h1>
    <label>Mobilização de teste <input aria-label="Mobilização de teste" type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    <MissionTeamSelector mission={null} roles={[role]} selectedIds={ids} allocationPeriods={periods} startDate={date} endDate="2026-11-25" loading={false} disabled={false}
      onChange={next => setIds(next)} onAllocationPeriodsChange={setPeriods} />
    <ProjectWorkflowDefinitiveTeam workflow={workflow} saving={false} showTeamEditAction={false} onOpenTeamProgramming={() => {}}
      onPatch={payload => { writes.push(payload); setLastWrite(JSON.stringify(payload)); }} />
    <output data-test-writes>{lastWrite}</output>
  </main>;
}

const root = createRoot(document.getElementById('root')!);
if (options.has('certificate')) root.render(<main><h1>Comprovante de teste isolado</h1><p>Arquivo fictício da validação de interface.</p></main>);
else root.render(<React.StrictMode><ThemeProvider><QueryClientProvider client={new QueryClient()}><Fixture /></QueryClientProvider></ThemeProvider></React.StrictMode>);
