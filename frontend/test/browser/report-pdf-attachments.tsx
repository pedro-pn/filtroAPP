// Componentes reais com API isolada para conferir anexos sem alterar relatórios.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { apiClient, TOKEN_STORAGE_KEY } from '../../src/api/client';
import type { ReportPdfAttachment } from '../../src/api/reportPdfAttachments';
import { AuthContext } from '../../src/auth/AuthContext';
import { ReportSummaryCard } from '../../src/components/reports/ReportSummaryCard';
import { ManagerReportListing } from '../../src/components/reports/manager/ManagerReportListing';
import { ToastProvider } from '../../src/components/ui/Toast';
import { RemoveIconButton } from '../../src/components/ui/RemoveIconButton';
import { Button } from '../../src/components/ui/ds';
import type { AuthUser } from '../../src/types/auth';
import type { ReportSummary } from '../../src/types/domain';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';

const params = new URLSearchParams(location.search);
const role = params.get('role') || 'manager';
const user: AuthUser = {
  id: role, username: role, name: 'Revisor', email: null, isActive: true,
  role: role === 'manager' ? 'MANAGER' : role === 'collaborator' ? 'COLLABORATOR' : 'COORDINATOR',
  accountType: role === 'manager' ? 'ADMIN' : 'INTERNAL',
  moduleRoles: [role === 'manager' ? 'rdo:manager' : role === 'collaborator' ? 'rdo:collaborator' : 'rdo:coordinator'],
  rdoExtraPermissions: role === 'reviewer' ? ['REVIEW_REPORTS'] : [], reportEmissionPermissions: ['SITE_RDO']
};
const reports = ['RDO', 'RTP'].map((reportType, index) => ({
  id: `report-${index}`, reportType, sequenceNumber: index + 1, reportDate: '2026-10-26',
  status: 'APPROVED', specialConditions: {},
  project: { id: 'project', code: '5800', name: 'Projeto de demonstração', managerOnly: false },
  createdBy: { name: 'Responsável' }, services: [], collaborators: [], attachments: []
})) as ReportSummary[];
const storageKey = 'report-pdf-attachments-fixture';
const stored: Record<string, ReportPdfAttachment[]> = JSON.parse(sessionStorage.getItem(storageKey) || 'null') || {
  'report-0': [{ id: 'existing', fileName: 'Certificado de calibração do equipamento.pdf', sizeBytes: 150000, pageCount: 2, position: 0, createdAt: '2026-10-26T12:00:00Z' }],
  'report-1': []
};
for (const report of reports) report._count = { pdfAttachments: stored[report.id].length };
localStorage.setItem(TOKEN_STORAGE_KEY, 'fixture');
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (/\/reports\/[^/]+\/pdf-attachments\/[^/]+\/pdf$/.test(url)) {
    const response = await realFetch('/src/assets/report-models/RDO-modelo.pdf');
    return new Response(await response.blob(), { headers: { 'Content-Type': 'application/pdf' } });
  }
  return realFetch(input, init);
};
import.meta.hot?.dispose(() => { window.fetch = realFetch; });
apiClient.defaults.adapter = async config => {
  const match = config.url?.match(/\/reports\/([^/]+)\/pdf-attachments(?:\/([^/]+))?(\/pdf)?$/);
  if (!match) throw new Error(`Chamada inesperada: ${config.url}`);
  const [, reportId, attachmentId, download] = match;
  let data: unknown;
  if (config.method === 'patch' && attachmentId === 'order') {
    const { ids } = JSON.parse(config.data);
    stored[reportId] = ids.map((id: string, position: number) => ({ ...stored[reportId].find(item => item.id === id)!, position }));
    data = [...stored[reportId]];
  } else if (config.method === 'post') {
    const body = JSON.parse(config.data);
    const attachment = { id: crypto.randomUUID(), fileName: body.fileName, sizeBytes: body.pdfDataUrl.length, pageCount: 1, position: stored[reportId].length, createdAt: new Date().toISOString() };
    stored[reportId].push(attachment);
    data = attachment;
  } else if (config.method === 'delete') {
    stored[reportId] = stored[reportId].filter(item => item.id !== attachmentId);
    data = { ok: true };
  } else if (download) data = new Blob(['%PDF-fixture'], { type: 'application/pdf' });
  else data = [...stored[reportId]];
  sessionStorage.setItem(storageKey, JSON.stringify(stored));
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode><QueryClientProvider client={queryClient}>
  <AuthContext.Provider value={{ user, token: 'fixture', isAuthenticated: true, isBootstrapping: false,
    login: async () => {}, logout: async () => {}, refreshUser: async () => {}, replaceUser: () => {} }}>
    <MemoryRouter><ToastProvider><main className="fv-ds" data-fv-ds style={{ padding: 24 }}>
      <h1>Anexos PDF · {role}</h1>
      <ReportSummaryCard report={reports[0]} allowOpenDetail={false} actions={<Button size="sm">PDF</Button>}
        deleteAction={role === 'manager' ? <RemoveIconButton label="Remover relatório" onClick={() => {}} /> : undefined} />
      <ManagerReportListing reports={reports.slice(1)} selectedReportIds={[]} onSelectionChange={() => {}}
        onOpenReport={() => {}} renderActions={() => <Button size="sm">PDF</Button>}
        renderDeleteAction={role === 'manager' ? () => <RemoveIconButton label="Remover relatório" onClick={() => {}} /> : undefined}
        reportType="RTP" projectLabel="Projeto de demonstração" sortDirection="asc" onSortChange={() => {}} />
    </main></ToastProvider></MemoryRouter>
  </AuthContext.Provider>
</QueryClientProvider></React.StrictMode>);
