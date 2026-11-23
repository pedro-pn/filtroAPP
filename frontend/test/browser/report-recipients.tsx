import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ProjectWorkflow, ProjectWorkflowPatch, ProjectWorkflowProject } from '../../src/api/projectWorkflow';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { ProjectWorkflowReportRecipients } from '../../src/pages/efetivo/components/ProjectWorkflowReportRecipients';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';
import '../../src/pages/efetivo/efetivo.css';

const options = new URLSearchParams(location.search);
const seed: ProjectWorkflowProject = {
  id: 'recipients-test', code: 'P-001', name: 'Projeto de teste', clientName: 'Cliente', location: 'Santos',
  clientEmailPrimary: options.has('empty') ? '' : 'cliente@example.com',
  clientSignerFirstName: 'Joana', clientSignerLastName: 'Souza',
  clientEmailCc: options.has('empty') ? [] : ['ana@example.com', 'leitor@example.com'],
  clientSigners: options.has('empty') ? [] : [{ email: 'ana@example.com', firstName: 'Ana', lastName: 'Silva', name: 'Ana Silva', signsServiceReports: false }]
};

function Fixture() {
  const [project, setProject] = useState<ProjectWorkflowProject>(seed);
  const [version, setVersion] = useState(1);
  const [writes, setWrites] = useState<ProjectWorkflowPatch[]>([]);
  const workflow = { version, permissions: { canEdit: !options.has('readOnly') } } as ProjectWorkflow;
  function save(payload: ProjectWorkflowPatch) {
    if (payload.action !== 'report_recipients') return;
    setWrites(current => [...current, payload]);
    setProject(current => ({ ...current, ...payload }));
    setVersion(current => current + 1);
  }
  return <main className="project-workflow-modal" style={{ padding: 24, maxWidth: 900, margin: 'auto' }}>
    <h1>Destinatários dos relatórios</h1>
    <ProjectWorkflowReportRecipients key={version} project={project} workflow={workflow} saving={false} onPatch={save} />
    <output data-test-writes>{JSON.stringify(writes)}</output>
  </main>;
}

const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<ThemeProvider><Fixture /></ThemeProvider>);
