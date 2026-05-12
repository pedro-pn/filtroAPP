import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  ReportAuditAction,
  ReportSignatureStatus,
  ReportSignatureType,
  ReportSignerRole,
  ReportVersionStatus
} from '@prisma/client';

import env from '../config/env.js';

export const INTERNAL_SIGNATURE_PROGRESS_KEY = '__internalSignatureProgress';
export const INTERNAL_SIGNATURE_TOKEN_DAYS = 30;

export function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function createInternalSignatureToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function createSignatureValidationCode() {
  return crypto.randomBytes(18).toString('base64url');
}

export function signatureValidationUrl(validationCode) {
  const code = stringValue(validationCode);
  if (!code) return '';
  const base = String(env.appUrl || '').replace(/\/+$/, '');
  const pathPart = `/validar-assinatura/${encodeURIComponent(code)}`;
  return base ? `${base}${pathPart}` : pathPart;
}

export function internalSignatureTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export function internalSignatureTokenExpiresAt(days = INTERNAL_SIGNATURE_TOKEN_DAYS) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function parseSignatureImageDataUrl(value) {
  const match = String(value || '').match(/^data:(image\/(?:png|jpe?g));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!bytes.length || bytes.length > 1.5 * 1024 * 1024) return null;
  return { mimeType, bytes };
}

export function normalizeSignerEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function stringValue(value) {
  return String(value || '').trim();
}

function userAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 1000) || null;
}

export function signatureEvidenceFromRequest(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return {
    ipAddress: forwarded || req.ip || null,
    userAgent: userAgent(req)
  };
}

function addSigner(signers, seen, signer) {
  const email = normalizeSignerEmail(signer?.email);
  if (!email || seen.has(email)) return;
  signers.push({
    name: stringValue(signer?.name) || stringValue(signer?.email) || 'Cliente',
    email,
    role: ReportSignerRole.CLIENT,
    isRequired: true
  });
  seen.add(email);
}

export function clientSignersForReport(report) {
  const signers = [];
  const seen = new Set();
  addSigner(signers, seen, {
    name: report?.project?.clientName || 'Cliente',
    email: report?.project?.clientEmailPrimary
  });
  const configuredSigners = Array.isArray(report?.project?.clientSigners) ? report.project.clientSigners : [];
  for (const signer of configuredSigners) addSigner(signers, seen, signer);
  return signers;
}

function authSignerEmail(authUser) {
  const email = normalizeSignerEmail(authUser?.email);
  if (email) return email;
  const username = stringValue(authUser?.username);
  return username.includes('@') ? normalizeSignerEmail(username) : '';
}

export function resolveInternalClientSigner(report, authUser) {
  const email = authSignerEmail(authUser);
  if (!email) {
    const error = new Error('Usuario sem e-mail para assinar o relatorio.');
    error.statusCode = 403;
    throw error;
  }

  const signer = clientSignersForReport(report).find(item => item.email === email);
  if (!signer) {
    const error = new Error('Apenas o cliente principal ou um assinante configurado pode assinar este relatorio.');
    error.statusCode = 403;
    throw error;
  }

  return {
    ...signer,
    name: stringValue(signer.name || authUser?.name) || 'Cliente'
  };
}

export function hasActiveSignedInternalSignature(report) {
  const signatures = Array.isArray(report?.reportSignatures) ? report.reportSignatures : [];
  return signatures.some(signature => signature.status === ReportSignatureStatus.SIGNED);
}

export function buildInternalSignatureProgress(signatures = []) {
  const active = signatures.filter(signature => signature.status !== ReportSignatureStatus.INVALIDATED);
  if (!active.length) return null;

  const required = active.filter(signature => signature.isRequired !== false);
  const total = required.length;
  const signed = required.filter(signature => signature.status === ReportSignatureStatus.SIGNED).length;
  const rejected = active.some(signature => signature.status === ReportSignatureStatus.REJECTED);
  const pending = Math.max(total - signed, 0);
  const signers = active.map(signature => ({
    name: signature.signerName,
    email: signature.signerEmail,
    status: signature.status === ReportSignatureStatus.SIGNED ? 'SIGNED' :
      signature.status === ReportSignatureStatus.REJECTED ? 'REJECTED' : 'PENDING',
    signedAt: signature.signedAt ? signature.signedAt.toISOString?.() || signature.signedAt : null,
    rejectedAt: signature.rejectedAt ? signature.rejectedAt.toISOString?.() || signature.rejectedAt : null
  }));

  return {
    total,
    signed,
    pending,
    rejected,
    signers,
    updatedAt: active
      .map(signature => signature.signedAt || signature.rejectedAt || signature.invalidatedAt || signature.createdAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]?.toISOString?.() || null
  };
}

export function withInternalSignatureProgress(report) {
  const progress = buildInternalSignatureProgress(report?.reportSignatures || []);
  if (!progress) return report;
  return {
    ...report,
    specialConditions: {
      ...(report.specialConditions || {}),
      [INTERNAL_SIGNATURE_PROGRESS_KEY]: progress
    }
  };
}

export function withInternalSignatureProgressList(reports) {
  return Array.isArray(reports) ? reports.map(withInternalSignatureProgress) : reports;
}

export function reportSourcePdfPath(sourcePdfUrl) {
  const source = stringValue(sourcePdfUrl);
  if (!source) return '';
  try {
    const pathname = /^https?:\/\//i.test(source) ? new URL(source).pathname : source;
    if (pathname.startsWith('/relatorios/')) {
      return path.join(env.reportsDir, decodeURIComponent(pathname.slice('/relatorios/'.length)));
    }
    if (pathname.startsWith('/uploads/')) {
      return path.join(env.reportsDir, decodeURIComponent(pathname.slice('/uploads/'.length)));
    }
  } catch {
    return '';
  }
  return '';
}

export async function createSignatureAuditLog(tx, {
  reportId,
  versionId = null,
  userId = null,
  action,
  description = null,
  evidence = {}
}) {
  return tx.reportAuditLog.create({
    data: {
      reportId,
      versionId,
      userId,
      action,
      description,
      ipAddress: evidence.ipAddress || null,
      userAgent: evidence.userAgent || null
    }
  });
}

async function nextVersionNumber(tx, reportId) {
  const aggregate = await tx.reportVersion.aggregate({
    where: { reportId },
    _max: { versionNumber: true }
  });
  return (aggregate._max.versionNumber || 0) + 1;
}

export async function ensureInternalSignatureRound(tx, {
  report,
  sourcePdfUrl,
  sourceDocumentHash,
  createdByUserId,
  evidence
}) {
  const existing = await tx.reportVersion.findFirst({
    where: { reportId: report.id, status: ReportVersionStatus.ACTIVE },
    include: { signatures: true },
    orderBy: { versionNumber: 'desc' }
  });
  if (existing) return existing;

  const signers = clientSignersForReport(report);
  if (!signers.length) {
    const error = new Error('Nenhum signatario cliente configurado para este relatorio.');
    error.statusCode = 409;
    throw error;
  }

  const versionNumber = await nextVersionNumber(tx, report.id);
  const version = await tx.reportVersion.create({
    data: {
      reportId: report.id,
      versionNumber,
      sourcePdfUrl,
      sourceDocumentHash,
      createdByUserId,
      signatures: {
        create: signers.map(signer => ({
          reportId: report.id,
          signerName: signer.name,
          signerEmail: signer.email,
          signerRole: signer.role,
          signatureType: ReportSignatureType.ELECTRONIC,
          status: ReportSignatureStatus.PENDING,
          isRequired: signer.isRequired,
          sourceDocumentHash
        }))
      }
    },
    include: { signatures: true }
  });

  await createSignatureAuditLog(tx, {
    reportId: report.id,
    versionId: version.id,
    userId: createdByUserId,
    action: ReportAuditAction.VERSION_CREATED,
    description: `Versao ${version.versionNumber} criada para assinatura interna.`,
    evidence
  });
  await createSignatureAuditLog(tx, {
    reportId: report.id,
    versionId: version.id,
    userId: createdByUserId,
    action: ReportAuditAction.SIGNATURE_ROUND_CREATED,
    description: 'Rodada de assinatura interna criada.',
    evidence
  });

  return version;
}

export async function issuePendingSignatureTokens(tx, version, options = {}) {
  const tokens = [];
  const now = new Date();
  const expiresAt = options.expiresAt || internalSignatureTokenExpiresAt(options.days);
  const signatures = Array.isArray(version?.signatures) ? version.signatures : [];

  for (const signature of signatures) {
    const expired = signature.tokenExpiresAt && new Date(signature.tokenExpiresAt).getTime() <= now.getTime();
    const needsToken = signature.status === ReportSignatureStatus.PENDING
      && (!signature.tokenHash || !signature.tokenExpiresAt || expired);
    if (!needsToken) continue;

    const token = createInternalSignatureToken();
    await tx.reportSignature.update({
      where: { id: signature.id },
      data: {
        tokenHash: internalSignatureTokenHash(token),
        tokenExpiresAt: expiresAt,
        status: ReportSignatureStatus.PENDING
      }
    });
    tokens.push({
      signatureId: signature.id,
      signerName: signature.signerName,
      signerEmail: signature.signerEmail,
      token,
      expiresAt
    });
  }

  return tokens;
}

export async function invalidateUnsignedInternalSignatureRound(tx, {
  reportId,
  userId = null,
  evidence = {},
  description = 'Rodada de assinatura invalidada por alteracao do relatorio.'
}) {
  const activeVersion = await tx.reportVersion.findFirst({
    where: { reportId, status: ReportVersionStatus.ACTIVE },
    include: { signatures: true },
    orderBy: { versionNumber: 'desc' }
  });
  if (!activeVersion) return false;
  if (activeVersion.signatures.some(signature => signature.status === ReportSignatureStatus.SIGNED)) return false;

  await tx.reportSignature.updateMany({
    where: {
      versionId: activeVersion.id,
      status: { in: [ReportSignatureStatus.PENDING, ReportSignatureStatus.EXPIRED] }
    },
    data: {
      status: ReportSignatureStatus.INVALIDATED,
      invalidatedAt: new Date()
    }
  });
  await tx.reportVersion.update({
    where: { id: activeVersion.id },
    data: { status: ReportVersionStatus.SUPERSEDED }
  });
  await createSignatureAuditLog(tx, {
    reportId,
    versionId: activeVersion.id,
    userId,
    action: ReportAuditAction.SIGNATURES_INVALIDATED,
    description,
    evidence
  });

  return true;
}

export async function signInternalReportVersion(tx, {
  report,
  version,
  signer,
  userId,
  evidence,
  signatureImageDataUrl
}) {
  const signature = version.signatures.find(item => normalizeSignerEmail(item.signerEmail) === signer.email);
  if (!signature) {
    const error = new Error('Assinante nao encontrado nesta rodada de assinatura.');
    error.statusCode = 403;
    throw error;
  }
  if (signature.status === ReportSignatureStatus.REJECTED || signature.status === ReportSignatureStatus.INVALIDATED) {
    const error = new Error('Esta rodada de assinatura nao esta mais ativa.');
    error.statusCode = 409;
    throw error;
  }
  if (signature.status === ReportSignatureStatus.SIGNED) {
    return { alreadySigned: true };
  }
  const signerName = stringValue(signer?.name) || stringValue(signature.signerName) || 'Cliente';

  await tx.reportSignature.update({
    where: { id: signature.id },
    data: {
      status: ReportSignatureStatus.SIGNED,
      signerName,
      userId,
      ipAddress: evidence.ipAddress || null,
      userAgent: evidence.userAgent || null,
      signatureImageDataUrl,
      signedAt: new Date()
    }
  });

  await createSignatureAuditLog(tx, {
    reportId: report.id,
    versionId: version.id,
    userId,
    action: ReportAuditAction.SIGNED,
    description: `${signerName} assinou o relatorio.`,
    evidence
  });

  return { alreadySigned: false };
}

export async function activeVersionWithSignatures(tx, reportId) {
  return tx.reportVersion.findFirst({
    where: { reportId, status: ReportVersionStatus.ACTIVE },
    include: { signatures: { orderBy: { createdAt: 'asc' } } },
    orderBy: { versionNumber: 'desc' }
  });
}

export function allRequiredSignaturesCompleted(version) {
  const required = (version?.signatures || []).filter(signature => signature.isRequired !== false);
  return required.length > 0 && required.every(signature => signature.status === ReportSignatureStatus.SIGNED);
}

function maskedIp(value) {
  const ip = stringValue(value);
  const ipv4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.xxx.xxx`;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 2).join(':')}:xxxx`;
  return ip ? 'registrado' : '-';
}

function summarizedUserAgent(value) {
  const ua = stringValue(value);
  if (!ua) return '-';
  return ua.split(/[()]/)[0].trim().slice(0, 80) || ua.slice(0, 80);
}

function drawText(page, text, x, y, options) {
  page.drawText(String(text || ''), { x, y, ...options });
}

async function embedSignatureImage(pdf, signature) {
  const parsed = parseSignatureImageDataUrl(signature.signatureImageDataUrl);
  if (!parsed) return null;
  try {
    const image = parsed.mimeType === 'image/png'
      ? await pdf.embedPng(parsed.bytes)
      : await pdf.embedJpg(parsed.bytes);
    return image;
  } catch {
    return null;
  }
}

export async function writeFinalEvidencePdf({
  sourcePdfPath,
  sourcePdfUrl,
  report,
  version,
  signatures,
  validationCode
}) {
  const sourceBytes = await fs.readFile(sourcePdfPath);
  const pdf = await PDFDocument.load(sourceBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  const black = rgb(0.08, 0.1, 0.16);
  const muted = rgb(0.35, 0.39, 0.46);
  let y = 790;

  drawText(page, 'ASSINATURA ELETRONICA - FILTROVALI RDO', 48, y, { font: bold, size: 15, color: black });
  y -= 30;
  drawText(page, `Relatorio: ${report.reportType || 'RDO'} ${report.sequenceNumber || ''}`, 48, y, { font, size: 10, color: muted });
  y -= 16;
  drawText(page, `Projeto: ${report.project?.code || '---'} - ${report.project?.name || 'Sem projeto'}`, 48, y, { font, size: 10, color: muted });
  y -= 16;
  drawText(page, `Hash PDF-base: ${version.sourceDocumentHash}`, 48, y, { font, size: 9, color: muted });
  if (validationCode) {
    y -= 16;
    drawText(page, `Codigo de validacao: ${validationCode}`, 48, y, { font, size: 9, color: muted });
    y -= 16;
    drawText(page, `Validar documento: ${signatureValidationUrl(validationCode)}`, 48, y, { font, size: 9, color: muted });
  }
  y -= 28;

  for (const signature of signatures) {
    if (signature.status !== ReportSignatureStatus.SIGNED) continue;
    if (y < 120) {
      page = pdf.addPage([595.28, 841.89]);
      y = 790;
    }
    drawText(page, `Nome: ${signature.signerName}`, 48, y, { font: bold, size: 10, color: black });
    y -= 15;
    drawText(page, `E-mail: ${signature.signerEmail}`, 48, y, { font, size: 10, color: black });
    y -= 15;
    drawText(page, `Papel: Cliente`, 48, y, { font, size: 10, color: black });
    y -= 15;
    drawText(page, `Data/Hora UTC: ${signature.signedAt ? new Date(signature.signedAt).toISOString() : '-'}`, 48, y, { font, size: 10, color: black });
    y -= 15;
    drawText(page, `IP: ${maskedIp(signature.ipAddress)}`, 48, y, { font, size: 10, color: black });
    y -= 15;
    drawText(page, `Navegador: ${summarizedUserAgent(signature.userAgent)}`, 48, y, { font, size: 10, color: black });
    y -= 18;
    const signatureImage = await embedSignatureImage(pdf, signature);
    if (signatureImage) {
      const maxWidth = 180;
      const maxHeight = 64;
      const scale = Math.min(maxWidth / signatureImage.width, maxHeight / signatureImage.height, 1);
      const width = signatureImage.width * scale;
      const height = signatureImage.height * scale;
      drawText(page, 'Assinatura:', 48, y, { font, size: 10, color: black });
      page.drawRectangle({
        x: 120,
        y: y - height + 10,
        width: maxWidth,
        height: maxHeight,
        borderColor: rgb(0.78, 0.81, 0.85),
        borderWidth: 0.6
      });
      page.drawImage(signatureImage, {
        x: 128,
        y: y - height + 18,
        width,
        height
      });
      y -= maxHeight + 18;
    } else {
      drawText(page, 'Assinatura visual: registrada no sistema, imagem indisponivel para incorporacao.', 48, y, { font, size: 9, color: muted });
      y -= 20;
    }
  }

  drawText(page, 'A trilha completa de auditoria permanece registrada no sistema Filtrovali RDO.', 48, 64, { font, size: 9, color: muted });

  const finalBytes = await pdf.save();
  const finalHash = sha256Hex(Buffer.from(finalBytes));
  const finalPdfPath = sourcePdfPath.replace(/\.pdf$/i, '-assinado.pdf');
  const finalPdfUrl = sourcePdfUrl.replace(/\.pdf($|\?)/i, '-assinado.pdf$1');
  await fs.writeFile(finalPdfPath, finalBytes);
  return {
    finalPdfPath,
    finalPdfUrl,
    finalDocumentHash: finalHash
  };
}

export { ReportAuditAction, ReportSignatureStatus, ReportVersionStatus };
