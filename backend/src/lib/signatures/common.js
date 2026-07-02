import { PDFDocument } from 'pdf-lib';

function stringValue(value) {
  return String(value || '').trim();
}

function parsePngImageSize(bytes) {
  if (bytes.length < 33) return null;
  const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (!pngSignature.every((byte, index) => bytes[index] === byte)) return null;
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

function parseJpegImageSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xFF) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xD9 || marker === 0xDA) return null;
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5)
      };
    }
    offset += segmentLength;
  }
  return null;
}

function validSignatureImageSize(size) {
  if (!size) return false;
  const width = Number(size.width);
  const height = Number(size.height);
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && width <= 4096
    && height <= 4096
    && width * height <= 4_000_000;
}

export function parseSignatureImageDataUrl(value) {
  const match = String(value || '').match(/^data:(image\/(?:png|jpe?g));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const encoded = match[2].replace(/\s/g, '');
  if (!encoded || encoded.length % 4 === 1) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 1.5 * 1024 * 1024) return null;
  const size = mimeType === 'image/png' ? parsePngImageSize(bytes) : parseJpegImageSize(bytes);
  if (!validSignatureImageSize(size)) return null;
  return { mimeType, bytes, width: size.width, height: size.height };
}

export async function decodableSignatureImageDataUrl(value) {
  const parsed = parseSignatureImageDataUrl(value);
  if (!parsed) return null;
  try {
    const pdf = await PDFDocument.create();
    const image = parsed.mimeType === 'image/png'
      ? await pdf.embedPng(parsed.bytes)
      : await pdf.embedJpg(parsed.bytes);
    if (!validSignatureImageSize({ width: image.width, height: image.height })) return null;
    return { ...parsed, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

export function normalizeSignerEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function signatureTokenExpiresAt(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function userAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 1000) || null;
}

function cleanIpCandidate(value) {
  return stringValue(value)
    .replace(/^"|"$/g, '')
    .replace(/^::ffff:/i, '')
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim();
}

function isPublicIp(value) {
  const ip = cleanIpCandidate(value);
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.some(part => part < 0 || part > 255)) return false;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
    return true;
  }

  const lower = ip.toLowerCase();
  if (!lower.includes(':')) return false;
  if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return false;
  return true;
}

function clientIpFromRequest(req) {
  const trustsProxy = !!req?.app?.get?.('trust proxy');
  if (trustsProxy) {
    const candidates = [
      ...(Array.isArray(req.ips) ? req.ips.map(cleanIpCandidate) : []),
      cleanIpCandidate(req.ip)
    ].filter(Boolean);
    return candidates.find(isPublicIp) || candidates[0] || null;
  }

  const candidates = [
    cleanIpCandidate(req.ip)
  ].filter(Boolean);

  return candidates.find(isPublicIp) || candidates[0] || null;
}

export function signatureEvidenceFromRequest(req) {
  return {
    ipAddress: clientIpFromRequest(req),
    userAgent: userAgent(req)
  };
}
