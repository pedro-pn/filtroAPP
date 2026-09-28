import { useInfiniteQuery } from '@tanstack/react-query';

import { getPlanningActivity } from '../../../api/efetivoPlanning';
import { Button, Card, EmptyState, Skeleton } from '../../../components/ui/ds';

export function EfetivoActivityList() {
  const query = useInfiniteQuery({
    queryKey: ['efetivo-planning-activity'],
    queryFn: ({ pageParam }) => getPlanningActivity(pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: lastPage => lastPage.nextCursor || undefined
  });
  const items = query.data?.pages.flatMap(page => page.items) || [];
  return <Card className="efetivo-administration-section"><div className="efetivo-section-heading"><div><h2>Atividade recente</h2><p>Autoria, data, tipo e alvo das alterações operacionais.</p></div></div>{query.isLoading ? <Skeleton variant="card" /> : query.isError ? <EmptyState variant="error" title="Não foi possível carregar a atividade." action={{ label: 'Tentar novamente', onClick: () => void query.refetch() }} /> : items.length ? <><div className="efetivo-activity-list">{items.map(item => <article key={item.id}><span className="efetivo-activity-marker" /><div><strong>{item.summary}</strong><p>{item.actorName || 'Sistema'} · {new Date(item.createdAt).toLocaleString('pt-BR')} · {item.entityType}</p></div></article>)}</div>{query.hasNextPage ? <Button variant="secondary" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Carregar mais</Button> : null}</> : <EmptyState title="Nenhuma atividade registrada." />}</Card>;
}
