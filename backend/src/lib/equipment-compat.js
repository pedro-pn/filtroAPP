// Camada de compatibilidade: projeta o modelo unificado (CompanyEquipment)
// de volta para as formas legadas consumidas pelo RDO (Unit/Manometer/ParticleCounter),
// para que os formulários de relatório continuem funcionando sem alterações.

import prisma from './prisma.js';
import { serializeEquipmentAttachment } from './equipment-attachments.js';
import {
  MANOMETER_SYSTEMKEY,
  PARTICLE_COUNTER_SYSTEMKEY,
  UNIT_SYSTEMKEY_PREFIX,
  legacyUnitCategory
} from './equipment-categories.js';
import { equipmentSerialNumber } from './equipment-attributes.js';

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

async function loadByCategoryPrefix(prefix, { exact = false } = {}) {
  return prisma.companyEquipment.findMany({
    where: {
      isActive: true,
      category: exact
        ? { systemKey: prefix }
        : { systemKey: { startsWith: prefix } }
    },
    include: { category: true, attachments: { orderBy: { createdAt: 'desc' } } },
    orderBy: [{ code: 'asc' }]
  });
}

export async function listUnitsCompat() {
  const items = await loadByCategoryPrefix(UNIT_SYSTEMKEY_PREFIX);
  return items
    .map(item => ({
      id: item.id,
      code: item.code,
      name: item.name,
      category: legacyUnitCategory(item.category.systemKey) || item.category.name,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
    .sort((a, b) => `${a.category}${a.name}${a.code}`.localeCompare(`${b.category}${b.name}${b.code}`, 'pt-BR'));
}

export async function listManometersCompat() {
  const items = await loadByCategoryPrefix(MANOMETER_SYSTEMKEY, { exact: true });
  return items.map(item => ({
    id: item.id,
    code: item.code,
    scale: attrs(item).scale || '',
    calibrationCertCode: attrs(item).calibrationCertCode || '',
    calibratedAt: item.calibratedAt,
    expiresAt: item.expiresAt,
    isActive: item.isActive,
    currentCalibrationCertificate: latestCertificate(item)
  }));
}

export async function listParticleCountersCompat() {
  const items = await loadByCategoryPrefix(PARTICLE_COUNTER_SYSTEMKEY, { exact: true });
  return items.map(item => ({
    id: item.id,
    code: item.code,
    serialNumber: equipmentSerialNumber(item),
    category: attrs(item).subCategory || item.category.name,
    calibratedAt: item.calibratedAt,
    expiresAt: item.expiresAt,
    isActive: item.isActive,
    currentCalibrationCertificate: latestCertificate(item)
  }));
}

// Lista unificada e enxuta de equipamentos ativos para o formulário de RDO
// (filtrada por categoria via rdoSlotMap no frontend).
export async function listRdoEquipments() {
  const items = await prisma.companyEquipment.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, categoryId: true, attributes: true, calibratedAt: true, expiresAt: true },
    orderBy: [{ code: 'asc' }]
  });
  return items.map(item => {
    const attributes = attrs(item);
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      categoryId: item.categoryId,
      serialNumber: equipmentSerialNumber(item),
      scale: attributes.scale || '',
      isActive: true
    };
  });
}

export const MODULE_MANAGED_MESSAGE = 'Equipamento gerenciado pelo módulo Equipamentos. Edite-o no módulo Equipamentos.';

export function respondManagedByModule(_req, res) {
  return res.status(409).json({ error: MODULE_MANAGED_MESSAGE });
}
