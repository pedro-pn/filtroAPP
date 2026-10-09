import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { createPointerDragGhost, movePointerDragGhost, reorderIdFromPoint, reorderRowsById, scrollReorderContainerEdge, type PointerDragState } from '../../utils/reorderDrag';
import './SortableEvidenceList.css';

export function SortableEvidenceList<T>({ items, getId, renderItem, onChange, disabled = false }: {
  items: T[]; getId: (item: T) => string; renderItem: (item: T, index: number) => ReactNode;
  onChange: (items: T[]) => void; disabled?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; row: HTMLElement; startX: number; startY: number; rows: T[]; ghost?: PointerDragState } | null>(null);
  const [preview, setPreview] = useState<T[] | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const cancel = () => { drag.current?.ghost?.ghost.remove(); drag.current = null; setPreview(null); setDraggedId(null); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('keydown', escape, true); drag.current?.ghost?.ghost.remove(); };
  }, []);
  return <div ref={listRef} className="evidence-sort-list" role="list" aria-label="Ordem das fotografias"
    onPointerMove={event => {
      const current = drag.current;
      if (!current) return;
      if (!current.ghost) {
        if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 5) return;
        current.ghost = createPointerDragGhost(current.row, current.startX, current.startY, 'evidence-sort-ghost');
        current.ghost.ghost.classList.add('fv-ds');
        current.ghost.ghost.inert = true;
        current.ghost.ghost.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
        setDraggedId(current.id);
      }
      movePointerDragGhost(current.ghost, event.clientX, event.clientY);
      scrollReorderContainerEdge(listRef.current?.closest<HTMLElement>('[data-modal-body], .fv-modal__body') || listRef.current?.parentElement || null, event.clientY);
      const targetId = reorderIdFromPoint(event.clientX, event.clientY, '.evidence-sort-row');
      if (targetId && current.rows.some(row => getId(row) === targetId)) {
        current.rows = reorderRowsById(current.rows, current.id, targetId, getId); setPreview([...current.rows]);
      }
    }}
    onPointerUp={() => { const current = drag.current; if (current?.ghost) onChange(current.rows); cancel(); }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
  >
    {(preview || items).map((item, index) => {
      const id = getId(item);
      return <div key={id} role="listitem" className={`evidence-sort-row${draggedId === id ? ' evidence-sort-placeholder' : ''}`} data-reorder-id={id}>
        <button type="button" className="evidence-sort-handle" disabled={disabled || items.length < 2}
          aria-label={`Reordenar foto ${index + 1}. Arraste ou use as setas.`}
          onKeyDown={event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const target = index + (event.key === 'ArrowUp' ? -1 : 1);
            if (target >= 0 && target < items.length) onChange(reorderRowsById(items, id, getId(items[target]), getId));
          }}
          onPointerDown={event => {
            if (event.button !== 0 || disabled) return;
            const row = event.currentTarget.closest<HTMLElement>('[data-reorder-id]');
            if (!row || !listRef.current) return;
            drag.current = { id, row, startX: event.clientX, startY: event.clientY, rows: [...items] };
            // Capture on the stable list: moving a row must not lose the pointer mid-drag.
            listRef.current.setPointerCapture(event.pointerId);
          }}
        ><GripVertical size={18} aria-hidden="true" /><span>{index + 1}</span></button>
        <div className="evidence-sort-content">
          {draggedId === id ? <p role="status">Soltar na posição {index + 1}. Esc cancela.</p> : null}
          {renderItem(item, index)}
        </div>
      </div>;
    })}
  </div>;
}
