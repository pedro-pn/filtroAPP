export const acompanhamentoRefreshQueryOptions = {
  staleTime: 60_000,
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always'
} as const;

// Uma revisão já carregada é imutável. Antes da primeira resposta, invalidações
// ainda precisam reiniciar leituras canceladas por uma gravação concorrente.
export const progressRevisionQueryOptions = {
  staleTime: (query: { state: { data: unknown } }): number | 'static' => query.state.data === undefined ? Infinity : 'static',
  gcTime: 60_000,
  refetchInterval: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false
} as const;
