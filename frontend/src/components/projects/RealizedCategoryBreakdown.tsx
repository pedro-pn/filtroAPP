import { useQuery } from '@tanstack/react-query';

import { getRealizedByCategory } from '../../api/acompanhamentoComercial';
import { Alert, BarList, EmptyState, Skeleton } from '../ui/ds';

function toNum(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
function brl(value: number) {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Realizado (compras Omie) por categoria de gasto. Global (sem projectId) ou de um projeto.
export function RealizedCategoryBreakdown({ projectId, limit = 12, appearance = 'legacy' }: {
  projectId?: string; limit?: number; appearance?: 'legacy' | 'design-system';
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['realized-categories', projectId ?? 'all'],
    queryFn: () => getRealizedByCategory(projectId)
  });

  if (isLoading) return appearance === 'design-system'
    ? <Skeleton variant="card" height="10rem" label="Carregando categorias" />
    : <div className="placeholder-copy">Carregando categorias…</div>;

  const rows = (data ?? [])
    .map(r => ({ categoria: r.categoria, value: toNum(r.total), count: r.count }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  if (appearance === 'design-system') {
    const max = rows.reduce((value, row) => Math.max(value, row.value), 0);
    return <>
      {isError ? <Alert tone="warning" title="Não foi possível atualizar os gastos por categoria"
        action={{ label: 'Tentar novamente', onClick: () => { void refetch(); } }}>
        {data ? 'Exibindo a última consulta disponível.' : 'Tente novamente para consultar os gastos.'}
      </Alert> : null}
      {rows.length ? <BarList aria-label="Gastos globais por categoria" items={rows.map(row => ({
        id: row.categoria, label: row.categoria, valueLabel: brl(row.value),
        percentage: max ? Math.max(2, (row.value / max) * 100) : 0
      }))} /> : !isError ? <EmptyState title="Sem compras com categoria" description="Nenhuma compra do Omie disponível para este recorte." /> : null}
    </>;
  }

  if (rows.length === 0) {
    return <div className="placeholder-copy">Sem compras (Omie) com categoria para este filtro.</div>;
  }

  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);

  return (
    <div className="acp-bars acp-bars-cat">
      {rows.map(row => (
        <div className="acp-bar-row" key={row.categoria}>
          <span className="acp-bar-label" title={row.categoria}>{row.categoria}</span>
          <span className="acp-bar-track">
            <span className="acp-bar-fill" style={{ width: `${max ? Math.max(2, (row.value / max) * 100) : 0}%` }} />
          </span>
          <span className="acp-bar-value">{brl(row.value)}</span>
        </div>
      ))}
    </div>
  );
}
