import { useQuery } from '@tanstack/react-query';

import { getApiCredentialUsage, listApiCredentialEvents } from '../../../api/apiCredentials';
import { Alert, Card, Skeleton } from '../../ui/ds';
import { ApiCursorPagination } from './ApiCursorPagination';

const eventLabels: Record<string, string> = {
  CREATED: 'Credencial criada', SECRET_REVEALED: 'Segredo exibido', METADATA_UPDATED: 'Identificação atualizada',
  RESTRICTIONS_REDUCED: 'Acesso reduzido', SCOPE_REDUCTION: 'Permissões reduzidas', PRIVILEGE_INCREASE_REJECTED: 'Ampliação recusada',
  TESTED: 'Teste no Playground', ROTATED: 'Credencial rotacionada', REVOKED: 'Credencial revogada', EXPIRED_NOTICE: 'Aviso de expiração'
};

export function ApiCredentialActivity({ credentialId, cursor, onCursorChange }: { credentialId: string; cursor: string; onCursorChange: (cursor: string) => void }) {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400000);
  const events = useQuery({ queryKey: ['admin-api-credential-events', credentialId, cursor], queryFn: () => listApiCredentialEvents(credentialId, cursor || undefined) });
  const usage = useQuery({ queryKey: ['admin-api-credential-usage', credentialId], queryFn: () => getApiCredentialUsage(credentialId, from.toISOString(), to.toISOString()) });

  return <section className="api-activity-grid" aria-label="Uso e eventos da credencial">
    <Card className="api-usage-card" header={<h3>Uso nos últimos 30 dias</h3>}>
      {usage.isLoading ? <Skeleton variant="text" lines={3} /> : usage.data ? <dl className="api-usage-summary">
        <div><dt>Requisições</dt><dd>{usage.data.requests.toLocaleString('pt-BR')}</dd></div>
        <div><dt>Linhas</dt><dd>{usage.data.rows.toLocaleString('pt-BR')}</dd></div>
        <div><dt>Volume</dt><dd>{Math.round(usage.data.bytes / 1024).toLocaleString('pt-BR')} KB</dd></div>
      </dl> : <Alert tone="danger" action={{ label: 'Tentar novamente', onClick: () => void usage.refetch() }}>Não foi possível carregar o uso.</Alert>}
    </Card>
    <Card className="api-event-card" header={<h3>Histórico de eventos</h3>}>
      {events.isLoading ? <Skeleton variant="text" lines={4} /> : events.isError ? <Alert tone="danger" action={{ label: 'Tentar novamente', onClick: () => void events.refetch() }}>Não foi possível carregar os eventos.</Alert> : events.data?.items.length ? <ol className="api-event-list">{events.data.items.map(event => <li key={event.id}>
        <div className="api-event-heading"><strong>{eventLabels[event.type] || event.type}</strong><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('pt-BR')}</time></div>
        <span>Responsável: {event.actor?.name || 'Sistema / integração'}</span>
        {event.reason ? <p>{event.reason}</p> : null}
        {Object.keys(event.summary || {}).length ? <details><summary>Resumo da alteração</summary><pre>{JSON.stringify(event.summary, null, 2)}</pre></details> : null}
        {event.requestId ? <small>requestId: {event.requestId}</small> : null}
      </li>)}</ol> : <p className="api-activity-empty">Nenhum evento registrado.</p>}
      {(cursor || events.data?.page.nextCursor) ? <ApiCursorPagination label="Paginação dos eventos" cursor={cursor} nextCursor={events.data?.page.nextCursor} loading={events.isFetching} onChange={onCursorChange} /> : null}
    </Card>
  </section>;
}
