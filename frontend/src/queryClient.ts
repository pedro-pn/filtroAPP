import { QueryClient } from '@tanstack/react-query';

import { matchesDataUpdate, subscribeToDataUpdates } from './api/dataUpdates';

const liveLists = [
  'reports', 'projects', 'collaborators', 'users', 'drafts', 'surveys', 'job-roles', 'dds-themes',
  'projectStats', 'statsOverview', 'allocationReport', 'commercial-dashboard', 'commercial-pendencias',
  'project-cards', 'project-detail', 'mission-group', 'project-progress', 'tracking-divisions', 'realized',
  'project-invoices', 'project-romaneios', 'project-standby', 'project-management-notes', 'ponto', 'sede-costs',
  'efetivo', 'project-workflows', 'project-execution', 'project-closeout', 'project-documents',
  'epi-collaborators', 'epi-catalog', 'romaneios', 'romaneio-projects', 'romaneio-drafts',
  'romaneio-catalog', 'romaneio-recipients', 'romaneio-return-items', 'estoque', 'qualidade',
  'operations', 'privacy-requests', 'admin-api-credentials'
];

export function liveQueryInterval(queryKey: readonly unknown[]) {
  // Os detalhes abaixo alimentam formulários, e não listas/painéis.
  if (queryKey[0] === 'reports' && ['planning-context', 'collaborator-prefill'].includes(String(queryKey[1]))) return false;
  if (queryKey[0] === 'operational-reports') return ['module-list', 'maintenance-schedule', 'maintenance-history'].includes(String(queryKey[1])) ? 60_000 : false;
  if (queryKey[0] === 'equipamentos') return ['items', 'categories', 'maintenance-history', 'notif-recipients', 'notif-accounts'].includes(String(queryKey[1])) ? 60_000 : false;
  return matchesDataUpdate(queryKey, liveLists) ? 60_000 : false;
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        // O cache aparece imediatamente; a montagem/foco confirma a versão atual.
        refetchOnMount: 'always',
        refetchOnWindowFocus: query => liveQueryInterval(query.queryKey) ? 'always' : true,
        refetchOnReconnect: query => liveQueryInterval(query.queryKey) ? 'always' : true,
        refetchInterval: query => liveQueryInterval(query.queryKey),
        refetchIntervalInBackground: false,
        retry: 1
      }
    }
  });
}

export function installQueryDataUpdates(queryClient: QueryClient) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('filtrovali:data-updates');
  } catch { /* A atualização da própria aba continua disponível. */ }

  const schedule = (prefixes: readonly string[]) => {
    prefixes.forEach(prefix => pending.add(prefix));
    if (timer !== undefined) return;
    // Agrupa gravações do mesmo fluxo e deixa os onSuccess locais atualizar o cache.
    timer = setTimeout(() => {
      timer = undefined;
      const prefixesToRefresh = [...pending];
      pending.clear();
      const affected = (query: { queryKey: readonly unknown[] }) => matchesDataUpdate(query.queryKey, prefixesToRefresh);
      // React Query reutiliza o primeiro GET pendente quando ainda não há dados.
      // Cancela essa leitura anterior à gravação para que ela não publique a versão antiga.
      void queryClient.cancelQueries({
        predicate: query => affected(query) && query.state.data === undefined && query.state.fetchStatus === 'fetching'
      }).then(() => queryClient.invalidateQueries({ predicate: affected }));
    }, 0);
  };
  const unsubscribe = subscribeToDataUpdates(prefixes => {
    schedule(prefixes);
    channel?.postMessage(prefixes);
  });
  if (channel) channel.onmessage = event => {
    if (Array.isArray(event.data) && event.data.every(item => typeof item === 'string')) schedule(event.data);
  };
  return () => {
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
    channel?.close();
  };
}
