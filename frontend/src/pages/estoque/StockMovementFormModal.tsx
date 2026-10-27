import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createStockMovements,
  createStockReturnMovements,
  listStockItems,
  type StockBatchSummary,
  type StockMovementPayload
} from '../../api/estoque';
import { ApiClientError } from '../../api/client';
import { listProjects } from '../../api/projects';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/ToastContext';
import { StockMovementLineRow } from './StockMovementLineRow';
import { createMovementLine, validateMovementLines, type MovementFormValues, type MovementLine } from './stockMovementForm';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function StockMovementFormModal({ open, onClose }: Props) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<MovementFormValues>(() => ({
    reason: 'COMPRA', movementType: 'ENTRADA', projectId: '', date: new Date().toISOString().slice(0, 10),
    nfNumber: '', supplier: '', requestedBy: '', notes: ''
  }));
  const [lines, setLines] = useState<MovementLine[]>(() => [createMovementLine()]);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof MovementFormValues, string>>>({});
  const [formError, setFormError] = useState('');
  const [expiredConfirmPayload, setExpiredConfirmPayload] = useState<StockMovementPayload[] | null>(null);
  const itemsQuery = useQuery({
    queryKey: ['estoque', 'itens', { movementOptions: true }],
    queryFn: () => listStockItems({ includeInactive: false })
  });
  const projectsQuery = useQuery({
    queryKey: ['estoque', 'projects', { active: true }],
    queryFn: () => listProjects(true)
  });
  const items = itemsQuery.data || [];
  const { reason, projectId } = values;
  const isProjectReturn = reason === 'DEVOLUCAO_OBRA';
  const needsProject = isProjectReturn || reason === 'USO_EM_PROJETO';
  const needsNotes = ['INVENTARIO', 'PERDA', 'DESCARTE_VALIDADE'].includes(reason);
  const savingMutation = useMutation({
    mutationFn: async (movements: StockMovementPayload[]) => {
      if (movements[0].reason === 'DEVOLUCAO_OBRA') {
        return createStockReturnMovements({
          reason: 'DEVOLUCAO_OBRA', projectId: movements[0].projectId!, date: movements[0].date,
          notes: movements[0].notes,
          items: movements.map(movement => ({ itemId: movement.itemId, batchId: movement.batchId!, quantity: movement.quantity }))
        });
      }
      return createStockMovements({ movements });
    },
    onSuccess: (_result, movements) => {
      queryClient.invalidateQueries({ queryKey: ['estoque'] });
      showToast(movements.length === 1 ? 'Movimentação registrada.' : `${movements.length} movimentações registradas.`, 'success');
      onClose();
    },
    onError: (error, movements) => {
      if (error instanceof ApiClientError && error.code === 'STOCK_EXPIRED_CONFIRMATION_REQUIRED') {
        setExpiredConfirmPayload(movements);
        return;
      }
      showToast(error instanceof Error ? error.message : 'Não foi possível registrar.', 'error');
    }
  });
  const busy = savingMutation.isPending || !!expiredConfirmPayload;

  function updateField<K extends keyof MovementFormValues>(field: K, value: MovementFormValues[K]) {
    setValues(current => ({ ...current, [field]: value }));
    setFieldErrors({});
    setFormError('');
    if (field === 'reason' || field === 'projectId') {
      setLines(current => current.map(line => ({ ...line, batchId: '' })));
      setLineErrors({});
    }
  }

  function updateLine(next: MovementLine) {
    setLines(current => current.map(line => line.id === next.id ? next : line));
    setLineErrors(current => {
      const updated = { ...current };
      delete updated[next.id];
      return updated;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const result = validateMovementLines(values, lines, items);
    setFieldErrors(result.fieldErrors);
    setLineErrors(result.lineErrors);
    setFormError(result.formError);
    if (result.formError || Object.keys(result.fieldErrors).length || Object.keys(result.lineErrors).length) return;
    const expired = reason === 'USO_EM_PROJETO' && lines.some(line => {
      const batches = queryClient.getQueryData<StockBatchSummary[]>(['estoque', 'lotes', { itemId: line.itemId, reason, projectId }]);
      return batches?.find(batch => batch.id === line.batchId)?.expired;
    });
    if (expired) setExpiredConfirmPayload(result.payloads);
    else savingMutation.mutate(result.payloads);
  }

  return (
    <>
      <Modal open={open} onClose={onClose} appearance="design-system" title="Registrar movimentação" size="lg"
        showCloseButton={!busy} closeOnEscape={!busy} panelClassName="stock-dialog stock-dialog--return">
        <form className="equip-form" onSubmit={submit} noValidate>
          <div className="stock-movement-line-fields stock-movement-line-fields--batch">
            <div className="field-group">
              <label htmlFor="stock-move-reason">Movimentação *</label>
              <select id="stock-move-reason" value={reason} disabled={busy}
                onChange={event => updateField('reason', event.target.value as MovementFormValues['reason'])}>
                <option value="COMPRA">Entrada por compra</option>
                <option value="USO_EM_PROJETO">Saída para projeto</option>
                <option value="DEVOLUCAO_OBRA">Devolução de obra</option>
                <option value="INVENTARIO">Ajuste de inventário</option>
                <option value="PERDA">Perda</option>
                <option value="DESCARTE_VALIDADE">Descarte por validade</option>
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="stock-move-date">Data *</label>
              <input id="stock-move-date" type="date" value={values.date} disabled={busy} onChange={event => updateField('date', event.target.value)} />
              {fieldErrors.date ? <small className="field-error" role="alert">{fieldErrors.date}</small> : null}
            </div>
          </div>
          {needsProject ? (
            <div className="field-group">
              <label htmlFor="stock-move-project">Projeto *</label>
              <select id="stock-move-project" value={projectId} disabled={busy || projectsQuery.isLoading}
                onChange={event => updateField('projectId', event.target.value)}>
                <option value="">Selecione</option>
                {(projectsQuery.data || []).map(project => <option key={project.id} value={project.id}>{project.code} — {project.name}</option>)}
              </select>
              {fieldErrors.projectId ? <small className="field-error" role="alert">{fieldErrors.projectId}</small> : null}
              {projectsQuery.isError ? <small className="field-error">Não foi possível carregar os projetos.</small> : null}
            </div>
          ) : null}
          {reason === 'COMPRA' ? (
            <div className="stock-movement-line-fields stock-movement-line-fields--batch">
              <div className="field-group">
                <label htmlFor="stock-move-nf">Nota fiscal *</label>
                <input id="stock-move-nf" value={values.nfNumber} disabled={busy} onChange={event => updateField('nfNumber', event.target.value)} />
                {fieldErrors.nfNumber ? <small className="field-error" role="alert">{fieldErrors.nfNumber}</small> : null}
              </div>
              <div className="field-group">
                <label htmlFor="stock-move-supplier">Fornecedor</label>
                <input id="stock-move-supplier" value={values.supplier} disabled={busy} onChange={event => updateField('supplier', event.target.value)} />
                {fieldErrors.supplier ? <small className="field-error" role="alert">{fieldErrors.supplier}</small> : null}
              </div>
            </div>
          ) : null}
          {reason === 'INVENTARIO' ? (
            <div className="field-group">
              <label htmlFor="stock-move-type">Tipo do ajuste *</label>
              <select id="stock-move-type" value={values.movementType} disabled={busy}
                onChange={event => updateField('movementType', event.target.value as MovementFormValues['movementType'])}>
                <option value="ENTRADA">Entrada</option><option value="SAIDA">Saída</option>
              </select>
            </div>
          ) : null}
          <section className="stock-return-editor" aria-labelledby="stock-move-products-title">
            <div className="admin-toolbar stock-movement-items-toolbar">
              <div>
                <div className="sec" id="stock-move-products-title">Produtos e lotes</div>
                <p className="rel-meta">Adicione os itens e preencha os dados de cada produto. Todos serão salvos juntos.</p>
              </div>
              <button className="mini-btn alt" type="button" disabled={busy || lines.length >= 100}
                onClick={() => setLines(current => [...current, createMovementLine()])}>Adicionar item</button>
            </div>
            <div className="stock-return-lines">
              {lines.map((line, index) => (
                <StockMovementLineRow key={line.id} line={line} index={index} items={items} reason={reason} projectId={projectId}
                  saving={busy} error={lineErrors[line.id]} canRemove={lines.length > 1} onChange={updateLine}
                  onRemove={() => {
                    setLines(current => current.filter(option => option.id !== line.id));
                    setLineErrors(current => { const updated = { ...current }; delete updated[line.id]; return updated; });
                  }} />
              ))}
            </div>
            {itemsQuery.isError ? <small className="field-error">Não foi possível carregar os produtos.</small> : null}
          </section>
          {reason === 'USO_EM_PROJETO' ? (
            <div className="field-group">
              <label htmlFor="stock-move-requested">Solicitante</label>
              <input id="stock-move-requested" value={values.requestedBy} disabled={busy} onChange={event => updateField('requestedBy', event.target.value)} />
              {fieldErrors.requestedBy ? <small className="field-error" role="alert">{fieldErrors.requestedBy}</small> : null}
            </div>
          ) : null}
          <div className="field-group">
            <label htmlFor="stock-move-notes">Observações{needsNotes ? ' *' : ''}</label>
            <textarea id="stock-move-notes" value={values.notes} disabled={busy} onChange={event => updateField('notes', event.target.value)} />
            {fieldErrors.notes ? <small className="field-error" role="alert">{fieldErrors.notes}</small> : null}
          </div>
          {formError ? <small className="field-error" role="alert">{formError}</small> : null}
          <div className="admin-form-actions equip-form-actions">
            <button className="mini-btn alt" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="mini-btn" type="submit" disabled={busy || itemsQuery.isLoading}>
              {savingMutation.isPending ? 'Salvando…' : `Salvar ${lines.length} ${isProjectReturn ? (lines.length === 1 ? 'devolução' : 'devoluções') : (lines.length === 1 ? 'movimentação' : 'movimentações')}`}
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={!!expiredConfirmPayload} title="Lote vencido"
        description="Há itens com lote vencido. Confirme para registrar todas as saídas."
        confirmLabel="Confirmar saída" danger={false}
        onConfirm={() => {
          if (expiredConfirmPayload) savingMutation.mutate(expiredConfirmPayload.map(movement => ({ ...movement, confirmExpired: true })));
          setExpiredConfirmPayload(null);
        }}
        onCancel={() => setExpiredConfirmPayload(null)} />
    </>
  );
}
