// Componentes de produção com transporte simulado; nenhum dado real é alterado.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AxiosError } from 'axios';
import { apiClient } from '../../src/api/client';
import { ProjectDetailDashboard } from '../../src/components/projects/ProjectDetailDashboard';
import { AuthContext } from '../../src/auth/AuthContext';
import { ToastProvider } from '../../src/components/ui/Toast';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { detail } from '../fixtures/project-detail.mjs';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';

const params = new URLSearchParams(location.search);
const grouped = params.has('grupo');
const readonly = params.has('consulta');
const projects = [
  { projectId: 'p1', code: '5815', name: 'VENTURA SS VICTÓRIA', clientName: 'Ventura', progressPct: 50 },
  { projectId: 'p2', code: '5816', name: 'USINA · LINHAS DE PRESSÃO', clientName: 'Usina', progressPct: 25 }
];
const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
const assignments = new Map<string, string | null>();
let failSave = params.has('falha') ? 500 : params.has('conflito') ? 409 : 0;
let refreshed = false;
const options = (id: string) => [
  { key: 'ACCESS_IMPORT:' + (id === 'p1' ? '4096' : '4700'), proposalCode: id === 'p1' ? '4096' : '4700',
    kind: 'MAIN', label: id === 'p1' ? 'Principal 4096 · Rev. 4' : 'Principal 4700 · Rev. 1' },
  { key: 'ACCESS_IMPORT:' + (id === 'p1' ? '4586' : '4800'), proposalCode: id === 'p1' ? '4586' : '4800',
    kind: 'ADDITIONAL', label: id === 'p1' ? 'Adicional 4586 · Rev. 1' : 'Adicional 4800 · Rev. 2' }
].map(option => ({ ...option, source: 'ACCESS_IMPORT', revision: 1, parentProposalCode: option.kind === 'ADDITIONAL' ? id === 'p1' ? '4096' : '4700' : null,
  version: 'a'.repeat(64), serviceCount: 1, progress: { progressPct: 50, services: [] } }));
const reports = (id: string) => (id === 'p1' ? [
  { reportId: 'r25', number: 25, system: 'Vaso do compressor · 845-VK-001A1', serviceType: 'limpeza' },
  { reportId: 'r26', number: 26, system: 'Vaso do compressor · 845-VK-001A', serviceType: 'limpeza' },
  { reportId: 'r2', number: 2, system: 'APVs verticais · APV-01', serviceType: 'limpeza', contributionKey: 'ACCESS_IMPORT:4096' }
] : [{ reportId: 'r3', number: 3, system: 'Linha da usina · L-203', serviceType: 'pressao' }]).map((report, index) => {
  const key = id + ':' + report.reportId;
  return { ...report, reportType: 'RDO', date: '2026-10-10', serviceKey: String(index + 1).repeat(64),
    version: (refreshed ? 'e' : 'd').repeat(64), contributionKey: assignments.has(key) ? assignments.get(key) : report.contributionKey || null,
    method: assignments.has(key) ? 'MANUAL' : 'INFERRED', count: 1 };
});
const projectDetail = (id: string) => ({ ...detail, header: { ...detail.header, code: id === 'p1' ? '5815' : '5816' },
  plannedScope: { ...detail.plannedScope, services: detail.plannedScope.services.map(service => ({ ...service,
    scopeName: id === 'p1' ? 'Extra Vaso compressor' : 'Tubulações da usina' })) } });
Object.assign(window, { scopeCalls: calls });
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
  calls.push({ url, method: config.method || 'get', body });
  const response = (data: unknown) => ({ config, status: 200, statusText: 'OK', headers: {}, data: structuredClone(data) });
  const projectId = url.match(/\/projetos\/(p[12])\//)?.[1] || 'p1';
  if (url.includes('/escopos-propostas')) {
    if (config.method === 'put') {
      if (readonly) throw new Error('Acesso de consulta tentou gravar.');
      if (failSave) {
        const status = failSave;
        failSave = 0;
        if (status === 409) refreshed = true;
        throw new AxiosError('Falha de teste', 'ERR_BAD_REQUEST', config, undefined,
          { ...response({ error: status === 409 ? 'O relatório mudou. Atualize o serviço antes de salvar.' : 'Falha simulada ao salvar. Tente novamente.' }), status });
      }
      assignments.set(projectId + ':' + url.split('/').at(-1), body.contributionKey);
      return response({ saved: true });
    }
    const services = reports(projectId);
    return response({ scopes: options(projectId), services, pending: services.filter(service => !service.contributionKey).length });
  }
  if (url.includes('/grupos-missoes/') && url.endsWith('/detalhe')) return response({ ...detail,
    header: { ...detail.header, code: '5815 + 5816' },
    group: { id: 'g1', name: 'Projetos mesclados', members: [...projects, {
      projectId: 'p3', code: '5817', name: 'Projeto oculto', clientName: 'Outro cliente', visible: false
    }], laborAllocationMode: 'VISUAL_ONLY', primaryLaborProjectId: null } });
  if (url.endsWith('/detalhe')) return response(projectDetail(projectId));
  if (url.endsWith('/divisoes')) return response({ candidates: [], divisions: [] });
  if (url.endsWith('/avanco')) return response({ services: [], progressPct: 0 });
  if (url.endsWith('/planning-context')) return response(null);
  if (url.endsWith('/metas-semanais')) return response({ targets: [] });
  return response([]);
};

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<QueryClientProvider client={client}><ThemeProvider>
  <AuthContext.Provider value={{ user: null, token: null, isAuthenticated: false, isBootstrapping: false,
    login: async () => {}, logout: async () => {}, refreshUser: async () => {}, replaceUser() {} }}>
    <MemoryRouter><ToastProvider><main className="fv-ds" style={{ maxWidth: 1200, padding: 16, margin: 'auto' }}>
      <ProjectDetailDashboard {...(grouped ? { groupId: 'g1' } : { projectId: 'p1' })}
        canManage={!readonly} canManageDivisions={!readonly} onBack={() => {}} />
    </main></ToastProvider></MemoryRouter>
  </AuthContext.Provider>
</ThemeProvider></QueryClientProvider>);
