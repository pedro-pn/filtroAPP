import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { apiClient } from '../../src/api/client';
import { convertProjectWorkflowToLegacySummary, type ProjectWorkflow, type ProjectWorkflowLegacySummaryConversionInput } from '../../src/api/projectWorkflow';
import { ProjectWorkflowAdminSummaryDialog } from '../../src/pages/efetivo/components/ProjectWorkflowAdminSummaryDialog';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';
import '../../src/pages/efetivo/efetivo.css';
import '../../src/pages/efetivo/EfetivoDialogs.css';

const mode = new URLSearchParams(window.location.search).get('mode');
const workflow = {
  projectId: 'project-1', stage: mode === 'finished' ? 'FINISHED' : 'HANDOVER', version: 3,
  executedAtHeadquarters: mode === 'sede', permissions: { canConvertLegacySummary: mode !== 'internal' }
} as ProjectWorkflow;
apiClient.defaults.adapter = async config => ({
  config, status: 200, statusText: 'OK', headers: {}, data: { url: config.url, payload: JSON.parse(config.data) }
});

function Fixture() {
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const confirm = async (payload: ProjectWorkflowLegacySummaryConversionInput) => {
    setSaving(true);
    const response = await convertProjectWorkflowToLegacySummary(workflow.projectId, payload);
    setResult(response);
    setSaving(false);
    setOpen(false);
  };
  return <>
    <button onClick={() => setOpen(true)}>Abrir conversão</button>
    <output data-testid="admin-summary-result">{JSON.stringify(result)}</output>
    {open ? <ProjectWorkflowAdminSummaryDialog workflow={workflow} projectLabel="P-001 · Projeto antigo" saving={saving || mode === 'saving'}
      onClose={() => setOpen(false)} onConfirm={payload => void confirm(payload)} /> : null}
  </>;
}

const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode><ThemeProvider><Fixture /></ThemeProvider></React.StrictMode>);
