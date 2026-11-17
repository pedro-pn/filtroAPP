import type { EquipmentAttachment, OperationStepPayload, OperationStoredStep } from '../../api/equipamentos';
import type { UploadedFile } from '../../api/uploads';

export const MAX_STEPS = 100;
export const MAX_STEP_LENGTH = 1000;
export const MAX_STEP_PHOTOS = 10;

/** Foto de um passo: `attachmentId` quando já salva no servidor; sem ele, `url` é um dataURL novo. */
export type OperationStepPhoto = UploadedFile & { attachmentId?: string };

export interface OperationStepDraft {
  /** Identidade estável da linha (reordenar/remover não pode trocar o estado de fotos aberto). */
  key: string;
  text: string;
  photos: OperationStepPhoto[];
}

let draftCounter = 0;
export function newStepKey() {
  draftCounter += 1;
  return `step-${Date.now().toString(36)}-${draftCounter}`;
}

export function emptyStepDraft(): OperationStepDraft {
  return { key: newStepKey(), text: '', photos: [] };
}

/** Monta os rascunhos de edição a partir dos passos gravados e das fotos do dono (equipamento ou categoria). */
export function toDrafts(steps: OperationStoredStep[] | null | undefined, photos: EquipmentAttachment[] | undefined): OperationStepDraft[] {
  const photosById = new Map((photos || []).map(photo => [photo.id, photo]));
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

/** Assinatura para detectar alterações (texto, ordem e fotos) sem comparar dataURLs inteiros. */
export function signature(steps: OperationStepDraft[]) {
  return JSON.stringify(
    steps
      .map(step => [step.text.trim(), step.photos.map(photo => photo.attachmentId || `new:${photo.fileName}:${photo.url.length}`)] as const)
      .filter(([text]) => text)
  );
}

/** Passos prontos para enviar: texto puro ou texto + fotos ({ id } já salva ou dataURL nova). */
export function toPayload(steps: OperationStepDraft[]): OperationStepPayload[] {
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

/** Foto sem texto no passo se perderia ao salvar. */
export function hasPhotoWithoutText(steps: OperationStepDraft[]) {
  return steps.some(step => !step.text.trim() && step.photos.length > 0);
}
