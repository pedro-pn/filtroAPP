import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import {
  Prisma,
  ReportAuditAction,
  ReportSignatureStatus,
  ReportSignatureType,
  ReportSignerRole,
  ReportVersionStatus
} from '@prisma/client';

import env from '../config/env.js';
import { AUDIT_ENTITY_TYPES, AUDIT_MODULES, recordAuditEvent } from './audit/events.js';
import { normalizeCnpj } from './cnpj.js';
import { createValidationQrCodeMatrix } from './qr-code.js';
import { createSignatureToken, encryptSignatureToken, signatureTokenHash } from './signature-token.js';
import {
  decodableSignatureImageDataUrl,
  normalizeSignerEmail,
  parseSignatureImageDataUrl,
  signatureEvidenceFromRequest,
  signatureTokenExpiresAt
} from './signatures/common.js';
import { resolveStoredUploadPath } from './stored-image.js';

export const INTERNAL_SIGNATURE_PROGRESS_KEY = '__internalSignatureProgress';
export const INTERNAL_SIGNATURE_TOKEN_DAYS = 30;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const evidenceLogoPath = path.resolve(__dirname, '../../assets/Logo/LOGO_COLORIDO.png');

export function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function createInternalSignatureToken() {
  return createSignatureToken();
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
  return signatureTokenHash(token);
}

export function internalSignatureTokenExpiresAt(days = INTERNAL_SIGNATURE_TOKEN_DAYS) {
  return signatureTokenExpiresAt(days);
}

function safeEvidenceFilePart(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 80);
}

export function finalEvidencePdfTarget(sourcePdfPath, sourcePdfUrl, suffix = '') {
  const safeSuffix = safeEvidenceFilePart(suffix);
  const suffixPart = safeSuffix ? `-${safeSuffix}` : '';
  return {
    finalPdfPath: sourcePdfPath.replace(/\.pdf$/i, `-assinado${suffixPart}.pdf`),
    finalPdfUrl: sourcePdfUrl.replace(/\.pdf($|\?)/i, `-assinado${suffixPart}.pdf$1`)
  };
}

function stringValue(value) {
  return String(value || '').trim();
}

function addSigner(signers, seen, signer) {
  const email = normalizeSignerEmail(signer?.email);
  if (!email || seen.has(email)) return;
  const nameFromParts = [signer?.firstName, signer?.lastName]
    .map(value => stringValue(value))
    .filter(Boolean)
    .join(' ');
  signers.push({
    name: nameFromParts || stringValue(signer?.name) || stringValue(signer?.email) || 'Cliente',
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
    firstName: report?.project?.clientSignerFirstName,
    lastName: report?.project?.clientSignerLastName,
    email: report?.project?.clientEmailPrimary
  });
  const configuredSigners = Array.isArray(report?.project?.clientSigners) ? report.project.clientSigners : [];
  for (const signer of configuredSigners) addSigner(signers, seen, signer);
  return signers;
}

export function authenticatedSignerEmail(authUser) {
  const username = stringValue(authUser?.username);
  return username.includes('@') ? normalizeSignerEmail(username) : '';
}

export function authenticatedSignerEmailForReport(report, authUser) {
  const usernameEmail = authenticatedSignerEmail(authUser);
  if (usernameEmail) return usernameEmail;

  const projectCnpj = normalizeCnpj(report?.project?.clientCnpj);
  const accountCnpjs = [
    normalizeCnpj(authUser?.username),
    normalizeCnpj(authUser?.clientCnpj)
  ].filter(cnpj => cnpj.length === 14);
  if (projectCnpj && accountCnpjs.includes(projectCnpj)) {
    return normalizeSignerEmail(report?.project?.clientEmailPrimary);
  }
  return '';
}

export function resolveInternalClientSigner(report, authUser) {
  const email = authenticatedSignerEmailForReport(report, authUser);
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
    declaredName: signature.declaredSignerName || null,
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
  return resolveStoredUploadPath(source) || '';
}

export async function createSignatureAuditLog(tx, {
  reportId,
  versionId = null,
  userId = null,
  action,
  description = null,
  evidence = {}
}) {
  return recordAuditEvent(tx, {
    module: AUDIT_MODULES.RDO,
    entityType: AUDIT_ENTITY_TYPES.REPORT,
    entityId: reportId,
    relatedEntityId: versionId,
    actorUserId: userId,
    action,
    description,
    evidence
  });
}

async function nextVersionNumber(tx, reportId) {
  const aggregate = await tx.reportVersion.aggregate({
    where: { reportId },
    _max: { versionNumber: true }
  });
  return (aggregate._max.versionNumber || 0) + 1;
}

async function lockSignatureRoundForReport(tx, reportId) {
  if (typeof tx.$queryRawUnsafe !== 'function') return;
  await tx.$queryRawUnsafe(`
    WITH advisory_lock AS (
      SELECT pg_advisory_xact_lock(hashtext($1), 0)
    )
    SELECT 1::int AS locked FROM advisory_lock
  `, String(reportId));
}

async function findActiveSignatureRound(tx, reportId) {
  return tx.reportVersion.findFirst({
    where: { reportId, status: ReportVersionStatus.ACTIVE },
    include: { signatures: true },
    orderBy: { versionNumber: 'desc' }
  });
}

export async function ensureInternalSignatureRound(tx, {
  report,
  sourcePdfUrl,
  sourceDocumentHash,
  createdByUserId,
  evidence
}) {
  await lockSignatureRoundForReport(tx, report.id);

  const existing = await findActiveSignatureRound(tx, report.id);
  if (existing?.signatures?.length) return existing;

  const signers = clientSignersForReport(report);
  if (!signers.length) {
    const error = new Error('Nenhum signatario cliente configurado para este relatorio.');
    error.statusCode = 409;
    throw error;
  }
  if (existing) {
    await tx.reportSignature.createMany({
      data: signers.map(signer => ({
        reportId: report.id,
        versionId: existing.id,
        signerName: signer.name,
        signerEmail: signer.email,
        signerRole: signer.role,
        signatureType: ReportSignatureType.ELECTRONIC,
        status: ReportSignatureStatus.PENDING,
        isRequired: signer.isRequired,
        sourceDocumentHash: existing.sourceDocumentHash || sourceDocumentHash
      })),
      skipDuplicates: true
    });
    await createSignatureAuditLog(tx, {
      reportId: report.id,
      versionId: existing.id,
      userId: createdByUserId,
      action: ReportAuditAction.SIGNATURE_ROUND_CREATED,
      description: 'Rodada de assinatura interna criada.',
      evidence
    });
    const active = await findActiveSignatureRound(tx, report.id);
    if (active) return active;
  }

  let version;
  try {
    const versionNumber = await nextVersionNumber(tx, report.id);
    version = await tx.reportVersion.create({
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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const active = await findActiveSignatureRound(tx, report.id);
      if (active) return active;
    }
    throw error;
  }

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
    const encryptedToken = encryptSignatureToken(token);
    await tx.reportSignature.update({
      where: { id: signature.id },
      data: {
        tokenHash: internalSignatureTokenHash(token),
        tokenEncrypted: encryptedToken.tokenEncrypted,
        tokenIv: encryptedToken.tokenIv,
        tokenAuthTag: encryptedToken.tokenAuthTag,
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
  description = 'Rodada de assinatura invalidada por alteracao do relatorio.',
  invalidateSignedRound = false
}) {
  const activeVersion = await tx.reportVersion.findFirst({
    where: { reportId, status: ReportVersionStatus.ACTIVE },
    include: { signatures: true },
    orderBy: { versionNumber: 'desc' }
  });
  if (!activeVersion) return false;
  if (invalidateSignedRound && allRequiredSignaturesCompleted(activeVersion)) return false;
  if (!invalidateSignedRound && activeVersion.signatures.some(signature => signature.status === ReportSignatureStatus.SIGNED)) return false;

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
  signatureImageDataUrl,
  privacyNoticeVersion = null,
  deferAuditLog = false
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
    return { alreadySigned: true, signedSignature: signature };
  }
  const signerName = stringValue(signature.signerName) || 'Cliente';
  const declaredSignerName = stringValue(signer.name) || null;
  const signedDescription = declaredSignerName && declaredSignerName !== signerName
    ? `${signerName} assinou o relatorio. Nome informado no ato: ${declaredSignerName}.`
    : `${signerName} assinou o relatorio.`;

  const updateResult = await tx.reportSignature.updateMany({
    where: { id: signature.id, status: ReportSignatureStatus.PENDING },
    data: {
      status: ReportSignatureStatus.SIGNED,
      signerName,
      declaredSignerName,
      userId,
      ipAddress: evidence.ipAddress || null,
      userAgent: evidence.userAgent || null,
      signatureImageDataUrl,
      privacyNoticeAcceptedAt: privacyNoticeVersion ? new Date() : null,
      privacyNoticeVersion: privacyNoticeVersion || null,
      signedAt: new Date()
    }
  });
  if (updateResult.count !== 1) {
    const current = await tx.reportSignature.findUnique({ where: { id: signature.id } });
    if (current?.status === ReportSignatureStatus.SIGNED) {
      return { alreadySigned: true, signedSignature: current };
    }
    if (current?.status === ReportSignatureStatus.REJECTED || current?.status === ReportSignatureStatus.INVALIDATED) {
      const error = new Error('Esta rodada de assinatura nao esta mais ativa.');
      error.statusCode = 409;
      throw error;
    }
    const error = new Error('Esta assinatura nao esta mais pendente.');
    error.statusCode = 409;
    throw error;
  }

  if (!deferAuditLog) {
    await createSignatureAuditLog(tx, {
      reportId: report.id,
      versionId: version.id,
      userId,
      action: ReportAuditAction.SIGNED,
      description: signedDescription,
      evidence
    });
  }

  return {
    alreadySigned: false,
    signedSignature: {
      id: signature.id,
      signerName,
      declaredSignerName,
      signerEmail: signature.signerEmail,
      status: ReportSignatureStatus.SIGNED
    }
  };
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

function signatureIp(value) {
  const ip = stringValue(value);
  return ip || '-';
}

function summarizedUserAgent(value) {
  const ua = stringValue(value);
  if (!ua) return '-';
  return ua.split(/[()]/)[0].trim().slice(0, 80) || ua.slice(0, 80);
}

function drawText(page, text, x, y, options) {
  page.drawText(String(text || ''), { x, y, ...options });
}

function truncateText(text, maxLength) {
  const value = stringValue(text);
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatDateTimePtBr(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo'
  }).format(date);
}

function documentStatusLabel(report, signatures = []) {
  const required = signatures.filter(signature => signature.isRequired !== false);
  if (required.length && required.every(signature => signature.status === ReportSignatureStatus.SIGNED)) return 'Assinado';
  if (report?.status === 'SIGNED') return 'Assinado';
  if (report?.status === 'APPROVED') return 'Aprovado';
  if (report?.status === 'RETURNED') return 'Devolvido';
  return 'Pendente';
}

function signatureEvidenceStatusLabel(signature) {
  if (signature.status === ReportSignatureStatus.SIGNED) return 'Assinado';
  if (signature.status === ReportSignatureStatus.REJECTED) return 'Reprovado';
  return 'Pendente';
}

function documentName(report, sourcePdfUrl) {
  const type = stringValue(report?.reportType) || 'RDO';
  const number = stringValue(report?.sequenceNumber);
  const project = [report?.project?.code, report?.project?.name].map(stringValue).filter(Boolean).join(' - ');
  const label = [number ? `${type} ${number}` : type, project].filter(Boolean).join(' | ');
  if (label) return label;

  const source = stringValue(sourcePdfUrl);
  const fileName = source ? decodeURIComponent(source.split('/').filter(Boolean).at(-1) || '') : '';
  return fileName || 'Documento';
}

function addLinkAnnotation(pdf, page, { x, y, width, height, url }) {
  if (!url) return;
  const link = pdf.context.register(pdf.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: {
      Type: PDFName.of('Action'),
      S: PDFName.of('URI'),
      URI: PDFString.of(url)
    }
  }));
  const annots = page.node.Annots();
  if (annots) {
    annots.push(link);
  } else {
    page.node.set(PDFName.of('Annots'), pdf.context.obj([link]));
  }
}

function drawValidationQrCode(page, text, x, y, size) {
  const matrix = createValidationQrCodeMatrix(text);
  if (!matrix) return false;

  const quietZone = 4;
  const moduleSize = size / (matrix.length + quietZone * 2);
  const fullSize = moduleSize * (matrix.length + quietZone * 2);
  page.drawRectangle({
    x,
    y,
    width: fullSize,
    height: fullSize,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.78, 0.81, 0.85),
    borderWidth: 0.6
  });

  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix.length; col += 1) {
      if (!matrix[row][col]) continue;
      page.drawRectangle({
        x: x + (col + quietZone) * moduleSize,
        y: y + (matrix.length - row - 1 + quietZone) * moduleSize,
        width: moduleSize,
        height: moduleSize,
        color: rgb(0.02, 0.02, 0.02)
      });
    }
  }
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
    // A ausencia da logo nao deve impedir a geracao do PDF assinado.
  }
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
  finalPdfPath,
  finalPdfUrl,
  report,
  version,
  signatures,
  validationCode
}) {
  const sourceBytes = await fs.readFile(sourcePdfPath);
  const currentSourceHash = sha256Hex(sourceBytes);
  if (!version.sourceDocumentHash || currentSourceHash !== version.sourceDocumentHash) {
    const error = new Error('PDF-base da assinatura interna diverge do hash registrado.');
    error.statusCode = 409;
    throw error;
  }
  const pdf = await PDFDocument.load(sourceBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  const black = rgb(0.08, 0.1, 0.16);
  const muted = rgb(0.35, 0.39, 0.46);
  let y = 790;
  const validationUrl = validationCode ? signatureValidationUrl(validationCode) : '';

  await drawEvidenceLogo(pdf, page);
  drawText(page, 'ASSINATURA ELETRONICA - FILTROVALI RDO', 48, y, { font: bold, size: 15, color: black });
  y -= 30;
  drawText(page, `Status do documento: ${documentStatusLabel(report, signatures)}`, 48, y, { font: bold, size: 10, color: black });
  y -= 16;
  drawText(page, `Nome do documento: ${truncateText(documentName(report, sourcePdfUrl), 86)}`, 48, y, { font, size: 10, color: muted });
  y -= 16;
  drawText(page, `Criado em: ${formatDateTimePtBr(version.createdAt || report.createdAt)}`, 48, y, { font, size: 10, color: muted });
  y -= 16;
  drawText(page, `Projeto: ${report.project?.code || '---'} - ${report.project?.name || 'Sem projeto'}`, 48, y, { font, size: 10, color: muted });
  y -= 16;
  drawText(page, `Hash PDF-base: ${version.sourceDocumentHash}`, 48, y, { font, size: 9, color: muted });
  if (validationCode) {
    y -= 16;
    drawText(page, `Codigo de validacao: ${validationCode}`, 48, y, { font, size: 9, color: muted });
    y -= 16;
    drawText(page, `Validar documento: ${validationUrl}`, 48, y, { font, size: 9, color: muted });
    const qrX = 462;
    const qrY = 670;
    const qrSize = 76;
    if (drawValidationQrCode(page, validationUrl, qrX, qrY, qrSize)) {
      addLinkAnnotation(pdf, page, { x: qrX, y: qrY, width: qrSize, height: qrSize, url: validationUrl });
      drawText(page, 'Escaneie para validar', 462, 657, { font, size: 8, color: muted });
    }
  }
  y -= 28;

  for (const signature of signatures) {
    if (signature.status === ReportSignatureStatus.INVALIDATED) continue;
    if (signature.isRequired === false && signature.status !== ReportSignatureStatus.SIGNED) continue;
    if (y < 120) {
      page = pdf.addPage([595.28, 841.89]);
      y = 790;
    }
    const signerDisplayName = stringValue(signature.declaredSignerName) || stringValue(signature.signerName) || '-';
    drawText(page, `Signatario: ${signerDisplayName}`, 48, y, { font: bold, size: 10, color: black });
    y -= 15;
    drawText(page, `E-mail: ${signature.signerEmail}`, 48, y, { font, size: 10, color: black });
    y -= 15;
    drawText(page, `Papel: Cliente`, 48, y, { font, size: 10, color: black });
    y -= 15;
    if (signature.status !== ReportSignatureStatus.SIGNED) {
      drawText(page, `Status: ${signatureEvidenceStatusLabel(signature)}`, 48, y, { font: bold, size: 10, color: muted });
      y -= 22;
      continue;
    }
    drawText(page, `Data/Hora UTC: ${signature.signedAt ? new Date(signature.signedAt).toISOString() : '-'}`, 48, y, { font, size: 10, color: black });
    y -= 15;
    drawText(page, `IP: ${signatureIp(signature.ipAddress)}`, 48, y, { font, size: 10, color: black });
    y -= 15;
    drawText(page, `Navegador: ${summarizedUserAgent(signature.userAgent)}`, 48, y, { font, size: 10, color: black });
    y -= 18;
    const signatureImage = await embedSignatureImage(pdf, signature);
    if (!signatureImage) {
      const error = new Error('Assinatura visual invalida para geracao do PDF final.');
      error.statusCode = 409;
      throw error;
    }
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
  }

  drawText(page, 'A trilha completa de auditoria permanece registrada no sistema Filtrovali RDO.', 48, 64, { font, size: 9, color: muted });

  const finalBytes = await pdf.save();
  const finalHash = sha256Hex(Buffer.from(finalBytes));
  const target = finalEvidencePdfTarget(sourcePdfPath, sourcePdfUrl);
  const targetPath = finalPdfPath || target.finalPdfPath;
  const targetUrl = finalPdfUrl || target.finalPdfUrl;
  await fs.writeFile(targetPath, finalBytes);
  return {
    finalPdfPath: targetPath,
    finalPdfUrl: targetUrl,
    finalDocumentHash: finalHash
  };
}

export {
  createValidationQrCodeMatrix,
  decodableSignatureImageDataUrl,
  normalizeSignerEmail,
  parseSignatureImageDataUrl,
  ReportAuditAction,
  ReportSignatureStatus,
  ReportVersionStatus,
  signatureEvidenceFromRequest
};
