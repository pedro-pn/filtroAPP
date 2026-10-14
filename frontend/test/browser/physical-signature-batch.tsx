// Production dialog and API with simulated responses; no database writes.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import { uploadPhysicalSignedReport } from '../../src/api/reports';
import { ToastProvider } from '../../src/components/ui/Toast';
import { Button } from '../../src/components/ui/ds';
import { PhysicalSignatureBatchDialog } from '../../src/pages/gestor/PhysicalSignatureBatchDialog';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import type { ReportSummary } from '../../src/types/domain';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';

const reports = [
  { id: 'a-12', projectId: 'project-a', project: { id: 'project-a', code: '5724', name: 'Cliente A' }, sequenceNumber: 12 },
  { id: 'a-13', projectId: 'project-a', project: { id: 'project-a', code: '5724', name: 'Cliente A' }, sequenceNumber: 13 },
  { id: 'a-14', projectId: 'project-a', project: { id: 'project-a', code: '5724', name: 'Cliente A' }, sequenceNumber: 14 },
  { id: 'b-12', projectId: 'project-b', project: { id: 'project-b', code: '5807', name: 'Cliente B' }, sequenceNumber: 12 }
].map(report => ({ ...report, reportType: 'RDO', status: 'APPROVED', reportDate: '2026-10-01' })) as ReportSummary[];
const attempts: string[] = [];
const projectRequests: string[] = [];
Object.assign(window, { physicalBatchProjectRequests: projectRequests });
const projects = [...new Map(reports.map(report => [report.projectId, report.project])).values(),
  { ...reports[0].project, id: 'project-empty', code: '9999', name: 'Sem RDOs' }];
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  let data: unknown;
  if (url.endsWith('/reports')) {
    if (!config.params?.projectId) throw new Error('Selecione o projeto antes de consultar os RDOs.');
    projectRequests.push(config.params.projectId);
    if (new URLSearchParams(location.search).has('load-error') && !attempts.includes('load-error')) {
      attempts.push('load-error');
      throw new Error('Falha simulada ao carregar');
    }
    data = reports.filter(report => report.projectId === config.params.projectId && report.status === 'APPROVED').map(report => ({ ...report }));
  } else if (url.endsWith('/physical-signature')) {
    const id = url.split('/').at(-2)!;
    const firstAttempt = !attempts.includes(id);
    attempts.push(id);
    await new Promise(resolve => setTimeout(resolve, 300));
    if (id === 'a-13' && firstAttempt) throw new Error('Falha simulada: tente novamente.');
    const payload = JSON.parse(config.data);
    if (!payload.pdfDataUrl.startsWith('data:application/pdf;base64,')) throw new Error('PDF inválido');
    const target = reports.find(report => report.id === id)!;
    target.status = 'SIGNED';
    data = { report: target, releasedServiceReports: [] };
  }
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};

function Fixture() {
  const [open, setOpen] = useState(false);
  return <div className="fv-ds">
    <Button onClick={() => setOpen(true)}>Enviar assinados em lote</Button>
    <Button variant="secondary" onClick={() => { reports.forEach(report => { report.status = 'APPROVED'; }); attempts.length = 0; }}>Restaurar dados de teste</Button>
    <output data-testid="batch-attempts">{attempts.join(', ')}</output>
    {open ? <PhysicalSignatureBatchDialog projects={projects} onClose={() => setOpen(false)}
      upload={({ id, fileName, pdfDataUrl }) => uploadPhysicalSignedReport(id, { fileName, pdfDataUrl })} /> : null}
  </div>;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode><QueryClientProvider client={client}><ThemeProvider><ToastProvider><Fixture /></ToastProvider></ThemeProvider></QueryClientProvider></React.StrictMode>);
