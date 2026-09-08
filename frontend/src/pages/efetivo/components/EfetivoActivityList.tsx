import { useInfiniteQuery } from '@tanstack/react-query';

import { getPlanningActivity } from '../../../api/efetivoPlanning';
import { Button } from '../../../components/ui/Button';

export function EfetivoActivityList() {
  const query = useInfiniteQuery({
    queryKey: ['efetivo-planning-activity'],
    queryFn: ({ pageParam }) => getPlanningActivity(pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: lastPage => lastPage.nextCursor || undefined
  });
  const items = query.data?.pages.flatMap(page => page.items) || [];
  return <section className="page-card"><div className="efetivo-section-heading"><div><h2>Atividade recente</h2><p>Autoria, data, tipo e alvo das alterações operacionais.</p></div></div>{query.isLoading ? <p className="placeholder-copy">Carregando atividade…</p> : query.isError ? <p className="placeholder-copy">Não foi possível carregar a atividade.</p> : items.length ? <><div className="efetivo-activity-list">{items.map(item => <article key={item.id}><span className="efetivo-activity-marker" /><div><strong>{item.summary}</strong><p>{item.actorName || 'Sistema'} · {new Date(item.createdAt).toLocaleString('pt-BR')} · {item.entityType}</p></div></article>)}</div>{query.hasNextPage ? <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}</Button> : null}</> : <p className="placeholder-copy">Nenhuma atividade registrada.</p>}</section>;
}
