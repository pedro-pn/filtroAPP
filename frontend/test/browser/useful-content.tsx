import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createAppQueryClient } from '../../src/queryClient';
import { beginPagePerformanceNavigation, installPagePerformanceDiagnostics } from '../../src/observability/pagePerformance';
import { PagePerformanceNavigationContext, useUsefulQueryContent } from '../../src/observability/useUsefulContent';

const client = createAppQueryClient();
const key = ['performance-fixture'];
if (new URLSearchParams(location.search).has('cache')) client.setQueryData(key, { label: 'Conteúdo em cache' }, { updatedAt: Date.now() - 10_000 });
beginPagePerformanceNavigation('fixture');
installPagePerformanceDiagnostics();
function Content() {
  const query = useQuery({ queryKey: key, queryFn: () => new Promise<{ label: string }>(resolve => {
    Object.assign(window, { finishUsefulQuery: () => resolve({ label: 'Conteúdo atualizado' }) });
  }) });
  useUsefulQueryContent('gestor:pendentes', 'fixture', [query]);
  return <><p>{query.data?.label || 'Carregando…'}</p><button aria-busy={query.isFetching} onClick={() => void query.refetch()}>Atualizar</button></>;
}
function Navigation() {
  const [navigation, setNavigation] = useState('fixture');
  return <PagePerformanceNavigationContext.Provider value={navigation}>
    <Content /><button onClick={() => { beginPagePerformanceNavigation('next'); setNavigation('next'); }}>Outra navegação</button>
  </PagePerformanceNavigationContext.Provider>;
}
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => { root.unmount(); client.clear(); });
root.render(<React.StrictMode><QueryClientProvider client={client}><Navigation /></QueryClientProvider></React.StrictMode>);
