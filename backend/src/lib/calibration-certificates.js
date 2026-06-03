import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import env from '../config/env.js';
import prisma from './prisma.js';

const PUBLIC_PATH_PREFIX = '/certificados-calibracao';
const MAX_PDF_BYTES = 20 * 1024 * 1024;

function safePath(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function publicPathForToken(token) {
  return `${PUBLIC_PATH_PREFIX}/${encodeURIComponent(token)}`;
}

export function publicCalibrationCertificateUrl(token) {
  const pathValue = publicPathForToken(token);
  const appUrl = String(env.appUrl || '').replace(/\/+$/, '');
  return appUrl ? `${appUrl}${pathValue}` : pathValue;
}

export function serializeCalibrationCertificate(certificate) {
  if (!certificate) return null;
  return {
    id: certificate.id,
    fileName: certificate.fileName,
    mimeType: certificate.mimeType,
    publicToken: certificate.publicToken,
    publicUrl: publicCalibrationCertificateUrl(certificate.publicToken),
    createdAt: certificate.createdAt
  };
}

export function withCurrentCalibrationCertificate(item) {
  if (!item) return item;
  const certificates = Array.isArray(item.calibrationCertificates)
    ? item.calibrationCertificates
    : [];
  const { calibrationCertificates: _calibrationCertificates, ...rest } = item;
  return {
    ...rest,
    currentCalibrationCertificate: serializeCalibrationCertificate(certificates[0] || null)
  };
}

export const currentCalibrationCertificateInclude = {
  calibrationCertificates: {
    orderBy: { createdAt: 'desc' },
    take: 1
  }
};

function parsePdfUpload(upload) {
  if (!upload) return null;
  const fileName = String(upload.fileName || upload.name || '').trim();
  const mimeType = String(upload.mimeType || upload.type || '').trim() || 'application/pdf';
  const dataUrl = String(upload.dataUrl || '').trim();
  if (!fileName || !dataUrl) return null;
  if (mimeType !== 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) {
    const error = new Error('O certificado deve ser um arquivo PDF.');
    error.statusCode = 400;
    throw error;
  }
  const match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/i);
  if (!match) {
    const error = new Error('O certificado deve ser enviado em formato PDF.');
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

async function writeCertificateFile({ equipmentType, token, fileName, bytes }) {
  const dir = path.join(env.uploadDir, 'Certificados de Calibração', equipmentType);
  await fs.mkdir(dir, { recursive: true });
  const baseName = safePath(path.basename(fileName, path.extname(fileName))) || 'certificado';
  const targetName = `${baseName}-${token}.pdf`;
  const targetPath = path.join(dir, targetName);
  await fs.writeFile(targetPath, bytes, { flag: 'wx' });
  return path.relative(env.uploadDir, targetPath).split(path.sep).join('/');
}

export async function createCalibrationCertificate(client, { equipmentType, manometerId = null, particleCounterId = null, upload }) {
  const parsed = parsePdfUpload(upload);
  if (!parsed) return null;

  const publicToken = randomUUID();
  const storagePath = await writeCertificateFile({
    equipmentType,
    token: publicToken,
    fileName: parsed.fileName,
    bytes: parsed.bytes
  });

  return client.calibrationCertificate.create({
    data: {
      equipmentType,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      storagePath,
      publicToken,
      manometerId,
      particleCounterId
    }
  });
}

export async function resolvePublicCalibrationCertificate(token) {
  const publicToken = String(token || '').trim();
  if (!publicToken) return null;
  const certificate = await prisma.calibrationCertificate.findUnique({ where: { publicToken } });
  if (!certificate) return null;

  const targetPath = path.resolve(env.uploadDir, certificate.storagePath.split('/').join(path.sep));
  const root = path.resolve(env.uploadDir);
  const relative = path.relative(root, targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!fsSync.existsSync(targetPath) || !fsSync.statSync(targetPath).isFile()) return null;
  return { certificate, targetPath };
}
