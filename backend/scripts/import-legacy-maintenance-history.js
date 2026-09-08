#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { resolveEffectiveMaintenanceProfile } from '../src/lib/operational-reports/domain.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_DATASET = path.resolve(
  path.dirname(__filename),
  'data/legacy-maintenance-history.json'
);
const MAX_MAINTENANCE_PHOTO_BYTES = 15 * 1024 * 1024;

function usage() {
  return [
    'Uso:',
    '  node scripts/import-legacy-maintenance-history.js [opções]',
    '',
    'A execução padrão é uma simulação. Use --apply somente após revisar o resumo.',
    '',
    'Opções:',
    `  --data <arquivo.json>              Padrão: ${DEFAULT_DATASET}`,
    '  --assets-dir <diretório>           Diretório criado pelo downloader',
    '  --database-url <url>               Sobrescreve DATABASE_URL',
    '  --reports-dir <diretório>          Sobrescreve REPORTS_DIR/UPLOAD_DIR',
    '  --actor-user-id <id>               Usuário registrado como autor da importação',
    '  --supervisor-name <nome>            Padrão: Não informado (controle legado)',
    '  --equipment-alias <origem=destino>  Pode ser repetido',
    '  --summary-out <arquivo.json>        Grava o relatório detalhado',
    '  --require-photos                    Exige também todas as fotos antes de aplicar',
    '  --allow-missing-documents           Permite importar sem os PDFs (não recomendado)',
    '  --apply                             Grava no banco e no diretório de relatórios'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    data: DEFAULT_DATASET,
    assetsDir: '',
    databaseUrl: '',
    reportsDir: '',
    actorUserId: '',
    supervisorName: 'Não informado (controle legado)',
    equipmentAliases: new Map(),
    summaryOut: '',
    requirePhotos: false,
    allowMissingDocuments: false,
    apply: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--require-photos') {
      options.requirePhotos = true;
      continue;
    }
    if (arg === '--allow-missing-documents') {
      options.allowMissingDocuments = true;
      continue;
    }
    const value = argv[index + 1];
    if (!arg.startsWith('--') || value == null || value.startsWith('--')) {
      throw new Error(`Argumento inválido: ${arg}`);
    }
    index += 1;
    switch (arg.slice(2)) {
      case 'data':
        options.data = value;
        break;
      case 'assets-dir':
        options.assetsDir = value;
        break;
      case 'database-url':
        options.databaseUrl = value;
        break;
      case 'reports-dir':
        options.reportsDir = value;
        break;
      case 'actor-user-id':
        options.actorUserId = value;
        break;
      case 'supervisor-name':
        options.supervisorName = value;
        break;
      case 'summary-out':
        options.summaryOut = value;
        break;
      case 'equipment-alias': {
        const separator = value.indexOf('=');
        if (separator <= 0 || separator === value.length - 1) {
          throw new Error('--equipment-alias deve usar origem=destino.');
        }
        const source = normalizeEquipmentCode(value.slice(0, separator));
        const target = value.slice(separator + 1).trim();
        options.equipmentAliases.set(source, target);
        break;
      }
      default:
        throw new Error(`Opção desconhecida: ${arg}`);
    }
  }
  return options;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeEquipmentCode(value) {
  const compact = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
  const suffix = compact.match(/^([A-Z]+)0*(\d+)$/);
  return suffix ? `${suffix[1]}${Number(suffix[2])}` : compact;
}

function exactEquipmentCode(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function stableId(prefix, sourceKey) {
  const digest = crypto
    .createHash('sha256')
    .update(String(sourceKey))
    .digest('hex')
    .slice(0, 28);
  return `${prefix}-${digest}`;
}

function maintenanceRecordId(record) {
  return stableId('legacy-maint', record.sourceKey);
}

function maintenanceAuditId(record) {
  return stableId('legacy-maint-audit', record.sourceKey);
}

function dateValue(dateKey) {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

function formatDateForFile(dateKey) {
  const [year, month, day] = dateKey.split('-');
  return `${day}-${month}-${year}`;
}

function safeFileName(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\n\r]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function documentFileName(record, equipment) {
  return safeFileName(
    `Manutenção ${equipment.code} - ${formatDateForFile(record.maintenanceDate)}.pdf`,
    `Manutenção-${record.sourceRow}.pdf`
  );
}

function imageMimeType(filePath, indexedMimeType = '') {
  const allowed = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]);
  if (allowed.has(indexedMimeType)) return indexedMimeType;
  const extension = path.extname(filePath).toLowerCase();
  const byExtension = new Map([
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.webp', 'image/webp'],
    ['.heic', 'image/heic'],
    ['.heif', 'image/heif']
  ]);
  return byExtension.get(extension) || '';
}

function pathInside(root, child) {
  const rootPath = path.resolve(root);
  const childPath = path.resolve(root, child);
  if (childPath !== rootPath && !childPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error(`Caminho de arquivo inválido no índice: ${child}`);
  }
  return childPath;
}

async function loadAssetIndex(assetsDir) {
  const assets = new Map();
  if (!assetsDir) return assets;
  const root = path.resolve(assetsDir);
  const indexPath = path.join(root, 'assets-index.json');
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    for (const asset of parsed.assets || []) {
      const filePath = pathInside(root, asset.localFileName);
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat?.isFile() && stat.size > 0) {
        assets.set(asset.driveFileId, {
          ...asset,
          filePath,
          size: stat.size
        });
      }
    }
    return assets;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  for (const name of await fs.readdir(root)) {
    const filePath = path.join(root, name);
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || name === 'assets-index.json') continue;
    const driveFileId = path.parse(name).name;
    if (!/^[A-Za-z0-9_-]{15,}$/.test(driveFileId)) continue;
    assets.set(driveFileId, {
      driveFileId,
      localFileName: name,
      originalName: name,
      mimeType: '',
      filePath,
      size: stat.size
    });
  }
  return assets;
}

function indexEquipment(equipment) {
  const index = new Map();
  for (const item of equipment) {
    const code = normalizeEquipmentCode(item.code);
    const current = index.get(code) || [];
    current.push(item);
    index.set(code, current);
  }
  return index;
}

function resolveEquipment(record, equipmentIndex, aliases = new Map()) {
  const sourceCode = normalizeEquipmentCode(record.equipmentCode);
  const alias = aliases.get(sourceCode);
  const requestedCode = alias || record.equipmentCode;
  const targetCode = normalizeEquipmentCode(requestedCode);
  const matches = equipmentIndex.get(targetCode) || [];
  const exactCode = exactEquipmentCode(requestedCode);
  const exactMatches = matches.filter(
    (item) => exactEquipmentCode(item.code) === exactCode
  );
  if (exactMatches.length === 1) {
    return {
      status: 'matched',
      equipment: exactMatches[0],
      strategy: alias ? 'alias-exact-code' : 'exact-code'
    };
  }
  if (matches.length === 1) {
    return {
      status: 'matched',
      equipment: matches[0],
      strategy: alias ? 'alias' : 'normalized-code'
    };
  }
  return {
    status: matches.length ? 'ambiguous' : 'missing',
    candidates: matches.map((item) => ({ id: item.id, code: item.code, name: item.name })),
    targetCode,
    strategy: alias ? 'alias' : 'normalized-code'
  };
}

function effectiveProfileSnapshots(record, equipment) {
  const profile = resolveEffectiveMaintenanceProfile(equipment);
  const itemsByLabel = new Map(
    (profile?.items || []).map((item) => [normalizeText(item.label), item])
  );
  return {
    profileId: profile?.id || null,
    profileName: profile?.name || 'Controle legado',
    selectedServices: record.selectedServices.map((service, index) => {
      const current = itemsByLabel.get(normalizeText(service.label));
      return {
        ...(current?.id ? { itemId: current.id } : {}),
        label: service.label,
        order: index + 1
      };
    })
  };
}

function existingPhotoDriveIds(attachments) {
  const ids = new Set();
  for (const attachment of attachments || []) {
    if (attachment.kind !== 'PHOTO') continue;
    const match = attachment.fileName.match(/^legacy-drive-([A-Za-z0-9_-]+)\./);
    if (match) ids.add(match[1]);
  }
  return ids;
}

async function verifyDocumentAsset(asset) {
  if (!asset) return { valid: false, reason: 'arquivo ausente' };
  const handle = await fs.open(asset.filePath, 'r');
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 5 || header.toString() !== '%PDF-') {
      return { valid: false, reason: 'conteúdo não é PDF' };
    }
  } finally {
    await handle.close();
  }
  return { valid: true };
}

async function prepareImport({
  dataset,
  equipment,
  existingRecords,
  assets,
  options
}) {
  const equipmentIndex = indexEquipment(equipment);
  const existingById = new Map(existingRecords.map((record) => [record.id, record]));
  const prepared = [];
  const blockers = [];
  const warnings = [];

  for (const source of dataset.records || []) {
    const id = maintenanceRecordId(source);
    const match = resolveEquipment(source, equipmentIndex, options.equipmentAliases);
    if (match.status !== 'matched') {
      blockers.push({
        type: `equipment-${match.status}`,
        sourceRow: source.sourceRow,
        equipmentCode: source.equipmentCode,
        candidates: match.candidates || []
      });
      prepared.push({ id, source, match });
      continue;
    }

    const existing = existingById.get(id) || null;
    if (existing && existing.equipmentId !== match.equipment.id) {
      blockers.push({
        type: 'existing-record-equipment-mismatch',
        sourceRow: source.sourceRow,
        equipmentCode: source.equipmentCode,
        currentEquipmentId: existing.equipmentId,
        expectedEquipmentId: match.equipment.id
      });
      prepared.push({ id, source, match, existing });
      continue;
    }

    const documentAttachment = existing?.attachments?.find(
      (attachment) => attachment.kind === 'DOCUMENT'
    );
    const documentAsset = source.document
      ? assets.get(source.document.driveFileId) || null
      : null;
    let documentReady = Boolean(documentAttachment);
    if (source.document && !documentAttachment) {
      const verification = await verifyDocumentAsset(documentAsset);
      documentReady = verification.valid;
      if (!verification.valid) {
        const issue = {
          type: 'document-missing-or-invalid',
          sourceRow: source.sourceRow,
          driveFileId: source.document.driveFileId,
          reason: verification.reason
        };
        if (options.allowMissingDocuments) warnings.push(issue);
        else blockers.push(issue);
      }
    }

    const existingPhotoIds = existingPhotoDriveIds(existing?.attachments);
    const photoAssets = (source.photos || []).map((photo) => {
      const asset = assets.get(photo.driveFileId) || null;
      const exists = existingPhotoIds.has(photo.driveFileId);
      const mimeType = asset ? imageMimeType(asset.filePath, asset.mimeType) : '';
      const reason = exists
        ? ''
        : !asset
          ? 'arquivo ausente'
          : !mimeType
            ? 'formato de imagem não suportado'
            : asset.size > MAX_MAINTENANCE_PHOTO_BYTES
              ? 'imagem maior que 15 MB'
              : '';
      return {
        ...photo,
        asset,
        exists,
        mimeType,
        valid: exists || !reason,
        reason
      };
    });
    for (const photo of photoAssets) {
      const { reason } = photo;
      if (!reason) continue;
      const issue = {
        type: 'photo-missing-or-invalid',
        sourceRow: source.sourceRow,
        driveFileId: photo.driveFileId,
        reason
      };
      if (options.requirePhotos) blockers.push(issue);
      else warnings.push(issue);
    }

    prepared.push({
      id,
      source,
      match,
      existing,
      documentAttachment,
      documentAsset,
      documentReady,
      photoAssets
    });
  }
  return { prepared, blockers, warnings };
}

function recordCreateData(item, options, actor) {
  const { source, match } = item;
  const snapshots = effectiveProfileSnapshots(source, match.equipment);
  const timestamp = dateValue(source.maintenanceDate);
  const sourceNote = (
    `Importado do controle legado. Planilha: ${source.sourceKey}.`
  );
  return {
    id: item.id,
    reportId: null,
    equipmentId: match.equipment.id,
    profileId: snapshots.profileId,
    maintenanceDate: timestamp,
    status: 'APPROVED',
    createdByUserId: actor?.id || null,
    reviewedByUserId: actor?.id || null,
    responsibleNameSnapshot: source.responsibleName,
    profileNameSnapshot: snapshots.profileName,
    selectedServices: snapshots.selectedServices,
    observations: source.observations || null,
    reviewNotes: sourceNote,
    supervisorNameSnapshot: options.supervisorName,
    supervisorSignatureSnapshot: null,
    approvedAt: timestamp,
    returnedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    thirdPartyServices: {
      create: (source.thirdPartyServices || []).map((service) => ({
        serviceDate: dateValue(service.serviceDate),
        location: service.location,
        description: service.description,
        order: service.order
      }))
    },
    reviewAudits: {
      create: {
        id: maintenanceAuditId(source),
        actorUserId: actor?.id || null,
        actorNameSnapshot: actor?.name || 'Importação do controle legado',
        previousStatus: 'PENDING',
        nextStatus: 'APPROVED',
        notes: sourceNote,
        createdAt: timestamp
      }
    }
  };
}

async function attachAssets({
  prisma,
  item,
  createMaintenanceDocument,
  createMaintenancePhoto,
  cleanupMaintenanceStoragePaths
}) {
  const createdAttachments = [];
  try {
    if (
      item.source.document
      && !item.documentAttachment
      && item.documentAsset
      && item.documentReady
    ) {
      const bytes = await fs.readFile(item.documentAsset.filePath);
      const attachment = await createMaintenanceDocument(prisma, {
        maintenanceId: item.id,
        equipmentCode: item.match.equipment.code,
        fileName: documentFileName(item.source, item.match.equipment),
        bytes
      });
      createdAttachments.push(attachment);
    }

    for (const photo of item.photoAssets || []) {
      if (photo.exists || !photo.asset) continue;
      const mimeType = photo.mimeType;
      if (!photo.valid || !mimeType) continue;
      const bytes = await fs.readFile(photo.asset.filePath);
      const extension = path.extname(photo.asset.filePath) || '.jpg';
      const attachment = await createMaintenancePhoto(prisma, {
        maintenanceId: item.id,
        equipmentCode: item.match.equipment.code,
        upload: {
          fileName: `legacy-drive-${photo.driveFileId}${extension}`,
          mimeType,
          dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`
        }
      });
      createdAttachments.push(attachment);
    }
    return createdAttachments;
  } catch (error) {
    if (createdAttachments.length) {
      await prisma.maintenanceAttachment.deleteMany({
        where: { id: { in: createdAttachments.map((item) => item.id) } }
      });
      await cleanupMaintenanceStoragePaths(
        createdAttachments.map((item) => item.storagePath)
      );
    }
    throw error;
  }
}

async function applyImport({
  prisma,
  prepared,
  options,
  actor,
  attachmentHelpers
}) {
  let recordsCreated = 0;
  let recordsExisting = 0;
  let attachmentsCreated = 0;
  for (const item of prepared) {
    if (item.match.status !== 'matched') continue;
    let createdRecord = false;
    try {
      if (!item.existing) {
        await prisma.maintenanceRecord.create({
          data: recordCreateData(item, options, actor)
        });
        createdRecord = true;
        recordsCreated += 1;
      } else {
        recordsExisting += 1;
      }
      const created = await attachAssets({
        prisma,
        item,
        ...attachmentHelpers
      });
      attachmentsCreated += created.length;
      console.log(
        `[importação] linha ${item.source.sourceRow} -> ${item.match.equipment.code}`
        + (createdRecord ? ' (criada)' : ' (já existia)')
      );
    } catch (error) {
      if (createdRecord) {
        await prisma.maintenanceRecord.delete({ where: { id: item.id } })
          .catch(() => {});
        recordsCreated -= 1;
      }
      throw new Error(
        `Falha na linha ${item.source.sourceRow}: ${error?.message || error}`,
        { cause: error }
      );
    }
  }
  return { recordsCreated, recordsExisting, attachmentsCreated };
}

function summarize({ dataset, prepared, blockers, warnings, mode, result }) {
  const matched = prepared.filter((item) => item.match.status === 'matched');
  const documents = matched.filter((item) => item.source.document);
  const photos = matched.flatMap((item) => item.photoAssets || []);
  return {
    mode,
    source: dataset.source,
    counts: {
      records: dataset.records.length,
      equipmentMatched: matched.length,
      equipmentUnmatched: prepared.length - matched.length,
      recordsNew: matched.filter((item) => !item.existing).length,
      recordsExisting: matched.filter((item) => item.existing).length,
      documentsExpected: documents.length,
      documentsReady: documents.filter(
        (item) => item.documentReady
      ).length,
      documentsAlreadyAttached: documents.filter(
        (item) => item.documentAttachment
      ).length,
      photoReferences: photos.length,
      photosReady: photos.filter((photo) => photo.valid).length,
      photosAlreadyAttached: photos.filter((photo) => photo.exists).length,
      blockers: blockers.length,
      warnings: warnings.length,
      recordsCreated: result?.recordsCreated || 0,
      attachmentsCreated: result?.attachmentsCreated || 0
    },
    readyToApply: blockers.length === 0,
    blockers,
    warnings,
    rows: prepared.map((item) => ({
      sourceRow: item.source.sourceRow,
      recordId: item.id,
      maintenanceDate: item.source.maintenanceDate,
      spreadsheetEquipmentCode: item.source.equipmentCode,
      equipment: item.match.equipment
        ? {
            id: item.match.equipment.id,
            code: item.match.equipment.code,
            name: item.match.equipment.name
          }
        : null,
      matchStatus: item.match.status,
      existing: Boolean(item.existing),
      documentDriveFileId: item.source.document?.driveFileId || null,
      documentReady: Boolean(item.documentReady),
      photoReferences: item.source.photos?.length || 0
    }))
  };
}

function printSummary(summary) {
  const { counts } = summary;
  console.log('');
  console.log(`[resumo] modo=${summary.mode}`);
  console.log(
    `[resumo] registros=${counts.records} novos=${counts.recordsNew} `
    + `existentes=${counts.recordsExisting}`
  );
  console.log(
    `[resumo] equipamentos=${counts.equipmentMatched}/${counts.records} `
    + `PDFs=${counts.documentsReady}/${counts.documentsExpected} `
    + `fotos=${counts.photosReady}/${counts.photoReferences}`
  );
  console.log(
    `[resumo] bloqueios=${counts.blockers} avisos=${counts.warnings} `
    + `pronto=${summary.readyToApply ? 'sim' : 'não'}`
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.databaseUrl) process.env.DATABASE_URL = options.databaseUrl;
  if (options.reportsDir) process.env.REPORTS_DIR = options.reportsDir;

  const dataset = JSON.parse(await fs.readFile(path.resolve(options.data), 'utf8'));
  if (dataset.version !== 1 || !Array.isArray(dataset.records)) {
    throw new Error('Arquivo de histórico legado inválido ou incompatível.');
  }
  const assets = await loadAssetIndex(options.assetsDir);
  const { default: prisma } = await import('../src/lib/prisma.js');
  try {
    const recordIds = dataset.records.map(maintenanceRecordId);
    const [equipment, existingRecords, actor] = await Promise.all([
      prisma.companyEquipment.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          maintenanceProfileOverride: true,
          maintenanceProfile: {
            select: {
              id: true,
              name: true,
              isActive: true,
              items: { select: { id: true, label: true, order: true, isActive: true } }
            }
          },
          category: {
            select: {
              id: true,
              name: true,
              maintenanceProfile: {
                select: {
                  id: true,
                  name: true,
                  isActive: true,
                  items: { select: { id: true, label: true, order: true, isActive: true } }
                }
              }
            }
          }
        }
      }),
      prisma.maintenanceRecord.findMany({
        where: { id: { in: recordIds } },
        select: {
          id: true,
          equipmentId: true,
          attachments: {
            select: { id: true, kind: true, fileName: true, storagePath: true }
          }
        }
      }),
      options.actorUserId
        ? prisma.user.findUnique({
            where: { id: options.actorUserId },
            select: { id: true, name: true }
          })
        : Promise.resolve(null)
    ]);
    if (options.actorUserId && !actor) {
      throw new Error(`Usuário de importação não encontrado: ${options.actorUserId}`);
    }

    const preparation = await prepareImport({
      dataset,
      equipment,
      existingRecords,
      assets,
      options
    });
    if (options.apply && preparation.blockers.length) {
      const error = new Error(
        `Importação bloqueada por ${preparation.blockers.length} problema(s). `
        + 'Execute sem --apply e revise --summary-out.'
      );
      error.blockers = preparation.blockers;
      throw error;
    }

    let result = null;
    if (options.apply) {
      const attachmentHelpers = await import(
        '../src/lib/operational-reports/maintenance-attachments.js'
      );
      result = await applyImport({
        prisma,
        prepared: preparation.prepared,
        options,
        actor,
        attachmentHelpers
      });
    }
    const summary = summarize({
      dataset,
      ...preparation,
      mode: options.apply ? 'apply' : 'dry-run',
      result
    });
    if (options.summaryOut) {
      const summaryPath = path.resolve(options.summaryOut);
      await fs.mkdir(path.dirname(summaryPath), { recursive: true });
      await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    }
    printSummary(summary);
    if (!options.apply) {
      console.log('[simulação] Nenhuma linha do banco ou arquivo foi alterado.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

export {
  effectiveProfileSnapshots,
  exactEquipmentCode,
  maintenanceAuditId,
  maintenanceRecordId,
  normalizeEquipmentCode,
  recordCreateData,
  resolveEquipment,
  stableId
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error?.message || error);
    if (error?.blockers) console.error(JSON.stringify(error.blockers, null, 2));
    process.exit(1);
  });
}
