import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getCommercialDashboard, getRealizedByCategory, type DashboardGroupRow, type DashboardItem, type DashboardRow } from '../../api/acompanhamentoComercial';
import { HelpTip } from '../ui/HelpTip';
import { Modal } from '../ui/Modal';
import { ProjectScheduleEditor, type ScheduleEditorHandle } from './ProjectScheduleEditor';
import { RealizedCategoryBreakdown } from './RealizedCategoryBreakdown';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';

function toNum(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function brl(value?: number | null) {
  return value === null || value === undefined ? '—' : value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
function pct(value?: string | number | null) {
  const n = toNum(value);
  return n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
function isGroupRow(row: DashboardItem): row is DashboardGroupRow {
  return row.kind === 'GROUP';
}

function itemKey(row: DashboardItem) {
  return isGroupRow(row) ? `group-${row.groupId}` : row.projectId;
}

function comp(row: DashboardItem, key: string) {
  return toNum(row.components?.[key] ?? null);
}

type Unit = 'brl' | 'num' | 'pct';
interface Metric {
  key: string;
  label: string;
  unit: Unit;
  get: (row: DashboardItem) => number | null;
}

const METRICS: Metric[] = [
  { key: 'avanco', label: 'Avanço físico (%)', unit: 'pct', get: r => r.progressPct ?? null },
  { key: 'custo', label: 'Custo previsto (total)', unit: 'brl', get: r => toNum(r.plannedTotalCost) },
  { key: 'realizadoPago', label: 'Realizado — pago', unit: 'brl', get: r => toNum(r.realizedPaid) },
  { key: 'realizadoTotal', label: 'Realizado — total', unit: 'brl', get: r => toNum(r.realizedCost) },
  { key: 'irpjCsllForaNf', label: 'IRPJ/CSLL fora da NF', unit: 'brl', get: r => r.presumedProfitTaxes?.outOfInvoiceTaxTotal ?? null },
  { key: 'issOmie', label: 'ISS Omie', unit: 'brl', get: r => r.presumedProfitTaxes?.omieIss ?? null },
  { key: 'impostosNfEstimados', label: 'Impostos NF previstos', unit: 'brl', get: r => r.presumedProfitTaxes?.basisSource === 'OMIE_INVOICED' ? null : r.presumedProfitTaxes?.invoiceTaxTotal ?? null },
  { key: 'faturadoOmie', label: 'Faturado no Omie', unit: 'brl', get: r => toNum(r.invoicedRevenue) },
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
  if (unit === 'brl') return brl(value);
  if (unit === 'pct') return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  return value.toLocaleString('pt-BR');
}

function hasAdditionalValue(value?: string | number | null) {
  const n = toNum(value);
  return n !== null && Math.abs(n) > 0.005;
}

function BudgetValue({
  total,
  original,
  additional
}: {
  total?: string | number | null;
  original?: string | number | null;
  additional?: string | number | null;
}) {
  return (
    <span className="acp-budget-cell">
      <strong>{brl(toNum(total))}</strong>
      {hasAdditionalValue(additional) ? (
        <small className="acp-table-split">
          Orig. {brl(toNum(original))} · Adic. {brl(toNum(additional))}
        </small>
      ) : null}
    </span>
  );
}

export function AcompanhamentoDashboard({ canManage = false }: { canManage?: boolean }) {
  const [search, setSearch] = useState('');
  const [modality, setModality] = useState<'todas' | 'INLOCO' | 'POP_SEDE'>('todas');
  const [status, setStatus] = useState<'todos' | 'andamento' | 'arquivados'>('todos');
  const [category, setCategory] = useState('');
  const [metricKey, setMetricKey] = useState('custo');
  const [managed, setManaged] = useState<DashboardRow | null>(null);
  const [managedDirty, setManagedDirty] = useState(false);
  const scheduleRef = useRef<ScheduleEditorHandle>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['commercial-dashboard', category],
    queryFn: () => getCommercialDashboard(category || undefined),
    ...acompanhamentoRefreshQueryOptions
  });
  const categoriesQuery = useQuery({
    queryKey: ['realized-categories', 'all'],
    queryFn: () => getRealizedByCategory(),
    ...acompanhamentoRefreshQueryOptions
  });

  const rows = useMemo(() => data ?? [], [data]);
  const metric = METRICS.find(m => m.key === metricKey) ?? METRICS[0];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(row => {
      if (modality !== 'todas' && row.serviceModality !== modality) return false;
      if (status === 'andamento' && row.archived) return false;
      if (status === 'arquivados' && !row.archived) return false;
      if (term) {
        const members = isGroupRow(row) ? row.members.map(m => `${m.code} ${m.name} ${m.clientName} ${m.clientCnpj ?? ''}`).join(' ') : '';
        const hay = `${row.code} ${row.name} ${row.clientName} ${row.clientCnpj ?? ''} ${row.proposalCode} ${members}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, search, modality, status]);

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
        missão com o número da proposta.
      </div>
    );
  }

  return (
    <div className="acp-dash">
      {/* Filtros */}
      <div className="page-card acp-filters" data-acp-dashboard-filters>
        <div className="field-group">
          <label htmlFor="acp-search">Buscar (missão, cliente, proposta)</label>
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
          <label htmlFor="acp-status">Situação</label>
          <select id="acp-status" value={status} onChange={e => setStatus(e.target.value as typeof status)}>
            <option value="todos">Todos</option>
            <option value="andamento">Em andamento</option>
            <option value="arquivados">Arquivados</option>
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
      <div className="acp-kpis" data-acp-kpis>
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
              <div className="acp-bar-row" key={itemKey(row)}>
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
      <div className="page-card" data-acp-dashboard-table>
        <div className="sec">Projetos ({filtered.length}) <span className="acp-table-hint">· clique numa linha para abrir o cronograma</span></div>
        <div className="acp-table-wrap">
          <table className="acp-table">
            <thead>
              <tr>
                <th>Missão</th>
                <th>Cliente</th>
                <th><HelpTip help="Número da proposta comercial vinculada à missão.">Proposta</HelpTip></th>
                <th><HelpTip help="Preço de venda previsto no comercial (revisão vigente).">Venda</HelpTip></th>
                <th><HelpTip help="Custo total previsto no comercial (inclui mão de obra).">Custo prev.</HelpTip></th>
                <th><HelpTip help="Total pago no Omie (títulos com status PAGO) vinculados à missão.">Realizado</HelpTip></th>
                <th><HelpTip help="Margem prevista no comercial (revisão vigente).">Margem</HelpTip></th>
                <th><HelpTip help="Dias previstos: corridos / trabalhados, do comercial.">Dias (prev/trab)</HelpTip></th>
                <th><HelpTip help="Nº de RDOs registrados = dias trabalhados realizados.">RDOs</HelpTip></th>
                <th><HelpTip help="Avanço físico do escopo: realizado dos RDOs (metros/litros) x previsto, ponderado pelo peso de cada serviço.">Avanço</HelpTip></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr
                  key={itemKey(row)}
                  className={`acp-table-row${isGroupRow(row) ? ' acp-table-row-group' : ''}`}
                  onClick={() => { if (!isGroupRow(row)) setManaged(row); }}
                  title={isGroupRow(row) ? 'Agrupamento de missões' : 'Abrir cronograma'}
                >
                  <td data-label="Missão">
                    {row.code}{row.name ? ` — ${row.name}` : ''}
                    {isGroupRow(row) ? (
                      <div className="acp-table-members">
                        {row.members.map(member => <span key={member.projectId}>{member.code}</span>)}
                      </div>
                    ) : null}
                  </td>
                  <td data-label="Cliente">{row.clientName || '—'}</td>
                  <td data-label="Proposta">{row.proposalCode}</td>
                  <td data-label="Venda">
                    <BudgetValue total={row.salePrice} original={row.originalSalePrice} additional={row.additionalSalePrice} />
                  </td>
                  <td data-label="Custo prev.">
                    <BudgetValue total={row.plannedTotalCost} original={row.originalPlannedTotalCost} additional={row.additionalPlannedTotalCost} />
                  </td>
                  <td data-label="Realizado">{brl(toNum(row.realizedPaid))}</td>
                  <td data-label="Margem">{pct(row.expectedMargin)}</td>
                  <td data-label="Dias (prev/trab)">{row.plannedDays ?? '—'} / {row.workedDays ?? '—'}</td>
                  <td data-label="RDOs">{row.rdoCount}</td>
                  <td data-label="Avanço">{row.progressPct == null ? '—' : (
                    <div className="acp-prog" title={`${row.progressPct}% de avanço`}>
                      <div className="acp-prog-bar"><span style={{ width: `${Math.min(row.progressPct, 100)}%` }} /></div>
                      <span className="acp-prog-val">{pct(row.progressPct)}</span>
                    </div>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={managed !== null} onClose={() => setManaged(null)} ariaLabelledBy="acp-manage-title" panelClassName="modal-card acp-manage-card">
        {managed ? (
          <div className="acp-manage">
            <div className="acp-manage-head">
              <div className="sec" id="acp-manage-title">Cronograma — {managed.code}{managed.name ? ` — ${managed.name}` : ''}</div>
              <button className="mini-btn alt" type="button" onClick={() => setManaged(null)} aria-label="Fechar">✕</button>
            </div>
            <div className="acp-manage-body">
              <ProjectScheduleEditor key={managed.projectId} ref={scheduleRef} projectId={managed.projectId} canManage={canManage} onDirtyChange={setManagedDirty} />
            </div>
            <div className="acp-manage-foot">
              <button type="button" className="mini-btn alt" onClick={() => setManaged(null)}>Cancelar</button>
              {canManage ? <button type="button" className="mini-btn" disabled={!managedDirty} onClick={() => scheduleRef.current?.save()}>Salvar</button> : null}
            </div>
          </div>
        ) : <div />}
      </Modal>
    </div>
  );
}
