import { Camera } from 'lucide-react';
import { useState } from 'react';

import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { UploadField } from '../../components/ui/UploadField';
import { Button } from '../../components/ui/ds';
import { MAX_STEPS, MAX_STEP_LENGTH, MAX_STEP_PHOTOS, emptyStepDraft, type OperationStepDraft, type OperationStepPhoto } from './operationSteps';

interface Props {
  value: OperationStepDraft[];
  onChange: (steps: OperationStepDraft[]) => void;
  disabled?: boolean;
}

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function OperationStepsEditor({ value, onChange, disabled = false }: Props) {
  // Painéis de foto abertos, por chave da linha (sobrevive a reordenar/remover).
  const [openPhotos, setOpenPhotos] = useState<Set<string>>(() => new Set());

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

  return (
    <div className="checklist-items-editor operation-steps-editor">
      {value.length === 0 && <p className="rel-meta">Nenhum passo cadastrado. Adicione os passos de operação deste equipamento.</p>}
      {value.map((step, index) => {
        const photosOpen = openPhotos.has(step.key);
        return (
          <div className="checklist-item-editor-row operation-step-row" key={step.key} data-operation-step>
            <div className="tech-build-main checklist-item-editor-main">
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
                <Button
                  variant="secondary" size="sm" className="checklist-item-editor-action"
                  aria-label={`Mover passo ${index + 1} para cima`} title="Mover para cima"
                  disabled={disabled || index === 0}
                  onClick={() => onChange(move(value, index, -1))}
                >
                  ↑
                </Button>
                <Button
                  variant="secondary" size="sm" className="checklist-item-editor-action"
                  aria-label={`Mover passo ${index + 1} para baixo`} title="Mover para baixo"
                  disabled={disabled || index === value.length - 1}
                  onClick={() => onChange(move(value, index, 1))}
                >
                  ↓
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
    </div>
  );
}
