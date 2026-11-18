import { createHash } from 'node:crypto';
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

function drawValidationQr(pdf, page, code) {
  if (!code) return;
  const url = validationUrl(code);
  const matrix = createValidationQrCodeMatrix(url);
  if (!matrix) return;
  const x = 478;
  const y = 752;
  const size = 66;
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
}

function drawEvidenceHeader(pdf, page, fonts, snapshot, sourceHash) {
  page.drawText('Evidências de assinatura', {
    x: 42, y: 798, size: 16, font: fonts.bold, color: rgb(0.08, 0.16, 0.24)
  });
  page.drawText(`Documento: ${evidenceText(snapshot.title)}`.slice(0, 100), {
    x: 42, y: 774, size: 9, font: fonts.regular
  });
  page.drawText(`Solicitante: ${evidenceText(snapshot.requesterNameSnapshot)}`.slice(0, 100), {
    x: 42, y: 758, size: 9, font: fonts.regular
  });
  page.drawText(`Hash original: ${sourceHash}`, {
    x: 42, y: 742, size: 7, font: fonts.regular
  });
  if (snapshot.validationCode) {
    page.drawText(`Código de validação: ${snapshot.validationCode}`, {
      x: 42, y: 726, size: 8, font: fonts.bold
    });
    page.drawText(`Validar: ${validationUrl(snapshot.validationCode)}`.slice(0, 100), {
      x: 42, y: 712, size: 7, font: fonts.regular
    });
    drawValidationQr(pdf, page, snapshot.validationCode);
    return 684;
  }
  return 712;
}

async function appendEvidencePages(pdf, snapshot, sourceHash, imageCache, fonts) {
  let page = pdf.addPage([595.28, 841.89]);
  let y = drawEvidenceHeader(pdf, page, fonts, snapshot, sourceHash);
  for (const [index, signer] of (snapshot.signers || []).entries()) {
    if (y < 120) {
      page = pdf.addPage([595.28, 841.89]);
      y = drawEvidenceHeader(pdf, page, fonts, snapshot, sourceHash);
    }
    page.drawRectangle({
      x: 42, y: y - 78, width: 511, height: 88,
      borderColor: rgb(0.78, 0.82, 0.86), borderWidth: 0.7
    });
    page.drawText(`${index + 1}. ${evidenceText(signer.declaredSignerName || signer.name)}`.slice(0, 90), {
      x: 52, y: y - 8, size: 10, font: fonts.bold
    });
    page.drawText(`E-mail: ${evidenceText(signer.email)}`.slice(0, 95), {
      x: 52, y: y - 25, size: 8, font: fonts.regular
    });
    page.drawText(`Data/hora: ${formatSaoPaulo(signer.signedAt)} (America/Sao_Paulo)`, {
      x: 52, y: y - 39, size: 8, font: fonts.regular
    });
    page.drawText(`IP: ${evidenceText(signer.ipAddress)}  Navegador: ${evidenceText(signer.userAgent)}`.slice(0, 105), {
      x: 52, y: y - 53, size: 7, font: fonts.regular
    });
    const image = await embeddedSignerImage(pdf, signer, imageCache);
    const imageRect = fitInside(image, { x: 410, y: y - 70, width: 130, height: 62 }, 2);
    page.drawImage(image, imageRect);
    y -= 102;
  }
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
    page.drawRectangle({
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      borderColor: rgb(0.15, 0.35, 0.55), borderWidth: 0.6,
      color: rgb(1, 1, 1), opacity: 0.92
    });
    page.drawImage(image, fitInside(image, rect, 4));
    const label = `Assinado por ${evidenceText(signer.declaredSignerName || signer.name)}`.slice(0, 80);
    page.drawText(label, {
      x: rect.x + 3,
      y: Math.max(cropBox.y + 2, rect.y + 2),
      size: Math.min(7, Math.max(5, rect.height / 8)),
      font: fonts.regular,
      color: rgb(0.08, 0.16, 0.24)
    });
  }

  await appendEvidencePages(pdf, snapshot, sourceHash, imageCache, fonts);
  return Buffer.from(await pdf.save({ useObjectStreams: false, addDefaultPage: false }));
}
