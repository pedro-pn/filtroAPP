import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import heicConvert from 'heic-convert';
import sharp from 'sharp';

import env from '../config/env.js';

const REPORT_IMAGE_MAX_DIMENSION = 1280;
const REPORT_IMAGE_QUALITY = 72;
const REPORT_IMAGE_CACHE_VERSION = 1;
const reportImageCacheJobs = new Map();

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

function reportImageCacheDir() {
  return path.join(env.uploadDir, '.cache', 'report-images');
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map(item => path.resolve(item)))];
}

function storedFileRoots() {
  return uniquePaths([env.uploadDir, env.reportsDir]);
}

function isInside(root, targetPath) {
  const relative = path.relative(root, targetPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function uploadRelativePathFromSource(source) {
  const raw = String(source || '').trim();
  if (!raw || raw.startsWith('data:')) return '';

  let pathname = raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      pathname = new URL(raw).pathname;
    }
  } catch {
    return '';
  }
  if (pathname.startsWith('//api/uploads/file/')) pathname = pathname.slice(1);
  if (pathname.startsWith('//api/rdo/uploads/file/')) pathname = pathname.slice(1);
  if (pathname.startsWith('//relatorios/')) pathname = pathname.slice(1);
  if (pathname.startsWith('//uploads/')) pathname = pathname.slice(1);

  let relativePath = '';
  if (pathname.startsWith('/relatorios/')) {
    relativePath = pathname.slice('/relatorios/'.length);
  } else if (pathname.startsWith('/api/uploads/file/')) {
    relativePath = pathname.slice('/api/uploads/file/'.length);
  } else if (pathname.startsWith('/api/rdo/uploads/file/')) {
    relativePath = pathname.slice('/api/rdo/uploads/file/'.length);
  } else if (pathname.startsWith('/uploads/')) {
    relativePath = pathname.slice('/uploads/'.length);
  } else if (pathname.startsWith('api/uploads/file/')) {
    relativePath = pathname.slice('api/uploads/file/'.length);
  } else if (pathname.startsWith('api/rdo/uploads/file/')) {
    relativePath = pathname.slice('api/rdo/uploads/file/'.length);
  } else if (pathname.startsWith('relatorios/')) {
    relativePath = pathname.slice('relatorios/'.length);
  } else if (pathname.startsWith('uploads/')) {
    relativePath = pathname.slice('uploads/'.length);
  } else if (!pathname.startsWith('/')) {
    relativePath = pathname;
  }

  if (!relativePath) return '';

  let decoded = '';
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return '';
  }

  const parts = decoded
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part.includes('\0'))) return '';
  return parts.join('/');
}

export function resolveStoredUploadPath(source) {
  const relativePath = uploadRelativePathFromSource(source);
  if (!relativePath) return null;

  for (const root of storedFileRoots()) {
    const targetPath = path.resolve(root, ...relativePath.split('/'));
    if (isInside(root, targetPath) && fsSync.existsSync(targetPath) && fsSync.statSync(targetPath).isFile()) {
      return targetPath;
    }
  }
  return null;
}

function reportImageCacheKey(targetPath, stat) {
  return createHash('sha256')
    .update([
      REPORT_IMAGE_CACHE_VERSION,
      path.resolve(targetPath),
      stat.size,
      Math.trunc(stat.mtimeMs),
      REPORT_IMAGE_MAX_DIMENSION,
      REPORT_IMAGE_QUALITY
    ].join('|'))
    .digest('hex')
    .slice(0, 32);
}

function shouldUseOriginalImage(meta, extension, stat) {
  const ext = String(extension || '').toLowerCase();
  if (!['jpg', 'jpeg', 'png', 'gif'].includes(ext) || !meta?.width || !meta?.height) return false;
  if (ext === 'gif') return true;
  return (
    meta.width <= REPORT_IMAGE_MAX_DIMENSION
    && meta.height <= REPORT_IMAGE_MAX_DIMENSION
    && stat.size <= 1.5 * 1024 * 1024
  );
}

async function readCachedOptimizedImage(targetPath, stat) {
  const cacheDir = reportImageCacheDir();
  const cachePath = path.join(cacheDir, `${reportImageCacheKey(targetPath, stat)}.jpg`);
  const cached = await fs.readFile(cachePath).catch(() => null);
  if (cached) {
    const meta = metaForExtension(cached, 'jpeg');
    if (meta.width && meta.height) {
      return {
        bytes: cached,
        extension: 'jpeg',
        mimeType: 'image/jpeg',
        width: meta.width,
        height: meta.height
      };
    }
  }
  return null;
}

async function writeCachedOptimizedImage(targetPath, stat, optimized) {
  if (!optimized?.bytes?.length) return;
  const cacheDir = reportImageCacheDir();
  const cachePath = path.join(cacheDir, `${reportImageCacheKey(targetPath, stat)}.jpg`);
  const tempPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(tempPath, optimized.bytes);
    await fs.rename(tempPath, cachePath);
  } catch {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function optimizeStoredImageForReport(targetPath, bytes, extension, stat) {
  const cacheKey = reportImageCacheKey(targetPath, stat);
  const existingJob = reportImageCacheJobs.get(cacheKey);
  if (existingJob) return existingJob;

  const job = (async () => {
    const cached = await readCachedOptimizedImage(targetPath, stat);
    if (cached) return cached;

    const optimized = await optimizeImageForReport(bytes, { extension }).catch(() => null);
    if (!optimized) return null;
    await writeCachedOptimizedImage(targetPath, stat, optimized);
    return optimized;
  })();

  reportImageCacheJobs.set(cacheKey, job);
  try {
    return await job;
  } finally {
    reportImageCacheJobs.delete(cacheKey);
  }
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

  const targetPath = resolveStoredUploadPath(source);
  if (!targetPath) return null;
  const stat = await fs.stat(targetPath).catch(() => null);
  if (!stat?.isFile()) return null;
  const bytes = await fs.readFile(targetPath);
  const extension = path.extname(targetPath).replace('.', '').toLowerCase();
  const meta = metaForExtension(bytes, extension);
  if (shouldUseOriginalImage(meta, extension, stat)) {
    return {
      bytes,
      fileName: path.basename(targetPath),
      ...meta
    };
  }

  const optimized = await optimizeStoredImageForReport(targetPath, bytes, extension, stat);
  if (optimized) {
    return {
      fileName: path.basename(targetPath).replace(/\.[^.]+$/, '.jpg'),
      ...optimized
    };
  }
  if (!meta.width || !meta.height) return null;
  return {
    bytes,
    fileName: path.basename(targetPath),
    ...meta
  };
}
