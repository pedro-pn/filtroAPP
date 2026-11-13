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
