import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';

import {
  createStockMovement,
  createStockReturnMovements,
  listStockBatches,
  listStockItems,
  type StockItem,
  type StockBatchSummary,
  type StockMovementReason,
  type StockMovementType,
  type StockMovementPayload,
  type StockReturnMovementsPayload
} from '../../api/estoque';
import { listProjects } from '../../api/projects';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/ToastContext';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';
import { makeEstoqueSchemas } from '../../../../shared/schemas/estoque.js';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface MovementFormValues {
  reason: Exclude<StockMovementReason, 'ESTORNO'>;
  movementType: StockMovementType;
  itemId: string;
  batchId: string;
  projectId: string;
  quantity: string;
  date: string;
  nfNumber: string;
  lotNumber: string;
  expiryDate: string;
  supplier: string;
  unitCost: string;
  requestedBy: string;
  notes: string;
}

interface ReturnMovementLine {
  id: number;
  itemId: string;
  batchId: string;
  quantity: string;
}

type MovementSubmission =
  | { kind: 'single'; payload: StockMovementPayload }
  | { kind: 'return'; payload: StockReturnMovementsPayload };

const estoqueSchemas = makeEstoqueSchemas(z);
let returnLineSequence = 0;

function createReturnLine(): ReturnMovementLine {
  return { id: ++returnLineSequence, itemId: '', batchId: '', quantity: '' };
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function optionalValue(value: string) {
  const text = String(value || '').trim();
  return text || undefined;
}

function selectedItem(items: StockItem[], itemId: string) {
  return items.find(item => item.id === itemId) || null;
}

function formValuesToPayload(values: MovementFormValues): StockMovementPayload {
  if (values.reason === 'USO_EM_PROJETO' || values.reason === 'DEVOLUCAO_OBRA') {
    return {
      reason: values.reason,
      type: values.reason === 'USO_EM_PROJETO' ? 'SAIDA' : 'ENTRADA',
      itemId: values.itemId,
      batchId: values.batchId,
      projectId: values.projectId,
      quantity: values.quantity,
      date: values.date,
      requestedBy: optionalValue(values.requestedBy),
      notes: optionalValue(values.notes)
    };
  }

  if (values.reason === 'INVENTARIO') {
    return {
      reason: 'INVENTARIO',
      type: values.movementType,
      itemId: values.itemId,
      batchId: values.batchId,
      quantity: values.quantity,
      date: values.date,
      notes: optionalValue(values.notes)
    };
  }

  if (values.reason === 'PERDA' || values.reason === 'DESCARTE_VALIDADE') {
    return {
      reason: values.reason,
      type: 'SAIDA',
      itemId: values.itemId,
      batchId: values.batchId,
      quantity: values.quantity,
      date: values.date,
      notes: optionalValue(values.notes)
    };
  }

  return {
    reason: 'COMPRA',
    type: 'ENTRADA',
    itemId: values.itemId,
    quantity: values.quantity,
    date: values.date,
    nfNumber: values.nfNumber,
    lotNumber: optionalValue(values.lotNumber),
    expiryDate: optionalValue(values.expiryDate),
    supplier: optionalValue(values.supplier),
    unitCost: optionalValue(values.unitCost),
    notes: optionalValue(values.notes)
  };
}

function zodErrorToFormErrors(error: z.ZodError) {
  return error.issues.reduce<Record<string, { type: string; message: string }>>((acc, issue) => {
    const key = String(issue.path[0] || 'form');
    if (!acc[key]) acc[key] = { type: 'manual', message: issue.message };
    return acc;
  }, {});
}

function resolverFor(items: StockItem[]): Resolver<MovementFormValues> {
  return async values => {
    if (values.reason === 'DEVOLUCAO_OBRA') return { values, errors: {} };
    const item = selectedItem(items, values.itemId);
    const result = estoqueSchemas.movement({ itemType: item?.type }).safeParse(formValuesToPayload(values));
    if (result.success) return { values, errors: {} };
    return { values: {}, errors: zodErrorToFormErrors(result.error) };
  };
}

function batchLabel(batch: StockBatchSummary, reason: StockMovementReason) {
  const lot = batch.lotNumber || 'Avulso';
  const expiry = batch.expiryDate ? ` · val. ${formatDateOnlyPtBr(batch.expiryDate)}` : '';
  const balanceLabel = reason === 'DEVOLUCAO_OBRA' ? 'disponível na obra' : 'saldo';
  return `${lot}${expiry} · ${balanceLabel} ${batch.balance}`;
}

function movementUnitLabel(item: StockItem | null) {
  return item?.unitLabel || '';
}

interface ReturnMovementLineRowProps {
  line: ReturnMovementLine;
  items: StockItem[];
  projectId: string;
  saving: boolean;
  error?: string;
  canRemove: boolean;
  onChange: (line: ReturnMovementLine) => void;
  onRemove: () => void;
}

function ReturnMovementLineRow({
  line,
  items,
  projectId,
  saving,
  error,
  canRemove,
  onChange,
  onRemove
}: ReturnMovementLineRowProps) {
  const item = selectedItem(items, line.itemId);
  const batchesQuery = useQuery({
    queryKey: ['estoque', 'lotes', { itemId: line.itemId, reason: 'DEVOLUCAO_OBRA', projectId }],
    queryFn: () => listStockBatches(line.itemId, { reason: 'DEVOLUCAO_OBRA', projectId }),
    enabled: !!line.itemId && !!projectId
  });
  const batches = batchesQuery.data || [];
  const batch = batches.find(option => option.id === line.batchId) || null;

  return (
    <div className="stock-return-line">
      <div className="stock-return-line-fields">
        <div className="field-group stock-return-item-field">
          <label htmlFor={`stock-return-item-${line.id}`}>Produto *</label>
          <select
            id={`stock-return-item-${line.id}`}
            value={line.itemId}
            disabled={saving}
            onChange={event => onChange({ ...line, itemId: event.target.value, batchId: '' })}
          >
            <option value="">Selecione</option>
            {items.map(option => (
              <option key={option.id} value={option.id}>
                {option.code} — {option.name} ({option.unitLabel})
              </option>
            ))}
          </select>
        </div>

        <div className="field-group stock-return-batch-field">
          <label htmlFor={`stock-return-batch-${line.id}`}>Lote *</label>
          <select
            id={`stock-return-batch-${line.id}`}
            value={line.batchId}
            disabled={saving || batchesQuery.isLoading || !line.itemId || !projectId}
            onChange={event => onChange({ ...line, batchId: event.target.value })}
          >
            <option value="">Selecione</option>
            {batches.map(option => (
              <option key={option.id} value={option.id}>{batchLabel(option, 'DEVOLUCAO_OBRA')}</option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor={`stock-return-expiry-${line.id}`}>Validade</label>
          <input
            id={`stock-return-expiry-${line.id}`}
            value={formatDateOnlyPtBr(batch?.expiryDate)}
            disabled
            aria-readonly="true"
          />
        </div>

        <div className="field-group">
          <label htmlFor={`stock-return-available-${line.id}`}>Disponível</label>
          <input
            id={`stock-return-available-${line.id}`}
            value={batch ? `${batch.balance} ${item?.unitLabel || ''}` : '-'}
            disabled
            aria-readonly="true"
          />
        </div>

        <div className="field-group">
          <label htmlFor={`stock-return-quantity-${line.id}`}>Quantidade *</label>
          <input
            id={`stock-return-quantity-${line.id}`}
            type="number"
            min="0"
            max={batch?.balance}
            step={item?.type === 'FILTRO' ? '1' : '0.001'}
            value={line.quantity}
            disabled={saving}
            onChange={event => onChange({ ...line, quantity: event.target.value })}
          />
        </div>

        <button
          className="icon-button stock-return-remove"
          type="button"
          aria-label="Remover produto da devolução"
          title="Remover produto"
          disabled={saving || !canRemove}
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      {batchesQuery.isSuccess && line.itemId && projectId && !batches.length ? (
        <small className="field-error">Este produto não possui lote com saldo disponível na obra.</small>
      ) : null}
      {error ? <small className="field-error">{error}</small> : null}
    </div>
  );
}

export function StockMovementFormModal({ open, onClose }: Props) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [expiredConfirmPayload, setExpiredConfirmPayload] = useState<StockMovementPayload | null>(null);
  const [returnLines, setReturnLines] = useState<ReturnMovementLine[]>(() => [createReturnLine()]);
  const [returnLineErrors, setReturnLineErrors] = useState<Record<number, string>>({});
  const [returnFormError, setReturnFormError] = useState('');
  const itemsQuery = useQuery({
    queryKey: ['estoque', 'itens', { movementOptions: true }],
    queryFn: () => listStockItems({ includeInactive: false })
  });
  const projectsQuery = useQuery({
    queryKey: ['estoque', 'projects', { active: true }],
    queryFn: () => listProjects(true)
  });
  const items = useMemo(() => itemsQuery.data || [], [itemsQuery.data]);
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<MovementFormValues>({
    defaultValues: {
      reason: 'COMPRA',
      movementType: 'ENTRADA',
      itemId: '',
      batchId: '',
      projectId: '',
      quantity: '',
      date: todayInputValue(),
      nfNumber: '',
      lotNumber: '',
      expiryDate: '',
      supplier: '',
      unitCost: '',
      requestedBy: '',
      notes: ''
    },
    resolver: resolverFor(items)
  });
  const reason = watch('reason');
  const itemId = watch('itemId');
  const projectId = watch('projectId');
  const item = selectedItem(items, watch('itemId'));
  const isProjectReturn = reason === 'DEVOLUCAO_OBRA';
  const needsExistingBatch = reason !== 'COMPRA' && !isProjectReturn;
  const needsProject = reason === 'USO_EM_PROJETO';
  const needsNotes = ['INVENTARIO', 'PERDA', 'DESCARTE_VALIDADE'].includes(reason);
  const batchesQuery = useQuery({
    queryKey: ['estoque', 'lotes', { itemId, reason }],
    queryFn: () => listStockBatches(itemId, { reason }),
    enabled: needsExistingBatch && !!itemId
  });
  const batches = useMemo(() => batchesQuery.data || [], [batchesQuery.data]);
  const selectedBatch = batches.find(batch => batch.id === watch('batchId')) || null;
  const savingMutation = useMutation({
    mutationFn: async (submission: MovementSubmission) => (
      submission.kind === 'return'
        ? createStockReturnMovements(submission.payload)
        : createStockMovement(submission.payload)
    ),
    onSuccess: (_result, submission) => {
      queryClient.invalidateQueries({ queryKey: ['estoque'] });
      showToast(
        submission.kind === 'return'
          ? `${submission.payload.items.length} ${submission.payload.items.length === 1 ? 'devolução registrada' : 'devoluções registradas'}.`
          : 'Movimentação registrada.',
        'success'
      );
      reset();
      setReturnLines([createReturnLine()]);
      setReturnLineErrors({});
      setReturnFormError('');
      onClose();
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível registrar.', 'error')
  });

  useEffect(() => {
    if (!needsExistingBatch || !batchesQuery.isSuccess) return;
    setValue('batchId', batches[0]?.id || '');
  }, [batches, batchesQuery.isSuccess, needsExistingBatch, setValue]);

  useEffect(() => {
    if (!isProjectReturn) {
      setReturnLineErrors({});
      setReturnFormError('');
      return;
    }
    setReturnLines(current => current.map(line => ({ ...line, batchId: '' })));
    setReturnLineErrors({});
    setReturnFormError('');
  }, [isProjectReturn, projectId]);

  function updateReturnLine(nextLine: ReturnMovementLine) {
    setReturnLines(current => current.map(line => line.id === nextLine.id ? nextLine : line));
    setReturnLineErrors(current => {
      const next = { ...current };
      delete next[nextLine.id];
      return next;
    });
  }

  function removeReturnLine(lineId: number) {
    setReturnLines(current => current.filter(line => line.id !== lineId));
    setReturnLineErrors(current => {
      const next = { ...current };
      delete next[lineId];
      return next;
    });
  }

  function submit(values: MovementFormValues) {
    if (values.reason === 'DEVOLUCAO_OBRA') {
      const nextErrors: Record<number, string> = {};
      let formError = '';
      if (!values.projectId) formError = 'Selecione o projeto da devolução.';
      else if (!values.date) formError = 'Informe a data da devolução.';
      else if (!returnLines.length) formError = 'Adicione ao menos um produto.';

      if (!formError) {
        const seenBatches = new Set<string>();
        for (const line of returnLines) {
          const currentItem = selectedItem(items, line.itemId);
          if (!currentItem) {
            nextErrors[line.id] = 'Selecione o produto.';
            continue;
          }
          const parsed = estoqueSchemas.movement({ itemType: currentItem.type }).safeParse({
            reason: 'DEVOLUCAO_OBRA',
            type: 'ENTRADA',
            itemId: line.itemId,
            batchId: line.batchId,
            projectId: values.projectId,
            quantity: line.quantity,
            date: values.date,
            notes: optionalValue(values.notes)
          });
          if (!parsed.success) {
            nextErrors[line.id] = parsed.error.issues[0]?.message || 'Revise os dados deste produto.';
            continue;
          }
          const key = `${line.itemId}:${line.batchId}`;
          if (seenBatches.has(key)) nextErrors[line.id] = 'Este produto e lote já foram adicionados.';
          seenBatches.add(key);
        }
      }

      setReturnLineErrors(nextErrors);
      setReturnFormError(formError);
      if (formError || Object.keys(nextErrors).length) return;

      savingMutation.mutate({
        kind: 'return',
        payload: {
          reason: 'DEVOLUCAO_OBRA',
          projectId: values.projectId,
          date: values.date,
          notes: optionalValue(values.notes),
          items: returnLines.map(line => ({
            itemId: line.itemId,
            batchId: line.batchId,
            quantity: line.quantity
          }))
        }
      });
      return;
    }

    const payload = formValuesToPayload(values);
    if (values.reason === 'USO_EM_PROJETO' && selectedBatch?.expired && !payload.confirmExpired) {
      setExpiredConfirmPayload(payload);
      return;
    }
    savingMutation.mutate({ kind: 'single', payload });
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        ariaLabelledBy="stock-movement-form-title"
        panelClassName={`modal-card equip-modal stock-modal${isProjectReturn ? ' stock-return-modal' : ''}`}
      >
        <button
          className="equip-modal-close-float icon-button"
          type="button"
          aria-label="Fechar movimentação"
          title="Fechar"
          onClick={onClose}
          disabled={savingMutation.isPending}
        >
          ×
        </button>
        <form className="equip-form" onSubmit={handleSubmit(submit)}>
          <header className="equip-form-head has-float-close">
            <h3 id="stock-movement-form-title">Movimentação</h3>
            <span className="equip-form-sub">Estoque</span>
          </header>

          <div className="field-group">
            <label htmlFor="stock-move-reason">Movimentação *</label>
            <select id="stock-move-reason" disabled={savingMutation.isPending} {...register('reason')}>
              <option value="COMPRA">Entrada por compra</option>
              <option value="USO_EM_PROJETO">Saída para projeto</option>
              <option value="DEVOLUCAO_OBRA">Devolução de obra</option>
              <option value="INVENTARIO">Ajuste de inventário</option>
              <option value="PERDA">Perda</option>
              <option value="DESCARTE_VALIDADE">Descarte por validade</option>
            </select>
          </div>

          {isProjectReturn ? (
            <>
              <div className="equip-toggle-fields stock-return-header-fields">
                <div className="field-group">
                  <label htmlFor="stock-move-project">Projeto *</label>
                  <select id="stock-move-project" disabled={savingMutation.isPending || projectsQuery.isLoading} {...register('projectId')}>
                    <option value="">Selecione</option>
                    {(projectsQuery.data || []).map(project => (
                      <option key={project.id} value={project.id}>{project.code} — {project.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor="stock-move-date">Data *</label>
                  <input id="stock-move-date" type="date" disabled={savingMutation.isPending} {...register('date')} />
                </div>
              </div>

              <section className="stock-return-editor" aria-labelledby="stock-return-products-title">
                <div className="admin-toolbar">
                  <div>
                    <div className="sec" id="stock-return-products-title">Produtos e lotes</div>
                    <p className="rel-meta">Cada linha gera uma movimentação dentro da mesma devolução.</p>
                  </div>
                  <button
                    className="mini-btn alt"
                    type="button"
                    disabled={savingMutation.isPending || returnLines.length >= 100}
                    onClick={() => setReturnLines(current => [...current, createReturnLine()])}
                  >
                    Adicionar produto
                  </button>
                </div>
                <div className="stock-return-lines">
                  {returnLines.map(line => (
                    <ReturnMovementLineRow
                      key={line.id}
                      line={line}
                      items={items}
                      projectId={projectId}
                      saving={savingMutation.isPending}
                      error={returnLineErrors[line.id]}
                      canRemove={returnLines.length > 1}
                      onChange={updateReturnLine}
                      onRemove={() => removeReturnLine(line.id)}
                    />
                  ))}
                </div>
              </section>
              {returnFormError ? <small className="field-error">{returnFormError}</small> : null}
            </>
          ) : (
            <>
              <div className="field-group">
                <label htmlFor="stock-move-item">Item *</label>
                <select id="stock-move-item" disabled={savingMutation.isPending || itemsQuery.isLoading} {...register('itemId')}>
                  <option value="">Selecione</option>
                  {items.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.code} — {option.name} ({option.unitLabel})
                    </option>
                  ))}
                </select>
                {errors.itemId ? <small className="field-error">{errors.itemId.message}</small> : null}
              </div>

              <div className="equip-toggle-fields">
                <div className="field-group">
                  <label htmlFor="stock-move-quantity">Quantidade *</label>
                  <input
                    id="stock-move-quantity"
                    type="number"
                    min="0"
                    step={item?.type === 'FILTRO' ? '1' : '0.001'}
                    disabled={savingMutation.isPending}
                    {...register('quantity')}
                  />
                  {errors.quantity ? <small className="field-error">{errors.quantity.message}</small> : null}
                </div>
                <div className="field-group stock-unit-field">
                  <label htmlFor="stock-move-unit">Unidade</label>
                  <select id="stock-move-unit" value={movementUnitLabel(item)} onChange={() => undefined} disabled aria-readonly="true">
                    {item ? <option value={item.unitLabel}>{item.unitLabel}</option> : <option value="">Selecione</option>}
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor="stock-move-date">Data *</label>
                  <input id="stock-move-date" type="date" disabled={savingMutation.isPending} {...register('date')} />
                  {errors.date ? <small className="field-error">{errors.date.message}</small> : null}
                </div>
              </div>

              {reason === 'COMPRA' ? (
                <>
                  <div className="field-group">
                    <label htmlFor="stock-move-nf">Nota fiscal *</label>
                    <input id="stock-move-nf" type="text" disabled={savingMutation.isPending} {...register('nfNumber')} />
                    {errors.nfNumber ? <small className="field-error">{errors.nfNumber.message}</small> : null}
                  </div>

                  <div className="equip-toggle-fields">
                    <div className="field-group">
                      <label htmlFor="stock-move-lot">Lote{item?.type === 'PRODUTO_QUIMICO' ? ' *' : ''}</label>
                      <input id="stock-move-lot" type="text" disabled={savingMutation.isPending} {...register('lotNumber')} />
                      {errors.lotNumber ? <small className="field-error">{errors.lotNumber.message}</small> : null}
                    </div>
                    <div className="field-group">
                      <label htmlFor="stock-move-expiry">Validade{item?.type === 'PRODUTO_QUIMICO' ? ' *' : ''}</label>
                      <input id="stock-move-expiry" type="date" disabled={savingMutation.isPending} {...register('expiryDate')} />
                      {errors.expiryDate ? <small className="field-error">{errors.expiryDate.message}</small> : null}
                    </div>
                  </div>

                  <div className="equip-toggle-fields">
                    <div className="field-group">
                      <label htmlFor="stock-move-supplier">Fornecedor</label>
                      <input id="stock-move-supplier" type="text" disabled={savingMutation.isPending} {...register('supplier')} />
                    </div>
                    <div className="field-group">
                      <label htmlFor="stock-move-cost">Custo unitário</label>
                      <input id="stock-move-cost" type="number" min="0" step="0.01" disabled={savingMutation.isPending} {...register('unitCost')} />
                      {errors.unitCost ? <small className="field-error">{errors.unitCost.message}</small> : null}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {reason === 'INVENTARIO' ? (
                    <div className="field-group">
                      <label htmlFor="stock-move-type">Tipo do ajuste *</label>
                      <select id="stock-move-type" disabled={savingMutation.isPending} {...register('movementType')}>
                        <option value="ENTRADA">Entrada</option>
                        <option value="SAIDA">Saída</option>
                      </select>
                    </div>
                  ) : null}
                  {needsProject ? (
                    <div className="field-group">
                      <label htmlFor="stock-move-project">Projeto *</label>
                      <select id="stock-move-project" disabled={savingMutation.isPending || projectsQuery.isLoading} {...register('projectId')}>
                        <option value="">Selecione</option>
                        {(projectsQuery.data || []).map(project => (
                          <option key={project.id} value={project.id}>{project.code} — {project.name}</option>
                        ))}
                      </select>
                      {errors.projectId ? <small className="field-error">{errors.projectId.message}</small> : null}
                    </div>
                  ) : null}
                  <div className="field-group">
                    <label htmlFor="stock-move-batch">Lote *</label>
                    <select id="stock-move-batch" disabled={savingMutation.isPending || batchesQuery.isLoading || !itemId} {...register('batchId')}>
                      <option value="">Selecione</option>
                      {batches.map(batch => (
                        <option key={batch.id} value={batch.id}>{batchLabel(batch, reason)}</option>
                      ))}
                    </select>
                    {errors.batchId ? <small className="field-error">{errors.batchId.message}</small> : null}
                  </div>
                  {reason === 'USO_EM_PROJETO' ? (
                    <div className="field-group">
                      <label htmlFor="stock-move-requested">Solicitante</label>
                      <input id="stock-move-requested" type="text" disabled={savingMutation.isPending} {...register('requestedBy')} />
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}

          <div className="field-group">
            <label htmlFor="stock-move-notes">Observações{needsNotes ? ' *' : ''}</label>
            <textarea id="stock-move-notes" disabled={savingMutation.isPending} {...register('notes')} />
            {errors.notes ? <small className="field-error">{errors.notes.message}</small> : null}
          </div>

          <div className="admin-form-actions equip-form-actions">
            <button className="mini-btn alt" type="button" onClick={onClose} disabled={savingMutation.isPending}>Cancelar</button>
            <button className="mini-btn" type="submit" disabled={savingMutation.isPending}>
              {savingMutation.isPending ? 'Salvando…' : isProjectReturn ? `Salvar ${returnLines.length} ${returnLines.length === 1 ? 'devolução' : 'devoluções'}` : 'Salvar'}
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={!!expiredConfirmPayload}
        title="Lote vencido"
        description="Confirme a saída usando o lote selecionado."
        confirmLabel="Confirmar saída"
        danger={false}
        onConfirm={() => {
          if (expiredConfirmPayload) {
            savingMutation.mutate({
              kind: 'single',
              payload: { ...expiredConfirmPayload, confirmExpired: true }
            });
          }
          setExpiredConfirmPayload(null);
        }}
        onCancel={() => setExpiredConfirmPayload(null)}
      />
    </>
  );
}
