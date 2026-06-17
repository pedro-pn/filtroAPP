// Resolve IDs de equipamento selecionados no formulário de RDO contra o modelo
// unificado (CompanyEquipment), substituindo as antigas buscas em Unit/Manometer/
// ParticleCounter. Retorna formas compatíveis com o que os geradores de relatório
// já consomem (code, scale, serialNumber, currentCalibrationCertificate).

import { equipmentAttachmentsInclude, serializeEquipmentAttachment } from './equipment-attachments.js';

function attrs(item) {
  return item && typeof item.attributes === 'object' && item.attributes ? item.attributes : {};
}

function latestCertificate(item) {
  const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
  const cert = attachments
    .filter(att => att.kind === 'CALIBRATION_CERTIFICATE')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  return serializeEquipmentAttachment(cert || null);
}

function orderByIds(ids, items) {
  const byId = new Map(items.map(item => [item.id, item]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

// Unidades: o relatório usa apenas `.code`.
export async function resolveReportUnits(client, ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return [];
  const items = await client.companyEquipment.findMany({ where: { id: { in: list } } });
  return orderByIds(list, items);
}

// Manômetros: forma legada usada em report-rtp e na montagem do specialConditions.
export async function resolveReportManometers(client, ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return [];
  const items = await client.companyEquipment.findMany({
    where: { id: { in: list } },
    include: equipmentAttachmentsInclude
  });
  return orderByIds(list, items).map(item => ({
    id: item.id,
    code: item.code,
    scale: attrs(item).scale || '',
    calibrationCertCode: attrs(item).calibrationCertCode || '',
    calibratedAt: item.calibratedAt,
    expiresAt: item.expiresAt,
    currentCalibrationCertificate: latestCertificate(item)
  }));
}

// Contador de partículas: { code, serialNumber, currentCalibrationCertificate }.
export async function resolveReportCounter(client, id) {
  if (!id) return null;
  const item = await client.companyEquipment.findUnique({
    where: { id },
    include: equipmentAttachmentsInclude
  });
  if (!item) return null;
  return {
    id: item.id,
    code: item.code,
    serialNumber: attrs(item).serialNumber || '',
    currentCalibrationCertificate: latestCertificate(item)
  };
}
