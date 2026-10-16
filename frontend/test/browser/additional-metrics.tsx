import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { apiClient } from '../../src/api/client';
import { ProjectRevisionPicker } from '../../src/components/projects/ProjectRevisionPicker';
import { ProjectDetailDashboard } from '../../src/components/projects/ProjectDetailDashboard';
import { MemoryRouter } from 'react-router';
import { AuthContext } from '../../src/auth/AuthContext';
import { detail } from '../fixtures/project-detail.mjs';
import { ToastContext } from '../../src/components/ui/ToastContext';
import { applyAdditionalMetricInclusion, normalizeAdditionalMetricInclusion } from '../../../shared/modules/additional-proposal-metrics.js';
import '../../src/styles/variables.css';
import '../../src/styles/base.css';
import '../../src/pages/gestor/GestorPage.ds.css';

const key = 'additional-metrics-browser-fixture';
const saved = JSON.parse(sessionStorage.getItem(key) ?? '{}');
const mode = new URLSearchParams(location.search).get('mode');
const readonly = new URLSearchParams(location.search).has('readonly');
let failNext = false;
const revision = (codBd: number, nRev: number) => ({ codBd, nRev, plannedDays: 5, workedDays: 4,
  salePrice: 5000, plannedCost: 3000, expectedProfit: 2000, taxes: 500,
  plannedHours: { normal: 50, overtime: 10, total: 60 } });
const groups = [
  { proposalCode: '11', currentCodBd: 9, revisions: [revision(10, 2), revision(9, 1)] },
  { proposalCode: '12', currentCodBd: 12, revisions: [revision(12, 1)] }
];
apiClient.defaults.adapter = async config => {
  const response = data => ({ config, status: 200, statusText: 'OK', headers: {}, data });
  if (config.method === 'post') {
    if (failNext) {
      failNext = false;
      throw new AxiosError('Falha simulada', 'ERR_BAD_REQUEST', config, undefined,
        { ...response({ error: 'Falha simulada' }), status: 500 });
    }
    const input = JSON.parse(config.data);
    const group = groups.find(item => item.revisions.some(item => item.codBd === input.codBd))!;
    saved[group.proposalCode] = { currentCodBd: input.codBd,
      metricInclusion: input.metricInclusion ?? saved[group.proposalCode]?.metricInclusion ?? normalizeAdditionalMetricInclusion() };
    sessionStorage.setItem(key, JSON.stringify(saved));
    return response(saved[group.proposalCode]);
  }
  if (config.url?.includes('/comercialapp/')) return response({ items: [], budgetSource: 'ACCESS' });
  if (config.url?.endsWith('/revisoes')) return response({ currentCodBd: 7, proposalPercentage: 50, revisions: [revision(7, 1)],
    additionalProposals: groups.map(group => ({ ...group, ...saved[group.proposalCode] })) });
  if (config.url?.endsWith('/detalhe')) {
    const additionals = groups.map(group => {
      const selected = saved[group.proposalCode];
      const row = group.revisions.find(row => row.codBd === (selected?.currentCodBd ?? group.currentCodBd))!;
      const effective = applyAdditionalMetricInclusion(row, selected?.metricInclusion);
      return { ...effective, projectId: 'metrics-fixture', codProp: Number(group.proposalCode), plannedTotalCost: effective.plannedCost };
    });
    return response({ ...detail, proposalPercentage: 50,
      budgetBreakdown: { original: { ...detail.budgetBreakdown.original, codBd: 7, codProp: 10 }, additionals },
      consumo: { ...detail.consumo, previsto: 3000 + additionals.reduce((sum, row) => sum + (row.plannedTotalCost ?? 0) / 2, 0) }
    });
  }
  if (config.url?.endsWith('/divisoes')) return response({ candidates: [], divisions: [] });
  if (config.url?.endsWith('/avanco')) return response({ services: [], progressPct: 0 });
  if (config.url?.endsWith('/planning-context')) return response(null);
  if (config.url?.endsWith('/metas-semanais')) return response({ targets: [] });
  return response([]);
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<QueryClientProvider client={client}>
  <ToastContext.Provider value={{ showToast() {} }}>
    <AuthContext.Provider value={{ user: null, token: null, isAuthenticated: false, isBootstrapping: false,
      login: async () => {}, logout: async () => {}, refreshUser: async () => {}, replaceUser() {} }}>
    <MemoryRouter>
    <main className="fv-ds rdo-manager-projects-page" style={{ maxWidth: 1200, padding: 12, margin: '20px auto' }}>
      {mode === 'gestor' ? <ProjectRevisionPicker projectId="metrics-fixture" />
        : <ProjectDetailDashboard projectId="metrics-fixture" canManage canManageManualCosts={!readonly} onBack={() => {}} />}
      <button onClick={() => { failNext = true; }}>Simular falha ao salvar</button>
    </main>
    </MemoryRouter>
    </AuthContext.Provider>
  </ToastContext.Provider>
</QueryClientProvider>);
