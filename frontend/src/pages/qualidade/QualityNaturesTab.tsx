import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createQualityNature,
  listQualityNatures,
  removeQualityNature,
  reorderQualityNatures,
  setQualityNatureActive,
  type QualityNature,
  type QualityNaturePayload,
  updateQualityNature
} from '../../api/qualidade';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { SearchBar } from '../../components/ui/SearchBar';
import { useToast } from '../../components/ui/ToastContext';
import { Badge, Button, Card, Input } from '../../components/ui/ds';
import {
  createPointerDragGhost,
  movePointerDragGhost,
  reorderIdFromPoint,
  reorderRowsById,
  sameStringOrder,
  setReorderDragImage,
  type PointerDragState
} from '../../utils/reorderDrag';
import { QualityNatureFormModal } from './QualityNatureFormModal';

interface Props {
  isManager: boolean;
}

type ConfirmState = {
  title: string;
  description?: string;
  highlight?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
};

function reorderNatureRows(rows: QualityNature[], fromId: string, targetId: string) {
  return reorderRowsById(rows, fromId, targetId, nature => nature.id)
    .map((nature, position) => ({ ...nature, position }));
}

export function QualityNaturesTab({ isManager }: Props) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formNature, setFormNature] = useState<QualityNature | null | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const [newSubmitted, setNewSubmitted] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const dragNatureId = useRef<string | null>(null);
  const [draggedNatureId, setDraggedNatureId] = useState<string | null>(null);
  const [dragOverNatureId, setDragOverNatureId] = useState<string | null>(null);
  const dropHandled = useRef(false);
  const dragStartOrderIds = useRef<string[]>([]);
  const orderedNaturesRef = useRef<QualityNature[]>([]);
  const touchDrag = useRef<PointerDragState | null>(null);
  const touchDragCleanup = useRef<(() => void) | null>(null);
  const touchPoint = useRef<{ x: number; y: number } | null>(null);
  const touchScrollFrame = useRef<number | null>(null);
  const [orderedNatures, setOrderedNatures] = useState<QualityNature[]>([]);

  const naturesQuery = useQuery({
    queryKey: ['qualidade', 'naturezas', { includeInactive }],
    queryFn: () => listQualityNatures({ includeInactive })
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['qualidade', 'naturezas'] });
    queryClient.invalidateQueries({ queryKey: ['qualidade', 'registros'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: QualityNaturePayload) => createQualityNature(payload),
    onSuccess: () => {
      invalidate();
      setNewName('');
      setNewSubmitted(false);
      showToast('Natureza cadastrada.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível cadastrar.', 'error')
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: QualityNaturePayload }) => updateQualityNature(id, payload),
    onSuccess: () => {
      invalidate();
      setFormNature(undefined);
      showToast('Natureza salva.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setQualityNatureActive(id, isActive),
    onSuccess: () => {
      invalidate();
      showToast('Status atualizado.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível atualizar.', 'error')
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => reorderQualityNatures(ids),
    onSuccess: () => {
      invalidate();
      showToast('Ordem atualizada.', 'success');
    },
    onError: error => {
      invalidate();
      showToast(error instanceof Error ? error.message : 'Não foi possível ordenar.', 'error');
    }
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeQualityNature(id),
    onSuccess: () => {
      invalidate();
      showToast('Natureza removida.', 'success');
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover.', 'error')
  });

  useEffect(() => {
    if (dragNatureId.current) return;
    const rows = naturesQuery.data || [];
    orderedNaturesRef.current = rows;
    setOrderedNatures(rows);
  }, [naturesQuery.data]);

  useEffect(() => () => {
    touchDragCleanup.current?.();
    if (touchScrollFrame.current !== null) window.cancelAnimationFrame(touchScrollFrame.current);
    touchDrag.current?.ghost.remove();
    document.body.classList.remove('app-reorder-touching');
  }, []);

  const natures = useMemo(() => {
    const rows = orderedNatures;
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(nature => nature.name.toLowerCase().includes(query));
  }, [orderedNatures, search]);
  const saving = createMutation.isPending || updateMutation.isPending;
  const canReorder = isManager && !search.trim() && natures.length > 1;
  const reorderDisabled = !canReorder || reorderMutation.isPending;
  const newNameError = newSubmitted && !newName.trim() ? 'Informe o nome da Natureza.' : '';

  function handleSubmit(payload: QualityNaturePayload) {
    if (formNature) updateMutation.mutate({ id: formNature.id, payload });
    else createMutation.mutate(payload);
  }

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNewSubmitted(true);
    const name = newName.trim();
    if (!name) return;
    createMutation.mutate({ name });
  }

  function clearDragState() {
    dragNatureId.current = null;
    setDraggedNatureId(null);
    setDragOverNatureId(null);
  }

  function applyOrderedNatures(rows: QualityNature[]) {
    orderedNaturesRef.current = rows;
    setOrderedNatures(rows);
  }

  function startNatureDrag(natureId: string) {
    dropHandled.current = false;
    orderedNaturesRef.current = orderedNatures;
    dragStartOrderIds.current = orderedNatures.map(nature => nature.id);
    dragNatureId.current = natureId;
    setDraggedNatureId(natureId);
    setDragOverNatureId(natureId);
  }

  function persistNatureOrder(rows: QualityNature[]) {
    const nextIds = rows.map(nature => nature.id);
    applyOrderedNatures(rows);
    if (sameStringOrder(nextIds, dragStartOrderIds.current)) return;
    queryClient.setQueryData(['qualidade', 'naturezas', { includeInactive }], rows);
    reorderMutation.mutate(nextIds);
  }

  function handleNatureDragStart(event: DragEvent<HTMLButtonElement>, natureId: string) {
    if (reorderDisabled) {
      event.preventDefault();
      return;
    }
    startNatureDrag(natureId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', natureId);
    setReorderDragImage(event, '.quality-nature-row', 'app-reorder-drag-ghost');
  }

  function handleNatureDragOver(event: DragEvent<HTMLElement>, natureId: string) {
    const fromId = dragNatureId.current;
    if (!fromId || reorderDisabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverNatureId(natureId);
    const next = reorderNatureRows(orderedNaturesRef.current, fromId, natureId);
    if (next !== orderedNaturesRef.current) applyOrderedNatures(next);
  }

  function handleNatureDrop(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    const fromId = dragNatureId.current;
    dropHandled.current = true;
    clearDragState();
    if (!fromId || reorderDisabled) return;

    const next = fromId === targetId
      ? orderedNaturesRef.current
      : reorderNatureRows(orderedNaturesRef.current, fromId, targetId);
    persistNatureOrder(next);
  }

  function handleNatureDragEnd() {
    if (!dropHandled.current) {
      applyOrderedNatures(naturesQuery.data || []);
    }
    dropHandled.current = false;
    clearDragState();
  }

  function handleNatureKeyDown(event: KeyboardEvent<HTMLButtonElement>, natureId: string) {
    if (reorderDisabled || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const rows = orderedNaturesRef.current;
    const index = rows.findIndex(nature => nature.id === natureId);
    const target = rows[index + (event.key === 'ArrowUp' ? -1 : 1)];
    if (!target) return;
    dragStartOrderIds.current = rows.map(nature => nature.id);
    persistNatureOrder(reorderNatureRows(rows, natureId, target.id));
  }

  function handleNaturePointerDown(event: ReactPointerEvent<HTMLButtonElement>, natureId: string) {
    if (event.pointerType === 'mouse') return;
    if (touchDrag.current) return;
    if (reorderDisabled) {
      event.preventDefault();
      return;
    }

    const row = event.currentTarget.closest('.quality-nature-row');
    if (!(row instanceof HTMLElement)) return;
    const rect = row.getBoundingClientRect();
    event.preventDefault();
    startNatureDrag(natureId);
    document.body.classList.add('app-reorder-touching');
    const state = createPointerDragGhost(row, event.clientX, event.clientY, 'app-reorder-touch-ghost');
    state.pointerId = event.pointerId;
    state.offsetX = event.clientX - rect.left;
    state.offsetY = event.clientY - rect.top;
    movePointerDragGhost(state, event.clientX, event.clientY);
    touchDrag.current = state;
    touchPoint.current = { x: event.clientX, y: event.clientY };
    const onMove = (moveEvent: globalThis.PointerEvent) => handleNaturePointerMove(moveEvent);
    const onUp = (upEvent: globalThis.PointerEvent) => finishNaturePointerDrag(upEvent, true);
    const onCancel = (cancelEvent: globalThis.PointerEvent) => finishNaturePointerDrag(cancelEvent, false);
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    touchDragCleanup.current = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };
  }

  function handleNaturePointerMove(event: globalThis.PointerEvent) {
    const state = touchDrag.current;
    const fromId = dragNatureId.current;
    if (!state || state.pointerId !== event.pointerId || !fromId || reorderDisabled) return;

    event.preventDefault();
    touchPoint.current = { x: event.clientX, y: event.clientY };
    movePointerDragGhost(state, event.clientX, event.clientY);
    const targetId = reorderIdFromPoint(event.clientX, Math.max(0, Math.min(event.clientY, window.innerHeight - 100)), '.quality-nature-row');
    if (targetId) {
      setDragOverNatureId(targetId);
      const next = reorderNatureRows(orderedNaturesRef.current, fromId, targetId);
      if (next !== orderedNaturesRef.current) applyOrderedNatures(next);
    }
    if (touchScrollFrame.current === null) {
      const scrollAtEdge = () => {
        const point = touchPoint.current;
        if (!touchDrag.current || !point) { touchScrollFrame.current = null; return; }
        const direction = point.y < 90 ? -1 : point.y > window.innerHeight - 100 ? 1 : 0;
        if (!direction) { touchScrollFrame.current = null; return; }
        window.scrollBy(0, direction * 12);
        const id = reorderIdFromPoint(point.x, Math.max(0, Math.min(point.y, window.innerHeight - 100)), '.quality-nature-row');
        if (id && dragNatureId.current) {
          setDragOverNatureId(id);
          const reordered = reorderNatureRows(orderedNaturesRef.current, dragNatureId.current, id);
          if (reordered !== orderedNaturesRef.current) applyOrderedNatures(reordered);
        }
        touchScrollFrame.current = window.requestAnimationFrame(scrollAtEdge);
      };
      touchScrollFrame.current = window.requestAnimationFrame(scrollAtEdge);
    }
  }

  function finishNaturePointerDrag(event: globalThis.PointerEvent, persist: boolean) {
    const state = touchDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;

    touchDragCleanup.current?.();
    touchDragCleanup.current = null;
    if (touchScrollFrame.current !== null) window.cancelAnimationFrame(touchScrollFrame.current);
    touchScrollFrame.current = null;
    touchPoint.current = null;
    state.ghost.remove();
    touchDrag.current = null;
    document.body.classList.remove('app-reorder-touching');

    if (persist) {
      persistNatureOrder(orderedNaturesRef.current);
    } else {
      applyOrderedNatures(naturesQuery.data || []);
    }
    clearDragState();
  }

  function confirmActive(nature: QualityNature, isActive: boolean) {
    setConfirm({
      title: isActive ? 'Reativar Natureza' : 'Inativar Natureza',
      description: isActive ? 'Ela voltará a aparecer em novos registros.' : 'Ela deixará de aparecer em novos registros, mas seguirá visível nos registros antigos.',
      highlight: nature.name,
      confirmLabel: isActive ? 'Reativar' : 'Inativar',
      danger: false,
      onConfirm: () => activeMutation.mutate({ id: nature.id, isActive })
    });
  }

  function confirmRemove(nature: QualityNature) {
    setConfirm({
      title: 'Excluir Natureza',
      description: nature.inUse ? 'Naturezas em uso não podem ser excluídas; use Inativar.' : 'A Natureza será removida do cadastro.',
      highlight: nature.name,
      confirmLabel: 'Excluir',
      onConfirm: () => removeMutation.mutate(nature.id)
    });
  }

  return (
    <Card className="quality-tab quality-natures-v2" padding="md" data-quality-natures>
      <div className="admin-toolbar">
        <div>
          <div className="sec">Naturezas</div>
          <p className="rel-meta">Categorias padronizadas usadas no formulário e na recorrência.</p>
        </div>
      </div>

      {isManager ? (
        <form className="quality-nature-inline-add" onSubmit={handleCreateSubmit} noValidate>
          <div className={newNameError ? 'field-group field-invalid' : 'field-group'}>
            <label htmlFor="quality-new-nature">Nova Natureza *</label>
            <Input
              id="quality-new-nature"
              type="text"
              value={newName}
              aria-invalid={Boolean(newNameError) || undefined}
              aria-describedby={newNameError ? 'quality-new-nature-error' : undefined}
              disabled={createMutation.isPending}
              onChange={event => {
                setNewName(event.target.value);
                setNewSubmitted(false);
              }}
            />
            {newNameError ? <small id="quality-new-nature-error" className="field-error">{newNameError}</small> : null}
          </div>
          <Button variant="primary" size="sm" type="submit" loading={createMutation.isPending}>{createMutation.isPending ? 'Adicionando…' : 'Adicionar'}</Button>
        </form>
      ) : null}

      <div className="nps-tab-toolbar">
        <div className="nps-tab-toolbar-left">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar Natureza"
            ariaLabel="Buscar Natureza"
            count={{ shown: natures.length, total: natures.length }}
          />
        </div>
        <div className="nps-tab-toolbar-right">
          <label className="equip-toggle">
            <input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} />
            <span>Inativas</span>
          </label>
        </div>
      </div>

      {naturesQuery.isLoading ? <p className="placeholder-copy">Carregando Naturezas...</p> : null}
      {naturesQuery.isError ? <p className="equip-form-error">Não foi possível carregar as Naturezas.</p> : null}
      {!naturesQuery.isLoading && !natures.length ? <p className="placeholder-copy">Nenhuma Natureza encontrada.</p> : null}

      <div className="quality-nature-list" role="list">
        {natures.map((nature, index) => (
          <article
            className={[
              'quality-nature-row',
              nature.isActive ? '' : 'inactive',
              draggedNatureId === nature.id ? 'drag-placeholder' : '',
              dragOverNatureId === nature.id && draggedNatureId !== nature.id ? 'drag-over' : ''
            ].filter(Boolean).join(' ')}
            key={nature.id}
            role="listitem"
            data-reorder-id={nature.id}
            onDragOver={event => handleNatureDragOver(event, nature.id)}
            onDragLeave={() => setDragOverNatureId(current => current === nature.id ? null : current)}
            onDrop={event => handleNatureDrop(event, nature.id)}
          >
            <div className="quality-nature-order">
              {isManager ? (
                <button
                  className="quality-nature-drag-handle"
                  type="button"
                  aria-label={`Reordenar ${nature.name}: arraste ou use as setas`}
                  aria-grabbed={draggedNatureId === nature.id}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  title={search.trim() ? 'Limpe a busca para reordenar' : 'Arraste ou use as setas para reordenar'}
                  draggable={!reorderDisabled}
                  disabled={reorderDisabled}
                  onDragStart={event => handleNatureDragStart(event, nature.id)}
                  onDragEnd={handleNatureDragEnd}
                  onKeyDown={event => handleNatureKeyDown(event, nature.id)}
                  onPointerDown={event => handleNaturePointerDown(event, nature.id)}
                >
                  ⠿
                </button>
              ) : (
                <span className="quality-nature-position">{index + 1}</span>
              )}
            </div>
            <div className="quality-nature-main">
              <div>
                <div className="sec">{nature.name}</div>
                <p className="rel-meta">{nature.recordCount} registro(s) vinculado(s)</p>
              </div>
            </div>
            <Badge tone={nature.isActive ? 'success' : 'neutral'}>{nature.isActive ? 'Ativa' : 'Inativa'}</Badge>
            <p className="rel-meta quality-nature-use">{nature.inUse ? 'Exclusão bloqueada por vínculo com registros.' : 'Sem registros vinculados.'}</p>
            {isManager ? (
              <div className="admin-form-actions quality-nature-actions">
                <Button variant="secondary" size="sm" onClick={() => setFormNature(nature)}>Editar</Button>
                <Button variant="secondary" size="sm" onClick={() => confirmActive(nature, !nature.isActive)}>
                  {nature.isActive ? 'Inativar' : 'Reativar'}
                </Button>
                <RemoveIconButton label={`Remover natureza ${nature.name}`} onClick={() => confirmRemove(nature)} />
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {formNature !== undefined ? (
        <QualityNatureFormModal
          open
          nature={formNature}
          saving={saving}
          onClose={() => setFormNature(undefined)}
          onSubmit={handleSubmit}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        appearance="design-system"
        title={confirm?.title || ''}
        description={confirm?.description}
        highlight={confirm?.highlight}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}
