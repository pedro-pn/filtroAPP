import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';

import type { EquipmentCategory } from '../../api/equipamentos';
import { useToast } from '../../components/ui/ToastContext';
import { useEquipamentoMutations } from '../../hooks/useEquipamentos';
import { type ProjectSortDirection } from '../../utils/projectSort';
import { ProjectSortButton } from '../../utils/ProjectSortButton';
import {
  createPointerDragGhost,
  movePointerDragGhost,
  reorderIdFromPoint,
  reorderRowsById,
  sameStringOrder,
  setReorderDragImage,
  type PointerDragState
} from '../../utils/reorderDrag';

interface Props {
  categories: EquipmentCategory[];
  rdoLinkedCategoryIds: Set<string>;
  onAdd: () => void;
  onEdit: (category: EquipmentCategory) => void;
  onRemove: (category: EquipmentCategory) => void;
}

export function CategoryManager({ categories, rdoLinkedCategoryIds, onAdd, onEdit, onRemove }: Props) {
  const { updateCategory } = useEquipamentoMutations();
  const showToast = useToast();
  const [locked, setLocked] = useState(true);
  const [ordered, setOrdered] = useState<EquipmentCategory[]>(categories);
  const [sortDir, setSortDir] = useState<ProjectSortDirection>('asc');
  const dragCategoryId = useRef<string | null>(null);
  const dropHandled = useRef(false);
  const dragStartOrderIds = useRef<string[]>([]);
  const orderedRef = useRef<EquipmentCategory[]>(categories);
  const touchDrag = useRef<PointerDragState | null>(null);
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [overCategoryId, setOverCategoryId] = useState<string | null>(null);

  // Mantém a ordem local em sincronia quando a lista do servidor muda.
  useEffect(() => {
    if (dragCategoryId.current) return;
    orderedRef.current = categories;
    setOrdered(categories);
  }, [categories]);

  function persistOrder(next: EquipmentCategory[]) {
    const changed = next
      .map((category, index) => ({ category, index }))
      .filter(({ category, index }) => category.order !== index);
    if (!changed.length) return;
    Promise.all(changed.map(({ category, index }) => updateCategory.mutateAsync({ id: category.id, payload: { order: index } })))
      .then(() => showToast('Ordem atualizada.', 'success'))
      .catch(error => showToast(error instanceof Error ? error.message : 'Não foi possível reordenar.', 'error'));
  }

  // Ordena as categorias alfabeticamente (e persiste a nova ordem das abas).
  function sortAlphabetically() {
    const direction = sortDir;
    const next = [...ordered].sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) * (direction === 'asc' ? 1 : -1)
    );
    setOrdered(next);
    persistOrder(next);
    setSortDir(direction === 'asc' ? 'desc' : 'asc');
  }

  function applyOrdered(next: EquipmentCategory[]) {
    orderedRef.current = next;
    setOrdered(next);
  }

  function clearDragState() {
    dragCategoryId.current = null;
    setDraggedCategoryId(null);
    setOverCategoryId(null);
  }

  function startCategoryDrag(categoryId: string) {
    dropHandled.current = false;
    orderedRef.current = ordered;
    dragStartOrderIds.current = ordered.map(category => category.id);
    dragCategoryId.current = categoryId;
    setDraggedCategoryId(categoryId);
    setOverCategoryId(categoryId);
  }

  function persistCategoryOrder(next: EquipmentCategory[]) {
    applyOrdered(next);
    const nextIds = next.map(category => category.id);
    if (sameStringOrder(nextIds, dragStartOrderIds.current)) return;
    persistOrder(next);
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, categoryId: string) {
    if (locked) {
      event.preventDefault();
      return;
    }
    startCategoryDrag(categoryId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', categoryId);
    setReorderDragImage(event, '.equip-card', 'app-reorder-drag-ghost');
  }

  function handleDragOver(event: DragEvent<HTMLElement>, categoryId: string) {
    const fromId = dragCategoryId.current;
    if (!fromId || locked) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setOverCategoryId(categoryId);
    const next = reorderRowsById(orderedRef.current, fromId, categoryId, category => category.id);
    if (next !== orderedRef.current) applyOrdered(next);
  }

  function handleDrop(event: DragEvent<HTMLElement>, categoryId: string) {
    event.preventDefault();
    const fromId = dragCategoryId.current;
    dropHandled.current = true;
    clearDragState();
    if (!fromId || locked) return;
    const next = fromId === categoryId
      ? orderedRef.current
      : reorderRowsById(orderedRef.current, fromId, categoryId, category => category.id);
    persistCategoryOrder(next);
  }

  function handleDragEnd() {
    if (!dropHandled.current) applyOrdered(categories);
    dropHandled.current = false;
    clearDragState();
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>, categoryId: string) {
    if (event.pointerType === 'mouse') return;
    if (locked) {
      event.preventDefault();
      return;
    }
    const row = event.currentTarget.closest('.equip-card');
    if (!(row instanceof HTMLElement)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startCategoryDrag(categoryId);
    document.body.classList.add('app-reorder-touching');
    const state = createPointerDragGhost(row, event.clientX, event.clientY, 'app-reorder-touch-ghost');
    state.pointerId = event.pointerId;
    touchDrag.current = state;
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const state = touchDrag.current;
    const fromId = dragCategoryId.current;
    if (!state || state.pointerId !== event.pointerId || !fromId || locked) return;
    event.preventDefault();
    movePointerDragGhost(state, event.clientX, event.clientY);

    const targetId = reorderIdFromPoint(event.clientX, event.clientY, '.equip-card');
    if (!targetId) return;
    setOverCategoryId(targetId);
    const next = reorderRowsById(orderedRef.current, fromId, targetId, category => category.id);
    if (next !== orderedRef.current) applyOrdered(next);
  }

  function finishPointerDrag(event: PointerEvent<HTMLButtonElement>, persist: boolean) {
    const state = touchDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    state.ghost.remove();
    touchDrag.current = null;
    document.body.classList.remove('app-reorder-touching');
    if (persist) persistCategoryOrder(orderedRef.current);
    else applyOrdered(categories);
    clearDragState();
  }

  return (
    <section className="page-card">
      <div className="admin-toolbar">
        <div className="sec">Categorias</div>
        <div className="equip-cat-tools">
          <ProjectSortButton direction={sortDir} onToggle={sortAlphabetically} />
          <button
            className={`icon-toggle ${locked ? '' : 'active'}`}
            type="button"
            aria-pressed={!locked}
            title={locked ? 'Destravar para reordenar' : 'Travar ordenação'}
            onClick={() => setLocked(v => !v)}
          >
            {locked ? '🔒' : '🔓'} {locked ? 'Reordenar' : 'Concluir'}
          </button>
          <button className="mini-btn" type="button" onClick={onAdd}>+ Nova categoria</button>
        </div>
      </div>

      {!locked && <p className="rel-meta equip-reorder-hint">Arraste os cards para reordenar as abas. Clique em “Concluir” para travar.</p>}

      <div className={`equip-grid ${locked ? '' : 'reordering'}`}>
        {ordered.map(category => (
          <article
            className={[
              'report-card equip-card',
              !locked ? 'draggable' : '',
              draggedCategoryId === category.id ? 'drag-placeholder' : '',
              overCategoryId === category.id && draggedCategoryId !== category.id ? 'drag-over' : ''
            ].filter(Boolean).join(' ')}
            key={category.id}
            data-reorder-id={category.id}
            onDragOver={event => handleDragOver(event, category.id)}
            onDragLeave={() => setOverCategoryId(current => current === category.id ? null : current)}
            onDrop={event => handleDrop(event, category.id)}
          >
            <div className="equip-card-head">
              <span className="equip-card-titlewrap">
                {!locked && (
                  <button
                    className="equip-drag-handle"
                    type="button"
                    draggable
                    aria-label={`Arrastar ${category.name} para reordenar`}
                    aria-grabbed={draggedCategoryId === category.id}
                    title="Arraste para reordenar"
                    onDragStart={event => handleDragStart(event, category.id)}
                    onDragEnd={handleDragEnd}
                    onPointerDown={event => handlePointerDown(event, category.id)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={event => finishPointerDrag(event, true)}
                    onPointerCancel={event => finishPointerDrag(event, false)}
                  >
                    ⠿
                  </button>
                )}
                <strong>{category.name}</strong>
              </span>
              {rdoLinkedCategoryIds.has(category.id) && (
                <span className="equip-badge equip-badge-ok" title="Categoria usada por algum relatório (RDO)">RDO</span>
              )}
            </div>
            <div className="rel-meta">{category.fieldSchema.length} campo(s){category.supportsCalibration ? ' · calibração' : ''}{category.syncToRomaneio ? ' · romaneio' : ''}{category.showInMaintenance !== false ? ' · manutenção' : ' · fora da manutenção'}</div>
            {locked && (
              <div className="report-card-actions">
                <button className="mini-btn alt" type="button" onClick={() => onEdit(category)}>Editar</button>
                {!rdoLinkedCategoryIds.has(category.id) && (
                  <button className="mini-btn danger" type="button" onClick={() => onRemove(category)}>Remover</button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
