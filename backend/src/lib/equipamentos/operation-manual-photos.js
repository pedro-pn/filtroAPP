// Fotos dos passos do Manual de Operação.
//
// Os passos chegam do formulário como texto puro ou { text, photos }, onde cada foto é uma já salva
// ({ id }) ou nova (dataURL). Este módulo grava as novas, reaproveita as já salvas do mesmo dono
// (equipamento ou categoria) e, quando um equipamento passa a ter passos próprios a partir do modelo
// da categoria, COPIA as fotos do modelo para o equipamento (independentes da original).

import {
  EquipmentAttachmentKinds,
  cloneOperationPhotoToEquipment,
  createEquipmentPhoto,
  removeAttachmentsOfOwner
} from '../equipment-attachments.js';
import { normalizeOperationStepItems } from './operation-manual.js';

const PHOTO_KIND = EquipmentAttachmentKinds.OPERATION_MANUAL_PHOTO;

// Resolve os passos para itens { text, photoIds } com as fotos gravadas para o dono informado.
// - dono equipamento: { equipmentId, categoryId } (categoryId = origem das fotos copiáveis do modelo);
// - dono categoria:   { categoryId }.
export async function resolveOperationStepItems(client, { equipmentId = null, categoryId = null, steps }) {
  const ownerIsEquipment = Boolean(equipmentId);
  const ownerWhere = ownerIsEquipment ? { equipmentId } : { categoryId };
  const ownRows = await client.equipmentAttachment.findMany({
    where: { ...ownerWhere, kind: PHOTO_KIND }
  });
  const ownById = new Map(ownRows.map(row => [row.id, row]));
  const templateRows = ownerIsEquipment && categoryId
    ? await client.equipmentAttachment.findMany({ where: { categoryId, kind: PHOTO_KIND } })
    : [];
  const templateById = new Map(templateRows.map(row => [row.id, row]));
  // Uma mesma foto do modelo usada em dois passos do equipamento vira uma única cópia.
  const clonedFromTemplate = new Map();

  const draft = [];
  for (const raw of steps) {
    const text = typeof raw === 'string' ? raw : raw.text;
    const photoIds = [];
    for (const photo of (typeof raw === 'string' ? [] : raw.photos || [])) {
      if ('id' in photo) {
        if (ownById.has(photo.id)) {
          photoIds.push(photo.id);
        } else if (templateById.has(photo.id)) {
          if (!clonedFromTemplate.has(photo.id)) {
            // eslint-disable-next-line no-await-in-loop
            const copy = await cloneOperationPhotoToEquipment(client, templateById.get(photo.id), equipmentId);
            clonedFromTemplate.set(photo.id, copy?.id || null);
          }
          const copyId = clonedFromTemplate.get(photo.id);
          if (copyId) photoIds.push(copyId);
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        const created = await createEquipmentPhoto(client, {
          equipmentId: ownerIsEquipment ? equipmentId : null,
          categoryId: ownerIsEquipment ? null : categoryId,
          upload: photo,
          kind: PHOTO_KIND
        });
        if (created) photoIds.push(created.id);
      }
    }
    draft.push({ text, photoIds });
  }
  return normalizeOperationStepItems(draft);
}

// Apaga as fotos do dono que nenhum passo referencia mais.
export async function pruneOperationPhotos(client, owner, items) {
  return removeAttachmentsOfOwner(client, owner, PHOTO_KIND, {
    exceptIds: items.flatMap(item => item.photoIds)
  });
}
