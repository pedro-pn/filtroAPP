// Browser fixture: real React/Query hooks, with manually ordered API responses.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { keepPreviousData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '../../src/auth/AuthContext';
import { apiClient } from '../../src/api/client';
import { SearchBar } from '../../src/components/ui/SearchBar';
import { SearchCombobox } from '../../src/components/ui/SearchCombobox';
import { useAccumulatedReportsPage } from '../../src/hooks/useReports';
import { usePersistentSearch } from '../../src/hooks/usePersistentSearch';

const requests = [];
window.searchRequests = requests;
apiClient.defaults.adapter = config => new Promise(resolve => {
  const request = {
    params: config.params,
    aborted: false,
    resolve(codes: string[]) {
      // Deliberately ignore transport cancellation: the hook must reject stale
      // responses even when the network adapter cannot cancel them.
      config.signal = undefined;
      const items = codes.map(code => ({
        id: `report-${code}`, projectId: `project-${code}`,
        reportType: 'RTP', sequenceNumber: 52, status: 'APPROVED',
        project: { code, name: code === '5800' ? 'Reframax' : 'Outro projeto' }
      }));
      resolve({ config, status: 200, statusText: 'OK', headers: {}, data: {
        items,
        pagination: { page: 1, pageSize: 25, total: items.length, totalPages: 1 },
        groups: items.map(item => ({ projectId: item.projectId, reportType: 'RTP', total: 1 })),
        meta: { projectTotal: items.length }
      } });
    }
  };
  config.signal?.addEventListener('abort', () => { request.aborted = true; });
  requests.push(request);
});

// Retain the old unsafe global default to verify the report hook is isolated.
const client = new QueryClient({ defaultOptions: { queries: {
  retry: false, staleTime: Infinity, placeholderData: keepPreviousData
} } });
const user = { id: 'search-race-user', username: 'search-race-user', role: 'MANAGER' };

function Fixture() {
  const [tab, setTab] = useState('approved');
  const [mounted, setMounted] = useState(true);
  return <>
    <button onClick={() => setTab(tab === 'approved' ? 'archived' : 'approved')}>Trocar aba</button>
    <button onClick={() => setMounted(current => !current)}>Montar/desmontar</button>
    {mounted && <Reports tab={tab} />}
  </>;
}

function Reports({ tab }: { tab: string }) {
  const [search, setSearch] = usePersistentSearch(`race-search:${tab}`);
  const reports = useAccumulatedReportsPage({ search, projectActive: tab === 'approved', pageSize: 25 });
  return <>
    <SearchBar value={search} onChange={setSearch} ariaLabel="Buscar relatórios" loading={reports.isSearching} />
    <button onClick={() => reports.ensureGroupPage({ projectId: 'project-9999', reportType: 'RTP', force: true })}>Carregar grupo antigo</button>
    <output id="state">{JSON.stringify({
      ids: reports.items.map(item => item.id), loading: reports.isLoadingInitial,
      searching: reports.isSearching, oldError: reports.isGroupError('project-9999', 'RTP'),
      oldLoading: reports.isGroupLoading('project-9999', 'RTP'),
      oldTotal: reports.groupTotal('project-9999', 'RTP')
    })}</output>
    <SearchCombobox label="Colaborador" value="" onChange={() => {}} options={[
      { value: '1', label: 'João da Silva', description: 'Teste de pressão' },
      { value: '2', label: 'Maria', description: 'Limpeza' }
    ]} />
  </>;
}

const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode>
  <QueryClientProvider client={client}>
    <AuthContext.Provider value={{ user, isAuthenticated: true } as never}><Fixture /></AuthContext.Provider>
  </QueryClientProvider>
</React.StrictMode>);
