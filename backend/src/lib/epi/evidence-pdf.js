import crypto from 'node:crypto';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';

import env from '../../config/env.js';
import { createValidationQrCodeMatrix } from '../qr-code.js';
import { parseSignatureImageDataUrl } from '../signatures/common.js';

export function epiSha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function epiSignatureImageHash(dataUrl) {
  const parsed = parseSignatureImageDataUrl(dataUrl);
  return parsed ? epiSha256(parsed.bytes) : null;
}

export function epiValidationUrl(code) {
  return `${String(env.appUrl || '').replace(/\/+$/, '')}/validar-epi/${encodeURIComponent(code)}`;
}

export function sortedEpiRecords(records = []) {
  return [...records].sort((a, b) => new Date(a.lendDate) - new Date(b.lendDate)
    || new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
    || String(a.id || '').localeCompare(String(b.id || '')));
}

export function epiEvidenceGroups(records = []) {
  const groups = new Map();
  sortedEpiRecords(records).forEach((record, index) => {
    const request = record.signatureRequest;
    const image = record.signatureImageDataUrl || request?.signatureImageDataUrl;
    if (!record.signedAt && !(request?.status === 'SIGNED' && request.signedAt) && !image) return;
    const key = request?.id || record.signatureRequestId || `legacy:${record.id || index}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        signedAt: request?.signedAt || record.signedAt || null,
        signerName: request?.signatureSignerName || record.signatureSignerName || 'Não registrado',
        ipAddress: request?.ipAddress,
        userAgent: request?.userAgent,
        createdAt: request?.createdAt,
        privacyNoticeVersion: request?.privacyNoticeVersion,
        privacyNoticeAcceptedAt: request?.privacyNoticeAcceptedAt,
        validationCode: request?.validationCode,
        sourceDocumentHash: request?.sourceDocumentHash,
        signedPdfHash: request?.signedPdfHash,
        signatureImageHash: request?.signatureImageHash || epiSignatureImageHash(image),
        auditLogs: request?.auditLogs || [],
        records: []
      });
    }
    groups.get(key).records.push({ ...record, rowNumber: index + 1 });
  });
  return [...groups.values()].sort((a, b) => new Date(a.signedAt || 0) - new Date(b.signedAt || 0)
    || a.id.localeCompare(b.id));
}

// Helvetica uses WinAnsi. Preserve Portuguese and replace unsupported user input.
function printable(value, font) {
  return Array.from(String(value ?? '').replace(/\s+/g, ' ')).map(char => {
    try { font.encodeText(char); return char; } catch { return '?'; }
  }).join('');
}

function wrapped(value, font, size, width) {
  const lines = [];
  let line = '';
  for (const char of printable(value, font)) {
    if (line && font.widthOfTextAtSize(line + char, size) > width) {
      const space = line.lastIndexOf(' ');
      if (space > 0) {
        lines.push(line.slice(0, space));
        line = line.slice(space + 1) + char;
      } else {
        lines.push(line);
        line = char;
      }
    } else line += char;
  }
  if (line) lines.push(line);
  return lines;
}

function utc(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toISOString() : 'Não registrado';
}

function dateOnly(value) {
  return value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : '-';
}

function drawValidationLink(pdf, page, url, x, y) {
  const size = 49;
  const matrix = createValidationQrCodeMatrix(url);
  if (matrix) {
    const unit = size / (matrix.length + 8);
    page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
    matrix.forEach((row, i) => row.forEach((dark, j) => {
      if (dark) page.drawRectangle({
        x: x + (j + 4) * unit, y: y + (matrix.length + 3 - i) * unit,
        width: unit, height: unit, color: rgb(0, 0, 0)
      });
    }));
  }
  const annotation = pdf.context.register(pdf.context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'),
    Rect: [x, y, x + size, y + size], Border: [0, 0, 0],
    A: { Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of(url) }
  }));
  const annotations = page.node.Annots();
  if (annotations) annotations.push(annotation);
  else page.node.set(PDFName.of('Annots'), pdf.context.obj([annotation]));
}

export async function appendEpiEvidencePages(sourceBytes, collaborator) {
  const sourceDocumentHash = epiSha256(sourceBytes);
  const groups = epiEvidenceGroups(collaborator.epiRecords);
  if (!groups.length) return { bytes: sourceBytes, sourceDocumentHash, signedPdfHash: sourceDocumentHash };

  // Always start from the newly rendered sheet, never from a previous signed PDF.
  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 42;
  const width = 595.28 - 2 * margin;
  const pages = [];
  let page;
  let y;
  const draw = (text, size = 8, weight = font, availableWidth = width) => {
    for (const line of wrapped(text, weight, size, availableWidth)) {
      page.drawText(line, { x: margin, y, font: weight, size, color: rgb(0.12, 0.16, 0.22) });
      y -= size + 3;
    }
  };
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    pages.push(page);
    y = 794;
    draw('VERIFICAÇÃO DE ASSINATURAS - FICHA DE EPI', 13, bold);
    draw(`Colaborador: ${collaborator.name || '-'} | ${groups.length} assinatura(s)`, 9);
    draw(`SHA-256 da ficha desta emissão, sem o anexo: ${sourceDocumentHash}`, 7);
    y -= 7;
  };
  newPage();

  groups.forEach((group, index) => {
    const heading = `Assinatura ${index + 1} | ${group.signerName} | UTC: ${utc(group.signedAt)}`;
    // Keep the signature header and its first item together; large batches continue naturally.
    if (y < 220) newPage();
    const top = y;
    draw(heading, 9, bold, width - (group.validationCode ? 59 : 0));
    draw(`Solicitação: ${group.id}`, 7);
    draw(`IP: ${group.ipAddress || 'Não registrado'} | Navegador: ${group.userAgent || 'Não registrado'}`, 7, font, width - (group.validationCode ? 59 : 0));
    if (group.validationCode) {
      drawValidationLink(pdf, page, epiValidationUrl(group.validationCode), 504, top - 44);
      y = Math.min(y, top - 53);
    }

    const lines = [];
    group.records.forEach(record => {
      lines.push(`Linha ${record.rowNumber}: ${record.epiName} | CA: ${record.ca || '-'} | Qtd: ${record.quantity} | Fornecimento: ${dateOnly(record.lendDate)} | Devolução: ${dateOnly(record.devolutionDate)}`);
    });
    lines.push(`SHA-256 da assinatura visual: ${group.signatureImageHash || 'Não registrado'}`);
    lines.push(`SHA-256 do PDF-base da solicitação, sem anexo: ${group.sourceDocumentHash || (group.validationCode && !group.signedPdfHash ? sourceDocumentHash : 'Não registrado (assinatura anterior)')}`);
    // The final PDF hash cannot be embedded in that same PDF. It is available after
    // persistence, in consolidated editions and through the validation endpoint.
    lines.push(`SHA-256 do PDF assinado da solicitação: ${group.signedPdfHash || (group.validationCode ? 'Disponível na validação online' : 'Não registrado')}`);
    lines.push(`Solicitada em (UTC): ${utc(group.createdAt)} | Ciência de privacidade: ${group.privacyNoticeVersion || 'Não registrada'} | UTC: ${utc(group.privacyNoticeAcceptedAt)}`);
    const audit = ['VIEWED', 'PDF_DOWNLOADED'].map(action => {
      const events = group.auditLogs.filter(event => event.action === action).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      return `${action === 'VIEWED' ? 'Visualizações' : 'Downloads'}: ${events.length}${events.length ? ` (primeiro UTC: ${utc(events[0].createdAt)})` : ''}`;
    }).join(' | ');
    lines.push(`Auditoria: ${audit} | Assinada (UTC): ${utc(group.signedAt)}`);
    if (group.validationCode) lines.push(`Validar PDF da solicitação: ${epiValidationUrl(group.validationCode)}`);

    lines.forEach(text => {
      const parts = wrapped(text, font, 7, width);
      parts.forEach(line => {
        if (y < 82) {
          newPage();
          draw(`Assinatura ${index + 1} (continuação) | Solicitação: ${group.id}`, 8, bold);
        }
        draw(line, 7);
      });
    });
    y -= 9;
  });

  pages.forEach((item, index) => {
    item.drawText('Os hashes das solicitações identificam os PDFs preservados de cada assinatura.', { x: margin, y: 51, font, size: 7 });
    item.drawText('A trilha completa de auditoria permanece registrada no sistema Filtrovali.', { x: margin, y: 40, font, size: 7 });
    item.drawText(`Verificação ${index + 1}/${pages.length}`, { x: 475, y: 27, font, size: 7 });
  });
  const bytes = Buffer.from(await pdf.save());
  return { bytes, sourceDocumentHash, signedPdfHash: epiSha256(bytes) };
}
