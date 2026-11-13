import { useQuery } from '@tanstack/react-query';
import { getPlanningRhCompliance } from '../../../api/efetivoPlanning';
import { Alert, Badge } from '../../../components/ui/ds';
import { displayDateOnly } from '../../../utils/calendarGrid';

const labels: Record<string, string> = { VALID: 'Válido', EXPIRED: 'Vencido', REVOKED: 'Revogado', PENDING: 'Pendente', UNKNOWN: 'Validade desconhecida' };

export function ConectaCompliancePanel({ collaboratorId, date }: { collaboratorId: string; date: string }) {
  const query = useQuery({ queryKey: ['efetivo-conecta-compliance', collaboratorId, date], queryFn: () => getPlanningRhCompliance(collaboratorId, date) });
  return <section className="page-card" aria-label="Conformidade do RH">
    <h3>Conformidade do RH</h3>
    <p>Situação em {displayDateOnly(date)}. Selecione a data da mobilização para conferir a validade.</p>
    {query.isLoading ? <p>Carregando conformidade…</p> : query.isError ? <Alert tone="warning">Não foi possível consultar a conformidade do RH.</Alert>
      : !query.data?.length ? <p>Nenhum item publicado pelo RH para este colaborador.</p> : <ul>{query.data.map(item => <li key={item.id}>
        <strong>{item.title}</strong> · <Badge>{labels[item.status] || item.status}</Badge>
        {item.hasNoExpiry ? ' · Sem vencimento' : item.expiresOn ? ` · Validade: ${displayDateOnly(item.expiresOn)}` : ' · Validade não informada'}
      </li>)}</ul>}
  </section>;
}
