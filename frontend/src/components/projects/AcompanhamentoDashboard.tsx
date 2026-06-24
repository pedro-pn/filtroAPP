import { useQuery } from '@tanstack/react-query';

import { getCommercialDashboard, type DashboardRow } from '../../api/acompanhamentoComercial';

function toNum(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function brl(value?: string | number | null) {
  const n = toNum(value);
  return n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pct(value?: string | number | null) {
  const n = toNum(value);
  return n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function consumedPct(row: DashboardRow) {
  if (!row.startDate || !row.plannedDays) return null;
  const start = new Date(row.startDate);
  if (Number.isNaN(start.getTime())) return null;
  const days = Math.floor((Date.now() - start.getTime()) / 86400000);
  return Math.round((days / row.plannedDays) * 100);
}

export function AcompanhamentoDashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['commercial-dashboard'], queryFn: getCommercialDashboard });

  if (isLoading) return <div className="page-card placeholder-copy">Carregando acompanhamento…</div>;

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <div className="page-card placeholder-copy">
        Nenhum projeto com proposta comercial importada. Importe o banco do comercial e cadastre
        a missão com o número do contrato.
      </div>
    );
  }

  return (
    <div className="page-card">
      <div className="sec">Acompanhamento de projetos</div>
      <p className="placeholder-copy" style={{ margin: '4px 0 12px' }}>
        Previsto (comercial) e realizado parcial. Dias trabalhados = nº de RDOs. Resolva a revisão
        nos detalhes do projeto (aba Projetos).
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '6px 8px' }}>Missão</th>
              <th style={{ padding: '6px 8px' }}>Cliente</th>
              <th style={{ padding: '6px 8px' }}>Contrato</th>
              <th style={{ padding: '6px 8px' }}>Venda</th>
              <th style={{ padding: '6px 8px' }}>Custo prev.</th>
              <th style={{ padding: '6px 8px' }}>Margem</th>
              <th style={{ padding: '6px 8px' }}>Dias (prev/trab)</th>
              <th style={{ padding: '6px 8px' }}>RDOs</th>
              <th style={{ padding: '6px 8px' }}>% prazo</th>
              <th style={{ padding: '6px 8px' }}>Equipe (op/enc · d/n)</th>
              <th style={{ padding: '6px 8px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const consumed = consumedPct(row);
              return (
                <tr key={row.projectId} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '6px 8px' }}>{row.code}{row.name ? ` — ${row.name}` : ''}</td>
                  <td style={{ padding: '6px 8px' }}>{row.clientName || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{row.proposalCode}</td>
                  <td style={{ padding: '6px 8px' }}>{brl(row.salePrice)}</td>
                  <td style={{ padding: '6px 8px' }}>{brl(row.plannedTotalCost)}</td>
                  <td style={{ padding: '6px 8px' }}>{pct(row.expectedMargin)}</td>
                  <td style={{ padding: '6px 8px' }}>{row.plannedDays ?? '—'} / {row.workedDays ?? '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{row.rdoCount}</td>
                  <td style={{ padding: '6px 8px' }}>{consumed != null ? `${consumed}%` : '—'}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {(row.numOperators ?? '—')}/{(row.numSupervisors ?? '—')} · {(row.numPerDay ?? '—')}/{(row.numPerNight ?? '—')}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {row.resolved
                      ? <span className="badge badge-ok">Resolvido</span>
                      : <span className="badge badge-pen">Pendente</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
