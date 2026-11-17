import { Camera, GripVertical } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { UploadField } from '../../components/ui/UploadField';
import { Button } from '../../components/ui/ds';
import { moveUpload } from '../../utils/uploadOrder';
import { MAX_STEPS, MAX_STEP_LENGTH, MAX_STEP_PHOTOS, emptyStepDraft, type OperationStepDraft, type OperationStepPhoto } from './operationSteps';

interface Props {
  value: OperationStepDraft[];
  onChange: (steps: OperationStepDraft[]) => void;
  disabled?: boolean;
  emptyText?: string;
}

interface StepDrag {
  from: number;
  to: number;
  x: number;
  y: number;
  active: boolean;
  width: number;
}

export function OperationStepsEditor({
  value,
  onChange,
  disabled = false,
  emptyText = 'Nenhum passo cadastrado. Adicione os passos de operação deste equipamento.'
}: Props) {
  // Painéis de foto abertos, por chave da linha (sobrevive a reordenar/remover).
  const [openPhotos, setOpenPhotos] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement | null>(null);
  const pointerDrag = useRef<StepDrag | null>(null);
  const [reordering, setReordering] = useState<StepDrag | null>(null);
  const [announcement, setAnnouncement] = useState('');

  function update(key: string, patch: Partial<OperationStepDraft>) {
    onChange(value.map(step => (step.key === key ? { ...step, ...patch } : step)));
  }

  function togglePhotos(key: string) {
    setOpenPhotos(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function updateDragTarget(x: number, y: number) {
    const drag = pointerDrag.current;
    if (!drag) return;
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-operation-step-index]');
    drag.to = row && listRef.current?.contains(row) ? Number(row.dataset.operationStepIndex) : -1;
    drag.x = x;
    drag.y = y;
    setReordering({ ...drag });
  }

  function cancelDrag() {
    pointerDrag.current = null;
    setReordering(null);
  }

  function reorder(from: number, to: number) {
    if (disabled || from === to || to < 0 || to >= value.length) return;
    onChange(moveUpload(value, from, to));
    setAnnouncement(`Passo movido para a posição ${to + 1} de ${value.length}.`);
  }

  // Passos longos exigem rolar durante o arrasto: rola o contêiner sob o mouse/dedo nas bordas.
  const dragActive = Boolean(reordering);
  const dragFrame = useRef<() => void>(() => {});
  dragFrame.current = () => {
    const drag = pointerDrag.current;
    if (!drag?.active) return;
    const edge = 64;
    const distance = drag.y < edge ? drag.y - edge : drag.y > window.innerHeight - edge ? drag.y - window.innerHeight + edge : 0;
    if (!distance) return;
    let scroller: HTMLElement | null = listRef.current?.parentElement || null;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    (scroller || document.scrollingElement)?.scrollBy(0, Math.sign(distance) * Math.min(18, Math.abs(distance) / 3));
    updateDragTarget(drag.x, drag.y);
  };
  useEffect(() => {
    if (!dragActive) return undefined;
    let frame: number;
    const tick = () => { dragFrame.current(); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragActive]);

  return (
    <div className="checklist-items-editor operation-steps-editor" ref={listRef}>
      {value.length === 0 && <p className="rel-meta">{emptyText}</p>}
      {value.length > 1 && !disabled ? (
        <p className="upload-order-help">Arraste pelo ícone para reordenar os passos. Use as setas do teclado com o ícone selecionado.</p>
      ) : null}
      <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
      {value.map((step, index) => {
        const photosOpen = openPhotos.has(step.key);
        return (
          <div
            className="checklist-item-editor-row operation-step-row"
            key={step.key}
            data-operation-step
            data-operation-step-index={index}
            data-dragging={reordering?.from === index || undefined}
            data-drop-target={(reordering?.to === index && reordering.from !== index) || undefined}
          >
            <div className="tech-build-main checklist-item-editor-main">
              {(
                <button
                  type="button"
                  className="upload-reorder-handle operation-step-handle"
                  aria-label={`Reordenar passo ${index + 1} de ${value.length}`}
                  title="Arraste para reordenar ou use as setas do teclado"
                  disabled={disabled || value.length < 2}
                  onKeyDown={event => {
                    if (event.key === 'Escape') { cancelDrag(); return; }
                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      reorder(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                    }
                  }}
                  onPointerDown={event => {
                    if (event.button !== 0) return;
                    const row = event.currentTarget.closest<HTMLElement>('[data-operation-step-index]');
                    pointerDrag.current = {
                      from: index, to: index, x: event.clientX, y: event.clientY, active: false,
                      width: Math.min(row?.getBoundingClientRect().width || 280, 360, window.innerWidth - 16)
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={event => {
                    const drag = pointerDrag.current;
                    if (!drag) return;
                    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
                    drag.active = true;
                    updateDragTarget(event.clientX, event.clientY);
                  }}
                  onPointerUp={event => {
                    if (pointerDrag.current?.active) updateDragTarget(event.clientX, event.clientY);
                    const drag = pointerDrag.current;
                    cancelDrag();
                    if (drag?.active) reorder(drag.from, drag.to);
                  }}
                  onPointerCancel={cancelDrag}
                  onLostPointerCapture={cancelDrag}
                >
                  <GripVertical aria-hidden="true" />
                </button>
              )}
              <span className="checklist-item-editor-index">{index + 1}</span>
              <textarea
                className="operation-step-text"
                rows={2}
                value={step.text}
                maxLength={MAX_STEP_LENGTH}
                disabled={disabled}
                placeholder="Descreva o passo (ex.: Conecte as mangueiras ao circuito)"
                aria-label={`Passo ${index + 1}`}
                onChange={event => update(step.key, { text: event.target.value })}
              />
              <div className="checklist-item-editor-actions">
                <Button
                  variant={step.photos.length || photosOpen ? 'primary' : 'secondary'}
                  size="sm"
                  className="checklist-item-editor-action operation-step-camera"
                  aria-label={`Fotos do passo ${index + 1}${step.photos.length ? ` (${step.photos.length})` : ''}`}
                  aria-expanded={photosOpen}
                  title="Adicionar fotos a este passo"
                  disabled={disabled}
                  onClick={() => togglePhotos(step.key)}
                  data-operation-step-camera
                >
                  <Camera aria-hidden="true" size={16} />
                  {step.photos.length ? <span className="operation-step-camera-count">{step.photos.length}</span> : null}
                </Button>
                <RemoveIconButton
                  className="checklist-item-editor-action"
                  label={`Remover passo ${index + 1}`}
                  disabled={disabled}
                  onClick={() => onChange(value.filter(item => item.key !== step.key))}
                />
              </div>
            </div>
            {photosOpen ? (
              <div className="operation-step-photos" data-operation-step-photos>
                <UploadField
                  label=""
                  localOnly
                  appearance="design-system"
                  disabled={disabled || step.photos.length >= MAX_STEP_PHOTOS}
                  value={step.photos}
                  onChange={files => update(step.key, { photos: (files as OperationStepPhoto[]).slice(0, MAX_STEP_PHOTOS) })}
                />
                <p className="rel-meta">As fotos aparecem logo abaixo deste passo no documento (até {MAX_STEP_PHOTOS}).</p>
              </div>
            ) : null}
          </div>
        );
      })}
      <Button variant="secondary" size="sm" className="checklist-item-editor-add" disabled={disabled || value.length >= MAX_STEPS} onClick={() => onChange([...value, emptyStepDraft()])}>
        Adicionar passo
      </Button>
      {reordering?.active && typeof document !== 'undefined' ? createPortal(
        <div
          className="upload-drag-ghost fv-ds"
          aria-hidden="true"
          style={{
            width: reordering.width,
            left: Math.max(8, Math.min(reordering.x + 12, window.innerWidth - reordering.width - 8)),
            top: Math.max(8, Math.min(reordering.y + 12, window.innerHeight - 80))
          }}
        >
          <GripVertical />
          <span>{`${reordering.from + 1}. ${value[reordering.from]?.text.trim() || 'Passo sem texto'}`}</span>
        </div>, document.body
      ) : null}
    </div>
  );
}
