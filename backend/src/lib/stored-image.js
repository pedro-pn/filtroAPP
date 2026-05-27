import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import heicConvert from 'heic-convert';
import sharp from 'sharp';

import env from '../config/env.js';

const REPORT_IMAGE_MAX_DIMENSION = 1280;
const REPORT_IMAGE_QUALITY = 72;

function parsePngSize(buf) {
  if (buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function parseJpegSize(buf) {
  let offset = 2;
  while (offset < buf.length) {
    if (buf[offset] !== 0xFF) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    const size = buf.readUInt16BE(offset + 2);
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + size;
  }
  return null;
}

function parseGifSize(buf) {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function metaForExtension(buffer, extension) {
  if (extension === 'png') return { ...parsePngSize(buffer), extension: 'png', mimeType: 'image/png' };
  if (extension === 'jpg' || extension === 'jpeg') return { ...parseJpegSize(buffer), extension: 'jpeg', mimeType: 'image/jpeg' };
  if (extension === 'gif') return { ...parseGifSize(buffer), extension: 'gif', mimeType: 'image/gif' };
  if (extension === 'webp') return { width: 100, height: 40, extension: 'webp', mimeType: 'image/webp' };
  return { width: 100, height: 40, extension: extension || 'png', mimeType: 'image/png' };
}

function mimeToExtension(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpeg';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/webp') return 'webp';
  return 'png';
}

function isOptimizableImage(extension, mimeType) {
  const ext = String(extension || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)
    || ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(mime);
}

async function convertHeicToJpeg(bytes) {
  const converted = await heicConvert({
    buffer: bytes,
    format: 'JPEG',
    quality: REPORT_IMAGE_QUALITY / 100
  });
  return Buffer.from(converted);
}

export async function optimizeImageForReport(bytes, options = {}) {
  const extension = String(options.extension || '').replace(/^\./, '').toLowerCase();
  const mimeType = String(options.mimeType || '').toLowerCase();
  if (!isOptimizableImage(extension, mimeType)) return null;

  let sourceBytes = bytes;
  if (extension === 'heic' || extension === 'heif' || mimeType === 'image/heic' || mimeType === 'image/heif') {
    try {
      sourceBytes = await sharp(bytes, { failOn: 'none' }).rotate().jpeg({ quality: REPORT_IMAGE_QUALITY }).toBuffer();
    } catch {
      sourceBytes = await convertHeicToJpeg(bytes);
    }
  }

  const optimized = await sharp(sourceBytes, { failOn: 'none' })
    .rotate()
    .resize({
      width: REPORT_IMAGE_MAX_DIMENSION,
      height: REPORT_IMAGE_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: REPORT_IMAGE_QUALITY, mozjpeg: true })
    .toBuffer();
  const meta = metaForExtension(optimized, 'jpeg');
  if (!meta.width || !meta.height) return null;
  return {
    bytes: optimized,
    extension: 'jpeg',
    mimeType: 'image/jpeg',
    width: meta.width,
    height: meta.height
  };
}

function relativeUploadPath(source) {
  if (!source || source.startsWith('data:')) return '';
  try {
    if (/^https?:\/\//i.test(source)) {
      const pathname = new URL(source).pathname;
      if (pathname.startsWith('/relatorios/')) return decodeURIComponent(pathname.slice('/relatorios/'.length));
      if (pathname.startsWith('/uploads/')) return decodeURIComponent(pathname.slice('/uploads/'.length));
      return '';
    }
    if (source.startsWith('/relatorios/')) return decodeURIComponent(source.slice('/relatorios/'.length));
    if (source.startsWith('/uploads/')) return decodeURIComponent(source.slice('/uploads/'.length));
  } catch {
    return '';
  }
  return '';
}

export async function readStoredImageAsset(source) {
  if (!source) return null;

  if (source.startsWith('data:')) {
    const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) return null;
    const mimeType = match[1].toLowerCase();
    const bytes = Buffer.from(match[2], 'base64');
    const extension = mimeToExtension(mimeType);
    const meta = metaForExtension(bytes, extension);
    if (!meta.width || !meta.height) return null;
    return {
      bytes,
      fileName: `inline-signature.${extension}`,
      ...meta,
      mimeType
    };
  }

  const relativePath = relativeUploadPath(source);
  if (!relativePath) return null;
  const targetPath = path.join(env.uploadDir, relativePath);
  if (!fsSync.existsSync(targetPath)) return null;
  const bytes = await fs.readFile(targetPath);
  const extension = path.extname(targetPath).replace('.', '').toLowerCase();
  const optimized = await optimizeImageForReport(bytes, { extension }).catch(() => null);
  if (optimized) {
    return {
      fileName: path.basename(targetPath).replace(/\.[^.]+$/, '.jpg'),
      ...optimized
    };
  }
  const meta = metaForExtension(bytes, extension);
  if (!meta.width || !meta.height) return null;
  return {
    bytes,
    fileName: path.basename(targetPath),
    ...meta
  };
}
