import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  listStockItems,
  listStockMovements,
  reverseStockMovement,
  type StockMovement,
  type StockMovementReason,
  type StockMovementType
} from '../../api/estoque';
import { listProjects } from '../../api/projects';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/ToastContext';

const PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 200;

function typeLabel(type: StockMovementType) {
  return type === 'ENTRADA' ? 'Entrada' : 'Saída';
}

function reasonLabel(reason: StockMovementReason) {
  const labels: Record<StockMovementReason, string> = {
    COMPRA: 'Compra',
    DEVOLUCAO_OBRA: 'Devolução de obra',
    INVENTARIO: 'Inventário',
    USO_EM_PROJETO: 'Uso em projeto',
    PERDA: 'Perda',
    DESCARTE_VALIDADE: 'Descarte por validade',
    ESTORNO: 'Estorno'
  };
  return labels[reason];
}

function formatDate(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(fileName: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(csvCell).join(';')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function movementStatus(movement: StockMovement) {
  if (movement.reversalOfId) return 'Estorno';
  if (movement.reversedById) return 'Estornada';
  return 'Ativa';
}

function movementProjectLabel(movement: StockMovement) {
  return movement.project ? `${movement.project.code} — ${movement.project.name}` : '-';
}

function exportRows(movements: StockMovement[]) {
  return [
    ['Data', 'Tipo', 'Motivo', 'Código', 'Item', 'Lote', 'Validade', 'Quantidade', 'Unidade', 'Projeto', 'NF', 'Fornecedor', 'Solicitante', 'Autor', 'Status', 'Observações'],
    ...movements.map(movement => [
      formatDate(movement.date),
      typeLabel(movement.type),
      reasonLabel(movement.reason),
      movement.item.code,
      movement.item.name,
      movement.batch.lotNumber || 'Avulso',
      formatDate(movement.batch.expiryDate),
      movement.quantity,
      movement.item.unitLabel,
      movementProjectLabel(movement),
      movement.nfNumber || '',
      movement.supplier || '',
      movement.requestedBy || '',
      movement.createdBy?.name || '',
      movementStatus(movement),
      movement.notes || ''
    ])
  ];
}

interface Props {
  isManager: boolean;
}

export function StockMovementsTab({ isManager }: Props) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState('');
  const [type, setType] = useState<StockMovementType | ''>('');
  const [reason, setReason] = useState<StockMovementReason | ''>('');
  const [projectId, setProjectId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dateOrder, setDateOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [reverseTarget, setReverseTarget] = useState<{ id: string; label: string } | null>(null);

  const itemsQuery = useQuery({
    queryKey: ['estoque', 'itens', { movementFilters: true }],
    queryFn: () => listStockItems({ includeInactive: true })
  });
  const projectsQuery = useQuery({
    queryKey: ['estoque', 'projects', { filters: true }],
    queryFn: () => listProjects(true)
  });

  function movementListParams(pageNumber: number, pageSize = PAGE_SIZE) {
    return {
      itemId: itemId || undefined,
      type: type || undefined,
      reason: reason || undefined,
      projectId: projectId || undefined,
      from: from || undefined,
      to: to || undefined,
      dateOrder,
      page: pageNumber,
      pageSize
    };
  }

  const movementsQuery = useQuery({
    queryKey: ['estoque', 'movimentacoes', { itemId, type, reason, projectId, from, to, dateOrder, page }],
    queryFn: () => listStockMovements(movementListParams(page))
  });

  const data = movementsQuery.data;
  const movements = useMemo(() => data?.movements || [], [data]);
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE));
  const exportMutation = useMutation({
    mutationFn: async () => {
      const firstPage = await listStockMovements(movementListParams(1, EXPORT_PAGE_SIZE));
      const allMovements = [...firstPage.movements];
      for (let nextPage = 2; allMovements.length < firstPage.total; nextPage += 1) {
        const next = await listStockMovements(movementListParams(nextPage, EXPORT_PAGE_SIZE));
        if (!next.movements.length) break;
        allMovements.push(...next.movements);
      }
      return allMovements;
    },
    onSuccess: rows => {
      if (!rows.length) {
        showToast('Não há movimentações para exportar.', 'info');
        return;
      }
      downloadCsv(`estoque-movimentacoes-${new Date().toISOString().slice(0, 10)}.csv`, exportRows(rows));
      showToast('CSV exportado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível exportar o CSV.', 'error')
  });
  const reverseMutation = useMutation({
    mutationFn: (id: string) => reverseStockMovement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estoque'] });
      showToast('Movimentação estornada.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível estornar.', 'error')
  });

  function resetPage(callback: () => void) {
    setPage(1);
    callback();
  }

  return (
    <section className="page-card">
      <div className="admin-toolbar">
        <div className="sec">Movimentações</div>
        <button
          className="mini-btn alt"
          type="button"
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending || movementsQuery.isLoading || !data?.total}
        >
          {exportMutation.isPending ? 'Exportando...' : 'Exportar CSV'}
        </button>
      </div>

      <div className="stock-movement-filters">
        <select
          className="stock-filter-item"
          aria-label="Filtrar item"
          value={itemId}
          onChange={event => resetPage(() => setItemId(event.target.value))}
        >
          <option value="">Todos os itens</option>
          {(itemsQuery.data || []).map(item => (
            <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
          ))}
        </select>
        <select aria-label="Filtrar tipo" value={type} onChange={event => resetPage(() => setType(event.target.value as StockMovementType | ''))}>
          <option value="">Entrada e saída</option>
          <option value="ENTRADA">Entrada</option>
          <option value="SAIDA">Saída</option>
        </select>
        <select aria-label="Filtrar motivo" value={reason} onChange={event => resetPage(() => setReason(event.target.value as StockMovementReason | ''))}>
          <option value="">Todos os motivos</option>
          <option value="COMPRA">Compra</option>
          <option value="USO_EM_PROJETO">Uso em projeto</option>
          <option value="DEVOLUCAO_OBRA">Devolução de obra</option>
          <option value="INVENTARIO">Inventário</option>
          <option value="PERDA">Perda</option>
          <option value="DESCARTE_VALIDADE">Descarte por validade</option>
          <option value="ESTORNO">Estorno</option>
        </select>
        <select
          className="stock-filter-project"
          aria-label="Filtrar projeto"
          value={projectId}
          onChange={event => resetPage(() => setProjectId(event.target.value))}
        >
          <option value="">Todos os projetos</option>
          {(projectsQuery.data || []).map(project => (
            <option key={project.id} value={project.id}>{project.code} — {project.name}</option>
          ))}
        </select>
        <div className="field-group stock-date-filter">
          <label htmlFor="stock-movements-from">Data inicial</label>
          <input
            id="stock-movements-from"
            type="date"
            value={from}
            onChange={event => resetPage(() => setFrom(event.target.value))}
          />
        </div>
        <div className="field-group stock-date-filter">
          <label htmlFor="stock-movements-to">Data final</label>
          <input
            id="stock-movements-to"
            type="date"
            value={to}
            onChange={event => resetPage(() => setTo(event.target.value))}
          />
        </div>
        <div className="field-group stock-date-filter stock-order-filter">
          <label htmlFor="stock-movements-date-order">Ordenar por data</label>
          <select
            id="stock-movements-date-order"
            value={dateOrder}
            onChange={event => resetPage(() => setDateOrder(event.target.value as 'asc' | 'desc'))}
          >
            <option value="desc">Mais recentes primeiro</option>
            <option value="asc">Mais antigas primeiro</option>
          </select>
        </div>
      </div>

      {movementsQuery.isLoading ? <p className="placeholder-copy">Carregando movimentações...</p> : null}
      {movementsQuery.isError ? <p className="equip-form-error">Não foi possível carregar as movimentações.</p> : null}
      {!movementsQuery.isLoading && !movements.length ? <p className="placeholder-copy">Nenhuma movimentação encontrada.</p> : null}

      {movements.length ? (
        <div className="equip-table-wrap stock-movements-table-wrap">
          <table className="equip-table stock-movements-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Motivo</th>
                <th>Item</th>
                <th>Lote</th>
                <th>Quantidade</th>
                <th>Projeto</th>
                <th>NF</th>
                <th>Autor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {movements.map(movement => (
                <tr key={movement.id}>
                  <td data-label="Data">{formatDate(movement.date)}</td>
                  <td data-label="Tipo"><span className={`badge ${movement.type === 'SAIDA' ? 'danger' : ''}`}>{typeLabel(movement.type)}</span></td>
                  <td data-label="Motivo">{reasonLabel(movement.reason)}</td>
                  <td data-label="Item">
                    <strong>{movement.item.code}</strong>
                    <span className="stock-table-muted">{movement.item.name}</span>
                  </td>
                  <td data-label="Lote">{movement.batch.lotNumber || 'Avulso'}</td>
                  <td data-label="Quantidade">{movement.quantity} {movement.item.unitLabel}</td>
                  <td data-label="Projeto">{movementProjectLabel(movement)}</td>
                  <td data-label="NF">{movement.nfNumber || '-'}</td>
                  <td data-label="Autor">{movement.createdBy?.name || '-'}</td>
                  <td data-label="Status">
                    <div className="stock-table-status">
                      {movement.reversalOfId ? <span className="badge">Estorno</span> : null}
                      {movement.reversedById ? <span className="badge">Estornada</span> : null}
                      {!movement.reversalOfId && !movement.reversedById ? <span className="badge">Ativa</span> : null}
                      {isManager && !movement.reversalOfId && !movement.reversedById ? (
                        <button
                          className="mini-btn alt stock-table-action"
                          type="button"
                          onClick={() => setReverseTarget({ id: movement.id, label: `${formatDate(movement.date)} · ${movement.item.code} · ${movement.quantity}` })}
                        >
                          Estornar
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {(data?.total || 0) > PAGE_SIZE ? (
        <div className="admin-form-actions">
          <button className="mini-btn alt" type="button" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>Anterior</button>
          <span className="rel-meta">Página {page} de {totalPages}</span>
          <button className="mini-btn alt" type="button" disabled={page >= totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))}>Próxima</button>
        </div>
      ) : null}
      <ConfirmDialog
        open={!!reverseTarget}
        title="Estornar movimentação"
        description="Será criada uma movimentação inversa vinculada ao histórico."
        highlight={reverseTarget?.label}
        confirmLabel="Estornar"
        onConfirm={() => {
          if (reverseTarget) reverseMutation.mutate(reverseTarget.id);
          setReverseTarget(null);
        }}
        onCancel={() => setReverseTarget(null)}
      />
    </section>
  );
}
