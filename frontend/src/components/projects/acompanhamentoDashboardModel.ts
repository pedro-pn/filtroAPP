import type { DashboardGroupRow, DashboardItem } from '../../api/acompanhamentoComercial';

export function toNum(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
export function brl(value?: number | null) {
  return value === null || value === undefined ? '—' : value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
export function pct(value?: string | number | null) {
  const n = toNum(value);
  return n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
export function isGroupRow(row: DashboardItem): row is DashboardGroupRow {
  return row.kind === 'GROUP';
}

export function itemKey(row: DashboardItem) {
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

export const METRICS: Metric[] = [
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

export function fmt(value: number | null, unit: Unit) {
  if (value === null) return '—';
  if (unit === 'brl') return brl(value);
  if (unit === 'pct') return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  return value.toLocaleString('pt-BR');
}

export function hasAdditionalValue(value?: string | number | null) {
  const n = toNum(value);
  return n !== null && Math.abs(n) > 0.005;
}


export interface DashboardFilters {
  search: string;
  modality: 'todas' | 'INLOCO' | 'POP_SEDE';
  status: 'todos' | 'andamento' | 'arquivados';
}

export function filterDashboardRows(rows: DashboardItem[], { search, modality, status }: DashboardFilters) {
  const term = search.trim().toLowerCase();
  return rows.filter(row => {
    if (modality !== 'todas' && row.serviceModality !== modality) return false;
    if (status === 'andamento' && row.archived) return false;
    if (status === 'arquivados' && !row.archived) return false;
    const members = isGroupRow(row) ? row.members.map(m => `${m.code} ${m.name} ${m.clientName} ${m.clientCnpj ?? ''}`).join(' ') : '';
    const hay = `${row.code} ${row.name} ${row.clientName} ${row.clientCnpj ?? ''} ${row.proposalCode} ${members}`.toLowerCase();
    return !term || hay.includes(term);
  });
}
