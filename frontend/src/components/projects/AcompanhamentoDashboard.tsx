import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getCommercialDashboard, getRealizedByCategory, type DashboardRow } from '../../api/acompanhamentoComercial';
import { Modal } from '../ui/Modal';
import { ProjectScheduleEditor } from './ProjectScheduleEditor';
import { RealizedCategoryBreakdown } from './RealizedCategoryBreakdown';

function toNum(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function brl(value?: number | null) {
  return value === null || value === undefined ? '—' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function pct(value?: string | number | null) {
  const n = toNum(value);
  return n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
function comp(row: DashboardRow, key: string) {
  return toNum(row.components?.[key] ?? null);
}

type Unit = 'brl' | 'num';
interface Metric {
  key: string;
  label: string;
  unit: Unit;
  get: (row: DashboardRow) => number | null;
}

const METRICS: Metric[] = [
  { key: 'custo', label: 'Custo previsto (total)', unit: 'brl', get: r => toNum(r.plannedTotalCost) },
  { key: 'realizadoPago', label: 'Realizado — pago', unit: 'brl', get: r => toNum(r.realizedPaid) },
  { key: 'realizadoTotal', label: 'Realizado — total (pago + a pagar)', unit: 'brl', get: r => toNum(r.realizedCost) },
  { key: 'venda', label: 'Preço de venda', unit: 'brl', get: r => toNum(r.salePrice) },
  { key: 'lucro', label: 'Lucro previsto', unit: 'brl', get: r => toNum(r.expectedProfit) },
  { key: 'he', label: 'Hora extra', unit: 'brl', get: r => comp(r, 'he') },
  { key: 'standby', label: 'Stand-by (horas paradas)', unit: 'brl', get: r => comp(r, 'standby') },
  { key: 'diaria', label: 'Diárias', unit: 'brl', get: r => comp(r, 'diaria') },
  { key: 'mobEquipe', label: 'Mobilização de equipe', unit: 'brl', get: r => comp(r, 'mobEquipe') },
  { key: 'mobEquipamento', label: 'Mobilização de equipamento', unit: 'brl', get: r => comp(r, 'mobEquipamento') },
  { key: 'analise', label: 'Análise', unit: 'brl', get: r => comp(r, 'analise') },
  { key: 'efluente', label: 'Efluente', unit: 'brl', get: r => comp(r, 'efluente') },
  { key: 'diasCorridos', label: 'Dias corridos previstos', unit: 'num', get: r => toNum(r.plannedDays) },
  { key: 'diasTrab', label: 'Dias trabalhados previstos', unit: 'num', get: r => toNum(r.workedDays) },
  { key: 'rdos', label: 'RDOs (dias trabalhados realizados)', unit: 'num', get: r => r.rdoCount }
];

function fmt(value: number | null, unit: Unit) {
  if (value === null) return '—';
  return unit === 'brl' ? brl(value) : value.toLocaleString('pt-BR');
}

export function AcompanhamentoDashboard() {
  const [search, setSearch] = useState('');
  const [modality, setModality] = useState<'todas' | 'INLOCO' | 'POP_SEDE'>('todas');
  const [category, setCategory] = useState('');
  const [metricKey, setMetricKey] = useState('custo');
  const [managed, setManaged] = useState<DashboardRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['commercial-dashboard', category],
    queryFn: () => getCommercialDashboard(category || undefined)
  });
  const categoriesQuery = useQuery({ queryKey: ['realized-categories', 'all'], queryFn: () => getRealizedByCategory() });

  const rows = useMemo(() => data ?? [], [data]);
  const metric = METRICS.find(m => m.key === metricKey) ?? METRICS[0];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(row => {
      if (modality !== 'todas' && row.serviceModality !== modality) return false;
      if (term) {
        const hay = `${row.code} ${row.name} ${row.clientName} ${row.proposalCode}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, search, modality]);

  const chartData = useMemo(() => {
    return filtered
      .map(row => ({ row, value: metric.get(row) ?? 0 }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);
  }, [filtered, metric]);

  const maxValue = chartData.reduce((max, d) => Math.max(max, d.value), 0);
  const totals = useMemo(() => ({
    count: filtered.length,
    venda: filtered.reduce((s, r) => s + (toNum(r.salePrice) ?? 0), 0),
    custo: filtered.reduce((s, r) => s + (toNum(r.plannedTotalCost) ?? 0), 0),
    metric: filtered.reduce((s, r) => s + (metric.get(r) ?? 0), 0)
  }), [filtered, metric]);

  if (isLoading) return <div className="page-card placeholder-copy">Carregando acompanhamento…</div>;

  if (rows.length === 0) {
    return (
      <div className="page-card placeholder-copy">
        Nenhum projeto com proposta comercial importada. Importe o banco do comercial e cadastre a
        missão com o número do contrato.
      </div>
    );
  }

  return (
    <div className="acp-dash">
      {/* Filtros */}
      <div className="page-card acp-filters">
        <div className="field-group">
          <label htmlFor="acp-search">Buscar (missão, cliente, contrato)</label>
          <input id="acp-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Ex.: 4069 ou nome do cliente" />
        </div>
        <div className="field-group">
          <label htmlFor="acp-modality">Modalidade</label>
          <select id="acp-modality" value={modality} onChange={e => setModality(e.target.value as typeof modality)}>
            <option value="todas">Todas</option>
            <option value="INLOCO">In loco</option>
            <option value="POP_SEDE">Na sede</option>
          </select>
        </div>
        <div className="field-group">
          <label htmlFor="acp-category">Categoria de gasto (realizado)</label>
          <select id="acp-category" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Todas</option>
            {(categoriesQuery.data ?? [])
              .filter(c => c.categoriaCodigo)
              .map(c => <option key={c.categoriaCodigo} value={c.categoriaCodigo as string}>{c.categoria}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label htmlFor="acp-metric">Indicador</label>
          <select id="acp-metric" value={metricKey} onChange={e => setMetricKey(e.target.value)}>
            {METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="acp-kpis">
        <div className="acp-kpi">
          <span className="acp-kpi-label">Projetos</span>
          <span className="acp-kpi-value">{totals.count}</span>
        </div>
        <div className="acp-kpi">
          <span className="acp-kpi-label">Venda prevista</span>
          <span className="acp-kpi-value">{brl(totals.venda)}</span>
        </div>
        <div className="acp-kpi">
          <span className="acp-kpi-label">Custo previsto</span>
          <span className="acp-kpi-value">{brl(totals.custo)}</span>
        </div>
        <div className="acp-kpi acp-kpi-accent">
          <span className="acp-kpi-label">{metric.label}</span>
          <span className="acp-kpi-value">{fmt(totals.metric, metric.unit)}</span>
          <span className="acp-kpi-foot">soma dos filtrados</span>
        </div>
      </div>

      {/* Gráfico */}
      <div className="page-card">
        <div className="sec">{metric.label} por projeto {chartData.length ? `(top ${chartData.length})` : ''}</div>
        {chartData.length === 0 ? (
          <div className="placeholder-copy">Sem valores para este indicador nos projetos filtrados.</div>
        ) : (
          <div className="acp-bars">
            {chartData.map(({ row, value }) => (
              <div className="acp-bar-row" key={row.projectId}>
                <span className="acp-bar-label" title={`${row.code} — ${row.name || row.clientName}`}>{row.code}</span>
                <span className="acp-bar-track">
                  <span className="acp-bar-fill" style={{ width: `${maxValue ? Math.max(2, (value / maxValue) * 100) : 0}%` }} />
                </span>
                <span className="acp-bar-value">{fmt(value, metric.unit)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Realizado por categoria (global, todas as compras Omie vinculadas) */}
      <div className="page-card">
        <div className="sec">Realizado por categoria de gasto</div>
        <p className="placeholder-copy" style={{ margin: '4px 0 10px' }}>Compras do Omie por categoria (hospedagem, material, etc.), somando todos os projetos vinculados.</p>
        <RealizedCategoryBreakdown />
      </div>

      {/* Tabela */}
      <div className="page-card">
        <div className="sec">Projetos ({filtered.length})</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="acp-table">
            <thead>
              <tr>
                <th>Missão</th>
                <th>Cliente</th>
                <th>Contrato</th>
                <th>Venda</th>
                <th>Custo prev.</th>
                <th>Realizado</th>
                <th>Margem</th>
                <th>Dias (prev/trab)</th>
                <th>RDOs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.projectId}>
                  <td>{row.code}{row.name ? ` — ${row.name}` : ''}</td>
                  <td>{row.clientName || '—'}</td>
                  <td>{row.proposalCode}</td>
                  <td>{brl(toNum(row.salePrice))}</td>
                  <td>{brl(toNum(row.plannedTotalCost))}</td>
                  <td>{brl(toNum(row.realizedPaid))}</td>
                  <td>{pct(row.expectedMargin)}</td>
                  <td>{row.plannedDays ?? '—'} / {row.workedDays ?? '—'}</td>
                  <td>{row.rdoCount}</td>
                  <td><button type="button" className="mini-btn" onClick={() => setManaged(row)}>Cronograma</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={managed !== null} onClose={() => setManaged(null)} ariaLabelledBy="acp-manage-title" panelClassName="modal-card acp-manage-card">
        {managed ? (
          <div className="acp-manage">
            <div className="admin-toolbar full">
              <div className="sec" id="acp-manage-title">Cronograma — {managed.code}{managed.name ? ` — ${managed.name}` : ''}</div>
              <button className="mini-btn alt" type="button" onClick={() => setManaged(null)}>Fechar</button>
            </div>
            <ProjectScheduleEditor projectId={managed.projectId} />
          </div>
        ) : <div />}
      </Modal>
    </div>
  );
}
