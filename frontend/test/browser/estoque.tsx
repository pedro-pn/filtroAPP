// Production components with a simulated API. No database or network writes.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import { ToastProvider } from '../../src/components/ui/Toast';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { StockSummaryTab } from '../../src/pages/estoque/StockSummaryTab';
import { StockMovementsTab } from '../../src/pages/estoque/StockMovementsTab';
import { SearchCombobox } from '../../src/components/ui/SearchCombobox';
import type { StockMovement, StockSummaryItem } from '../../src/api/estoque';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/utilities.css';
import '../../src/styles/legacy.css';
import '../../src/pages/estoque/EstoquePage.ds.css';

const seadrill = { id: 'seadrill', code: '5824', name: 'Seadrill' };
const klabin = { id: 'klabin', code: '5839', name: 'Klabin' };
const chemical = { id: 'acid', code: 'PQ 002', name: 'Ácido fosfórico 85%', unitLabel: 'kg' as const };
const summary: StockSummaryItem[] = [chemical, { id: 'carbonate', code: 'PQ 005', name: 'Carbonato de sódio', unitLabel: 'kg' as const }].map((item, index) => ({
  item: { ...item, type: 'PRODUTO_QUIMICO', category: { id: 'chemicals', name: 'Produtos químicos' },
    minQuantity: '50', manufacturer: null, description: null, location: 'Galpão 1', filterModel: null,
    filterKind: null, filterMicron: null, unNumber: null, casNumber: null, isActive: true },
  balance: index ? '0.000' : '68.000', belowMin: !!index,
  batches: index ? [] : [{ id: 'lot', lotNumber: 'MPA02', expiryDate: '2027-07-12', balance: '68.000', expired: false }]
}));
function movement(id: string, type: StockMovement['type'], quantity: string, extra: Partial<StockMovement> = {}): StockMovement {
  return { id, type, reason: 'COMPRA', quantity, date: '2026-11-01', createdAt: '2026-11-01T12:00:00Z', item: chemical,
    batch: { id: 'lot', lotNumber: 'MPA02', expiryDate: '2027-07-12' }, project: null, nfNumber: null, supplier: null,
    unitCost: null, requestedBy: null, notes: null, reversalOfId: null, reversedById: null,
    createdBy: { id: 'user', name: 'Responsável fictício' }, ...extra };
}
const movements = [
  movement('purchase', 'ENTRADA', '450.000', { date: '2026-10-30', supplier: 'Fornecedor' }),
  movement('old-exit', 'SAIDA', '450.000', { reason: 'USO_EM_PROJETO', project: seadrill, reversedById: 'reversal', reversedByRomaneioEdit: true }),
  movement('reversal', 'ENTRADA', '450.000', { reason: 'ESTORNO', project: seadrill, reversalOfId: 'old-exit', date: '2026-11-10', romaneioEdit: true }),
  movement('exit', 'SAIDA', '385.000', { reason: 'USO_EM_PROJETO', project: seadrill, romaneioEdit: true, createdAt: '2026-11-10T12:00:01Z' }),
  movement('return', 'ENTRADA', '5.000', { reason: 'DEVOLUCAO_OBRA', project: seadrill, date: '2026-11-09' }),
  movement('other-exit', 'SAIDA', '10.000', { reason: 'USO_EM_PROJETO', project: klabin, date: '2026-11-08' }),
  ...Array.from({ length: 8 }, (_, i) => movement(`inventory-${i}`, 'ENTRADA', '1.000', { reason: 'INVENTARIO', date: `2026-11-0${i + 1}` }))
];
const requests: unknown[] = [];
Object.assign(window, { stockRequests: requests });
apiClient.defaults.adapter = async config => {
  if (config.method !== 'get') throw new Error('Esta tela de teste só permite consultas.');
  const url = config.url || '';
  const params = config.params || {};
  requests.push({ url, params });
  let data: unknown;
  if (url.endsWith('/resumo')) data = { summary };
  else if (url.endsWith('/itens')) data = { items: summary.map(row => row.item) };
  else if (url.endsWith('/projects')) data = [seadrill, klabin];
  else if (url.endsWith('/obras')) data = { projects: url.includes('/acid/') ? [
    { project: seadrill, outbound: '385.000', inbound: '5.000', netOutbound: '380.000' },
    { project: klabin, outbound: '10.000', inbound: '0.000', netOutbound: '10.000' }
  ] : [] };
  else if (url.endsWith('/movimentacoes')) {
    const ordered = movements.filter(row => String(params.includeReversed) !== 'false' || (!row.reversalOfId && !row.reversedById))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    let balance = 0;
    const balances = new Map(ordered.map(row => {
      balance += (row.type === 'ENTRADA' ? 1 : -1) * Number(row.quantity);
      return [row.id, balance.toFixed(3)];
    }));
    const filtered = ordered.filter(row => (!params.itemId || row.item.id === params.itemId)
      && (!params.projectId || row.project?.id === params.projectId)
      && (!params.type || row.type === params.type) && (!params.reason || row.reason === params.reason));
    if (params.dateOrder !== 'asc') filtered.reverse();
    const page = params.page || 1, pageSize = params.pageSize || 50;
    data = { movements: filtered.slice((page - 1) * pageSize, page * pageSize).map(row => ({ ...row, balanceAfter: balances.get(row.id) })), total: filtered.length, page, pageSize };
  } else throw new Error(`Consulta inesperada: ${url}`);
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};
function Preview() {
  const [tab, setTab] = useState('stock');
  const [legacyValue, setLegacyValue] = useState('existing');
  return <main className="fv-ds stock-page-v2" style={{ maxWidth: 1280, padding: 16, margin: 'auto' }}>
    <h1>Estoque</h1>
    <nav aria-label="Abas do estoque"><button onClick={() => setTab('stock')}>Estoque</button> <button onClick={() => setTab('movements')}>Movimentos</button></nav>
    {tab === 'stock' ? <StockSummaryTab isManager={false} onRegisterMovement={() => {}} /> : <StockMovementsTab isManager={false} onRegisterMovement={() => {}} />}
    <details><summary>Controle de regressão do combobox padrão</summary><SearchCombobox label="Campo padrão" value={legacyValue} onChange={setLegacyValue}
      options={[{ value: 'existing', label: 'Seleção existente' }, { value: 'other', label: 'Outra opção' }]} /></details>
  </main>;
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<React.StrictMode><ThemeProvider><ToastProvider><QueryClientProvider client={client}><Preview /></QueryClientProvider></ToastProvider></ThemeProvider></React.StrictMode>);
