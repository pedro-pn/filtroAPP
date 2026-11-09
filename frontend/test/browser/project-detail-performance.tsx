// Harness do componente real, com fontes controladas e sem acesso a dados externos.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { apiClient } from '../../src/api/client';
import { createAppQueryClient } from '../../src/queryClient';
import { ProjectDetailDashboard } from '../../src/components/projects/ProjectDetailDashboard';
import { ToastProvider } from '../../src/components/ui/Toast';
import { detail } from '../fixtures/project-detail.mjs';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';

const params = new URLSearchParams(location.search);
const client = createAppQueryClient();
const state = {
  revision: 1, failMode: '', changeDuringRead: false,
  reads: [] as Array<{ mode: string; revision: number; fields?: string }>
};
Object.assign(window, { projectDetailPerformance: state });
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  let data: unknown = [];
  if (url.endsWith('/detalhe')) {
    const mode = config.params?.progress || 'full';
    state.reads.push({ mode, revision: state.revision, fields: config.params?.fields });
    if (state.failMode === mode) throw new AxiosError('Falha simulada', undefined, config, undefined, {
      config, status: 503, statusText: 'Service Unavailable', headers: {}, data: { error: 'Falha simulada' }
    });
    if (mode !== 'current' && state.changeDuringRead) { state.revision++; state.changeDuringRead = false; }
    const result: Record<string, unknown> = {
      ...structuredClone(detail),
      avancoPct: 50 + state.revision,
      progressBreakdown: { hasScope: true, progressPct: 50 + state.revision, services: [] },
      dailyProgressHistory: detail.progressHistory.map(point => ({ ...point, services: [] })),
      progressReadMode: mode,
      progressRevision: `revision-${state.revision}`,
      progressFilters: mode === 'full' ? {
        scopes: [{ key: 'scope-a', name: 'Escopo A' }], equipments: [], lookup: { 'scope-a|': 0 },
        slices: [{ avancoPct: 25 + state.revision, progressHistory: detail.progressHistory,
          dailyProgressHistory: detail.progressHistory.map(point => ({ ...point, services: [] })), requiredWeeklyProgress: detail.requiredWeeklyProgress }]
      } : null,
      ...(params.has('group') ? { group: { id: 'g1', name: 'Grupo de teste', members: [] } } : {})
    };
    if (params.has('legacy')) {
      delete result.progressReadMode;
      delete result.progressRevision;
    } else if (mode === 'current') {
      delete result.progressHistory;
      delete result.dailyProgressHistory;
    }
    data = config.params?.fields === 'progress' && !params.has('legacy')
      ? Object.fromEntries(Object.entries(result).filter(([key]) => ['avancoPct', 'avancoMethod', 'progressBreakdown',
        'progressReadMode', 'progressRevision', 'progressFilters', 'requiredWeeklyProgress', 'progressHistory', 'dailyProgressHistory'].includes(key)))
      : result;
  } else if (url.endsWith('/divisoes')) data = { divisions: [], candidates: [] };
  else if (url.endsWith('/metas-semanais')) data = { targets: [], workdays: [1, 2, 3, 4, 5], serviceHistory: [], attendanceHistory: [] };
  else if (url.endsWith('/planning-context')) data = { collaborators: [] };
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};

const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => { root.unmount(); client.clear(); });
root.render(<React.StrictMode><QueryClientProvider client={client}><ToastProvider>
  <ProjectDetailDashboard projectId={params.has('group') ? undefined : 'p1'} groupId={params.has('group') ? 'g1' : undefined} onBack={() => {}} />
</ToastProvider></QueryClientProvider></React.StrictMode>);
