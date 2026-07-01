import { useEffect, useRef, useState } from 'react';

import type { EquipmentCategory } from '../../api/equipamentos';
import { useToast } from '../../components/ui/ToastContext';
import { useEquipamentoMutations } from '../../hooks/useEquipamentos';
import { type ProjectSortDirection } from '../../utils/projectSort';
import { ProjectSortButton } from '../../utils/ProjectSortButton';

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
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Mantém a ordem local em sincronia quando a lista do servidor muda.
  useEffect(() => { setOrdered(categories); }, [categories]);

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

  function handleDrop(targetIndex: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    setOverIndex(null);
    if (from === null || from === targetIndex) return;
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);
    setOrdered(next);
    persistOrder(next);
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
        {ordered.map((category, index) => (
          <article
            className={`report-card equip-card ${!locked ? 'draggable' : ''} ${overIndex === index ? 'drag-over' : ''}`}
            key={category.id}
            draggable={!locked}
            onDragStart={() => { dragIndex.current = index; }}
            onDragOver={event => { if (!locked) { event.preventDefault(); setOverIndex(index); } }}
            onDragLeave={() => { if (overIndex === index) setOverIndex(null); }}
            onDrop={() => handleDrop(index)}
            onDragEnd={() => { dragIndex.current = null; setOverIndex(null); }}
          >
            <div className="equip-card-head">
              <span className="equip-card-titlewrap">
                {!locked && <span className="equip-drag-handle" aria-hidden="true">⠿</span>}
                <strong>{category.name}</strong>
              </span>
              {rdoLinkedCategoryIds.has(category.id) && (
                <span className="equip-badge equip-badge-ok" title="Categoria usada por algum relatório (RDO)">RDO</span>
              )}
            </div>
            <div className="rel-meta">{category.fieldSchema.length} campo(s){category.supportsCalibration ? ' · calibração' : ''}{category.syncToRomaneio ? ' · romaneio' : ''}</div>
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
