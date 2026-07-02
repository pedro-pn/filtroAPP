import path from 'node:path';
import { randomUUID } from 'node:crypto';

import env from '../config/env.js';
import {
  inlineContentDisposition as commonInlineContentDisposition,
  publicPathForToken,
  publicUrlForPath,
  resolveManagedDocumentPath,
  unlinkManagedDocumentFile,
  writeManagedDocumentFile
} from './documents/storage.js';
import prisma from './prisma.js';
import { equipmentSerialNumber } from './equipment-attributes.js';
import { readStoredImageAsset } from './stored-image.js';

// Sob /api para reaproveitar o roteamento já existente do proxy/nginx até o
// backend (evita precisar de um location dedicado para cada caminho público).
const PUBLIC_PATH_PREFIX = '/api/equipamentos-anexos';
const MAX_PDF_BYTES = 20 * 1024 * 1024;

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp'
};

export const EquipmentAttachmentKinds = {
  CALIBRATION_CERTIFICATE: 'CALIBRATION_CERTIFICATE',
  TECHNICAL_DOC: 'TECHNICAL_DOC',
  // Datasheet gerado automaticamente a partir dos Dados Técnicos (Etapa D).
  TECHNICAL_DOC_GENERATED: 'TECHNICAL_DOC_GENERATED',
  // Fotos dos Dados Técnicos (opcionais, várias por equipamento).
  TECHNICAL_PHOTO: 'TECHNICAL_PHOTO'
};

const KIND_FOLDER = {
  CALIBRATION_CERTIFICATE: 'Certificados de Calibração',
  TECHNICAL_DOC: 'Documentação Técnica',
  TECHNICAL_DOC_GENERATED: 'Datasheets Gerados',
  TECHNICAL_PHOTO: 'Fotos Dados Técnicos'
};

export function publicEquipmentAttachmentUrl(token) {
  return publicUrlForPath(publicPathForToken(PUBLIC_PATH_PREFIX, token));
}

export function serializeEquipmentAttachment(attachment) {
  if (!attachment) return null;
  return {
    id: attachment.id,
    kind: attachment.kind,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    publicToken: attachment.publicToken,
    publicUrl: publicEquipmentAttachmentUrl(attachment.publicToken),
    createdAt: attachment.createdAt
  };
}

// Reduz a lista bruta de anexos para o anexo mais recente de cada tipo.
export function withCurrentAttachments(item) {
  if (!item) return item;
  const attachments = Array.isArray(item.attachments) ? item.attachments : [];
  const latest = kind => attachments
    .filter(att => att.kind === kind)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  const { attachments: _attachments, ...rest } = item;
  // Datasheets gerados, do mais novo ao mais antigo. O primeiro é o "atual"; os demais
  // (+ o PDF legado enviado à mão) ficam ARQUIVADOS.
  const generatedAll = attachments
    .filter(att => att.kind === EquipmentAttachmentKinds.TECHNICAL_DOC_GENERATED)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const generated = generatedAll[0] || null;
  const legacyDoc = latest(EquipmentAttachmentKinds.TECHNICAL_DOC);
  const calibrationCertificates = attachments
    .filter(att => att.kind === EquipmentAttachmentKinds.CALIBRATION_CERTIFICATE)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const calibrationCertificate = calibrationCertificates[0] || null;
  const archive = [...generatedAll.slice(1), ...(legacyDoc ? [legacyDoc] : [])]
    .map(serializeEquipmentAttachment);
  // "Desatualizado": os Dados Técnicos foram editados depois do datasheet gerado.
  const generatedOutdated = Boolean(
    generated && rest.technicalUpdatedAt &&
    new Date(rest.technicalUpdatedAt) > new Date(generated.createdAt)
  );
  const photos = attachments
    .filter(att => att.kind === EquipmentAttachmentKinds.TECHNICAL_PHOTO)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(serializeEquipmentAttachment);
  return {
    ...rest,
    calibrationCertificate: serializeEquipmentAttachment(calibrationCertificate),
    calibrationCertificateArchive: calibrationCertificates.slice(1).map(serializeEquipmentAttachment),
    technicalDoc: serializeEquipmentAttachment(legacyDoc),
    technicalDocGenerated: serializeEquipmentAttachment(generated),
    technicalDocGeneratedOutdated: generatedOutdated,
    technicalDocArchive: archive,
    technicalPhotos: photos
  };
}

export const equipmentAttachmentsInclude = {
  attachments: {
    orderBy: { createdAt: 'desc' }
  }
};

function parsePdfUpload(upload) {
  if (!upload) return null;
  const fileName = String(upload.fileName || upload.name || '').trim();
  const mimeType = String(upload.mimeType || upload.type || '').trim() || 'application/pdf';
  const dataUrl = String(upload.dataUrl || '').trim();
  if (!fileName || !dataUrl) return null;
  if (mimeType !== 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) {
    const error = new Error('O anexo deve ser um arquivo PDF.');
    error.statusCode = 400;
    throw error;
  }
  const match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/i);
  if (!match) {
    const error = new Error('O anexo deve ser enviado em formato PDF.');
    error.statusCode = 400;
    throw error;
  }
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 4).toString('utf8') !== '%PDF') {
    const error = new Error('Arquivo PDF inválido.');
    error.statusCode = 400;
    throw error;
  }
  return { fileName, mimeType: 'application/pdf', bytes };
}

async function writeAttachmentFile({ kind, token, fileName, bytes, extension = 'pdf' }) {
  const folder = KIND_FOLDER[kind] || 'Anexos';
  return writeManagedDocumentFile({
    rootDir: env.uploadDir,
    folderParts: ['Equipamentos', folder],
    token,
    fileName,
    bytes,
    extension
  });
}

// Valida uma foto enviada como dataURL de imagem (PNG/JPG/WEBP).
function parseImageUpload(upload) {
  if (!upload) return null;
  const fileName = String(upload.fileName || upload.name || 'foto').trim() || 'foto';
  const dataUrl = String(upload.dataUrl || '').trim();
  const match = dataUrl.match(/^data:(image\/[a-zA-Z.+-]+);base64,(.+)$/);
  if (!match) {
    const error = new Error('A foto deve ser uma imagem (PNG, JPG ou WEBP).');
    error.statusCode = 400;
    throw error;
  }
  const mimeType = match[1].toLowerCase();
  const extension = IMAGE_MIME_EXT[mimeType];
  if (!extension) {
    const error = new Error('Formato de imagem não suportado (use PNG, JPG ou WEBP).');
    error.statusCode = 400;
    throw error;
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    const error = new Error('Imagem inválida ou muito grande (máx. 15 MB).');
    error.statusCode = 400;
    throw error;
  }
  return { fileName, mimeType, extension, bytes };
}

// Cria uma foto dos Dados Técnicos (anexo TECHNICAL_PHOTO). Várias por equipamento.
export async function createEquipmentPhoto(client, { equipmentId, upload }) {
  const parsed = parseImageUpload(upload);
  if (!parsed) return null;
  const publicToken = randomUUID();
  const storagePath = await writeAttachmentFile({
    kind: EquipmentAttachmentKinds.TECHNICAL_PHOTO,
    token: publicToken,
    fileName: parsed.fileName,
    bytes: parsed.bytes,
    extension: parsed.extension
  });
  return client.equipmentAttachment.create({
    data: {
      equipmentId,
      kind: EquipmentAttachmentKinds.TECHNICAL_PHOTO,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      storagePath,
      publicToken
    }
  });
}

export async function createEquipmentAttachment(client, { equipmentId, kind, upload }) {
  const parsed = parsePdfUpload(upload);
  if (!parsed) return null;

  const publicToken = randomUUID();
  const storagePath = await writeAttachmentFile({
    kind,
    token: publicToken,
    fileName: parsed.fileName,
    bytes: parsed.bytes
  });

  return client.equipmentAttachment.create({
    data: {
      equipmentId,
      kind,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      storagePath,
      publicToken
    }
  });
}

// Persiste um anexo gerado pelo próprio sistema (bytes já prontos, sem dataUrl) —
// usado pelo datasheet gerado a partir dos Dados Técnicos.
export async function createGeneratedEquipmentAttachment(client, { equipmentId, kind, fileName, bytes }) {
  if (!bytes || !bytes.length) return null;
  const publicToken = randomUUID();
  const storagePath = await writeAttachmentFile({ kind, token: publicToken, fileName, bytes });
  return client.equipmentAttachment.create({
    data: {
      equipmentId,
      kind,
      fileName,
      mimeType: 'application/pdf',
      storagePath,
      publicToken
    }
  });
}

// Remove todos os anexos de um tipo (certificado/doc técnica) do equipamento.
// O arquivo físico só é apagado dos anexos do próprio módulo (sob "Equipamentos/");
// os migrados compartilham o arquivo com registros antigos e são preservados.
export async function removeEquipmentAttachments(client, equipmentId, kind, options = {}) {
  const exceptIds = new Set((options.exceptIds || []).filter(Boolean));
  const where = {
    equipmentId,
    kind,
    ...(exceptIds.size ? { id: { notIn: [...exceptIds] } } : {})
  };
  const rows = await client.equipmentAttachment.findMany({ where });
  if (!rows.length) return 0;
  await client.equipmentAttachment.deleteMany({ where: { equipmentId, kind, id: { in: rows.map(row => row.id) } } });
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await unlinkManagedDocumentFile(row.storagePath, { rootDir: env.uploadDir, requiredPrefix: 'Equipamentos/' });
  }
  return rows.length;
}

// Remove fotos específicas (por id) de um equipamento, apagando os arquivos físicos.
export async function removeEquipmentAttachmentsByIds(client, equipmentId, ids) {
  const idList = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!idList.length) return 0;
  const rows = await client.equipmentAttachment.findMany({
    where: { equipmentId, id: { in: idList }, kind: EquipmentAttachmentKinds.TECHNICAL_PHOTO }
  });
  if (!rows.length) return 0;
  await client.equipmentAttachment.deleteMany({ where: { id: { in: rows.map(r => r.id) } } });
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await unlinkManagedDocumentFile(row.storagePath, { rootDir: env.uploadDir, requiredPrefix: 'Equipamentos/' });
  }
  return rows.length;
}

// Resolve as fotos (TECHNICAL_PHOTO) de um equipamento em assets de imagem
// (bytes + dimensões + mime), na ordem de criação — para embutir no datasheet.
export async function resolveEquipmentPhotoAssets(client, equipmentId) {
  const rows = await client.equipmentAttachment.findMany({
    where: { equipmentId, kind: EquipmentAttachmentKinds.TECHNICAL_PHOTO },
    orderBy: { createdAt: 'asc' }
  });
  const assets = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const asset = await readStoredImageAsset(row.storagePath);
    if (asset && asset.width && asset.height) assets.push({ ...asset, label: row.fileName });
  }
  return assets;
}

export async function resolvePublicEquipmentAttachment(token) {
  const publicToken = String(token || '').trim();
  if (!publicToken) return null;
  const attachment = await prisma.equipmentAttachment.findUnique({
    where: { publicToken },
    include: { equipment: { select: { code: true, name: true, attributes: true } } }
  });
  if (!attachment) return null;

  const targetPath = resolveManagedDocumentPath(attachment.storagePath, {
    rootDir: env.uploadDir
  });
  if (!targetPath) return null;
  return { attachment, targetPath };
}

// Nome do arquivo no download, conforme padrão pedido:
//  - Documentação técnica: "Datasheet - [código] - [nome]"
//  - Certificado de calibração: "Certificado de calibração - [código] - [serial quando houver] - [nome]"
export function equipmentAttachmentFileName(attachment) {
  // Datasheets arquivados já guardam um nome com a revisão ("… - Rev N.pdf");
  // preserva esse nome (snapshot da revisão) para o download.
  if (
    attachment?.kind === EquipmentAttachmentKinds.TECHNICAL_DOC_GENERATED &&
    /\bRev\s*\d+/i.test(String(attachment?.fileName || ''))
  ) {
    return String(attachment.fileName);
  }
  const equipment = attachment?.equipment || {};
  const code = String(equipment.code || '').trim();
  const name = String(equipment.name || '').trim();
  const serial = equipmentSerialNumber(equipment);
  const isDatasheet = attachment?.kind === EquipmentAttachmentKinds.TECHNICAL_DOC
    || attachment?.kind === EquipmentAttachmentKinds.TECHNICAL_DOC_GENERATED;
  const parts = isDatasheet
    ? ['Datasheet', code, name]
    : ['Certificado de calibração', code, serial, name];
  const base = parts.map(part => String(part || '').trim()).filter(Boolean).join(' - ');
  return `${base || 'documento'}.pdf`;
}

// Content-Disposition "inline" (abre no navegador) preservando o nome no salvar.
export function inlineContentDisposition(fileName) {
  return commonInlineContentDisposition(fileName);
}
