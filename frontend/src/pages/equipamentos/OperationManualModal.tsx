import { useState } from 'react';

import type { CompanyEquipment, EquipmentCategory, OperationStepPayload, OperationStoredStep } from '../../api/equipamentos';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/ds';
import { formatTimestampDate } from '../../utils/dateOnly';
import { OperationStepsEditor } from './OperationStepsEditor';
import { newStepKey, type OperationStepDraft } from './operationSteps';

interface OperationManualModalProps {
  open: boolean;
  category: EquipmentCategory;
  equipment: CompanyEquipment;
  isManager: boolean;
  saving: boolean;
  onClose: () => void;
  /** Lista vazia = o equipamento volta a herdar o modelo da categoria. */
  onSave: (steps: OperationStepPayload[]) => void;
  onRegenerate: () => void;
}

function toDrafts(steps: OperationStoredStep[] | null | undefined, equipment: CompanyEquipment | null): OperationStepDraft[] {
  const photosById = new Map((equipment?.operationPhotos || []).map(photo => [photo.id, photo]));
  return (steps || []).map(step => {
    const text = typeof step === 'string' ? step : step.text;
    const photoIds = typeof step === 'string' ? [] : step.photoIds || [];
    return {
      key: newStepKey(),
      text,
      photos: photoIds.flatMap(id => {
        const photo = photosById.get(id);
        return photo ? [{ label: 'Foto', fileName: photo.fileName, mimeType: photo.mimeType, url: photo.publicUrl, attachmentId: photo.id }] : [];
      })
    };
  });
}

// Assinatura para detectar alterações (texto, ordem e fotos) sem comparar dataURLs inteiros.
function signature(steps: OperationStepDraft[]) {
  return JSON.stringify(
    steps
      .map(step => [step.text.trim(), step.photos.map(photo => photo.attachmentId || `new:${photo.fileName}:${photo.url.length}`)] as const)
      .filter(([text]) => text)
  );
}

function toPayload(steps: OperationStepDraft[]): OperationStepPayload[] {
  return steps
    .map(step => ({ ...step, text: step.text.trim() }))
    .filter(step => step.text)
    .map(step => (step.photos.length
      ? {
          text: step.text,
          photos: step.photos.map(photo => (photo.attachmentId
            ? { id: photo.attachmentId }
            : { fileName: photo.fileName, mimeType: photo.mimeType, dataUrl: photo.url }))
        }
      : step.text));
}

export function OperationManualModal({ open, category, equipment, isManager, saving, onClose, onSave, onRegenerate }: OperationManualModalProps) {
  const ownSteps = Array.isArray(equipment.operationSteps) && equipment.operationSteps.length ? equipment.operationSteps : null;
  const [categoryDrafts] = useState(() => toDrafts(category.operationSteps, null));
  const [hasOverride, setHasOverride] = useState(ownSteps !== null);
  const [steps, setSteps] = useState<OperationStepDraft[]>(() => (ownSteps ? toDrafts(ownSteps, equipment) : categoryDrafts));
  const [savedSignature] = useState(() => signature(ownSteps ? toDrafts(ownSteps, equipment) : categoryDrafts));

  const shownSteps = hasOverride ? steps : categoryDrafts;
  const manual = equipment.operationManual || null;
  const changed = signature(shownSteps) !== savedSignature || (hasOverride && ownSteps === null && signature(steps) !== signature(categoryDrafts));
  const hasAnySteps = shownSteps.some(step => step.text.trim());
  // Foto sem texto no passo se perderia ao salvar: bloqueia e avisa.
  const hasPhotoWithoutText = shownSteps.some(step => !step.text.trim() && step.photos.length > 0);

  function handleSave() {
    // Sem edição própria (ou lista esvaziada) → herda o modelo da categoria.
    onSave(hasOverride ? toPayload(steps) : []);
  }

  function restoreCategoryModel() {
    setHasOverride(false);
    setSteps(categoryDrafts);
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      appearance="design-system"
      title="Manual de Operação"
      size="lg"
      panelClassName="equip-entity-modal equip-operation-modal"
      closeOnBackdrop={false}
      showCloseButton={!saving}
      closeOnEscape={!saving}
      footer={isManager ? (
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Fechar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={hasPhotoWithoutText || (!hasAnySteps && !hasOverride && ownSteps === null)} data-equip-manual-save>
            Salvar e gerar PDF
          </Button>
        </>
      ) : (
        <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
      )}
    >
      <div className="equip-modal-head">
        <p className="equip-entity-subtitle">{equipment.code} — {equipment.name}</p>
      </div>

      <div className="equip-operation-body">
      <div className="equip-toggle-block" data-equip-manual-source>
        <div className="admin-toolbar">
          <div>
            <div className="sec">Passo a passo</div>
            <div className="rel-meta">
              {hasOverride
                ? 'Passos próprios deste equipamento'
                : categoryDrafts.length
                  ? `Modelo da categoria ${category.name}`
                  : 'Nenhum passo cadastrado'}
              {' · '}Revisão {equipment.operationRevision ?? 0}
            </div>
          </div>
          {isManager && (
            <Button variant="secondary" size="sm" disabled={!hasOverride || saving} onClick={restoreCategoryModel}>
              Usar modelo da categoria
            </Button>
          )}
        </div>

        {isManager ? (
          <OperationStepsEditor
            value={shownSteps}
            disabled={saving}
            onChange={items => {
              setHasOverride(true);
              setSteps(items);
            }}
          />
        ) : shownSteps.length ? (
          <ol className="equip-operation-steps">
            {shownSteps.map(step => (
              <li key={step.key}>
                {step.text}
                {step.photos.length ? (
                  <div className="equip-operation-steps__photos">
                    {step.photos.map(photo => <img key={photo.attachmentId || photo.url} src={photo.url} alt="" loading="lazy" />)}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="rel-meta">Nenhum passo cadastrado.</p>
        )}
      </div>

      <div className="equip-toggle-block" data-equip-manual-pdf>
        <div className="admin-toolbar">
          <div>
            <div className="sec">Documento PDF</div>
            <div className="rel-meta">
              {manual
                ? `Gerado em ${formatTimestampDate(manual.createdAt)}${equipment.operationManualOutdated ? ' · desatualizado' : ''}`
                : 'Ainda não gerado'}
            </div>
          </div>
          <div className="checklist-item-editor-actions">
            {manual && (
              <a className="fv-button fv-button--secondary fv-button--sm" href={manual.publicUrl} target="_blank" rel="noreferrer" data-equip-manual-link>
                Abrir PDF
              </a>
            )}
            {isManager && manual && equipment.operationManualOutdated && !changed && (
              <Button variant="primary" size="sm" loading={saving} onClick={onRegenerate}>Atualizar PDF</Button>
            )}
          </div>
        </div>
        {isManager && hasPhotoWithoutText && <p className="inline-error">Há passos com foto e sem texto. Descreva o passo ou remova as fotos para salvar.</p>}
        {isManager && changed && <p className="rel-meta">Há alterações não salvas — o PDF só é atualizado ao salvar.</p>}
      </div>
      </div>
    </Modal>
  );
}
