import { randomUUID } from 'node:crypto';

import prisma from '../src/lib/prisma.js';
import {
  LEGACY_FIELD_SCHEMAS,
  MANOMETER_SYSTEMKEY,
  PARTICLE_COUNTER_SYSTEMKEY,
  SEED_NEW_CATEGORIES,
  unitSystemKey
} from '../src/lib/equipment-categories.js';
import { syncRomaneioCatalog } from '../src/lib/romaneio-catalog.js';

const dryRun = process.argv.includes('--dry-run');
const help = process.argv.includes('--help') || process.argv.includes('-h');

if (help) {
  console.log(`Uso: npm run backfill:equipment -- [opcoes]

Migra os equipamentos das tabelas legadas (Unit, Manometer, ParticleCounter)
e seus certificados de calibração para o módulo Equipamentos (CompanyEquipment).
É idempotente: registros já migrados (mesmo code) são pulados.

Opcoes:
  --dry-run   Mostra o que seria criado sem alterar o banco
  --help, -h  Mostra esta ajuda
`);
  process.exit(0);
}

const stats = {
  categoriesCreated: 0,
  equipmentCreated: 0,
  equipmentSkipped: 0,
  attachmentsCreated: 0
};

async function ensureCategory({ systemKey, name, fieldSchema = [], supportsCalibration = false, supportsTechnicalDoc = true, syncToRomaneio = false, isSystemManaged = false, order = 0 }) {
  const existing = await prisma.equipmentCategory.findUnique({ where: { systemKey } });
  if (existing) return existing;
  if (dryRun) {
    stats.categoriesCreated += 1;
    return { id: `dry:${systemKey}`, systemKey, name };
  }
  const created = await prisma.equipmentCategory.create({
    data: { systemKey, name, fieldSchema, supportsCalibration, supportsTechnicalDoc, syncToRomaneio, isSystemManaged, order }
  });
  stats.categoriesCreated += 1;
  return created;
}

function humanizeUnitCategory(category) {
  const map = {
    FILTRAGEM: 'Unidades de Filtragem',
    FLUSHING: 'Unidades de Flushing',
    LIMPEZA_QUIMICA: 'Unidades de Limpeza Química',
    DESIDRATACAO: 'Unidades de Desidratação',
    UTH: 'Unidades UTH',
    OUTRA: 'Outras Unidades'
  };
  return map[category] || category;
}

async function migrateEquipment({ category, code, name, attributes, hasCalibration, calibratedAt, expiresAt }) {
  const existing = await prisma.companyEquipment.findUnique({ where: { code } });
  if (existing) {
    stats.equipmentSkipped += 1;
    return existing;
  }
  if (dryRun) {
    stats.equipmentCreated += 1;
    return { id: `dry:${code}` };
  }
  const created = await prisma.companyEquipment.create({
    data: {
      code,
      name: name || code,
      categoryId: category.id,
      attributes,
      hasCalibration,
      calibratedAt: hasCalibration ? calibratedAt : null,
      expiresAt: hasCalibration ? expiresAt : null,
      hasTechnicalDoc: false
    }
  });
  stats.equipmentCreated += 1;
  return created;
}

// Reaproveita o arquivo de certificado existente em disco (mesmo storagePath),
// apenas criando o registro EquipmentAttachment com um novo publicToken.
async function migrateCertificate(equipmentId, certificate) {
  if (!certificate) return;
  if (dryRun) {
    stats.attachmentsCreated += 1;
    return;
  }
  await prisma.equipmentAttachment.create({
    data: {
      equipmentId,
      kind: 'CALIBRATION_CERTIFICATE',
      fileName: certificate.fileName,
      mimeType: certificate.mimeType || 'application/pdf',
      storagePath: certificate.storagePath,
      publicToken: randomUUID()
    }
  });
  stats.attachmentsCreated += 1;
}

async function latestCertificateFor(where) {
  return prisma.calibrationCertificate.findFirst({
    where,
    orderBy: { createdAt: 'desc' }
  });
}

async function main() {
  console.log(`[backfill-equipment] inicio${dryRun ? ' (dry-run)' : ''}`);

  // 1) Categorias novas pedidas pelo usuário (Trafo, gerador, turbidímetro, phmetro, contador).
  let order = 100;
  for (const seed of SEED_NEW_CATEGORIES) {
    await ensureCategory({ ...seed, order: order++ });
  }

  // 2) Manômetros.
  const manometerCategory = await ensureCategory({
    systemKey: MANOMETER_SYSTEMKEY,
    name: 'Manômetros',
    fieldSchema: LEGACY_FIELD_SCHEMAS.manometer,
    supportsCalibration: true,
    syncToRomaneio: false,
    isSystemManaged: true,
    order: 1
  });
  const manometers = await prisma.manometer.findMany();
  for (const m of manometers) {
    const equipment = await migrateEquipment({
      category: manometerCategory,
      code: m.code,
      name: `Manômetro ${m.code}`,
      attributes: { scale: m.scale || '', calibrationCertCode: m.calibrationCertCode || '' },
      hasCalibration: true,
      calibratedAt: m.calibratedAt,
      expiresAt: m.expiresAt
    });
    const cert = await latestCertificateFor({ manometerId: m.id });
    await migrateCertificate(equipment.id, cert);
  }

  // 3) Contadores de partículas (preservando a subcategoria original como atributo).
  const counterCategory = await ensureCategory({
    systemKey: PARTICLE_COUNTER_SYSTEMKEY,
    name: 'Contadores de Partículas',
    fieldSchema: LEGACY_FIELD_SCHEMAS.particle_counter,
    supportsCalibration: true,
    syncToRomaneio: true,
    isSystemManaged: true,
    order: 2
  });
  const counters = await prisma.particleCounter.findMany();
  for (const c of counters) {
    const equipment = await migrateEquipment({
      category: counterCategory,
      code: c.code,
      name: `Contador de partículas ${c.serialNumber || c.code}`,
      attributes: { serialNumber: c.serialNumber || '', subCategory: c.category || 'CONTADOR DE PARTICULAS' },
      hasCalibration: true,
      calibratedAt: c.calibratedAt,
      expiresAt: c.expiresAt
    });
    const cert = await latestCertificateFor({ particleCounterId: c.id });
    await migrateCertificate(equipment.id, cert);
  }

  // 4) Unidades — uma categoria por categoria legada distinta.
  const units = await prisma.unit.findMany();
  const unitCategories = Array.from(new Set(units.map(u => String(u.category || '').trim()).filter(Boolean)));
  const unitCategoryByName = new Map();
  let unitOrder = 10;
  for (const legacy of unitCategories) {
    const category = await ensureCategory({
      systemKey: unitSystemKey(legacy),
      name: humanizeUnitCategory(legacy),
      fieldSchema: LEGACY_FIELD_SCHEMAS.unit,
      supportsCalibration: false,
      syncToRomaneio: true,
      isSystemManaged: true,
      order: unitOrder++
    });
    unitCategoryByName.set(legacy, category);
  }
  for (const u of units) {
    const legacy = String(u.category || '').trim();
    const category = unitCategoryByName.get(legacy);
    if (!category) continue;
    await migrateEquipment({
      category,
      code: u.code,
      name: u.name || u.code,
      attributes: {},
      hasCalibration: false,
      calibratedAt: null,
      expiresAt: null
    });
  }

  // Limpeza única: desativa itens de catálogo de romaneio sincronizados das
  // tabelas antigas (UNIT/PARTICLE_COUNTER); a nova fonte é EQUIPAMENTOS.
  if (!dryRun) {
    const deactivated = await prisma.romaneioCatalogItem.updateMany({
      where: { sourceType: { in: ['UNIT', 'PARTICLE_COUNTER'] }, isActive: true },
      data: { isActive: false }
    });
    stats.legacyCatalogDeactivated = deactivated.count;
    await syncRomaneioCatalog();
  }

  console.log(JSON.stringify({ dryRun, ...stats }, null, 2));
}

main()
  .catch(error => {
    console.error('[backfill-equipment] erro', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
