import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listStockBatches, type StockItem, type StockMovementReason } from '../../api/estoque';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';
import { formatUnitCost, type MovementLine } from './stockMovementForm';

interface Props {
  line: MovementLine;
  index: number;
  items: StockItem[];
  reason: StockMovementReason;
  projectId: string;
  saving: boolean;
  error?: string;
  canRemove: boolean;
  onChange: (line: MovementLine) => void;
  onRemove: () => void;
}

export function StockMovementLineRow({ line, index, items, reason, projectId, saving, error, canRemove, onChange, onRemove }: Props) {
  const item = items.find(option => option.id === line.itemId);
  const purchase = reason === 'COMPRA';
  const projectReturn = reason === 'DEVOLUCAO_OBRA';
  const batchesQuery = useQuery({
    queryKey: ['estoque', 'lotes', { itemId: line.itemId, reason, projectId }],
    queryFn: () => listStockBatches(line.itemId, { reason, projectId: projectId || undefined }),
    enabled: !purchase && !!line.itemId && (!projectReturn || !!projectId)
  });
  const batches = batchesQuery.data || [];
  const batch = batches.find(option => option.id === line.batchId);
  const prefix = `stock-move-${line.id}`;

  useEffect(() => {
    if (!purchase && !projectReturn && batchesQuery.isSuccess && !line.batchId && batchesQuery.data?.length) {
      onChange({ ...line, batchId: batchesQuery.data[0].id });
    }
  }, [purchase, projectReturn, batchesQuery.isSuccess, batchesQuery.data, line, onChange]);

  return (
    <fieldset className="stock-movement-line" aria-describedby={error ? `${prefix}-error` : undefined}>
      <legend>Item {index + 1}</legend>
      <div className="stock-movement-line-header">
        <div className="field-group">
          <label htmlFor={`${prefix}-item`}>Produto *</label>
          <select id={`${prefix}-item`} value={line.itemId} disabled={saving}
            onChange={event => onChange({ ...line, itemId: event.target.value, batchId: '', quantity: '', lotNumber: '', expiryDate: '', unitCost: '' })}>
            <option value="">Selecione</option>
            {items.map(option => <option key={option.id} value={option.id}>{option.code} — {option.name} ({option.unitLabel})</option>)}
          </select>
        </div>
        <RemoveIconButton label={`Remover item ${index + 1}`} disabled={saving || !canRemove} onClick={onRemove} />
      </div>
      <div className="stock-movement-line-fields">
        <div className="field-group">
          <label htmlFor={`${prefix}-quantity`}>Quantidade *</label>
          <input id={`${prefix}-quantity`} type="number" min="0" step={item?.type === 'FILTRO' ? '1' : '0.001'}
            max={projectReturn ? batch?.balance : undefined} value={line.quantity} disabled={saving}
            onChange={event => onChange({ ...line, quantity: event.target.value })} />
        </div>
        <div className="field-group">
          <label htmlFor={`${prefix}-unit`}>Unidade</label>
          <input id={`${prefix}-unit`} value={item?.unitLabel || '-'} disabled aria-readonly="true" />
        </div>
        {purchase ? (
          <div className="field-group">
            <label htmlFor={`${prefix}-cost`}>Custo unitário</label>
            <input id={`${prefix}-cost`} type="text" inputMode="numeric" placeholder="R$ 0,00" autoComplete="off"
              value={line.unitCost} disabled={saving}
              onChange={event => onChange({ ...line, unitCost: formatUnitCost(event.target.value) })} />
          </div>
        ) : (
          <div className="field-group">
            <label htmlFor={`${prefix}-available`}>{projectReturn ? 'Disponível na obra' : 'Saldo do lote'}</label>
            <input id={`${prefix}-available`} value={batch ? `${batch.balance} ${item?.unitLabel || ''}` : '-'} disabled aria-readonly="true" />
          </div>
        )}
      </div>
      <div className="stock-movement-line-fields stock-movement-line-fields--batch">
        <div className="field-group">
          <label htmlFor={`${prefix}-batch`}>Lote{!purchase || item?.type === 'PRODUTO_QUIMICO' ? ' *' : ''}</label>
          {purchase ? (
            <input id={`${prefix}-batch`} value={line.lotNumber} disabled={saving}
              onChange={event => onChange({ ...line, lotNumber: event.target.value })} />
          ) : (
            <select id={`${prefix}-batch`} value={line.batchId}
              disabled={saving || batchesQuery.isLoading || !line.itemId || (projectReturn && !projectId)}
              onChange={event => onChange({ ...line, batchId: event.target.value })}>
              <option value="">Selecione</option>
              {batches.map(option => (
                <option key={option.id} value={option.id}>
                  {option.lotNumber || 'Avulso'}{option.expiryDate ? ` · val. ${formatDateOnlyPtBr(option.expiryDate)}` : ''} · {projectReturn ? 'disponível na obra' : 'saldo'} {option.balance}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="field-group">
          <label htmlFor={`${prefix}-expiry`}>Validade{purchase && item?.type === 'PRODUTO_QUIMICO' ? ' *' : ''}</label>
          {purchase ? (
            <input id={`${prefix}-expiry`} type="date" value={line.expiryDate} disabled={saving}
              onChange={event => onChange({ ...line, expiryDate: event.target.value })} />
          ) : <input id={`${prefix}-expiry`} value={formatDateOnlyPtBr(batch?.expiryDate)} disabled aria-readonly="true" />}
        </div>
      </div>
      {!purchase && batchesQuery.isError ? <small className="field-error">Não foi possível carregar os lotes.</small> : null}
      {!purchase && batchesQuery.isSuccess && !batches.length ? (
        <small className="field-error">{projectReturn ? 'Este produto não possui lote com saldo disponível na obra.' : 'Este produto não possui lote disponível.'}</small>
      ) : null}
      {reason === 'USO_EM_PROJETO' && batch?.expired ? <small className="field-error">Lote vencido. A saída exigirá confirmação.</small> : null}
      {error ? <small className="field-error" role="alert" id={`${prefix}-error`}>{error}</small> : null}
    </fieldset>
  );
}
