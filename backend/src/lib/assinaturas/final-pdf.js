import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb
} from 'pdf-lib';

import env from '../../config/env.js';
import { createValidationQrCodeMatrix } from '../qr-code.js';
import { parseSignatureImageDataUrl } from '../signatures/common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const evidenceLogoPath = path.resolve(__dirname, '../../../assets/Logo/LOGO_COLORIDO.png');

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  return error;
}

function number(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw httpError('Geometria de assinatura inválida.');
  return parsed;
}

export function normalizedFieldToPdfRect(field, pageGeometry) {
  const rotation = ((number(pageGeometry.rotation || 0) % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) throw httpError('Rotação de página não suportada.');
  const originX = number(pageGeometry.x || 0);
  const originY = number(pageGeometry.y || 0);
  const pageWidth = number(pageGeometry.width);
  const pageHeight = number(pageGeometry.height);
  const visualWidth = rotation === 90 || rotation === 270 ? pageHeight : pageWidth;
  const visualHeight = rotation === 90 || rotation === 270 ? pageWidth : pageHeight;
  const visualX = number(field.x) * visualWidth;
  const visualY = number(field.y) * visualHeight;
  const visualRectWidth = number(field.width) * visualWidth;
  const visualRectHeight = number(field.height) * visualHeight;

  if (rotation === 0) {
    return {
      x: originX + visualX,
      y: originY + pageHeight - visualY - visualRectHeight,
      width: visualRectWidth,
      height: visualRectHeight
    };
  }
  if (rotation === 90) {
    return {
      x: originX + visualY,
      y: originY + visualX,
      width: visualRectHeight,
      height: visualRectWidth
    };
  }
  if (rotation === 180) {
    return {
      x: originX + pageWidth - visualX - visualRectWidth,
      y: originY + visualY,
      width: visualRectWidth,
      height: visualRectHeight
    };
  }
  return {
    x: originX + pageWidth - visualY - visualRectHeight,
    y: originY + pageHeight - visualX - visualRectWidth,
    width: visualRectHeight,
    height: visualRectWidth
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fitInside(image, rect, padding = 3) {
  const maxWidth = Math.max(1, rect.width - (padding * 2));
  const maxHeight = Math.max(1, rect.height - (padding * 2));
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: rect.x + ((rect.width - width) / 2),
    y: rect.y + ((rect.height - height) / 2),
    width,
    height
  };
}

function evidenceText(value, fallback = '—') {
  const text = String(value || '').trim();
  return text || fallback;
}

function formatSaoPaulo(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date);
}

async function embeddedSignerImage(pdf, signer, cache) {
  if (cache.has(signer.id)) return cache.get(signer.id);
  const parsed = parseSignatureImageDataUrl(signer.signatureImageDataUrl);
  if (!parsed) throw httpError(`Assinatura visual inválida para ${signer.name}.`);
  const image = parsed.mimeType === 'image/png'
    ? await pdf.embedPng(parsed.bytes)
    : await pdf.embedJpg(parsed.bytes);
  cache.set(signer.id, image);
  return image;
}

function validationUrl(code) {
  const base = String(env.appUrl || '').replace(/\/+$/, '');
  const route = `/validar-documento/${encodeURIComponent(code)}`;
  return base ? `${base}${route}` : route;
}

function addLinkAnnotation(pdf, page, { x, y, width, height, url }) {
  const link = pdf.context.register(pdf.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: { Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of(url) }
  }));
  const annots = page.node.Annots();
  if (annots) annots.push(link);
  else page.node.set(PDFName.of('Annots'), pdf.context.obj([link]));
}

function drawValidationQr(pdf, page, code, x = 462, y = 670, size = 76) {
  if (!code) return false;
  const url = validationUrl(code);
  const matrix = createValidationQrCodeMatrix(url);
  if (!matrix) return false;
  const quietZone = 4;
  const moduleSize = size / (matrix.length + (quietZone * 2));
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1), borderColor: rgb(0.78, 0.82, 0.86), borderWidth: 0.6 });
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix.length; col += 1) {
      if (!matrix[row][col]) continue;
      page.drawRectangle({
        x: x + ((col + quietZone) * moduleSize),
        y: y + ((matrix.length - row - 1 + quietZone) * moduleSize),
        width: moduleSize,
        height: moduleSize,
        color: rgb(0, 0, 0)
      });
    }
  }
  addLinkAnnotation(pdf, page, { x, y, width: size, height: size, url });
  return true;
}

async function drawEvidenceLogo(pdf, page) {
  try {
    const bytes = await fs.readFile(evidenceLogoPath);
    const logo = await pdf.embedPng(bytes);
    const maxWidth = 112;
    const maxHeight = 44;
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height, 1);
    const width = logo.width * scale;
    const height = logo.height * scale;
    page.drawImage(logo, {
      x: 595.28 - 48 - width,
      y: 790 - height + 4,
      width,
      height
    });
  } catch {
    // A ausência do logo não deve impedir a geração do PDF assinado.
  }
}

async function drawEvidenceHeader(pdf, page, fonts, snapshot, sourceHash) {
  const black = rgb(0.08, 0.1, 0.16);
  const muted = rgb(0.35, 0.39, 0.46);
  let y = 790;

  await drawEvidenceLogo(pdf, page);
  page.drawText('ASSINATURA ELETRONICA - FILTROVALI', {
    x: 48, y, size: 15, font: fonts.bold, color: black
  });
  y -= 30;
  page.drawText('Status do documento: Assinado', {
    x: 48, y, size: 10, font: fonts.bold, color: black
  });
  y -= 16;
  page.drawText(`Nome do documento: ${evidenceText(snapshot.title || snapshot.originalFileName)}`.slice(0, 92), {
    x: 48, y, size: 10, font: fonts.regular, color: muted
  });
  y -= 16;
  page.drawText(`Criado em: ${formatSaoPaulo(snapshot.createdAt)}`, {
    x: 48, y, size: 10, font: fonts.regular, color: muted
  });
  y -= 16;
  page.drawText(`Solicitante: ${evidenceText(snapshot.requesterNameSnapshot)}`.slice(0, 92), {
    x: 48, y, size: 10, font: fonts.regular, color: muted
  });
  y -= 16;
  page.drawText(`Hash PDF-base: ${sourceHash}`, {
    x: 48, y, size: 9, font: fonts.regular, color: muted
  });
  if (snapshot.validationCode) {
    y -= 16;
    page.drawText(`Codigo de validacao: ${snapshot.validationCode}`, {
      x: 48, y, size: 9, font: fonts.regular, color: muted
    });
    y -= 16;
    page.drawText(`Validar documento: ${validationUrl(snapshot.validationCode)}`.slice(0, 96), {
      x: 48, y, size: 9, font: fonts.regular, color: muted
    });
    if (drawValidationQr(pdf, page, snapshot.validationCode)) {
      page.drawText('Escaneie para validar', {
        x: 462, y: 657, size: 8, font: fonts.regular, color: muted
      });
    }
  }
  return y - 28;
}

async function appendEvidencePages(pdf, snapshot, sourceHash, imageCache, fonts) {
  let page = pdf.addPage([595.28, 841.89]);
  let y = await drawEvidenceHeader(pdf, page, fonts, snapshot, sourceHash);
  const black = rgb(0.08, 0.1, 0.16);
  const muted = rgb(0.35, 0.39, 0.46);
  for (const signer of snapshot.signers || []) {
    if (y < 190) {
      page = pdf.addPage([595.28, 841.89]);
      y = await drawEvidenceHeader(pdf, page, fonts, snapshot, sourceHash);
    }
    const signerName = evidenceText(signer.declaredSignerName || signer.name);
    page.drawText(`Signatario: ${signerName}`.slice(0, 92), {
      x: 48, y, size: 10, font: fonts.bold, color: black
    });
    y -= 15;
    page.drawText(`E-mail: ${evidenceText(signer.email)}`.slice(0, 96), {
      x: 48, y, size: 10, font: fonts.regular, color: black
    });
    y -= 15;
    page.drawText('Papel: Assinante', {
      x: 48, y, size: 10, font: fonts.regular, color: black
    });
    y -= 15;
    page.drawText(`Data/Hora: ${formatSaoPaulo(signer.signedAt)} (America/Sao_Paulo)`, {
      x: 48, y, size: 10, font: fonts.regular, color: black
    });
    y -= 15;
    page.drawText(`IP: ${evidenceText(signer.ipAddress)}`, {
      x: 48, y, size: 10, font: fonts.regular, color: black
    });
    y -= 15;
    page.drawText(`Navegador: ${evidenceText(signer.userAgent)}`.slice(0, 96), {
      x: 48, y, size: 10, font: fonts.regular, color: black
    });
    y -= 18;
    const image = await embeddedSignerImage(pdf, signer, imageCache);
    const maxWidth = 180;
    const maxHeight = 64;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawText('Assinatura:', {
      x: 48, y, size: 10, font: fonts.regular, color: black
    });
    page.drawRectangle({
      x: 120,
      y: y - maxHeight + 10,
      width: maxWidth,
      height: maxHeight,
      borderColor: rgb(0.78, 0.81, 0.85),
      borderWidth: 0.6
    });
    page.drawImage(image, {
      x: 128,
      y: y - height + 18,
      width,
      height
    });
    y -= maxHeight + 18;
  }
  page.drawText('A trilha completa de auditoria permanece registrada no sistema Filtrovali.', {
    x: 48, y: 64, size: 9, font: fonts.regular, color: muted
  });
}

export async function buildFinalPdfBytes(snapshot, sourceBytes) {
  const sourceHash = sha256(sourceBytes);
  if (!snapshot?.sourceDocumentHash || sourceHash !== snapshot.sourceDocumentHash) {
    throw httpError('A integridade do PDF original não pôde ser confirmada.', 409);
  }
  let pdf;
  try {
    pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  } catch {
    throw httpError('O PDF original não pôde ser aberto.', 409);
  }
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold)
  };
  const signersById = new Map((snapshot.signers || []).map(signer => [signer.id, signer]));
  const imageCache = new Map();
  const pages = pdf.getPages();

  for (const field of snapshot.fields || []) {
    const page = pages[Number(field.pageNumber) - 1];
    const signer = signersById.get(field.signerId);
    if (!page || !signer?.signatureImageDataUrl) throw httpError('Configuração de assinatura incompleta.', 409);
    const cropBox = page.getCropBox();
    const rect = normalizedFieldToPdfRect(field, {
      x: cropBox.x,
      y: cropBox.y,
      width: cropBox.width,
      height: cropBox.height,
      rotation: page.getRotation().angle
    });
    const image = await embeddedSignerImage(pdf, signer, imageCache);
    page.drawImage(image, fitInside(image, rect, 0));
  }

  await appendEvidencePages(pdf, snapshot, sourceHash, imageCache, fonts);
  return Buffer.from(await pdf.save({ useObjectStreams: false, addDefaultPage: false }));
}
