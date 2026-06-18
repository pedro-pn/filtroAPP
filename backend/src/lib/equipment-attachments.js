import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import env from '../config/env.js';
import prisma from './prisma.js';

// Sob /api para reaproveitar o roteamento já existente do proxy/nginx até o
// backend (evita precisar de um location dedicado para cada caminho público).
const PUBLIC_PATH_PREFIX = '/api/equipamentos-anexos';
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export const EquipmentAttachmentKinds = {
  CALIBRATION_CERTIFICATE: 'CALIBRATION_CERTIFICATE',
  TECHNICAL_DOC: 'TECHNICAL_DOC'
};

const KIND_FOLDER = {
  CALIBRATION_CERTIFICATE: 'Certificados de Calibração',
  TECHNICAL_DOC: 'Documentação Técnica'
};

function safePath(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function publicPathForToken(token) {
  return `${PUBLIC_PATH_PREFIX}/${encodeURIComponent(token)}`;
}

export function publicEquipmentAttachmentUrl(token) {
  const pathValue = publicPathForToken(token);
  const appUrl = String(env.appUrl || '').replace(/\/+$/, '');
  return appUrl ? `${appUrl}${pathValue}` : pathValue;
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
  return {
    ...rest,
    calibrationCertificate: serializeEquipmentAttachment(latest(EquipmentAttachmentKinds.CALIBRATION_CERTIFICATE)),
    technicalDoc: serializeEquipmentAttachment(latest(EquipmentAttachmentKinds.TECHNICAL_DOC))
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

async function writeAttachmentFile({ kind, token, fileName, bytes }) {
  const folder = KIND_FOLDER[kind] || 'Anexos';
  const dir = path.join(env.uploadDir, 'Equipamentos', folder);
  await fs.mkdir(dir, { recursive: true });
  const baseName = safePath(path.basename(fileName, path.extname(fileName))) || 'anexo';
  const targetName = `${baseName}-${token}.pdf`;
  const targetPath = path.join(dir, targetName);
  await fs.writeFile(targetPath, bytes, { flag: 'wx' });
  return path.relative(env.uploadDir, targetPath).split(path.sep).join('/');
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

// Remove todos os anexos de um tipo (certificado/doc técnica) do equipamento.
// O arquivo físico só é apagado dos anexos do próprio módulo (sob "Equipamentos/");
// os migrados compartilham o arquivo com registros antigos e são preservados.
export async function removeEquipmentAttachments(client, equipmentId, kind) {
  const rows = await client.equipmentAttachment.findMany({ where: { equipmentId, kind } });
  if (!rows.length) return 0;
  await client.equipmentAttachment.deleteMany({ where: { equipmentId, kind } });
  for (const row of rows) {
    if (!row.storagePath || !row.storagePath.startsWith('Equipamentos/')) continue;
    const targetPath = path.resolve(env.uploadDir, row.storagePath.split('/').join(path.sep));
    const root = path.resolve(env.uploadDir);
    const relative = path.relative(root, targetPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    try {
      await fs.unlink(targetPath);
    } catch {
      // Arquivo já ausente — ignora.
    }
  }
  return rows.length;
}

export async function resolvePublicEquipmentAttachment(token) {
  const publicToken = String(token || '').trim();
  if (!publicToken) return null;
  const attachment = await prisma.equipmentAttachment.findUnique({
    where: { publicToken },
    include: { equipment: { select: { code: true, name: true, attributes: true } } }
  });
  if (!attachment) return null;

  const targetPath = path.resolve(env.uploadDir, attachment.storagePath.split('/').join(path.sep));
  const root = path.resolve(env.uploadDir);
  const relative = path.relative(root, targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!fsSync.existsSync(targetPath) || !fsSync.statSync(targetPath).isFile()) return null;
  return { attachment, targetPath };
}

function attachmentEquipmentAttrs(equipment) {
  return equipment && typeof equipment.attributes === 'object' && equipment.attributes ? equipment.attributes : {};
}

// Nome do arquivo no download, conforme padrão pedido:
//  - Documentação técnica: "Datasheet - [código] - [nome]"
//  - Certificado de calibração: "Certificado de calibração - [código] - [serial quando houver] - [nome]"
export function equipmentAttachmentFileName(attachment) {
  const equipment = attachment?.equipment || {};
  const code = String(equipment.code || '').trim();
  const name = String(equipment.name || '').trim();
  const serial = String(attachmentEquipmentAttrs(equipment).serialNumber || '').trim();
  const parts = attachment?.kind === EquipmentAttachmentKinds.TECHNICAL_DOC
    ? ['Datasheet', code, name]
    : ['Certificado de calibração', code, serial, name];
  const base = parts.map(part => String(part || '').trim()).filter(Boolean).join(' - ');
  return `${base || 'documento'}.pdf`;
}

// Content-Disposition "inline" (abre no navegador) preservando o nome no salvar.
export function inlineContentDisposition(fileName) {
  const ascii = String(fileName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._\-]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
