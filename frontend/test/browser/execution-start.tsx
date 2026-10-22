import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ProjectWorkflowProject, ProjectOperationalMissionSummary } from '../../src/api/projectWorkflow';
import { ProjectExecutionStartModal } from '../../src/pages/efetivo/components/ProjectExecutionStartModal';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';
import '../../src/pages/efetivo/efetivo.css';

const mode = new URLSearchParams(window.location.search).get('mode');
const allocation = (id: string, name: string, canOperateReports: boolean, isActive = true) => ({
  id: `a-${id}`, collaboratorId: id, jobRoleId: 'role', jobRole: null,
  collaborator: { id, name, role: 'Operador', isActive, canOperateReports }
});
const allocations = mode === 'eligible'
  ? [allocation('ana', 'Ana', true), allocation('bruno', 'Bruno', true)]
  : [allocation('no-account', 'Sem conta ativa', false), allocation('inactive', 'Colaborador inativo', true, false)];
const project: ProjectWorkflowProject = {
  id: 'project', code: '5782', name: 'Projeto de teste', clientName: 'Cliente', location: 'Campo',
  // Responsável antigo fora da equipe não pode ser submetido como operador.
  operatorId: 'old-operator', mobilizationDate: '2026-09-10',
  operationalMission: { allocations, executionStartDate: mode === 'future' ? '2999-01-01' : '2026-09-12' } as ProjectOperationalMissionSummary
};

function Fixture() {
  const [open, setOpen] = useState(true);
  const [payload, setPayload] = useState<{ startDate: string; operatorId?: string } | null>(null);
  return <>
    <button onClick={() => setOpen(true)}>Iniciar execução</button>
    <output data-testid="execution-start-payload">{JSON.stringify(payload)}</output>
    {open ? <ProjectExecutionStartModal project={project} plannedStartDate={null} executedAtHeadquarters={false}
      saving={mode === 'saving'} onClose={() => setOpen(false)}
      onConfirm={(startDate, operatorId) => { setPayload({ startDate, operatorId }); setOpen(false); }} /> : null}
  </>;
}

const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode><ThemeProvider><Fixture /></ThemeProvider></React.StrictMode>);
