import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { ClientReviewAction, Prisma, ReportSignatureStatus, ReportStatus, ReportType, ReportVersionStatus } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import env from '../../config/env.js';
import { clientCanAccessProject, clientProjectAccessWhereWithSigners } from '../../lib/client-project-access.js';
import { resolveReportCounter, resolveReportManometers, resolveReportUnits } from '../../lib/report-equipment-resolve.js';
import {
  addNotificationPreferencesLink,
  buildReportApprovedEmailTemplate,
  buildReportReapprovedEmailTemplate,
  buildReportRejectedByClientEmailTemplate,
  buildReportSignatureRequestEmailTemplate,
  buildReportSignatureCompletedEmailTemplate,
  buildReportSignatureReceivedEmailTemplate,
  buildReleasedServiceReportsEmailTemplate
} from '../../lib/email-templates.js';
import { clientEmailsEnabled, getMissingMailerConfig, sendClientMail, sendMail } from '../../lib/mailer.js';
import { SIGNATURE_RDO_NOTICE_VERSION, validatePrivacyNoticeAcknowledgement } from '../../lib/privacy-consent.js';
import { saveReportDocx } from '../../lib/report-docx.js';
import { isLikelyCompletePdf, runWithPdfAbortSignal, saveReportPdf } from '../../lib/report-pdf-from-docx.js';
import { saveRtpDocx, saveRtpPdf } from '../../lib/report-rtp.js';
import { saveRlqDocx, saveRlqPdf } from '../../lib/report-rlq.js';
import { saveRcpDocx, saveRcpPdf, calcServiceMinutes } from '../../lib/report-rcp.js';
import { saveRlmDocx, saveRlmPdf } from '../../lib/report-rlm.js';
import { saveRlfDocx, saveRlfPdf } from '../../lib/report-rlf.js';
import { saveRliDocx, saveRliPdf } from '../../lib/report-rli.js';
import { downloadSignedZapSignDocument, getZapSignDocument } from '../../lib/zapsign.js';
import { reconcileLegacyZapSignReport } from '../../lib/zapsign-legacy-reconciliation.js';
import {
  ReportAuditAction,
  activeVersionWithSignatures,
  allRequiredSignaturesCompleted,
  authenticatedSignerEmailForReport,
  clientSignersForReport,
  createSignatureAuditLog,
  createSignatureValidationCode,
  decodableSignatureImageDataUrl,
  ensureInternalSignatureRound,
  finalEvidencePdfTarget,
  hasActiveSignedInternalSignature,
  internalSignatureTokenHash,
  invalidateUnsignedInternalSignatureRound,
  issuePendingSignatureTokens,
  reportSourcePdfPath,
  parseSignatureImageDataUrl,
  resolveInternalClientSigner,
  sha256Hex,
  signInternalReportVersion,
  signatureEvidenceFromRequest,
  withInternalSignatureProgress,
  writeFinalEvidencePdf
} from '../../lib/internal-report-signatures.js';
import { calculateReportOvertime } from '../../lib/overtime.js';
import { coordinatorNotificationEmails, NotificationEmailCategory, notificationRecipientsForEmails } from '../../lib/notification-preferences.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';
import prisma from '../../lib/prisma.js';
import { logSlowOperation } from '../../lib/performance-logging.js';
import { statisticsProjectsCache } from '../../lib/resource-list-cache.js';
import { buildReportFileName, safePath } from '../../lib/report-filename.js';
import {
  normalizeReportUploadReference,
  normalizeStoredReportUploadUrls,
  syncReportUploadAttachments
} from '../../lib/report-upload-attachments.js';
import { grantReportUploadAccess, grantReportsUploadAccess } from '../../lib/transient-upload-access.js';
import { RDO_ACCESS_ROLES, requireAuth, requireModuleRole } from '../../middleware/auth.js';

const router = Router();
const requireRdoAccess = requireModuleRole(...RDO_ACCESS_ROLES);
const requireRdoManager = requireModuleRole('rdo:manager');
const REPORT_LIST_DEFAULT_PAGE_SIZE = 50;
const REPORT_LIST_MAX_PAGE_SIZE = 100;
const COLLABORATOR_EDIT_NOTE = 'Editado pelo colaborador';
const CLIENT_REJECTION_KEY = '__clientRejectedAt';

function reportDateUnchanged(existingReport, nextReportDate) {
  return Boolean(existingReport?.reportDate && reportDateKey(existingReport.reportDate) === reportDateKey(nextReportDate));
}

function previousManometerSnapshot(existingReport, manometer) {
  const previous = existingReport?.specialConditions?.resolvedManometers;
  if (!Array.isArray(previous)) return null;
  return previous.find(item => (
    (manometer.id && item?.id === manometer.id) ||
    (manometer.code && item?.code === manometer.code)
  )) || null;
}

function preserveManometerCalibrationSnapshot(existingReport, nextReportDate, manometer) {
  if (!reportDateUnchanged(existingReport, nextReportDate)) return manometer;
  const previous = previousManometerSnapshot(existingReport, manometer);
  if (!previous?.certificate) return manometer;
  return {
    ...manometer,
    certCode: previous.certCode || manometer.certCode,
    certificate: previous.certificate,
    calibratedAt: previous.calibratedAt || manometer.calibratedAt,
    expiresAt: previous.expiresAt || manometer.expiresAt
  };
}

function previousCounterSnapshot(existingReport, counter) {
  const previous = existingReport?.specialConditions?.resolvedCounter;
  if (!previous) return null;
  if (counter?.code && previous.code === counter.code) return previous;
  if (counter?.serialNumber && previous.serialNumber === counter.serialNumber) return previous;
  return null;
}

function preserveCounterCalibrationSnapshot(existingReport, nextReportDate, counter) {
  if (!counter || !reportDateUnchanged(existingReport, nextReportDate)) return counter;
  const previous = previousCounterSnapshot(existingReport, counter);
  if (!previous?.certificate) return counter;
  return {
    ...counter,
    certificate: previous.certificate
  };
}
const CLIENT_REJECTION_RESOLVED_KEY = '__clientRejectionResolvedAt';
const CLIENT_REJECTION_COMMENT_KEY = '__clientRejectionComment';
const LEGACY_EXTERNAL_SIGNATURE_KEYS = [
  '__zapSignSigners',
  '__zapSignSignatureProgress',
  '__zapSignBatchMainDocToken',
  '__zapSignBatchDocTokens'
];
const publicSignatureLimiter = createMemoryRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Muitas tentativas. Tente novamente mais tarde.'
});
const pdfDownloadJobs = new Map();
let activeGeneratedPdfDownloads = 0;

async function uniqueSignatureValidationCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createSignatureValidationCode();
    const existing = await prisma.reportVersion.findUnique({
      where: { validationCode: code },
      select: { id: true }
    });
    if (!existing) return code;
  }
  const error = new Error('Não foi possível gerar código de validação único.');
  error.statusCode = 500;
  throw error;
}

function formatDatePtBr(date) {
  const value = date instanceof Date ? date.toISOString() : String(date || '');
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }
  return new Date(date).toLocaleDateString('pt-BR');
}

function hasActiveClientRejection(report) {
  const special = report?.specialConditions || {};
  const rejectedAt = special[CLIENT_REJECTION_KEY];
  const resolvedAt = special[CLIENT_REJECTION_RESOLVED_KEY];
  if (rejectedAt) {
    return !resolvedAt || new Date(rejectedAt).getTime() > new Date(resolvedAt).getTime();
  }
  const reviews = Array.isArray(report?.clientReviews) ? report.clientReviews : [];
  const latest = reviews[0];
  if (!latest || latest.action !== ClientReviewAction.REJECTED) return false;
  if (resolvedAt && new Date(latest.createdAt).getTime() <= new Date(resolvedAt).getTime()) return false;
  return report?.status !== ReportStatus.SIGNED;
}

function withClientRejectionCleared(specialConditions) {
  const next = { ...(specialConditions || {}) };
  delete next[CLIENT_REJECTION_KEY];
  delete next[CLIENT_REJECTION_COMMENT_KEY];
  next[CLIENT_REJECTION_RESOLVED_KEY] = new Date().toISOString();
  return next;
}

function withoutLegacyExternalSignatureState(specialConditions) {
  const next = { ...(specialConditions || {}) };
  for (const key of LEGACY_EXTERNAL_SIGNATURE_KEYS) delete next[key];
  return next;
}

function reportNumberLabel(report) {
  if (report.sequenceNumber == null) return '';
  return String(report.sequenceNumber);
}

export function projectEmailRecipients(project) {
  const primary = String(project?.clientEmailPrimary || '').trim().toLowerCase();
  const signerEmails = (project?.clientSigners || [])
    .map(signer => String(signer?.email || '').trim().toLowerCase())
    .filter(Boolean);
  const cc = Array.from(new Set([...(project?.clientEmailCc || []), ...signerEmails]
    .map(email => String(email || '').trim().toLowerCase())
    .filter(Boolean)
    .filter(email => email !== primary)));
  const recipients = [primary, ...cc].filter(Boolean);
  if (primary) return { to: primary, cc, recipients };
  return { to: cc[0] || '', cc: cc.slice(1), recipients };
}

function queueApprovedReportNotification(report) {
  if (report.project?.managerOnly) return;
  const { recipients } = projectEmailRecipients(report.project);
  if (!recipients.length) return;

  const missingMailerConfig = getMissingMailerConfig();
  if (clientEmailsEnabled() && missingMailerConfig.length) {
    console.warn('SMTP não configurado; notificação de aprovação não enviada.', missingMailerConfig.join(', '));
    return;
  }

  const template = buildReportApprovedEmailTemplate({
    projectCode: report.project?.code || '---',
    projectName: report.project?.name || 'Sem projeto',
    clientName: report.project?.clientName || 'Cliente',
    reportType: report.reportType,
    reportNumber: reportNumberLabel(report),
    reportDate: formatDatePtBr(report.reportDate),
    appUrl: env.appUrl || ''
  });

  setImmediate(async () => {
    try {
      const enabledRecipients = await notificationRecipientsForEmails(recipients, NotificationEmailCategory.REPORTS);
      await Promise.all(enabledRecipients.map(recipient => sendClientMail({
        to: recipient.email,
        ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
      })));
    } catch (error) {
      console.error('Falha ao enviar notificação de aprovação do relatório.', {
        reportId: report.id,
        projectId: report.projectId,
        error: error?.message || error
      });
    }
  });
}

function queueReapprovedReportNotification(report) {
  if (report.project?.managerOnly) return;
  const { recipients } = projectEmailRecipients(report.project);
  if (!recipients.length) return;

  const missingMailerConfig = getMissingMailerConfig();
  if (clientEmailsEnabled() && missingMailerConfig.length) {
    console.warn('SMTP não configurado; notificação de reaprovação não enviada.', missingMailerConfig.join(', '));
    return;
  }

  const template = buildReportReapprovedEmailTemplate({
    projectCode: report.project?.code || '---',
    projectName: report.project?.name || 'Sem projeto',
    clientName: report.project?.clientName || 'Cliente',
    reportType: report.reportType,
    reportNumber: reportNumberLabel(report),
    reportDate: formatDatePtBr(report.reportDate),
    appUrl: env.appUrl || ''
  });

  setImmediate(async () => {
    try {
      const enabledRecipients = await notificationRecipientsForEmails(recipients, NotificationEmailCategory.REPORTS);
      await Promise.all(enabledRecipients.map(recipient => sendClientMail({
        to: recipient.email,
        ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
      })));
    } catch (error) {
      console.error('Falha ao enviar notificação de reaprovação do relatório.', {
        reportId: report.id,
        projectId: report.projectId,
        error: error?.message || error
      });
    }
  });
}

function queueClientRejectionNotification(report, comment) {
  const managerEmail = String(report.reviewedBy?.email || '').trim().toLowerCase();
  if (!managerEmail) return;

  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length) {
    console.warn('SMTP não configurado; notificação de reprovação não enviada.', missingMailerConfig.join(', '));
    return;
  }

  const template = buildReportRejectedByClientEmailTemplate({
    projectCode: report.project?.code || '---',
    projectName: report.project?.name || 'Sem projeto',
    clientName: report.clientRejectionReviewer || 'Cliente',
    reportType: report.reportType,
    reportNumber: reportNumberLabel(report),
    reportDate: formatDatePtBr(report.reportDate),
    comment: comment || '',
    appUrl: env.appUrl || ''
  });

  setImmediate(async () => {
    try {
      const [recipient] = await notificationRecipientsForEmails([managerEmail], NotificationEmailCategory.REPORTS);
      if (!recipient) return;
      await sendMail({
        to: recipient.email,
        ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
      });
    } catch (error) {
      console.error('Falha ao enviar notificação de reprovação do relatório.', {
        reportId: report.id,
        error: error?.message || error
      });
    }
  });
}

function clientReviewerLabel(report, user) {
  const email = String(user?.email || '').trim().toLowerCase();
  const signers = Array.isArray(report?.project?.clientSigners) ? report.project.clientSigners : [];
  const signer = signers.find(item => String(item?.email || '').trim().toLowerCase() === email);
  const isPrimaryClient = email && String(report?.project?.clientEmailPrimary || '').trim().toLowerCase() === email;
  const name = String(signer?.name || (isPrimaryClient ? report?.project?.clientName : '') || user?.name || '').trim();

  if (name && email && name.toLowerCase() !== email) return `${name} (${email})`;
  return name || email || 'Cliente';
}

function reportManagerEmail(report) {
  const reviewedByEmail = String(report.reviewedBy?.email || '').trim().toLowerCase();
  if (reviewedByEmail) return reviewedByEmail;
  if (report.createdBy?.role === 'MANAGER') {
    return String(report.createdBy?.email || '').trim().toLowerCase();
  }
  return '';
}

function queueInternalSignatureNotification(report, version, signer, completed) {
  const managerEmail = reportManagerEmail(report);

  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length) {
    console.warn('SMTP não configurado; notificação de assinatura interna não enviada.', missingMailerConfig.join(', '));
    return;
  }

  const required = (version?.signatures || []).filter(signature => signature.isRequired !== false);
  const signedCount = required.filter(signature => signature.status === 'SIGNED').length;
  const requiredCount = required.length;
  const common = {
    projectCode: report.project?.code || '---',
    projectName: report.project?.name || 'Sem projeto',
    reportType: report.reportType,
    reportNumber: reportNumberLabel(report),
    reportDate: formatDatePtBr(report.reportDate),
    signerName: signer?.name || 'Cliente',
    signerEmail: signer?.email || '',
    appUrl: env.appUrl || ''
  };
  const template = completed
    ? buildReportSignatureCompletedEmailTemplate({
      ...common,
      finalDocumentHash: version?.finalDocumentHash || ''
    })
    : buildReportSignatureReceivedEmailTemplate({
      ...common,
      signedCount,
      requiredCount
    });

  setImmediate(async () => {
    try {
      const coordinatorEmails = await coordinatorNotificationEmails();
      const recipients = await notificationRecipientsForEmails(
        [managerEmail, ...coordinatorEmails],
        NotificationEmailCategory.SIGNATURES
      );
      await Promise.all(recipients.map(recipient => sendMail({
        to: recipient.email,
        ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
      })));
    } catch (error) {
      console.error('Falha ao enviar notificação de assinatura interna.', {
        reportId: report.id,
        error: error?.message || error
      });
    }
  });
}

function publicSignatureUrl(token) {
  const base = String(env.appUrl || '').replace(/\/+$/, '');
  const pathPart = `/assinar/${encodeURIComponent(token)}`;
  return base ? `${base}${pathPart}` : pathPart;
}

function signatureRequestEmailDeliveryError(message, details = {}) {
  const error = new Error(message);
  error.statusCode = 503;
  error.details = details;
  return error;
}

function missingSignatureRequestEmailConfigError(missingMailerConfig) {
  return signatureRequestEmailDeliveryError(
    `Configuração SMTP ausente para envio dos links de assinatura: ${missingMailerConfig.join(', ')}`,
    { missingMailerConfig }
  );
}

function signatureRequestEmailDeliveryFailure(error, details = {}) {
  return {
    ok: false,
    retryable: true,
    error: error?.message || String(error || 'Falha ao enviar links de assinatura.'),
    ...details
  };
}

export function signatureRequestEmailRequired(report, version) {
  if (!report || report.project?.managerOnly || !shouldCreateInternalSignatureRound(report)) return false;
  if (!version) return true;
  const now = Date.now();
  return (version.signatures || []).some(signature => {
    if (signature.status !== ReportSignatureStatus.PENDING) return false;
    if (!signature.tokenHash || !signature.tokenExpiresAt) return true;
    return new Date(signature.tokenExpiresAt).getTime() <= now;
  });
}

export function assertSignatureRequestEmailDeliveryConfigured(report, version) {
  if (!signatureRequestEmailRequired(report, version)) return;
  const missingMailerConfig = getMissingMailerConfig();
  if (clientEmailsEnabled() && missingMailerConfig.length) throw missingSignatureRequestEmailConfigError(missingMailerConfig);
}

export async function assertApprovedReportSignatureEmailPreflight(report, client = prisma) {
  if (!report || report.status !== ReportStatus.APPROVED) return;
  if (!shouldCreateInternalSignatureRound(report)) return;
  const activeVersion = report.id
    ? await client.reportVersion.findFirst({
        where: { reportId: report.id, status: ReportVersionStatus.ACTIVE },
        include: { signatures: true },
        orderBy: { versionNumber: 'desc' }
      })
    : null;
  assertSignatureRequestEmailDeliveryConfigured(report, activeVersion);
}

export async function sendSignatureRequestEmails(report, tokens, options = {}) {
  if (!tokens?.length || report.project?.managerOnly) return { ok: true, sentCount: 0, sentTokens: [] };

  const missingMailerConfig = options.missingMailerConfig || getMissingMailerConfig();
  if (clientEmailsEnabled() && missingMailerConfig.length) {
    throw missingSignatureRequestEmailConfigError(missingMailerConfig);
  }
  const mailer = options.mailer || sendClientMail;
  const sentTokens = [];

  for (const tokenData of tokens) {
    const [recipient] = await notificationRecipientsForEmails(
      [tokenData.signerEmail],
      NotificationEmailCategory.SIGNATURES,
      { client: options.client || prisma }
    );
    if (!recipient) continue;
    const daysValid = Math.max(1, Math.ceil((new Date(tokenData.expiresAt).getTime() - Date.now()) / 86_400_000));
    const template = buildReportSignatureRequestEmailTemplate({
      projectCode: report.project?.code || '---',
      projectName: report.project?.name || 'Sem projeto',
      reportType: report.reportType,
      reportNumber: reportNumberLabel(report),
      reportDate: formatDatePtBr(report.reportDate),
      signerName: tokenData.signerName || 'Cliente',
      signUrl: publicSignatureUrl(tokenData.token),
      expiresLabel: `${daysValid} dia${daysValid !== 1 ? 's' : ''}`
    });

    try {
      await mailer({
        to: recipient.email,
        ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
      });
      sentTokens.push(tokenData);
    } catch (error) {
      error.sentTokens = sentTokens.slice();
      error.failedToken = tokenData;
      throw error;
    }
  }

  return { ok: true, sentCount: sentTokens.length, sentTokens };
}

export async function clearIssuedSignatureTokens(client, tokens) {
  for (const tokenData of tokens || []) {
    if (!tokenData?.signatureId || !tokenData?.token) continue;
    await client.reportSignature.updateMany({
      where: {
        id: tokenData.signatureId,
        status: ReportSignatureStatus.PENDING,
        tokenHash: internalSignatureTokenHash(tokenData.token)
      },
      data: {
        tokenHash: null,
        tokenEncrypted: null,
        tokenIv: null,
        tokenAuthTag: null,
        tokenExpiresAt: null
      }
    });
  }
}

export async function deliverIssuedSignatureRequestEmails(report, tokens, options = {}) {
  if (!tokens?.length) return { ok: true, sentCount: 0 };
  const client = options.client || prisma;
  try {
    const delivery = await sendSignatureRequestEmails(report, tokens, options);
    return { ok: true, sentCount: delivery.sentCount || tokens.length };
  } catch (error) {
    const sentTokens = Array.isArray(error?.sentTokens) ? error.sentTokens : [];
    const sentTokenObjects = new Set(sentTokens);
    const sentSignatureIds = new Set(sentTokens.map(token => token?.signatureId).filter(Boolean));
    const retryTokens = tokens.filter(token => !sentTokenObjects.has(token) && !sentSignatureIds.has(token?.signatureId));

    await clearIssuedSignatureTokens(client, retryTokens).catch(cleanupError => {
      console.error('Falha ao limpar tokens de assinatura interna após erro de envio.', {
        reportId: report?.id,
        error: cleanupError?.message || cleanupError
      });
    });
    if (options.throwOnFailure) throw error;
    console.error('Falha ao enviar links de assinatura interna; entrega marcada para retry.', {
      reportId: report?.id,
      error: error?.message || error
    });
    return signatureRequestEmailDeliveryFailure(error, {
      sentCount: sentTokens.length,
      retryCount: retryTokens.length
    });
  }
}

export async function releasedServiceReportEmailAttachments(serviceReports, options = {}) {
  const getPdfDownload = options.getPdfDownload || getReportPdfDownload;
  return Promise.all((serviceReports || []).map(async report => {
    const file = await getPdfDownload(report);
    const fallbackFileName = buildReportFileName(report, 'pdf');
    return {
      filename: safePath(file.fileName || fallbackFileName) || fallbackFileName,
      content: file.buffer,
      contentType: 'application/pdf'
    };
  }));
}

export async function sendReleasedServiceReportsEmail(rdo, serviceReports, options = {}) {
  if (!rdo || rdo.reportType !== ReportType.RDO || rdo.project?.managerOnly || !serviceReports?.length) {
    return { ok: true, sentCount: 0, attachmentCount: 0 };
  }

  const { recipients } = projectEmailRecipients(rdo.project);
  if (!recipients.length) return { ok: true, sentCount: 0, attachmentCount: 0 };

  const missingMailerConfig = options.missingMailerConfig || getMissingMailerConfig();
  if (clientEmailsEnabled() && missingMailerConfig.length) {
    throw new Error(`Configuração SMTP ausente para envio dos relatórios de serviço liberados: ${missingMailerConfig.join(', ')}`);
  }

  const template = buildReleasedServiceReportsEmailTemplate({
    projectCode: rdo.project?.code || '---',
    projectName: rdo.project?.name || 'Sem projeto',
    rdoNumber: reportNumberLabel(rdo),
    rdoDate: formatDatePtBr(rdo.reportDate),
    reports: serviceReports,
    appUrl: env.appUrl || ''
  });
  const attachments = await releasedServiceReportEmailAttachments(serviceReports, options);
  const mailer = options.mailer || sendClientMail;
  const enabledRecipients = await notificationRecipientsForEmails(recipients, NotificationEmailCategory.REPORTS, { client: options.client || prisma });
  await Promise.all(enabledRecipients.map(recipient => mailer({
    to: recipient.email,
    ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl),
    attachments
  })));

  return { ok: true, sentCount: enabledRecipients.length, attachmentCount: attachments.length };
}

export function publicSignaturePayload(signature, status) {
  if (!signature || status === 'INVALID' || status === 'UNAVAILABLE') return { status };
  const payload = {
    status,
    expiresAt: signature.tokenExpiresAt || null,
    signer: {
      signatureId: signature.id,
      name: signature.signerName,
      declaredName: signature.declaredSignerName || null,
      email: signature.signerEmail,
      status: signature.status,
      signedAt: signature.signedAt || null,
      rejectedAt: signature.rejectedAt || null
    },
    report: {
      id: signature.report?.id || '',
      reportType: signature.report?.reportType || '',
      sequenceNumber: signature.report?.sequenceNumber || null,
      reportDate: signature.report?.reportDate || null,
      status: signature.report?.status || '',
      sourceDocumentHash: signature.sourceDocumentHash || '',
      project: {
        code: signature.report?.project?.code || '',
        name: signature.report?.project?.name || '',
        clientName: signature.report?.project?.clientName || ''
      }
    }
  };
  return payload;
}

function publicSignatureReportPayload(signature, status = publicSignatureStatus(signature)) {
  return {
    signatureId: signature.id,
    status,
    expiresAt: signature.tokenExpiresAt || null,
    signer: {
      name: signature.signerName,
      declaredName: signature.declaredSignerName || null,
      email: signature.signerEmail,
      status: signature.status,
      signedAt: signature.signedAt || null,
      rejectedAt: signature.rejectedAt || null
    },
    report: {
      id: signature.report?.id || '',
      reportType: signature.report?.reportType || '',
      sequenceNumber: signature.report?.sequenceNumber || null,
      reportDate: signature.report?.reportDate || null,
      status: signature.report?.status || '',
      sourceDocumentHash: signature.sourceDocumentHash || '',
      project: {
        code: signature.report?.project?.code || '',
        name: signature.report?.project?.name || '',
        clientName: signature.report?.project?.clientName || ''
      }
    }
  };
}

function publicSignatureBatchPayload(anchor, signatures) {
  const reports = (signatures || []).map(signature => publicSignatureReportPayload(signature));
  return {
    project: {
      code: anchor.report?.project?.code || '',
      name: anchor.report?.project?.name || '',
      clientName: anchor.report?.project?.clientName || ''
    },
    pendingCount: reports.length,
    reports
  };
}

export function publicSignatureStatus(signature) {
  if (!signature) return 'INVALID';
  if (signature.report?.deletedAt) return 'UNAVAILABLE';
  if (signature.report?.project?.deletedAt) return 'UNAVAILABLE';
  if (signature.report?.project?.managerOnly) return 'UNAVAILABLE';
  if (signature.tokenExpiresAt && new Date(signature.tokenExpiresAt).getTime() <= Date.now()) return 'EXPIRED';
  if (
    signature.status === 'SIGNED'
    && signature.version?.status === ReportVersionStatus.ACTIVE
    && !signature.version?.finalDocumentHash
    && signature.report?.status === ReportStatus.APPROVED
    && allRequiredSignaturesCompleted(signature.version)
  ) return 'ACTIVE';
  if (signature.status === 'SIGNED') return 'SIGNED';
  if (signature.status === 'REJECTED') return 'REJECTED';
  if (signature.status === 'INVALIDATED') return 'INVALIDATED';
  if (signature.status === 'EXPIRED') return 'EXPIRED';
  if (signature.version?.status !== 'ACTIVE') return 'INVALIDATED';
  if (signature.report?.status === ReportStatus.SIGNED) return 'SIGNED';
  if (signature.report?.status !== ReportStatus.APPROVED) return 'UNAVAILABLE';
  return 'ACTIVE';
}

export async function expirePendingPublicSignature(tx, signature, evidence = {}) {
  if (!signature?.id) return false;
  const expired = await tx.reportSignature.updateMany({
    where: {
      id: signature.id,
      status: ReportSignatureStatus.PENDING,
      tokenExpiresAt: { lte: new Date() }
    },
    data: { status: ReportSignatureStatus.EXPIRED }
  });
  if (expired.count !== 1) return false;

  await createSignatureAuditLog(tx, {
    reportId: signature.reportId,
    versionId: signature.versionId,
    userId: null,
    action: ReportAuditAction.TOKEN_EXPIRED,
    description: 'Link publico de assinatura expirado.',
    evidence
  });
  return true;
}

export function shouldCreateInternalSignatureRound(report) {
  if (report?.reportType !== ReportType.RDO || report?.status !== ReportStatus.APPROVED || report?.project?.managerOnly) return false;
  if (hasActiveClientRejection(report)) return false;
  return clientSignersForReport(report).length > 0;
}

function maskEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const [local, domain] = email.split('@');
  if (!local || !domain) return email ? 'registrado' : '';
  const visible = local.length <= 2 ? local[0] : `${local.slice(0, 2)}***`;
  return `${visible}@${domain}`;
}

export function validationStatus(version) {
  if (!version) return 'INVALID';
  if (version.report?.deletedAt || version.report?.project?.deletedAt) return 'UNAVAILABLE';
  if (version.report?.project?.managerOnly) return 'UNAVAILABLE';
  if (version.status === 'REJECTED') return 'REJECTED';
  if (version.status === 'SUPERSEDED') return 'SUPERSEDED';
  if (version.report?.status !== ReportStatus.SIGNED || !version.finalDocumentHash) return 'UNAVAILABLE';
  return 'VALID';
}

export function publicValidationPayload(version) {
  const status = validationStatus(version);
  if (!version || status === 'INVALID' || status === 'UNAVAILABLE') return { status };
  return {
    status,
    validationCode: version.validationCode,
    sourceDocumentHash: version.sourceDocumentHash,
    finalDocumentHash: version.finalDocumentHash,
    finalPdfCreatedAt: version.createdAt,
    report: {
      id: version.report?.id || '',
      reportType: version.report?.reportType || '',
      sequenceNumber: version.report?.sequenceNumber || null,
      reportDate: version.report?.reportDate || null,
      status: version.report?.status || '',
      project: {
        code: version.report?.project?.code || '',
        name: version.report?.project?.name || '',
        clientName: version.report?.project?.clientName || ''
      }
    },
    signers: (version.signatures || []).map(signature => ({
      name: signature.signerName,
      declaredName: signature.declaredSignerName || null,
      email: maskEmail(signature.signerEmail),
      role: signature.signerRole,
      status: signature.status,
      signedAt: signature.signedAt || null,
      rejectedAt: signature.rejectedAt || null
    }))
  };
}

async function publicSignatureFromToken(token, client = prisma) {
  return client.reportSignature.findUnique({
    where: { tokenHash: internalSignatureTokenHash(token) },
    include: {
      report: { include },
      version: { include: { signatures: { orderBy: { createdAt: 'asc' } } } }
    }
  });
}

async function publicSignatureFromId(signatureId, client = prisma) {
  return client.reportSignature.findUnique({
    where: { id: signatureId },
    include: {
      report: { include },
      version: { include: { signatures: { orderBy: { createdAt: 'asc' } } } }
    }
  });
}

function samePublicSignatureBatchScope(anchor, signature) {
  const anchorProjectId = anchor?.report?.projectId || anchor?.report?.project?.id || '';
  const signatureProjectId = signature?.report?.projectId || signature?.report?.project?.id || '';
  return Boolean(
    anchorProjectId
    && signatureProjectId
    && anchorProjectId === signatureProjectId
    && signerEmailValue(anchor?.signerEmail) === signerEmailValue(signature?.signerEmail)
  );
}

function publicSignatureBatchScopeUnavailable(status) {
  return ['INVALID', 'UNAVAILABLE', 'EXPIRED', 'INVALIDATED', 'REJECTED'].includes(status);
}

async function activePublicSignatureBatchFromAnchor(anchor, client = prisma) {
  if (!anchor || publicSignatureBatchScopeUnavailable(publicSignatureStatus(anchor))) return [];
  const projectId = anchor.report?.projectId || anchor.report?.project?.id;
  const signerEmail = signerEmailValue(anchor.signerEmail);
  if (!projectId || !signerEmail) return publicSignatureStatus(anchor) === 'ACTIVE' ? [anchor] : [];

  const signatures = await client.reportSignature.findMany({
    where: {
      signerEmail: { equals: signerEmail, mode: 'insensitive' },
      status: ReportSignatureStatus.PENDING,
      isRequired: true,
      tokenExpiresAt: { gt: new Date() },
      report: {
        projectId,
        reportType: ReportType.RDO,
        status: ReportStatus.APPROVED,
        deletedAt: null,
        project: {
          deletedAt: null,
          managerOnly: false
        }
      },
      version: {
        status: ReportVersionStatus.ACTIVE,
        finalDocumentHash: null
      }
    },
    orderBy: [
      { report: { reportDate: 'asc' } },
      { report: { sequenceNumber: 'asc' } },
      { createdAt: 'asc' }
    ],
    include: {
      report: { include },
      version: { include: { signatures: { orderBy: { createdAt: 'asc' } } } }
    }
  });

  return signatures.filter(signature => publicSignatureStatus(signature) === 'ACTIVE');
}

async function publicSignatureForTokenScopeOrThrow(token, signatureId, client = prisma, { retryable = false } = {}) {
  if (!signatureId) {
    return retryable
      ? retryablePublicSignatureForConfirmOrThrow(token, client)
      : activePublicSignatureOrThrow(token, client);
  }

  const anchor = await publicSignatureFromToken(token, client);
  const anchorStatus = publicSignatureStatus(anchor);
  if (publicSignatureBatchScopeUnavailable(anchorStatus)) {
    const error = new Error('Link de assinatura indisponível.');
    error.statusCode = anchorStatus === 'INVALID' ? 404 : 409;
    error.publicStatus = anchorStatus;
    throw error;
  }

  const signature = await publicSignatureFromId(signatureId, client);
  const status = publicSignatureStatus(signature);
  if (!samePublicSignatureBatchScope(anchor, signature) || (status !== 'ACTIVE' && !(retryable && isFinalizationRetryableSignature(signature)))) {
    const error = new Error('Link de assinatura indisponível.');
    error.statusCode = !signature ? 404 : 409;
    error.publicStatus = !signature ? 'INVALID' : status;
    throw error;
  }
  return signature;
}

async function activePublicSignatureOrThrow(token, client = prisma) {
  const signature = await publicSignatureFromToken(token, client);
  const status = publicSignatureStatus(signature);
  if (status !== 'ACTIVE') {
    const error = new Error('Link de assinatura indisponível.');
    error.statusCode = status === 'INVALID' ? 404 : 409;
    error.publicStatus = status;
    throw error;
  }
  return signature;
}

async function retryablePublicSignatureForConfirmOrThrow(token, client = prisma) {
  const signature = await publicSignatureFromToken(token, client);
  const status = publicSignatureStatus(signature);
  if (status !== 'ACTIVE' && !isFinalizationRetryableSignature(signature)) {
    const error = new Error('Link de assinatura indisponível.');
    error.statusCode = status === 'INVALID' ? 404 : 409;
    error.publicStatus = status;
    throw error;
  }
  return signature;
}

function isFinalizationRetryableSignature(signature) {
  return !!(
    signature
    && signature.status === ReportSignatureStatus.SIGNED
    && signature.version?.status === ReportVersionStatus.ACTIVE
    && !signature.version?.finalDocumentHash
    && signature.report?.status === ReportStatus.APPROVED
    && !isReportUnavailable(signature.report)
    && allRequiredSignaturesCompleted(signature.version)
  );
}

export function authenticatedSignatureFinalizationRetryable(report, version, signature) {
  return !!(
    report
    && version
    && signature
    && signature.status === ReportSignatureStatus.SIGNED
    && signature.versionId === version.id
    && version.status === ReportVersionStatus.ACTIVE
    && !version.finalDocumentHash
    && report.status === ReportStatus.APPROVED
    && !isReportUnavailable(report)
    && allRequiredSignaturesCompleted(version)
  );
}

function signerEmailValue(value) {
  return String(value || '').trim().toLowerCase();
}

function signatureForSigner(version, signerEmail) {
  const email = signerEmailValue(signerEmail);
  return (version?.signatures || []).find(signature => signerEmailValue(signature.signerEmail) === email) || null;
}

function signatureWouldCompleteRequired(version, signatureId) {
  const required = (version?.signatures || []).filter(signature => signature.isRequired !== false);
  return required.length > 0 && required.every(signature => (
    signature.status === ReportSignatureStatus.SIGNED || signature.id === signatureId
  ));
}

async function assertSignatureFinalizationPreflight(version) {
  const sourcePath = reportSourcePdfPath(version?.sourcePdfUrl);
  if (!sourcePath) {
    const error = new Error('PDF-base da assinatura interna nao foi encontrado.');
    error.statusCode = 409;
    throw error;
  }
  const sourceBuffer = await fs.readFile(sourcePath);
  if (sha256Hex(sourceBuffer) !== version.sourceDocumentHash) {
    const error = new Error('PDF-base da assinatura interna diverge do hash registrado.');
    error.statusCode = 409;
    throw error;
  }
}

export async function resetSignedSignatureForFinalizationRetry(_client, _signatureResult) {
  // Retry finalization without reverting the already persisted signature evidence.
  return false;
}

export async function persistClientSignatureApprovalReview(client, {
  reportId,
  clientUserId,
  comment = null,
  evidence = {}
}) {
  const normalizedComment = String(comment || '').trim();
  const approvedReview = await client.clientReportReview.findFirst({
    where: {
      reportId,
      action: ClientReviewAction.APPROVED
    },
    orderBy: { createdAt: 'desc' }
  });

  const data = {
    comment: normalizedComment || null,
    ipAddress: evidence.ipAddress || null,
    userAgent: evidence.userAgent || null
  };

  if (approvedReview) {
    return client.clientReportReview.update({
      where: { id: approvedReview.id },
      data
    });
  }

  return client.clientReportReview.create({
    data: {
      reportId,
      clientUserId,
      action: ClientReviewAction.APPROVED,
      ...data
    }
  });
}

export async function completedSignatureVersionAfterCommit(client, reportId) {
  const version = await activeVersionWithSignatures(client, reportId);
  return allRequiredSignaturesCompleted(version) ? version : null;
}

export async function rejectPublicInternalSignature({
  token,
  signatureId = null,
  comment,
  evidence,
  client = prisma
}) {
  return client.$transaction(async tx => {
    const signature = await publicSignatureForTokenScopeOrThrow(token, signatureId, tx);
    const rejected = await tx.reportSignature.updateMany({
      where: { id: signature.id, status: ReportSignatureStatus.PENDING },
      data: {
        status: ReportSignatureStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: comment,
        ipAddress: evidence.ipAddress,
        userAgent: evidence.userAgent
      }
    });
    if (rejected.count !== 1) {
      const error = new Error('Link de assinatura indisponível.');
      error.statusCode = 409;
      throw error;
    }
    await tx.reportSignature.updateMany({
      where: {
        versionId: signature.versionId,
        id: { not: signature.id },
        status: { in: [ReportSignatureStatus.PENDING, ReportSignatureStatus.SIGNED] }
      },
      data: {
        status: ReportSignatureStatus.INVALIDATED,
        invalidatedAt: new Date(),
        rejectionReason: comment
      }
    });
    const versionRejected = await tx.reportVersion.updateMany({
      where: { id: signature.versionId, status: ReportVersionStatus.ACTIVE },
      data: { status: ReportVersionStatus.REJECTED }
    });
    if (versionRejected.count !== 1) {
      const error = new Error('Link de assinatura indisponível.');
      error.statusCode = 409;
      throw error;
    }
    await createSignatureAuditLog(tx, {
      reportId: signature.reportId,
      versionId: signature.versionId,
      userId: null,
      action: ReportAuditAction.REJECTED,
      description: 'Relatorio reprovado por link publico de assinatura.',
      evidence
    });
    await createSignatureAuditLog(tx, {
      reportId: signature.reportId,
      versionId: signature.versionId,
      userId: null,
      action: ReportAuditAction.SIGNATURES_INVALIDATED,
      description: 'Assinaturas da rodada foram invalidadas por reprovacao via link publico.',
      evidence
    });
    const updated = await tx.report.updateMany({
      where: { id: signature.reportId, status: ReportStatus.APPROVED },
      data: {
        status: ReportStatus.PENDING,
        specialConditions: {
          ...(signature.report.specialConditions || {}),
          [CLIENT_REJECTION_KEY]: new Date().toISOString(),
          [CLIENT_REJECTION_COMMENT_KEY]: comment
        }
      }
    });
    if (updated.count !== 1) {
      const error = new Error('Link de assinatura indisponível.');
      error.statusCode = 409;
      throw error;
    }
    return tx.report.findUniqueOrThrow({
      where: { id: signature.reportId },
      include
    });
  });
}

function staleClientSignatureRejectionError() {
  const error = new Error('Esta assinatura não está mais pendente para rejeição.');
  error.statusCode = 409;
  return error;
}

function unauthorizedClientSignatureRejectionError() {
  const error = new Error('Cliente não configurado como signatário desta rodada.');
  error.statusCode = 403;
  return error;
}

export async function rejectAuthenticatedClientSignatureRound(tx, {
  report,
  authUser,
  comment,
  evidence
}) {
  const nextSpecialConditions = { ...(report.specialConditions || {}) };
  nextSpecialConditions[CLIENT_REJECTION_KEY] = new Date().toISOString();
  nextSpecialConditions[CLIENT_REJECTION_COMMENT_KEY] = comment || null;
  delete nextSpecialConditions[CLIENT_REJECTION_RESOLVED_KEY];

  const activeVersion = await tx.reportVersion.findFirst({
    where: { reportId: report.id, status: ReportVersionStatus.ACTIVE },
    include: { signatures: true },
    orderBy: { versionNumber: 'desc' }
  });
  if (activeVersion) {
    const authEmail = authenticatedSignerEmailForReport(report, authUser);
    const matchingSignature = activeVersion.signatures.find(signature => signature.signerEmail.toLowerCase() === authEmail);
    if (!matchingSignature) throw unauthorizedClientSignatureRejectionError();

    const rejected = await tx.reportSignature.updateMany({
      where: { id: matchingSignature.id, status: ReportSignatureStatus.PENDING },
      data: {
        status: ReportSignatureStatus.REJECTED,
        userId: authUser.id,
        rejectedAt: new Date(),
        rejectionReason: comment || null,
        ipAddress: evidence.ipAddress,
        userAgent: evidence.userAgent
      }
    });
    if (rejected.count !== 1) throw staleClientSignatureRejectionError();

    await tx.reportSignature.updateMany({
      where: {
        versionId: activeVersion.id,
        id: { not: matchingSignature.id },
        status: { in: [ReportSignatureStatus.PENDING, ReportSignatureStatus.SIGNED] }
      },
      data: {
        status: ReportSignatureStatus.INVALIDATED,
        invalidatedAt: new Date(),
        rejectionReason: comment || null
      }
    });
    const versionRejected = await tx.reportVersion.updateMany({
      where: { id: activeVersion.id, status: ReportVersionStatus.ACTIVE },
      data: { status: ReportVersionStatus.REJECTED }
    });
    if (versionRejected.count !== 1) throw staleClientSignatureRejectionError();
    await createSignatureAuditLog(tx, {
      reportId: report.id,
      versionId: activeVersion.id,
      userId: authUser.id,
      action: ReportAuditAction.REJECTED,
      description: 'Relatorio reprovado pelo cliente durante a rodada de assinatura.',
      evidence
    });
    await createSignatureAuditLog(tx, {
      reportId: report.id,
      versionId: activeVersion.id,
      userId: authUser.id,
      action: ReportAuditAction.SIGNATURES_INVALIDATED,
      description: 'Assinaturas anteriores da rodada foram invalidadas por reprovacao.',
      evidence
    });
  }

  const reportRejected = await tx.report.updateMany({
    where: { id: report.id, status: ReportStatus.APPROVED },
    data: {
      status: ReportStatus.PENDING,
      specialConditions: nextSpecialConditions
    }
  });
  if (reportRejected.count !== 1) throw staleClientSignatureRejectionError();

  return tx.report.findUniqueOrThrow({
    where: { id: report.id },
    include
  });
}

function contentDisposition(fileName) {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._\-]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function sendDownloadBuffer(res, { contentType, fileName, buffer }) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', contentDisposition(fileName));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Content-Length', buffer.length);
  res.removeHeader('ETag');
  return res.end(buffer);
}

const include = {
  project: {
    include: {
      operator: true,
      authorizedUsers: true
    }
  },
  createdBy: {
    include: {
      collaborator: true
    }
  },
  reviewedBy: {
    include: {
      collaborator: true
    }
  },
  collaborators: { include: { collaborator: true } },
  services: {
    include: {
      equipment: true,
      attachments: true
    }
  },
  attachments: true,
  versions: {
    where: { status: 'ACTIVE' },
    orderBy: { versionNumber: 'desc' },
    take: 1
  },
  reportSignatures: {
    where: {
      status: { not: 'INVALIDATED' },
      version: { status: 'ACTIVE' }
    },
    orderBy: { createdAt: 'asc' }
  },
  clientReviews: {
    orderBy: { createdAt: 'desc' },
    include: {
      clientUser: {
        select: {
          id: true,
          name: true,
          email: true,
          username: true
        }
      }
    }
  }
};

const listSummarySelect = {
  id: true,
  projectId: true,
  createdByUserId: true,
  reviewedByUserId: true,
  reportType: true,
  sequenceNumber: true,
  status: true,
  reportDate: true,
  arrivalTime: true,
  departureTime: true,
  lunchBreak: true,
  daytimeCount: true,
  daytimeWorkedMinutes: true,
  nighttimeWorkedMinutes: true,
  daytimeOvertimeMinutes: true,
  nighttimeOvertimeMinutes: true,
  totalOvertimeMinutes: true,
  overtimeReason: true,
  dailyDescription: true,
  reviewNotes: true,
  specialConditions: true,
  approvedAt: true,
  returnedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  project: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      visibleToCollaborators: true,
      managerOnly: true,
      deletedAt: true,
      clientName: true,
      clientCnpj: true,
      clientEmailPrimary: true,
      clientEmailCc: true,
      clientSigners: true,
      operatorId: true
    }
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      collaborator: {
        select: {
          id: true,
          name: true
        }
      }
    }
  },
  collaborators: {
    select: {
      collaboratorId: true,
      collaborator: true
    }
  },
  services: {
    select: {
      id: true,
      serviceType: true,
      equipmentId: true,
      equipment: true,
      system: true,
      material: true,
      startTime: true,
      endTime: true,
      finalized: true,
      extraData: true
    }
  },
  reportSignatures: {
    where: {
      status: { not: 'INVALIDATED' },
      version: { status: 'ACTIVE' }
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      signerName: true,
      declaredSignerName: true,
      signerEmail: true,
      status: true,
      isRequired: true,
      signedAt: true,
      rejectedAt: true
    }
  },
  clientReviews: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      action: true,
      comment: true,
      createdAt: true,
      clientUser: {
        select: {
          id: true,
          name: true,
          email: true,
          username: true
        }
      }
    }
  }
};

export function collaboratorCanAccessProject(auth, project) {
  const collaboratorId = auth.rawUser?.collaboratorId || auth.user?.collaboratorId;
  const authorized = Array.isArray(project?.authorizedUsers)
    && project.authorizedUsers.some(link => link.userId === auth.user?.id);
  return !!(
    project?.isActive
    && !project.deletedAt
    && !project.managerOnly
    && (
      authorized
      || (
        collaboratorId
        && project.visibleToCollaborators
        && project.operatorId === collaboratorId
      )
    )
  );
}

function collaboratorHasAuthorizedProjectLink(auth, project) {
  return Array.isArray(project?.authorizedUsers)
    && project.authorizedUsers.some(link => link.userId === auth.user?.id);
}

export function collaboratorCanAccessReportProject(auth, project) {
  return !!(
    project?.isActive
    && !project.deletedAt
    && !project.managerOnly
    && (
      project.visibleToCollaborators
      || collaboratorHasAuthorizedProjectLink(auth, project)
    )
  );
}

export function collaboratorReportProjectWhere(collaboratorId, userId) {
  if (!collaboratorId && !userId) return { id: '__NO_MATCH__' };
  return {
    isActive: true,
    deletedAt: null,
    managerOnly: false,
    OR: [
      {
        visibleToCollaborators: true,
        operatorId: collaboratorId || '__NO_MATCH__'
      },
      {
        authorizedUsers: {
          some: { userId: userId || '__NO_MATCH__' }
        }
      }
    ]
  };
}

function activeReportProjectWhere(projectWhere = {}) {
  return { ...projectWhere, deletedAt: null };
}

function parseReportStatusFilter(query) {
  const raw = query.statuses ?? query.status;
  const values = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)));
}

function applyReportProjectActiveFilter(where, projectActive) {
  if (projectActive !== 'true' && projectActive !== 'false') return;
  const requestedIsActive = projectActive === 'true';
  const existingProjectWhere = where.project || {};
  if (existingProjectWhere.isActive !== undefined && existingProjectWhere.isActive !== requestedIsActive) {
    where.project = {
      ...existingProjectWhere,
      id: '__NO_MATCH__'
    };
    return;
  }
  where.project = {
    ...existingProjectWhere,
    isActive: requestedIsActive
  };
}

function reportReviewQueueWhere() {
  return {
    OR: [
      { status: { in: [ReportStatus.PENDING, ReportStatus.RETURNED] } },
      {
        status: { not: ReportStatus.SIGNED },
        AND: [
          {
            specialConditions: {
              path: [CLIENT_REJECTION_KEY],
              not: Prisma.AnyNull
            }
          },
          {
            specialConditions: {
              path: [CLIENT_REJECTION_RESOLVED_KEY],
              equals: Prisma.AnyNull
            }
          }
        ]
      }
    ]
  };
}

function applyReportReviewQueueFilter(where, reviewQueue) {
  if (reviewQueue !== 'true') return false;
  where.AND = [...(where.AND || []), reportReviewQueueWhere()];
  return true;
}

function parseReportSearchTerm(query) {
  const term = String(query.search || '').trim();
  return term.length >= 2 ? term.slice(0, 120) : '';
}

function parseReportSortDirection(query) {
  const direction = String(query.reportSort || '').trim().toLowerCase();
  return direction === 'asc' || direction === 'desc' ? direction : null;
}

function parseProjectSortDirection(query) {
  const direction = String(query.projectSort || '').trim().toLowerCase();
  return direction === 'asc' || direction === 'desc' ? direction : null;
}

function stringContainsFilter(term) {
  return { contains: term, mode: 'insensitive' };
}

function buildReportSearchWhere(term) {
  if (!term) return null;
  const contains = stringContainsFilter(term);
  const upperTerm = term.toUpperCase();
  const numericTerm = Number.parseInt(term, 10);
  const or = [
    { overtimeReason: contains },
    { dailyDescription: contains },
    { reviewNotes: contains },
    { project: { code: contains } },
    { project: { name: contains } },
    { project: { clientName: contains } },
    { project: { clientCnpj: contains } },
    { createdBy: { is: { name: contains } } },
    { createdBy: { is: { collaborator: { is: { name: contains } } } } },
    { collaborators: { some: { collaborator: { name: contains } } } },
    { services: { some: { serviceType: contains } } },
    { services: { some: { equipment: { is: { code: contains } } } } },
    { services: { some: { equipment: { is: { name: contains } } } } },
    { services: { some: { system: contains } } },
    { services: { some: { material: contains } } }
  ];
  if (Object.values(ReportType).includes(upperTerm)) or.push({ reportType: upperTerm });
  if (Object.values(ReportStatus).includes(upperTerm)) or.push({ status: upperTerm });
  if (Number.isInteger(numericTerm) && String(numericTerm) === term) {
    or.push({ sequenceNumber: numericTerm });
  }
  return { OR: or };
}

function normalizeReportSearchValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function reportSearchParts(report) {
  return [
    report.reportType,
    report.sequenceNumber,
    report.status,
    report.reportDate,
    report.project?.code,
    report.project?.name,
    report.project?.clientName,
    report.project?.clientCnpj,
    report.createdBy?.name,
    report.createdBy?.collaborator?.name,
    report.overtimeReason,
    report.dailyDescription,
    report.reviewNotes,
    ...(report.collaborators || []).map(item => item.collaborator?.name),
    ...(report.services || []).flatMap(service => [
      service.serviceType,
      service.equipment?.code,
      service.equipment?.name,
      service.system,
      service.material
    ])
  ];
}

function reportMatchesSearch(report, term) {
  if (!term) return true;
  return normalizeReportSearchValue(reportSearchParts(report).join(' '))
    .includes(normalizeReportSearchValue(term));
}

export function approvedRdoHistoryWhere(projectId) {
  return {
    projectId,
    deletedAt: null,
    project: activeReportProjectWhere(),
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED
  };
}

export function derivedReportsForProjectWhere(projectId) {
  return {
    projectId,
    deletedAt: null,
    project: activeReportProjectWhere(),
    reportType: { in: [ReportType.RTP, ReportType.RLQ, ReportType.RCPU, ReportType.RLM, ReportType.RLF, ReportType.RLI] }
  };
}

function reportDateKey(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value || '');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function reportSequenceValue(report) {
  const value = Number(report?.sequenceNumber);
  return Number.isInteger(value) ? value : null;
}

function reportCreatedAtKey(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toISOString();
}

function compareProjectReportOrder(left, right) {
  const leftDate = reportDateKey(left?.reportDate);
  const rightDate = reportDateKey(right?.reportDate);
  if (leftDate && rightDate && leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;

  const leftSequence = reportSequenceValue(left);
  const rightSequence = reportSequenceValue(right);
  if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
    return leftSequence < rightSequence ? -1 : 1;
  }

  const leftCreated = reportCreatedAtKey(left?.createdAt);
  const rightCreated = reportCreatedAtKey(right?.createdAt);
  if (leftCreated && rightCreated && leftCreated !== rightCreated) return leftCreated < rightCreated ? -1 : 1;
  return 0;
}

function reportCollection(allReportsById) {
  if (!allReportsById) return [];
  if (Array.isArray(allReportsById)) return allReportsById;
  if (typeof allReportsById.values === 'function') return Array.from(allReportsById.values());
  return [];
}

export function previousRdosSignedForServiceReport(report, parentRdo, allReportsById) {
  if (!parentRdo && !report?.reportDate) return false;
  const projectId = report?.projectId || parentRdo?.projectId;
  return reportCollection(allReportsById).every(item => {
    if (!item || item.projectId !== projectId) return true;
    if (item.reportType !== ReportType.RDO) return true;
    if (item.deletedAt || item.project?.deletedAt) return true;
    if (compareProjectReportOrder(item, parentRdo || report) >= 0) return true;
    return item.status === ReportStatus.SIGNED;
  });
}

function assignActiveReportProjectWhere(where, projectWhere = {}) {
  where.project = activeReportProjectWhere(projectWhere);
}

function assignClientReportProjectWhere(where, projectWhere = {}) {
  where.project = projectWhere;
}

function isReportUnavailable(report) {
  return !!(report?.deletedAt || report?.project?.deletedAt);
}

function parseReportListPagination(query) {
  if (query.page === undefined && query.pageSize === undefined) return null;

  const page = Number.parseInt(String(query.page || '1'), 10);
  const pageSize = Number.parseInt(String(query.pageSize || REPORT_LIST_DEFAULT_PAGE_SIZE), 10);
  if (!Number.isInteger(page) || page < 1) {
    const error = new Error('Página inválida.');
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > REPORT_LIST_MAX_PAGE_SIZE) {
    const error = new Error(`Tamanho de página inválido. Use um valor entre 1 e ${REPORT_LIST_MAX_PAGE_SIZE}.`);
    error.statusCode = 400;
    throw error;
  }

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize
  };
}

function paginatedReportResponse(items, total, pagination, groups = [], meta = {}) {
  return {
    items,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize))
    },
    groups,
    meta
  };
}

function reportProjectTotalFromItems(items) {
  return new Set(items.map(item => item.projectId).filter(Boolean)).size;
}

function reportGroupTotalsFromItems(items) {
  const totals = new Map();
  for (const item of items) {
    const key = `${item.projectId}::${item.reportType}`;
    const current = totals.get(key) || { projectId: item.projectId, reportType: item.reportType, total: 0 };
    current.total += 1;
    totals.set(key, current);
  }
  return Array.from(totals.values());
}

async function reportGroupTotalsForVisibleProjects(where, items, client = prisma) {
  if (!items.length) return [];
  const projectIds = Array.from(new Set(items.map(item => item.projectId).filter(Boolean)));
  const groupWhere = { ...where };
  if (!groupWhere.projectId && projectIds.length) {
    groupWhere.projectId = { in: projectIds };
  }
  const groups = await client.report.groupBy({
    by: ['projectId', 'reportType'],
    where: groupWhere,
    _count: { _all: true }
  });
  return groups.map(group => ({
    projectId: group.projectId,
    reportType: group.reportType,
    total: group._count._all
  }));
}

async function reportProjectTotal(where, client = prisma) {
  const groups = await client.report.groupBy({
    by: ['projectId'],
    where,
    _count: { _all: true }
  });
  return groups.length;
}

function reportListUsesSummarySelect(query) {
  const value = String(query.summary || '').trim().toLowerCase();
  return value === 'true' || value === '1';
}

export async function canAccessReport(auth, report, options = {}) {
  if (isReportUnavailable(report)) return false;
  if (auth.user.role === 'MANAGER') return true;
  if (report.project?.managerOnly) return false;
  if (auth.user.role === 'COORDINATOR') return true;
  if (auth.user.role === 'CLIENT') {
    if (!clientCanAccessProject(auth, report.project)) return false;
    if (options.clientVisibilityById) {
      return canClientSeeReport(report, options.clientVisibilityById);
    }
    return canClientSeeReportForAccess(report);
  }
  if (auth.user.role === 'COLLABORATOR' && !collaboratorCanAccessReportProject(auth, report.project)) return false;
  if (collaboratorCanMutateReport(auth, report)) return true;
  if (collaboratorHasAuthorizedProjectLink(auth, report.project)) return true;
  return false;
}

export function collaboratorCanMutateReport(auth, report) {
  if (auth.user?.role === 'COLLABORATOR' && !collaboratorCanAccessReportProject(auth, report.project)) return false;
  if (report.createdByUserId === auth.user.id) return true;
  const collabId = auth.rawUser?.collaboratorId || auth.user?.collaboratorId;
  if (collabId && report.project?.operatorId === collabId) return true;
  if (collabId && Array.isArray(report.collaborators)) {
    if (report.collaborators.some(rc => rc.collaboratorId === collabId)) return true;
  }
  return false;
}

export function canClientSeeReport(report, allReportsById) {
  if (isReportUnavailable(report)) return false;
  if (!report || !report.project?.clientCnpj) return false;
  if (report.reportType === ReportType.RDO) {
    return report.status === ReportStatus.APPROVED || report.status === ReportStatus.SIGNED || hasActiveClientRejection(report);
  }
  if (report.specialConditions?.serviceOnly === true) {
    return report.status === ReportStatus.APPROVED || report.status === ReportStatus.SIGNED;
  }
  const parentId = report.specialConditions?.parentRdoId;
  if (!parentId) return false;
  const parent = allReportsById.get(parentId);
  return !!(
    parent
    && parent.status === ReportStatus.SIGNED
    && previousRdosSignedForServiceReport(report, parent, allReportsById)
  );
}

async function projectReportsForClientVisibility(projectId, client = prisma) {
  return client.report.findMany({
    where: { projectId, deletedAt: null, project: activeReportProjectWhere() },
    include
  });
}

async function projectReportsForClientVisibilityProjectIds(projectIds, client = prisma) {
  const ids = Array.from(new Set((projectIds || []).filter(Boolean)));
  if (!ids.length) return [];
  return client.report.findMany({
    where: { projectId: { in: ids }, deletedAt: null, project: activeReportProjectWhere() },
    include
  });
}

async function clientVisibilityMapForReports(reports, client = prisma) {
  const projectIds = reports.map(report => report?.projectId).filter(Boolean);
  const projectReports = await projectReportsForClientVisibilityProjectIds(projectIds, client);
  return new Map(projectReports.map(item => [item.id, item]));
}

export async function canClientSeeReportForAccess(report, client = prisma) {
  if (!report?.projectId) return false;
  const projectReports = await projectReportsForClientVisibility(report.projectId, client);
  const byId = new Map(projectReports.map(item => [item.id, item]));
  return canClientSeeReport(report, byId);
}

function releasedServiceReportPayload(report) {
  return {
    id: report.id,
    projectId: report.projectId,
    reportType: report.reportType,
    sequenceNumber: report.sequenceNumber ?? null,
    reportDate: report.reportDate,
    project: {
      id: report.project?.id || report.projectId,
      code: report.project?.code || '',
      name: report.project?.name || ''
    }
  };
}

export async function releasedServiceReportsAfterRdoSignature(rdo, client = prisma) {
  if (!rdo || rdo.reportType !== ReportType.RDO || rdo.status !== ReportStatus.SIGNED) return [];
  const projectReports = await projectReportsForClientVisibility(rdo.projectId, client);
  const byId = new Map(projectReports.map(item => [item.id, item]));
  return projectReports
    .filter(report => {
      if (report.reportType === ReportType.RDO) return false;
      const parentId = report.specialConditions?.parentRdoId;
      if (!parentId) return false;
      const parent = byId.get(parentId);
      const signedRdoReleasedThisReport = parentId === rdo.id || compareProjectReportOrder(rdo, parent || report) < 0;
      return signedRdoReleasedThisReport && canClientSeeReport(report, byId);
    })
    .map(releasedServiceReportPayload);
}

export function removedPendingRequiredClientSignatureIds(report, version = null) {
  const activeVersion = version || (Array.isArray(report?.versions)
    ? report.versions.find(item => item.status === ReportVersionStatus.ACTIVE)
    : null);
  const currentSignerEmails = new Set(clientSignersForReport(report).map(signer => signer.email));
  const openSignatureStatuses = new Set([
    ReportSignatureStatus.PENDING,
    ReportSignatureStatus.EXPIRED
  ]);
  const roundHasCurrentSigner = (activeVersion?.signatures || [])
    .some(signature => signature.isRequired !== false && currentSignerEmails.has(signerEmailValue(signature.signerEmail)));
  const pendingRequired = (activeVersion?.signatures || []).filter(signature => (
    openSignatureStatuses.has(signature.status)
    && signature.isRequired !== false
  ));
  if (!roundHasCurrentSigner) return pendingRequired.map(signature => signature.id);
  return pendingRequired
    .filter(signature => !currentSignerEmails.has(signerEmailValue(signature.signerEmail)))
    .map(signature => signature.id);
}

// Signatários atuais do projeto que ainda não têm uma assinatura "viva" (não invalidada) na
// rodada ativa — ou seja, foram incluídos depois que a rodada foi criada e precisam ser
// adicionados a ela (preservando as assinaturas já feitas dos demais).
export function addedRequiredClientSigners(report, version = null) {
  const activeVersion = version || (Array.isArray(report?.versions)
    ? report.versions.find(item => item.status === ReportVersionStatus.ACTIVE)
    : null);
  if (!activeVersion) return [];
  const liveSignerEmails = new Set((activeVersion.signatures || [])
    .filter(signature => signature.status !== ReportSignatureStatus.INVALIDATED)
    .map(signature => signerEmailValue(signature.signerEmail)));
  return clientSignersForReport(report)
    .filter(signer => signer.isRequired !== false && !liveSignerEmails.has(signer.email));
}

export async function reconcileProjectClientSignatureRequirements(projectId, options = {}) {
  if (!projectId) return { updatedReports: 0, finalizedReports: 0 };
  const evidence = options.evidence || {};
  const userId = options.userId || null;
  const sendReleasedEmails = options.sendReleasedEmails !== false;
  const reports = await prisma.report.findMany({
    where: {
      projectId,
      deletedAt: null,
      reportType: ReportType.RDO,
      status: ReportStatus.APPROVED,
      versions: { some: { status: ReportVersionStatus.ACTIVE } }
    },
    include
  });

  let updatedReports = 0;
  let finalizedReports = 0;
  for (const report of reports) {
    if (isReportUnavailable(report) || report.project?.managerOnly || hasActiveClientRejection(report)) continue;
    // Carrega a versão ativa COM as assinaturas (o include de listagem não traz signatures).
    const version = await activeVersionWithSignatures(prisma, report.id);
    if (!version) continue;

    const removedSignatureIds = removedPendingRequiredClientSignatureIds(report, version);
    const addedSigners = addedRequiredClientSigners(report, version);
    if (!removedSignatureIds.length && !addedSigners.length) continue;

    const hasAdditions = addedSigners.length > 0;
    const currentSignerEmails = new Set(clientSignersForReport(report).map(signer => signer.email));
    const roundHasCurrentSigner = (version.signatures || [])
      .some(signature => signature.isRequired !== false && currentSignerEmails.has(signerEmailValue(signature.signerEmail)));

    // Rodada órfã (nenhum signatário atual permanece na rodada): substitui por uma nova rodada
    // montada com os signatários atuais do projeto (já inclui os novos). Não há assinatura de
    // signatário atual a preservar neste caso.
    if (removedSignatureIds.length && !roundHasCurrentSigner) {
      await prisma.$transaction(async tx => {
        await tx.reportSignature.updateMany({
          where: {
            id: { in: removedSignatureIds },
            versionId: version.id,
            status: { in: [ReportSignatureStatus.PENDING, ReportSignatureStatus.EXPIRED] }
          },
          data: {
            status: ReportSignatureStatus.INVALIDATED,
            isRequired: false,
            invalidatedAt: new Date(),
            tokenHash: null,
            tokenExpiresAt: null
          }
        });
        await tx.reportVersion.update({
          where: { id: version.id },
          data: { status: ReportVersionStatus.SUPERSEDED }
        });
        await createSignatureAuditLog(tx, {
          reportId: report.id,
          versionId: version.id,
          userId,
          action: ReportAuditAction.SIGNATURES_INVALIDATED,
          description: 'Rodada de assinatura substituida por alteracao dos signatarios do projeto.',
          evidence
        });
      });
      updatedReports += 1;
      const freshReport = await prisma.report.findUnique({ where: { id: report.id }, include });
      await ensureInternalSignatureRoundAndNotify(freshReport, userId, evidence);
      continue;
    }

    // Preserva a rodada ativa (e as assinaturas já feitas). Aplica, conforme o caso:
    //  - invalida os signatários removidos;
    //  - inclui os novos signatários (PENDING), reativando um registro INVALIDATED se já existir;
    //  - reabre assinaturas EXPIRADAS de signatários ainda atuais (qualquer alteração reabre);
    //  - emite token + e-mail apenas para os novos/reabertos (não reincomoda quem já assinou).
    const expiredCurrentSignatureIds = (version.signatures || [])
      .filter(signature => signature.status === ReportSignatureStatus.EXPIRED
        && signature.isRequired !== false
        && currentSignerEmails.has(signerEmailValue(signature.signerEmail)))
      .map(signature => signature.id);
    const invalidatedSignatureByEmail = new Map((version.signatures || [])
      .filter(signature => signature.status === ReportSignatureStatus.INVALIDATED)
      .map(signature => [signerEmailValue(signature.signerEmail), signature]));

    const reconciled = await prisma.$transaction(async tx => {
      if (removedSignatureIds.length) {
        await tx.reportSignature.updateMany({
          where: {
            id: { in: removedSignatureIds },
            versionId: version.id,
            status: { in: [ReportSignatureStatus.PENDING, ReportSignatureStatus.EXPIRED] }
          },
          data: {
            status: ReportSignatureStatus.INVALIDATED,
            isRequired: false,
            invalidatedAt: new Date(),
            tokenHash: null,
            tokenExpiresAt: null
          }
        });
      }
      for (const signer of addedSigners) {
        const reusable = invalidatedSignatureByEmail.get(signer.email);
        if (reusable) {
          await tx.reportSignature.update({
            where: { id: reusable.id },
            data: {
              signerName: signer.name,
              signerRole: signer.role,
              status: ReportSignatureStatus.PENDING,
              isRequired: true,
              invalidatedAt: null,
              signedAt: null,
              rejectedAt: null,
              rejectionReason: null,
              tokenHash: null,
              tokenEncrypted: null,
              tokenIv: null,
              tokenAuthTag: null,
              tokenExpiresAt: null
            }
          });
        } else {
          await tx.reportSignature.create({
            data: {
              reportId: report.id,
              versionId: version.id,
              signerName: signer.name,
              signerEmail: signer.email,
              signerRole: signer.role,
              status: ReportSignatureStatus.PENDING,
              isRequired: true,
              sourceDocumentHash: version.sourceDocumentHash
            }
          });
        }
      }
      if (expiredCurrentSignatureIds.length) {
        await tx.reportSignature.updateMany({
          where: { id: { in: expiredCurrentSignatureIds }, versionId: version.id, status: ReportSignatureStatus.EXPIRED },
          data: { status: ReportSignatureStatus.PENDING, tokenHash: null, tokenExpiresAt: null }
        });
      }
      await createSignatureAuditLog(tx, {
        reportId: report.id,
        versionId: version.id,
        userId,
        action: hasAdditions ? ReportAuditAction.SIGNATURE_ROUND_CREATED : ReportAuditAction.SIGNATURES_INVALIDATED,
        description: hasAdditions
          ? 'Rodada de assinatura atualizada: signatarios do projeto incluidos/renovados.'
          : 'Assinaturas pendentes de signatarios removidos deixaram de ser obrigatorias.',
        evidence
      });
      const refreshed = await activeVersionWithSignatures(tx, report.id);
      const shouldIssueTokens = hasAdditions || expiredCurrentSignatureIds.length > 0;
      const tokens = shouldIssueTokens ? await issuePendingSignatureTokens(tx, refreshed) : [];
      return { version: refreshed, tokens };
    });
    updatedReports += 1;

    if (reconciled.tokens.length) {
      await deliverIssuedSignatureRequestEmails(report, reconciled.tokens, {});
    }

    if (allRequiredSignaturesCompleted(reconciled.version)) {
      const finalized = await finalizeInternalSignatureRound(report, reconciled.version, evidence, userId);
      finalizedReports += finalized?.status === ReportStatus.SIGNED ? 1 : 0;
      if (sendReleasedEmails && finalized?.status === ReportStatus.SIGNED) {
        const released = await releasedServiceReportsAfterRdoSignature(finalized);
        if (released.length) queueReleasedServiceReportsEmailAfterRdoSignature(finalized, released);
      }
    }
  }

  return { updatedReports, finalizedReports };
}

function queueReleasedServiceReportsEmailAfterRdoSignature(rdo, releasedReports = null) {
  if (!rdo || rdo.reportType !== ReportType.RDO || rdo.status !== ReportStatus.SIGNED) return;

  setImmediate(async () => {
    try {
      const released = Array.isArray(releasedReports)
        ? releasedReports
        : await releasedServiceReportsAfterRdoSignature(rdo);
      const releasedIds = released.map(report => report.id).filter(Boolean);
      if (!releasedIds.length) return;

      const serviceReports = await prisma.report.findMany({
        where: {
          id: { in: releasedIds },
          deletedAt: null
        },
        include
      });
      const emailRdo = await prisma.report.findUnique({
        where: { id: rdo.id },
        include
      });
      if (!emailRdo) return;
      const byId = new Map(serviceReports.map(report => [report.id, report]));
      const orderedReports = releasedIds.map(id => byId.get(id)).filter(Boolean);
      if (!orderedReports.length) return;

      await sendReleasedServiceReportsEmail(emailRdo, orderedReports);
    } catch (error) {
      console.error('Falha ao enviar relatórios de serviço liberados por e-mail.', {
        reportId: rdo?.id,
        projectId: rdo?.projectId,
        error: error?.message || error
      });
    }
  });
}

function assertReportMutable(report) {
  if (report.status === ReportStatus.SIGNED) {
    const error = new Error('Relatório assinado não pode mais ser alterado.');
    error.statusCode = 409;
    throw error;
  }
  if (hasActiveSignedInternalSignature(report)) {
    const error = new Error('Relatório com assinatura iniciada não pode mais ser alterado.');
    error.statusCode = 409;
    throw error;
  }
}

function reportUpdatedAtToken(report) {
  const value = report?.updatedAt;
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function assertSignatureSourceCurrent(currentReport, expectedUpdatedAt) {
  if (!expectedUpdatedAt) return;
  if (reportUpdatedAtToken(currentReport) === expectedUpdatedAt) return;
  const error = new Error('A solicitação de assinatura foi atualizada por outra operação.');
  error.statusCode = 409;
  throw error;
}

function reportPdfFileName(report, saved) {
  if (saved?.fileName) return saved.fileName;
  return buildReportFileName(report, 'pdf');
}

function generatedReportPdfTarget(report) {
  if (!report?.project) return null;
  const projectFolderName = safePath(`Missão ${report.project.code} - ${report.project.name}`);
  const fileName = buildReportFileName(report, 'pdf');
  return {
    fileName,
    targetPath: path.join(env.uploadDir, projectFolderName, report.reportType, fileName)
  };
}

function reportContentUpdatedAtMs(report) {
  const value = report?.updatedAt || report?.createdAt;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function reportVersionCreatedAtMs(version) {
  const value = version?.createdAt;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function reportVersionMatchesCurrentContent(report, version) {
  const reportUpdatedAt = reportContentUpdatedAtMs(report);
  const versionCreatedAt = reportVersionCreatedAtMs(version);
  return Boolean(versionCreatedAt && (!reportUpdatedAt || versionCreatedAt >= reportUpdatedAt));
}

function calibrationCertificateUrlsForReport(report) {
  const sc = report?.specialConditions || {};
  const urls = [];
  if (Array.isArray(sc.resolvedManometers)) {
    urls.push(...sc.resolvedManometers.map(item => item?.certificate?.publicUrl));
  }
  urls.push(sc.resolvedCounter?.certificate?.publicUrl);
  return [...new Set(urls.map(url => String(url || '').trim()).filter(Boolean))];
}

function uploadFingerprintValue(value) {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return '';
    const normalized = normalizeReportUploadReference(raw);
    if (normalized) return normalized;
    return /^data:image\//i.test(raw) ? raw : '';
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const raw = String(
    value.url
    || value.storagePath
    || value.path
    || value.publicUrl
    || value.href
    || value.src
    || value.source
    || value.dataUrl
    || ''
  ).trim();
  if (raw) {
    const normalized = normalizeReportUploadReference(raw);
    if (normalized) return normalized;
    if (/^data:image\//i.test(raw)) return raw;
  }

  const fileName = String(value.fileName || value.name || '').trim();
  const mimeType = String(value.mimeType || '').trim().toLowerCase();
  return fileName && mimeType.startsWith('image/') ? fileName : '';
}

function addUploadFingerprint(urls, value) {
  const fingerprint = uploadFingerprintValue(value);
  if (fingerprint) urls.push(fingerprint);
}

function collectUploadFingerprintsFromGroups(urls, groups) {
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    if (!Array.isArray(group.files)) continue;
    for (const file of group.files) addUploadFingerprint(urls, file);
  }
}

function collectUploadFingerprintsFromServiceData(urls, serviceData) {
  if (!serviceData || typeof serviceData !== 'object' || Array.isArray(serviceData)) return;
  collectUploadFingerprintsFromGroups(urls, serviceData.__uploads__);
  for (const [key, value] of Object.entries(serviceData)) {
    if (key === '__uploads__') continue;
    if (Array.isArray(value)) {
      for (const item of value) addUploadFingerprint(urls, item);
    } else {
      addUploadFingerprint(urls, value);
    }
  }
}

export function pdfUploadUrlsForReport(report) {
  const urls = [];
  const special = report?.specialConditions || {};
  if (Array.isArray(special.generalUploads)) {
    for (const item of special.generalUploads) addUploadFingerprint(urls, item);
  }
  collectUploadFingerprintsFromServiceData(urls, special.serviceData);
  for (const attachment of report?.attachments || []) {
    addUploadFingerprint(urls, attachment);
  }
  for (const service of report?.services || []) {
    collectUploadFingerprintsFromGroups(urls, service?.extraData?.__uploads__);
    for (const attachment of service?.attachments || []) {
      addUploadFingerprint(urls, attachment);
    }
  }
  return [...new Set(urls.map(url => String(url || '').trim()).filter(Boolean))];
}

function pdfCacheMetadataForReport(report) {
  return {
    version: 2,
    reportId: report.id,
    reportUpdatedAt: reportUpdatedAtToken(report),
    fingerprint: sha256Hex(JSON.stringify({
      photos: pdfUploadUrlsForReport(report).sort(),
      calibrationLinks: calibrationCertificateUrlsForReport(report).sort(),
      overtimeAccepted: report?.specialConditions?.overtimeAccepted !== false,
      daytimeOvertimeMinutes: report?.daytimeOvertimeMinutes || 0,
      nighttimeOvertimeMinutes: report?.nighttimeOvertimeMinutes || 0,
      overtimeReason: report?.overtimeReason || ''
    }))
  };
}

function pdfCacheMetadataPath(pdfPath) {
  return `${pdfPath}.meta.json`;
}

async function readPdfCacheMetadata(pdfPath) {
  try {
    return JSON.parse(await fs.readFile(pdfCacheMetadataPath(pdfPath), 'utf8'));
  } catch {
    return null;
  }
}

async function writePdfCacheMetadata(pdfPath, report) {
  await fs.writeFile(
    pdfCacheMetadataPath(pdfPath),
    JSON.stringify(pdfCacheMetadataForReport(report), null, 2),
    'utf8'
  );
}

function pdfCacheMetadataMatches(report, metadata) {
  const expected = pdfCacheMetadataForReport(report);
  return Boolean(
    metadata
    && metadata.version === expected.version
    && metadata.reportId === expected.reportId
    && metadata.reportUpdatedAt === expected.reportUpdatedAt
    && metadata.fingerprint === expected.fingerprint
  );
}

async function activeSourceVersionMatchesCurrentPdf(report, version) {
  if (!reportVersionMatchesCurrentContent(report, version)) return false;
  const sourcePath = reportSourcePdfPath(version.sourcePdfUrl);
  if (!sourcePath) return false;
  if (!pdfCacheMetadataMatches(report, await readPdfCacheMetadata(sourcePath))) return false;
  try {
    return sha256Hex(await fs.readFile(sourcePath)) === version.sourceDocumentHash;
  } catch {
    return false;
  }
}

function pdfBufferContainsExpectedLinks(buffer, expectedUrls) {
  if (!expectedUrls.length) return true;
  const content = buffer.toString('latin1');
  return expectedUrls.every(url => content.includes(url));
}

async function getFreshGeneratedReportPdf(report) {
  const target = generatedReportPdfTarget(report);
  if (!target) return null;

  const stat = await fs.stat(target.targetPath).catch(() => null);
  if (!stat?.isFile() || stat.size < 1024) return null;

  const reportUpdatedAt = reportContentUpdatedAtMs(report);
  if (reportUpdatedAt && stat.mtimeMs < reportUpdatedAt) return null;
  if (!(await isLikelyCompletePdf(target.targetPath))) return null;
  if (!pdfCacheMetadataMatches(report, await readPdfCacheMetadata(target.targetPath))) return null;
  const buffer = await fs.readFile(target.targetPath);
  if (!pdfBufferContainsExpectedLinks(buffer, calibrationCertificateUrlsForReport(report))) return null;

  return {
    fileName: target.fileName,
    buffer
  };
}

async function generateReportPdfDownload(report) {
  if (activeGeneratedPdfDownloads > 0) {
    const error = new Error('Outra geração de PDF está em andamento. Tente novamente em alguns segundos.');
    error.statusCode = 503;
    throw error;
  }
  activeGeneratedPdfDownloads += 1;
  const startedAt = Date.now();
  try {
    const saved = await generateReportPdfAsset(report);
    await writePdfCacheMetadata(saved.targetPath, report);
    const buffer = await fs.readFile(saved.targetPath);
    logSlowOperation('reports.pdf.generate', Date.now() - startedAt, {
      reportId: report.id,
      reportType: report.reportType,
      bytes: buffer.length
    });
    return {
      fileName: saved.fileName,
      buffer
    };
  } finally {
    activeGeneratedPdfDownloads = Math.max(0, activeGeneratedPdfDownloads - 1);
  }
}

async function getOrCreateGeneratedReportPdf(report) {
  const cached = await getFreshGeneratedReportPdf(report);
  if (cached) return cached;

  const key = `${report.id}:${reportContentUpdatedAtMs(report)}:${report.reportType}:${report.sequenceNumber ?? ''}`;
  const existingJob = pdfDownloadJobs.get(key);
  if (existingJob) return existingJob;

  const job = generateReportPdfDownload(report);
  pdfDownloadJobs.set(key, job);
  try {
    return await job;
  } finally {
    pdfDownloadJobs.delete(key);
  }
}

async function withCurrentServiceLeaderSnapshot(report) {
  const parentRdoId = report?.specialConditions?.parentRdoId;
  if (!parentRdoId || report.reportType === ReportType.RDO) return report;

  const parent = await prisma.report.findUnique({
    where: { id: parentRdoId },
    include: {
      project: { include: { operator: true } },
      createdBy: { include: { collaborator: true } }
    }
  });
  if (!parent) return report;

  const leaderSnapshot = projectLeaderSnapshot(parent.project) || parent.specialConditions?.__leaderSnapshot || null;
  return {
    ...report,
    specialConditions: {
      ...(report.specialConditions || {}),
      __leaderSnapshot: leaderSnapshot
    }
  };
}

async function generateReportPdfAsset(report) {
  report = await withCurrentServiceLeaderSnapshot(report);
  report = withServiceUploadFields(report);
  if (report.reportType === 'RTP') return saveRtpPdf(report);
  if (report.reportType === 'RLQ') return saveRlqPdf(report);
  if (report.reportType === 'RCPU') return saveRcpPdf(report);
  if (report.reportType === 'RLM') return saveRlmPdf(report);
  if (report.reportType === 'RLF') return saveRlfPdf(report);
  if (report.reportType === 'RLI') return saveRliPdf(report);
  return saveReportPdf(report);
}

async function generateReportDocxAsset(report) {
  report = await withCurrentServiceLeaderSnapshot(report);
  report = withServiceUploadFields(report);
  if (report.reportType === 'RTP') return saveRtpDocx(report);
  if (report.reportType === 'RLQ') return saveRlqDocx(report);
  if (report.reportType === 'RCPU') return saveRcpDocx(report);
  if (report.reportType === 'RLM') return saveRlmDocx(report);
  if (report.reportType === 'RLF') return saveRlfDocx(report);
  if (report.reportType === 'RLI') return saveRliDocx(report);
  return saveReportDocx(report);
}

async function refreshDerivedReportSource(report) {
  if (![ReportType.RTP, ReportType.RLQ, ReportType.RCPU, ReportType.RLM, ReportType.RLF, ReportType.RLI].includes(report.reportType)) {
    return report;
  }
  const parentRdoId = report.specialConditions?.parentRdoId;
  if (!parentRdoId) return report;

  const parentMeta = await prisma.report.findUnique({
    where: { id: parentRdoId },
    select: {
      id: true,
      reportType: true,
      status: true,
      updatedAt: true,
      deletedAt: true
    }
  });
  if (!parentMeta || parentMeta.deletedAt || parentMeta.reportType !== ReportType.RDO || parentMeta.status !== ReportStatus.APPROVED) {
    return report;
  }
  if (reportContentUpdatedAtMs(parentMeta) <= reportContentUpdatedAtMs(report)) {
    return report;
  }

  await prisma.$transaction(async tx => {
    const parent = await tx.report.findUnique({
      where: { id: parentRdoId },
      include
    });
    if (!parent || parent.reportType !== ReportType.RDO || parent.status !== ReportStatus.APPROVED) return;
    if (report.reportType === ReportType.RTP) await syncApprovedRtpReports(tx, parent);
    if (report.reportType === ReportType.RLQ) await syncApprovedRlqReports(tx, parent);
    if (report.reportType === ReportType.RCPU) await syncApprovedRcpReports(tx, parent);
    if (report.reportType === ReportType.RLM) await syncApprovedRlmReports(tx, parent);
    if (report.reportType === ReportType.RLF) await syncApprovedRlfReports(tx, parent);
    if (report.reportType === ReportType.RLI) await syncApprovedRliReports(tx, parent);
  });

  return prisma.report.findUniqueOrThrow({
    where: { id: report.id },
    include
  });
}

function legacyZapSignSignedPdfCachePath(report) {
  const id = safePathLocal(report?.id);
  if (!id) return '';
  return path.join(env.reportsDir, '_zapsign-assinados', `${id}.pdf`);
}

async function readCachedLegacyZapSignSignedPdf(report) {
  const cachePath = legacyZapSignSignedPdfCachePath(report);
  if (!cachePath) return null;

  const stat = await fs.stat(cachePath).catch(() => null);
  if (!stat?.isFile() || stat.size < 16) return null;
  if (!(await isLikelyCompletePdf(cachePath))) {
    await fs.unlink(cachePath).catch(() => undefined);
    return null;
  }
  return fs.readFile(cachePath);
}

async function cacheLegacyZapSignSignedPdf(report, buffer) {
  const cachePath = legacyZapSignSignedPdfCachePath(report);
  if (!cachePath || !Buffer.isBuffer(buffer) || buffer.length < 16) return;

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, buffer);
    if (!(await isLikelyCompletePdf(tempPath))) return;
    await fs.rename(tempPath, cachePath);
  } finally {
    await fs.unlink(tempPath).catch(() => undefined);
  }
}

export async function resolveSignedPdf(report) {
  const cachedBuffer = await readCachedLegacyZapSignSignedPdf(report);
  if (cachedBuffer) {
    return {
      fileName: buildReportFileName(report, 'pdf'),
      buffer: cachedBuffer
    };
  }

  let signedUrl = String(report.zapsignDocUrl || '').trim();

  if (!signedUrl) {
    if (!report?.zapsignDocToken) {
      const error = new Error('Relatório assinado sem referência do PDF assinado legado.');
      error.statusCode = 409;
      throw error;
    }
    const details = await getZapSignDocument(report.zapsignDocToken);
    signedUrl = String(details?.signedFile || '').trim();
    if (!signedUrl) {
      const error = new Error('Documento assinado ainda não disponível na ZapSign.');
      error.statusCode = 409;
      throw error;
    }

    await prisma.report.update({
      where: { id: report.id },
      data: {
        zapsignDocUrl: signedUrl,
        ...(report.zapsignSignedAt ? {} : { zapsignSignedAt: new Date() })
      }
    });
  }

  const fileName = buildReportFileName(report, 'pdf');
  let buffer;
  try {
    buffer = await downloadSignedZapSignDocument(signedUrl);
    await cacheLegacyZapSignSignedPdf(report, buffer);
  } catch (error) {
    if (error?.statusCode !== 403) {
      throw error;
    }
    if (!report?.zapsignDocToken) {
      throw error;
    }

    const details = await getZapSignDocument(report.zapsignDocToken);
    const refreshedSignedUrl = String(details?.signedFile || '').trim();
    if (!refreshedSignedUrl || refreshedSignedUrl === signedUrl) {
      throw error;
    }

    await prisma.report.update({
      where: { id: report.id },
      data: {
        zapsignDocUrl: refreshedSignedUrl,
        ...(report.zapsignSignedAt ? {} : { zapsignSignedAt: new Date() })
      }
    });

    buffer = await downloadSignedZapSignDocument(refreshedSignedUrl);
    await cacheLegacyZapSignSignedPdf(report, buffer);
  }
  return { fileName, buffer };
}

async function getReportPdfDownload(report) {
  if (
    report.status === ReportStatus.APPROVED &&
    report.reportType === ReportType.RDO &&
    report.zapsignDocToken &&
    !report.zapsignSignedAt
  ) {
    try {
      const result = await reconcileLegacyZapSignReport(report);
      report = result.report || report;
    } catch (error) {
      console.warn('Reconciliação legada ZapSign ignorada durante download do relatório.', {
        reportId: report.id,
        message: error?.message
      });
    }
  }

  const finalVersion = Array.isArray(report.versions)
    ? report.versions.find(version => version.finalPdfUrl)
    : null;
  if (report.status === ReportStatus.SIGNED && finalVersion?.finalPdfUrl) {
    const finalPath = reportSourcePdfPath(finalVersion.finalPdfUrl);
    if (finalPath) {
      const buffer = await verifiedFinalPdfBuffer(finalPath, finalVersion);
      return {
        fileName: path.basename(finalPath),
        buffer
      };
    }
  }

  if (
    report.status === ReportStatus.SIGNED &&
    report.reportType === ReportType.RDO &&
    (report.zapsignDocToken || report.zapsignDocUrl)
  ) {
    return resolveSignedPdf(report);
  }

  const activeSourceVersion = Array.isArray(report.versions)
    ? report.versions.find(version => version.status === ReportVersionStatus.ACTIVE && version.sourcePdfUrl && version.sourceDocumentHash)
    : null;
  if (
    report.status === ReportStatus.APPROVED &&
    report.reportType === ReportType.RDO &&
    activeSourceVersion &&
    await activeSourceVersionMatchesCurrentPdf(report, activeSourceVersion)
  ) {
    const sourcePath = reportSourcePdfPath(activeSourceVersion.sourcePdfUrl);
    if (sourcePath) {
      const buffer = await verifiedSourcePdfBuffer(sourcePath, activeSourceVersion);
      return {
        fileName: path.basename(sourcePath),
        buffer
      };
    }
  }

  return getOrCreateGeneratedReportPdf(report);
}

export async function verifiedSourcePdfBuffer(sourcePath, version) {
  if (!version?.sourceDocumentHash) {
    const error = new Error('PDF-base da assinatura sem hash registrado.');
    error.statusCode = 409;
    throw error;
  }
  const buffer = await fs.readFile(sourcePath);
  const actualHash = sha256Hex(buffer);
  if (actualHash !== version.sourceDocumentHash) {
    const error = new Error('PDF-base da assinatura diverge do hash registrado.');
    error.statusCode = 409;
    throw error;
  }
  return buffer;
}

export async function verifiedFinalPdfBuffer(finalPath, finalVersion) {
  if (!finalVersion?.finalDocumentHash) {
    const error = new Error('PDF assinado sem hash final registrado.');
    error.statusCode = 409;
    throw error;
  }
  const buffer = await fs.readFile(finalPath);
  const actualHash = sha256Hex(buffer);
  if (actualHash !== finalVersion.finalDocumentHash) {
    const error = new Error('PDF assinado diverge do hash final registrado.');
    error.statusCode = 409;
    throw error;
  }
  return buffer;
}

async function finalizeInternalSignatureRound(report, version, evidence, userId, options = {}) {
  const currentVersion = await prisma.reportVersion.findUnique({
    where: { id: version.id },
    include: { signatures: { orderBy: { createdAt: 'asc' } } }
  });
  if (currentVersion?.finalDocumentHash) {
    return prisma.report.findUniqueOrThrow({
      where: { id: report.id },
      include
    });
  }

  const versionForFinalPdf = currentVersion ? { ...version, ...currentVersion } : version;
  const sourcePath = reportSourcePdfPath(versionForFinalPdf.sourcePdfUrl);
  if (!sourcePath) {
    const error = new Error('PDF-base da assinatura interna nao foi encontrado.');
    error.statusCode = 409;
    throw error;
  }

  const validationCode = await uniqueSignatureValidationCode();
  const target = finalEvidencePdfTarget(sourcePath, versionForFinalPdf.sourcePdfUrl, validationCode);

  let finalPdf;
  try {
    finalPdf = await writeFinalEvidencePdf({
      sourcePdfPath: sourcePath,
      sourcePdfUrl: versionForFinalPdf.sourcePdfUrl,
      finalPdfPath: target.finalPdfPath,
      finalPdfUrl: target.finalPdfUrl,
      report,
      version: { ...versionForFinalPdf, validationCode },
      signatures: versionForFinalPdf.signatures || [],
      validationCode
    });
  } catch (error) {
    await fs.unlink(target.finalPdfPath).catch(() => {});
    throw error;
  }

  try {
    const wonFinalization = await prisma.$transaction(async tx => {
      const finalized = await tx.reportVersion.updateMany({
        where: {
          id: version.id,
          status: ReportVersionStatus.ACTIVE,
          finalDocumentHash: null,
          report: {
            status: ReportStatus.APPROVED
          },
          signatures: {
            every: {
              OR: [
                { isRequired: false },
                { status: ReportSignatureStatus.SIGNED }
              ]
            }
          }
        },
        data: {
          finalPdfUrl: finalPdf.finalPdfUrl,
          validationCode,
          finalDocumentHash: finalPdf.finalDocumentHash
        }
      });
      if (finalized.count !== 1) {
        return false;
      }
      await tx.reportSignature.updateMany({
        where: { versionId: version.id, status: 'SIGNED' },
        data: { finalDocumentHash: finalPdf.finalDocumentHash }
      });
      await tx.report.update({
        where: { id: report.id },
        data: { status: ReportStatus.SIGNED }
      });
      if (options.signedAudit?.signerName) {
        await createSignatureAuditLog(tx, {
          reportId: report.id,
          versionId: version.id,
          userId,
          action: ReportAuditAction.SIGNED,
          description: `${options.signedAudit.signerName} assinou o relatorio.`,
          evidence
        });
      }
      await createSignatureAuditLog(tx, {
        reportId: report.id,
        versionId: version.id,
        userId,
        action: ReportAuditAction.REPORT_LOCKED,
        description: 'Relatorio assinado internamente e bloqueado.',
        evidence
      });
      return true;
    });
    if (!wonFinalization) {
      await fs.unlink(target.finalPdfPath).catch(() => {});
      const finalizedReport = await prisma.report.findUniqueOrThrow({
        where: { id: report.id },
        include
      });
      if (finalizedReport.versions?.some(item => item.id === version.id && item.finalDocumentHash)) {
        return finalizedReport;
      }
      const error = new Error('Finalizacao de assinatura ja processada por outra requisicao.');
      error.statusCode = 409;
      throw error;
    }
  } catch (error) {
    await fs.unlink(target.finalPdfPath).catch(() => {});
    throw error;
  }

  return prisma.report.findUniqueOrThrow({
    where: { id: report.id },
    include
  });
}

async function ensureInternalSignatureRoundAndNotify(report, userId, evidence, options = {}) {
  const freshReport = report?.id
    ? await prisma.report.findUnique({ where: { id: report.id }, include })
    : null;
  if (freshReport) report = freshReport;
  if (isReportUnavailable(report)) return null;

  if (!shouldCreateInternalSignatureRound(report)) {
    if (
      report?.reportType === ReportType.RDO
      && report?.status === ReportStatus.APPROVED
      && !report?.project?.managerOnly
      && !hasActiveClientRejection(report)
      && !clientSignersForReport(report).length
    ) {
      console.warn('Rodada de assinatura interna nao criada: nenhum signatario cliente configurado.', {
        reportId: report.id,
        projectId: report.projectId
      });
    }
    return null;
  }

  const activeVersion = await prisma.reportVersion.findFirst({
    where: { reportId: report.id, status: 'ACTIVE' },
    include: { signatures: true },
    orderBy: { versionNumber: 'desc' }
  });
  let sourcePdfUrl = activeVersion?.sourcePdfUrl || '';
  let sourceDocumentHash = activeVersion?.sourceDocumentHash || '';
  let generatedSourcePath = '';
  const expectedReportUpdatedAt = reportUpdatedAtToken(report);
  if (!activeVersion) {
    const saved = await generateReportPdfAsset(report);
    generatedSourcePath = saved.targetPath;
    const pdfBuffer = await fs.readFile(saved.targetPath);
    sourcePdfUrl = saved.publicUrl;
    sourceDocumentHash = sha256Hex(pdfBuffer);
  }

  let version;
  let tokens;
  let emailDelivery = null;
  try {
    ({ version, tokens, emailDelivery } = await prisma.$transaction(async tx => {
      const current = await tx.report.findUniqueOrThrow({
        where: { id: report.id },
        include
      });
      if (current.status !== ReportStatus.APPROVED || hasActiveClientRejection(current)) {
        return { version: null, tokens: [] };
      }
      assertSignatureSourceCurrent(current, expectedReportUpdatedAt);
      const nextVersion = await ensureInternalSignatureRound(tx, {
        report: current,
        sourcePdfUrl,
        sourceDocumentHash,
        createdByUserId: userId,
        evidence
      });
      const missingMailerConfig = getMissingMailerConfig();
      if (missingMailerConfig.length && signatureRequestEmailRequired(current, nextVersion)) {
        if (options.throwOnEmailFailure) throw missingSignatureRequestEmailConfigError(missingMailerConfig);
        return {
          version: nextVersion,
          tokens: [],
          emailDelivery: signatureRequestEmailDeliveryFailure(missingSignatureRequestEmailConfigError(missingMailerConfig))
        };
      }
      const issuedTokens = await issuePendingSignatureTokens(tx, nextVersion);
      return { version: nextVersion, tokens: issuedTokens, emailDelivery: null };
    }));
    if (generatedSourcePath && version?.sourcePdfUrl !== sourcePdfUrl) {
      await fs.unlink(generatedSourcePath).catch(() => {});
    }
  } catch (error) {
    if (generatedSourcePath) await fs.unlink(generatedSourcePath).catch(() => {});
    if (error?.statusCode === 409 && /Nenhum signatario cliente/.test(error.message || '')) {
      console.warn('Rodada de assinatura interna nao criada: nenhum signatario cliente configurado.', {
        reportId: report.id,
        projectId: report.projectId
      });
      return null;
    }
    throw error;
  }

  if (tokens.length) {
    emailDelivery = await deliverIssuedSignatureRequestEmails(report, tokens, {
      throwOnFailure: options.throwOnEmailFailure
    });
  }
  if (options.throwOnEmailFailure && emailDelivery && emailDelivery.ok === false) {
    throw signatureRequestEmailDeliveryError(emailDelivery.error || 'Falha ao enviar links de assinatura interna.', {
      emailDelivery
    });
  }
  return { version, emailDelivery };
}

function reportWithSignatureEmailDelivery(item, signaturePreparation) {
  const delivery = signaturePreparation?.emailDelivery;
  if (!delivery || delivery.ok !== false) return item;
  return {
    ...item,
    signatureEmailDelivery: delivery
  };
}

async function getReportDocxDownload(report) {
  const saved = await generateReportDocxAsset(report);
  return {
    fileName: saved.fileName,
    buffer: await fs.readFile(saved.targetPath)
  };
}

async function fetchReportsForIds(ids) {
  const items = await prisma.report.findMany({
    where: { id: { in: ids }, deletedAt: null, project: activeReportProjectWhere() },
    include,
    orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }]
  });
  const byId = new Map(items.map(item => [item.id, item]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

async function assertBatchAccess(auth, reports) {
  if (!reports.length) {
    const error = new Error('Nenhum relatório selecionado.');
    error.statusCode = 400;
    throw error;
  }

  if (auth.user.role === 'CLIENT') {
    const projectAccessDenied = reports.some(report => (
      isReportUnavailable(report)
      || report.project?.managerOnly
      || !clientCanAccessProject(auth, report.project)
    ));
    if (projectAccessDenied) {
      const error = new Error('Você não tem permissão para acessar um ou mais relatórios selecionados.');
      error.statusCode = 403;
      throw error;
    }

    const byId = await clientVisibilityMapForReports(reports);
    if (reports.some(report => !canClientSeeReport(report, byId))) {
      const error = new Error('Você não tem permissão para acessar um ou mais relatórios selecionados.');
      error.statusCode = 403;
      throw error;
    }
    return;
  }

  const access = await Promise.all(reports.map(report => canAccessReport(auth, report)));
  if (access.some(allowed => !allowed)) {
    const error = new Error('Você não tem permissão para acessar um ou mais relatórios selecionados.');
    error.statusCode = 403;
    throw error;
  }
}

function normalizedText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function serviceExtraData(service) {
  return service?.extraData && typeof service.extraData === 'object' && !Array.isArray(service.extraData)
    ? service.extraData
    : {};
}

function serviceRequiresTubes(service) {
  const type = String(service?.serviceType || '').trim().toLowerCase();
  const extraData = serviceExtraData(service);
  if (type === 'pressao') {
    return normalizedText(extraData['Equipamento testado'] || extraData.equipamentoTestado) !== 'outro';
  }
  if (type === 'limpeza') return normalizedText(extraData['Limpeza de tubulação?'] || extraData['Limpeza de tubulacao?'] || extraData.limpezaTubulacao) !== 'nao';
  if (type === 'flushing') return normalizedText(extraData['Flushing em tubulação?'] || extraData['Flushing em tubulacao?'] || extraData.flushingTubulacao) !== 'nao';
  return false;
}

function serviceTubeItemLabel(service) {
  const type = String(service?.serviceType || '').trim().toLowerCase();
  if (type !== 'pressao') return 'tubulação';
  const extraData = serviceExtraData(service);
  const testedEquipment = normalizedText(extraData['Equipamento testado'] || extraData.equipamentoTestado);
  if (testedEquipment === 'mangueiras' || testedEquipment === 'mangueira') return 'mangueira';
  if (testedEquipment === 'outro') return 'item testado';
  return 'tubulação';
}

function serviceTubeRows(service) {
  const extraData = serviceExtraData(service);
  const rows = extraData['Diâmetros e comprimentos'] || extraData['Diametros e comprimentos'] || extraData.tubes;
  return Array.isArray(rows) ? rows : [];
}

function serviceHasCompleteTubeRows(service) {
  const rows = serviceTubeRows(service);
  return rows.length > 0 && rows.every(row => (
    row
    && typeof row === 'object'
    && String(row.d || '').trim()
    && String(row.c || '').trim()
  ));
}

export function assertCompleteTubeRows(services) {
  const invalid = (services || []).find(service => serviceRequiresTubes(service) && !serviceHasCompleteTubeRows(service));
  if (!invalid) return;
  const error = new Error(`Preencha diâmetro e comprimento para cada ${serviceTubeItemLabel(invalid)}.`);
  error.status = 400;
  throw error;
}

function assertProjectAllowsInhibition(project, services) {
  const hasInhibition = (services || []).some(service => service.serviceType === 'inibicao');
  if (!hasInhibition || project?.inhibitionServiceEnabled) return;
  const error = new Error('Serviço de inibição não está habilitado para este projeto.');
  error.statusCode = 400;
  throw error;
}

const serviceSchema = z.object({
  serviceType: z.string().min(1),
  equipmentId: z.string().nullable().optional(),
  system: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  finalized: z.boolean(),
  extraData: z.any().optional()
});

const serviceOnlyServiceSchema = serviceSchema.extend({
  finalized: z.boolean().optional()
});

const schema = z.object({
  projectId: z.string().min(1),
  createdByUserId: z.string().min(1),
  reportType: z.nativeEnum(ReportType).default(ReportType.RDO),
  status: z.nativeEnum(ReportStatus).default(ReportStatus.PENDING),
  reportDate: z.string().min(1),
  arrivalTime: z.string().min(1),
  departureTime: z.string().min(1),
  lunchBreak: z.string().min(1),
  daytimeCount: z.number().int().nonnegative(),
  overtimeReason: z.string().optional().nullable(),
  dailyDescription: z.string().optional().nullable(),
  specialConditions: z.any().optional(),
  collaboratorIds: z.array(z.string()).default([]),
  services: z.array(serviceSchema).default([])
});

const serviceOnlySchema = z.object({
  projectId: z.string().min(1),
  createdByUserId: z.string().min(1),
  reportDate: z.string().min(1),
  collaboratorIds: z.array(z.string()).default([]),
  services: z.array(serviceOnlyServiceSchema).min(1)
});

const positiveIntSchema = z.coerce.number().int().positive();

const updateSchema = schema.omit({
  createdByUserId: true,
  status: true
}).extend({
  sequenceNumber: positiveIntSchema.optional(),
  deleteUnfinalizedDerivedReports: z.boolean().optional()
});

const statusSchema = z.object({
  status: z.nativeEnum(ReportStatus),
  reviewNotes: z.string().nullable().optional(),
  acceptOvertime: z.boolean().optional().default(true)
});
const sequenceSchema = z.object({
  sequenceNumber: positiveIntSchema
});
const clientReviewSchema = z.object({
  action: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(4000).optional().nullable()
}).superRefine((data, ctx) => {
  if (data.action === 'REJECTED' && !data.comment) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['comment'],
      message: 'Informe um motivo para reprovar o relatório.'
    });
  }
});
export const requestSignatureSchema = z.object({
  comment: z.string().trim().max(4000).optional().nullable(),
  signerName: z.string().trim().min(2).max(160),
  signatureImageDataUrl: z.string().trim().min(1).max(2_100_000)
    .refine(value => !!parseSignatureImageDataUrl(value), 'Assinatura visual invalida.'),
  privacyNoticeAccepted: z.boolean().optional(),
  privacyNoticeVersion: z.string().trim().optional().nullable()
}).superRefine((data, ctx) => {
  const error = validatePrivacyNoticeAcknowledgement(data, SIGNATURE_RDO_NOTICE_VERSION);
  if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['privacyNoticeVersion'], message: error });
});

function reportDateDayRange(reportDate) {
  const raw = String(reportDate || '').trim();
  const parsed = /^\d{4}-\d{2}-\d{2}/.test(raw) ? null : new Date(raw);
  if (parsed && Number.isNaN(parsed.getTime())) {
    const error = new Error('Data do relatório inválida.');
    error.statusCode = 400;
    throw error;
  }
  const day = parsed ? parsed.toISOString().slice(0, 10) : raw.slice(0, 10);
  const start = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    const error = new Error('Data do relatório inválida.');
    error.statusCode = 400;
    throw error;
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function assertUniqueReportDate(tx, { projectId, reportType, reportDate, excludeReportId }) {
  const { start, end } = reportDateDayRange(reportDate);
  if (reportType !== ReportType.RDO) return;
  const duplicate = await tx.report.findFirst({
    where: {
      projectId,
      reportType,
      deletedAt: null,
      reportDate: {
        gte: start,
        lt: end
      },
      ...(excludeReportId ? { id: { not: excludeReportId } } : {})
    },
    select: {
      id: true
    }
  });
  if (!duplicate) return;
  const error = new Error('Já existe um relatório deste projeto para esta data.');
  error.statusCode = 409;
  throw error;
}
export const publicSignatureConfirmSchema = z.object({
  signatureId: z.string().trim().min(1).optional(),
  signerName: z.string().trim().min(2).max(160),
  signatureImageDataUrl: z.string().trim().min(1).max(2_100_000)
    .refine(value => !!parseSignatureImageDataUrl(value), 'Assinatura visual invalida.'),
  privacyNoticeAccepted: z.boolean().optional(),
  privacyNoticeVersion: z.string().trim().optional().nullable()
}).superRefine((data, ctx) => {
  const error = validatePrivacyNoticeAcknowledgement(data, SIGNATURE_RDO_NOTICE_VERSION);
  if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['privacyNoticeVersion'], message: error });
});
const publicSignatureRejectSchema = z.object({
  signatureId: z.string().trim().min(1).optional(),
  comment: z.string().trim().min(1).max(4000)
});
const batchDownloadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  format: z.enum(['pdf', 'docx'])
});
function uniqueIds(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nightCollaboratorInput(value) {
  if (typeof value === 'string') return { name: value.trim(), role: '' };
  const record = plainObject(value);
  return {
    id: textValue(record.id),
    name: textValue(record.name),
    role: textValue(record.role)
  };
}

export async function enrichNightCollaboratorsInSpecialConditions(tx, specialConditions) {
  const next = cloneJson(plainObject(specialConditions));
  const noturnoDetails = plainObject(next.noturnoDetails);
  const collaboratorIds = Array.isArray(noturnoDetails.collaboratorIds)
    ? uniqueIds(noturnoDetails.collaboratorIds.filter(id => typeof id === 'string'))
    : [];
  if (!collaboratorIds.length) return next;

  const collaborators = await tx.collaborator.findMany({
    where: { id: { in: collaboratorIds } },
    select: { id: true, name: true, role: true }
  });
  const byId = new Map(collaborators.map(collaborator => [collaborator.id, collaborator]));
  const existing = Array.isArray(noturnoDetails.colaboradores)
    ? noturnoDetails.colaboradores.map(nightCollaboratorInput)
    : [];

  next.noturnoDetails = {
    ...noturnoDetails,
    collaboratorIds,
    colaboradores: collaboratorIds.map((id, index) => {
      const current = existing[index] || {};
      const collaborator = byId.get(id);
      return {
        id,
        name: current.name || collaborator?.name || id,
        role: current.role || collaborator?.role || ''
      };
    })
  };
  return next;
}

export async function assertRenderableReportSignatureImageDataUrl(value) {
  if (await decodableSignatureImageDataUrl(value)) return;
  throw new z.ZodError([{
    code: z.ZodIssueCode.custom,
    path: ['signatureImageDataUrl'],
    message: 'Assinatura visual invalida.'
  }]);
}

function stripInternalEditState(specialConditions) {
  if (!specialConditions || typeof specialConditions !== 'object' || Array.isArray(specialConditions)) {
    return specialConditions || {};
  }

  const cleaned = cloneJson(specialConditions) || {};
  delete cleaned.__editOriginalSnapshot;
  delete cleaned.__editMeta;
  return cleaned;
}

function extractInternalEditState(specialConditions) {
  if (!specialConditions || typeof specialConditions !== 'object' || Array.isArray(specialConditions)) {
    return {};
  }

  const state = {};
  if (specialConditions.__editOriginalSnapshot) state.__editOriginalSnapshot = cloneJson(specialConditions.__editOriginalSnapshot);
  if (specialConditions.__editMeta) state.__editMeta = cloneJson(specialConditions.__editMeta);
  return state;
}

function markOvertimeRejected(specialConditions) {
  const next = cloneJson(plainObject(specialConditions));
  next.overtimeAccepted = false;
  return next;
}

function reportSnapshotUploadAttachments(report) {
  const records = [];
  for (const attachment of report.attachments || []) {
    if (attachment?.storagePath) records.push({ storagePath: attachment.storagePath });
  }
  for (const service of report.services || []) {
    for (const attachment of service.attachments || []) {
      if (attachment?.storagePath) records.push({ storagePath: attachment.storagePath });
    }
  }
  return records;
}

function trustedStoragePathsFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  return (Array.isArray(snapshot.uploadAttachments) ? snapshot.uploadAttachments : [])
    .map(attachment => normalizeReportUploadReference(attachment?.storagePath || attachment?.url || attachment?.path))
    .filter(Boolean);
}

function buildReportSnapshot(report) {
  return {
    projectId: report.projectId,
    createdByUserId: report.createdByUserId || null,
    reportType: report.reportType,
    status: report.status,
    reportDate: report.reportDate ? new Date(report.reportDate).toISOString().slice(0, 10) : null,
    arrivalTime: report.arrivalTime,
    departureTime: report.departureTime,
    lunchBreak: report.lunchBreak,
    daytimeCount: report.daytimeCount,
    overtimeReason: report.overtimeReason || null,
    dailyDescription: report.dailyDescription || null,
    reviewNotes: report.reviewNotes || null,
    reviewedByUserId: report.reviewedByUserId || null,
    approvedAt: report.approvedAt ? new Date(report.approvedAt).toISOString() : null,
    returnedAt: report.returnedAt ? new Date(report.returnedAt).toISOString() : null,
    specialConditions: stripInternalEditState(report.specialConditions || {}),
    collaboratorIds: (report.collaborators || []).map(link => link.collaboratorId).filter(Boolean),
    collaborators: (report.collaborators || []).map(link => ({
      collaboratorId: link.collaboratorId,
      name: link.collaborator?.name || null,
      role: link.collaborator?.role || null
    })),
    uploadAttachments: reportSnapshotUploadAttachments(report),
    services: (report.services || []).map(service => ({
      serviceType: service.serviceType,
      equipmentId: service.equipmentId || null,
      system: service.system || null,
      material: service.material || null,
      startTime: service.startTime || null,
      endTime: service.endTime || null,
      finalized: typeof service.finalized === 'boolean' ? service.finalized : null,
      extraData: cloneJson(service.extraData || {})
    }))
  };
}

function buildReportUpdateFromSnapshot(project, snapshot) {
  const overtime = calculateReportOvertime(project, snapshot);
  return {
    projectId: snapshot.projectId,
    reportType: snapshot.reportType,
    status: snapshot.status || ReportStatus.APPROVED,
    reportDate: new Date(snapshot.reportDate),
    arrivalTime: snapshot.arrivalTime,
    departureTime: snapshot.departureTime,
    lunchBreak: snapshot.lunchBreak,
    daytimeCount: snapshot.daytimeCount,
    daytimeWorkedMinutes: overtime.daytimeWorkedMinutes,
    nighttimeWorkedMinutes: overtime.nighttimeWorkedMinutes,
    daytimeOvertimeMinutes: overtime.daytimeOvertimeMinutes,
    nighttimeOvertimeMinutes: overtime.nighttimeOvertimeMinutes,
    totalOvertimeMinutes: overtime.totalOvertimeMinutes,
    overtimeReason: snapshot.overtimeReason || null,
    dailyDescription: snapshot.dailyDescription || null,
    reviewNotes: snapshot.reviewNotes || null,
    reviewedByUserId: snapshot.reviewedByUserId || null,
    approvedAt: snapshot.approvedAt ? new Date(snapshot.approvedAt) : null,
    returnedAt: snapshot.returnedAt ? new Date(snapshot.returnedAt) : null,
    specialConditions: {
      ...normalizeStoredReportUploadUrls(stripInternalEditState(snapshot.specialConditions || {})),
      overtimeSummary: overtime
    },
    pendingDerivedTypes: collectPendingDerivedTypes(snapshot.services || []),
    collaborators: {
      create: uniqueIds(snapshot.collaboratorIds).map(collaboratorId => ({ collaboratorId }))
    },
    services: {
      create: (snapshot.services || []).map(service => ({
        serviceType: service.serviceType,
        equipmentId: service.equipmentId || null,
        system: service.system || null,
        material: service.material || null,
        startTime: service.startTime || null,
        endTime: service.endTime || null,
        finalized: typeof service.finalized === 'boolean' ? service.finalized : null,
        extraData: normalizeStoredReportUploadUrls(service.extraData || {})
      }))
    }
  };
}

async function restoreReportFromSnapshot(tx, reportId, originalSnapshot) {
  const project = await tx.project.findFirstOrThrow({
    where: { id: originalSnapshot.projectId, ...activeReportProjectWhere() }
  });

  await tx.reportCollaborator.deleteMany({ where: { reportId } });
  await tx.reportService.deleteMany({ where: { reportId } });

  const restored = await tx.report.update({
    where: { id: reportId },
    data: buildReportUpdateFromSnapshot(project, originalSnapshot),
    include
  });

  await syncApprovedRtpReports(tx, restored);
  await syncApprovedRlqReports(tx, restored);
  await syncApprovedRcpReports(tx, restored);
  await syncApprovedRlmReports(tx, restored);
  await syncApprovedRlfReports(tx, restored);
  await syncApprovedRliReports(tx, restored);
  await syncReportUploadAttachments(tx, restored, {
    trustedStoragePaths: trustedStoragePathsFromSnapshot(originalSnapshot)
  });
  return restored;
}

function resolveCollaboratorsByShift(report, collaborators) {
  const daytimeIds = new Set((report.collaborators || []).map(link => link.collaboratorId).filter(Boolean));
  const nighttimeIds = new Set(
    (((report.specialConditions || {}).noturnoDetails || {}).collaboratorIds || []).filter(Boolean)
  );

  return collaborators.flatMap(c => {
    const inDay = daytimeIds.has(c.id);
    const inNight = nighttimeIds.has(c.id);
    if (!inDay && !inNight) return [{ id: c.id, name: c.name, role: c.role, shift: 'Diurno' }];
    const shift = inDay && inNight ? 'Diurno e Noturno' : (inNight ? 'Noturno' : 'Diurno');
    return [{ id: c.id, name: c.name, role: c.role, shift }];
  });
}

function safePathLocal(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function expandUploadGroupsInServiceData(serviceData, fallbackData) {
  const next = cloneJson(serviceData || {}) || {};
  const groups = [];
  [fallbackData, serviceData].forEach(source => {
    if (Array.isArray(source?.__uploads__)) groups.push(...source.__uploads__);
  });

  groups.forEach(group => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return;
    const label = String(group.label || '').trim();
    const files = Array.isArray(group.files) ? group.files.filter(Boolean) : [];
    if (!label || !files.length) return;
    if (!hasReportFieldValue(next[label])) next[label] = files;
    if (label === 'Foto do laudo' && !hasReportFieldValue(next['Foto do laudo do contador'])) {
      next['Foto do laudo do contador'] = files;
    }
  });

  return next;
}

function withServiceUploadFields(report) {
  if (!report || report.reportType === ReportType.RDO) return report;
  const specialConditions = report.specialConditions || {};
  const serviceData = specialConditions.serviceData || {};
  const serviceExtraData = report.services?.[0]?.extraData || {};
  return {
    ...report,
    specialConditions: {
      ...specialConditions,
      serviceData: expandUploadGroupsInServiceData(serviceData, serviceExtraData)
    }
  };
}

// As fotos não são mais movidas no servidor (a referência canônica é gravada na
// escrita do relatório via normalizeStoredReportUploadUrls e nunca muda). Aqui só
// reconstruímos o índice ReportAttachment a partir do JSON. O segundo argumento é
// ignorado — mantido por compatibilidade com call-sites legados.
async function organizeAndSyncReportUploadAttachments(report) {
  await syncReportUploadAttachments(prisma, report.id);
  return prisma.report.findUnique({
    where: { id: report.id },
    include
  });
}

function derivedReportTypesForService(service) {
  switch (service?.serviceType) {
    case 'limpeza':
      return [ReportType.RLQ];
    case 'pressao':
      return [ReportType.RTP];
    case 'filtragem':
    case 'flushing':
      return [ReportType.RCPU];
    case 'mecanica':
      return [ReportType.RLM];
    case 'inibicao': {
      const types = [];
      if (serviceWantsReportType(service, ReportType.RLI)) types.push(ReportType.RLI);
      if (serviceWantsReportType(service, ReportType.RLF)) types.push(ReportType.RLF);
      return types;
    }
    default:
      return [];
  }
}

function collectPendingDerivedTypes(services) {
  const derived = new Set();

  for (const service of services || []) {
    if (service.finalized !== true) continue;
    derivedReportTypesForService(service).forEach(type => derived.add(type));
  }

  return Array.from(derived);
}

export async function reserveSequence(tx, projectId, reportType) {
  const reservation = await tx.projectReportSeq.upsert({
    where: {
      projectId_reportType: {
        projectId,
        reportType
      }
    },
    create: {
      projectId,
      reportType,
      nextNumber: 1
    },
    update: {
      nextNumber: { increment: 1 }
    },
    select: {
      nextNumber: true
    }
  });

  return Math.max(1, reservation.nextNumber || 0);
}

async function syncProjectReportSequence(tx, projectId, reportType, sequenceNumber) {
  if (!projectId || !reportType || !Number.isInteger(sequenceNumber) || sequenceNumber < 1) return;
  const aggregate = await tx.report.aggregate({
    where: {
      projectId,
      reportType
    },
    _max: {
      sequenceNumber: true
    }
  });
  const lastUsedNumber = Math.max(sequenceNumber, aggregate._max.sequenceNumber || 0);
  const existing = await tx.projectReportSeq.findUnique({
    where: {
      projectId_reportType: {
        projectId,
        reportType
      }
    }
  });
  if (!existing) {
    await tx.projectReportSeq.create({
      data: {
        projectId,
        reportType,
        nextNumber: lastUsedNumber
      }
    });
    return;
  }
  await tx.projectReportSeq.update({
    where: {
      projectId_reportType: {
        projectId,
        reportType
      }
    },
    data: {
      nextNumber: lastUsedNumber
    }
  });
}

async function setProjectReportLastSequence(tx, projectId, reportType, lastUsedNumber) {
  if (!projectId || !reportType || !Number.isInteger(lastUsedNumber) || lastUsedNumber < 0) return;
  await tx.projectReportSeq.upsert({
    where: {
      projectId_reportType: {
        projectId,
        reportType
      }
    },
    create: {
      projectId,
      reportType,
      nextNumber: lastUsedNumber
    },
    update: {
      nextNumber: lastUsedNumber
    }
  });
}

async function renumberProjectReports(tx, projectId, reportType) {
  const reports = await tx.report.findMany({
    where: {
      projectId,
      reportType,
      deletedAt: null
    },
    orderBy: [
      { sequenceNumber: 'asc' },
      { reportDate: 'asc' },
      { createdAt: 'asc' }
    ],
    select: {
      id: true,
      sequenceNumber: true,
      status: true
    }
  });

  if (!reports.length) {
    await setProjectReportLastSequence(tx, projectId, reportType, 0);
    return;
  }

  const signedNumbers = new Set(
    reports
      .filter(report => report.status === ReportStatus.SIGNED && Number.isInteger(report.sequenceNumber) && report.sequenceNumber > 0)
      .map(report => report.sequenceNumber)
  );
  const nextNumbersByReport = new Map();
  let nextNumber = 1;
  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index];
    if (report.status === ReportStatus.SIGNED) {
      if (Number.isInteger(report.sequenceNumber) && report.sequenceNumber >= nextNumber) {
        nextNumber = report.sequenceNumber + 1;
      }
      continue;
    }
    while (signedNumbers.has(nextNumber)) nextNumber += 1;
    nextNumbersByReport.set(report.id, nextNumber);
    nextNumber += 1;
  }

  const unsignedReports = reports.filter(report => report.status !== ReportStatus.SIGNED);
  const needsRenumber = unsignedReports.some(report => report.sequenceNumber !== nextNumbersByReport.get(report.id));
  if (needsRenumber && unsignedReports.length) {
    await tx.report.updateMany({
      where: {
        id: { in: unsignedReports.map(report => report.id) }
      },
      data: {
        sequenceNumber: null
      }
    });

    for (const report of unsignedReports) {
      await tx.report.update({
        where: { id: report.id },
        data: { sequenceNumber: nextNumbersByReport.get(report.id) }
      });
    }
  }

  const lastUsedNumber = Math.max(
    0,
    ...signedNumbers,
    ...nextNumbersByReport.values()
  );
  await setProjectReportLastSequence(tx, projectId, reportType, lastUsedNumber);
}

async function prepareReportSequenceChange(tx, currentReport, targetProjectId, targetReportType, targetSequenceNumber) {
  if (!Number.isInteger(targetSequenceNumber) || targetSequenceNumber < 1) return null;

  const currentSequenceNumber = currentReport.sequenceNumber;
  const sameGroup = currentReport.projectId === targetProjectId && currentReport.reportType === targetReportType;
  if (sameGroup && currentSequenceNumber === targetSequenceNumber) return null;

  const conflicting = await tx.report.findFirst({
    where: {
      projectId: targetProjectId,
      reportType: targetReportType,
      sequenceNumber: targetSequenceNumber,
      id: { not: currentReport.id }
    },
    select: {
      id: true,
      status: true
    }
  });

  if (!conflicting) return null;

  if (!sameGroup || !Number.isInteger(currentSequenceNumber) || currentSequenceNumber < 1) {
    const error = new Error('Ja existe um relatorio deste projeto e tipo usando este numero.');
    error.statusCode = 409;
    throw error;
  }

  if (conflicting.status === ReportStatus.SIGNED) {
    const error = new Error('Nao e possivel trocar numeracao com um relatorio assinado.');
    error.statusCode = 409;
    throw error;
  }

  await tx.report.update({
    where: { id: conflicting.id },
    data: { sequenceNumber: null }
  });

  return {
    id: conflicting.id,
    sequenceNumber: currentSequenceNumber
  };
}

async function finishReportSequenceChange(tx, swappedReport) {
  if (!swappedReport) return;
  await tx.report.update({
    where: { id: swappedReport.id },
    data: {
      sequenceNumber: swappedReport.sequenceNumber
    }
  });
}

function projectLeaderSnapshot(project) {
  if (!project || !project.operator) return null;
  return {
    name: project.operator.name || null,
    role: project.operator.role || null,
    signatureImage: project.operator.signatureImage || null
  };
}

function withLeaderSnapshot(specialConditions, leaderSnapshot) {
  const { __leaderSnapshot, ...rest } = specialConditions || {};
  if (!leaderSnapshot) return rest;
  return {
    ...rest,
    __leaderSnapshot: leaderSnapshot
  };
}

async function validateDerivedReportSequenceMove(tx, existingReport, targetProjectId, targetReportType) {
  if (!existingReport || existingReport.projectId === targetProjectId) return;
  if (!Number.isInteger(existingReport.sequenceNumber) || existingReport.sequenceNumber < 1) return;
  const sequenceSwap = await prepareReportSequenceChange(
    tx,
    existingReport,
    targetProjectId,
    targetReportType,
    existingReport.sequenceNumber
  );
  await finishReportSequenceChange(tx, sequenceSwap);
  await syncProjectReportSequence(tx, targetProjectId, targetReportType, existingReport.sequenceNumber);
}

async function syncApprovedRtpReports(tx, report) {
  if (!report || report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED) {
    return;
  }

  const pressaoServices = (report.services || []).filter(
    service => service.serviceType === 'pressao' && service.finalized === true
  );

  if (!pressaoServices.length) {
    return;
  }

  const existingRtps = await tx.report.findMany({
    where: {
      projectId: report.projectId,
      deletedAt: null,
      project: activeReportProjectWhere(),
      reportType: ReportType.RTP
    },
    select: {
      id: true,
      projectId: true,
      reportType: true,
      sequenceNumber: true,
      status: true,
      reportDate: true,
      specialConditions: true
    }
  });

  const existingByLinkKey = new Map();
  existingRtps.forEach(item => {
    const special = item.specialConditions || {};
    if (special.parentRdoId !== report.id) {
      return;
    }
    const linkKey = String(special.serviceLinkKey || special.serviceId || '').trim();
    if (linkKey) {
      existingByLinkKey.set(linkKey, item);
    }
  });

  const allApprovedRdos = await tx.report.findMany({
    where: approvedRdoHistoryWhere(report.projectId),
    orderBy: [{ reportDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      reportDate: true,
      createdAt: true,
      services: {
        select: { id: true, serviceType: true, startTime: true, endTime: true, extraData: true }
      }
    }
  });

  for (const service of pressaoServices) {
    const fields = service.extraData || {};
    const serviceLinkKey = serviceHistoryKey(service) || String(service.id || '').trim();
    const serviceHistory = [];
    for (const rdo of allApprovedRdos) {
      for (const svc of rdo.services || []) {
        if (svc.serviceType !== service.serviceType) continue;
        if (hasSharedServiceHistoryKey(service, svc) || svc.id === service.id) {
          serviceHistory.push({ rdo, svc, fields: svc.extraData || {} });
        }
      }
    }
    if (!serviceHistory.length) {
      serviceHistory.push({ rdo: report, svc: service, fields });
    }
    const consolidatedFields = buildHistoricalServiceData(fields, serviceHistory);

    const collabField =
      consolidatedFields['Colaboradores do serviço'] ||
      consolidatedFields['Colaboradores do serviÃ§o'] ||
      consolidatedFields['Colaboradores do servico'];
    const collabIds = [...new Set(Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [])];

    const manoField =
      fields['Manômetros utilizados'] ||
      fields['ManÃ´metros utilizados'] ||
      fields['Manometros utilizados'];
    const manoIds = Array.isArray(manoField?.ids) ? manoField.ids.filter(Boolean) : [];

    const uthField = fields['Unidade de Teste Hidrostático (UTH)'] ||
      fields['Unidade de Teste HidrostÃ¡tico (UTH)'] ||
      fields['Unidade de Teste Hidrostatico (UTH)'];
    const uthIds = Array.isArray(uthField?.ids) ? uthField.ids.filter(Boolean)
      : (uthField && typeof uthField === 'string' ? [uthField] : []);

    const [collaborators, manometers, uthUnits] = await Promise.all([
      collabIds.length ? tx.collaborator.findMany({ where: { id: { in: collabIds } } }) : Promise.resolve([]),
      resolveReportManometers(tx, manoIds),
      resolveReportUnits(tx, uthIds)
    ]);

    const existingRtp = serviceLinkKey ? findExistingByLinkKeys(existingByLinkKey, service, service.id) : null;
    const resolvedCollaborators = resolveCollaboratorsByShift(report, collaborators);
    const resolvedManometers = manometers.map(m => ({
      id: m.id,
      code: m.code,
      scale: m.scale,
      certCode: m.calibrationCertCode,
      certificate: m.currentCalibrationCertificate,
      calibratedAt: m.calibratedAt ? m.calibratedAt.toISOString().slice(0, 10) : '',
      expiresAt: m.expiresAt ? m.expiresAt.toISOString().slice(0, 10) : ''
    })).map(m => preserveManometerCalibrationSnapshot(existingRtp, report.reportDate, m));
    const resolvedUnits = uthUnits.map(u => u.code);

    const rtpPayload = {
      projectId: report.projectId,
      createdByUserId: report.createdByUserId,
      reviewedByUserId: report.reviewedByUserId,
      reportType: ReportType.RTP,
      status: ReportStatus.APPROVED,
      reportDate: report.reportDate,
      arrivalTime: service.startTime || report.arrivalTime,
      departureTime: service.endTime || report.departureTime,
      lunchBreak: report.lunchBreak,
      daytimeCount: resolvedCollaborators.length || report.daytimeCount,
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0,
      nighttimeOvertimeMinutes: 0,
      totalOvertimeMinutes: 0,
      approvedAt: report.approvedAt || new Date(),
      specialConditions: {
        parentRdoId: report.id,
        serviceId: service.id,
        serviceLinkKey: serviceLinkKey || String(service.id),
        serviceData: consolidatedFields,
        resolvedCollaborators,
        resolvedManometers,
        resolvedUnits,
        __leaderSnapshot: report.specialConditions?.__leaderSnapshot || null
      }
    };

    if (existingRtp) {
      await validateDerivedReportSequenceMove(tx, existingRtp, report.projectId, ReportType.RTP);
      await tx.reportCollaborator.deleteMany({ where: { reportId: existingRtp.id } });
      await tx.reportService.deleteMany({ where: { reportId: existingRtp.id } });
      await tx.report.update({
        where: { id: existingRtp.id },
        data: {
          ...rtpPayload,
          collaborators: {
            create: collabIds.map(id => ({ collaboratorId: id }))
          },
          services: {
            create: [{
              serviceType: service.serviceType,
              equipmentId: service.equipmentId || null,
              system: service.system || null,
              material: service.material || null,
              startTime: service.startTime || null,
              endTime: service.endTime || null,
              finalized: true,
              extraData: consolidatedFields
            }]
          }
        }
      });
      continue;
    }

    const rtpSeq = await reserveSequence(tx, report.projectId, ReportType.RTP);

    await tx.report.create({
      data: {
        ...rtpPayload,
        sequenceNumber: rtpSeq,
        collaborators: {
          create: collabIds.map(id => ({ collaboratorId: id }))
        },
        services: {
          create: [{
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: true,
            extraData: consolidatedFields
          }]
        }
      }
    });
  }
}

async function syncApprovedRlqReports(tx, report) {
  if (!report || report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED) {
    return;
  }

  const limpezaServices = (report.services || []).filter(
    service => service.serviceType === 'limpeza' && service.finalized === true
  );

  if (!limpezaServices.length) {
    return;
  }

  const existingRlqs = await tx.report.findMany({
    where: {
      projectId: report.projectId,
      deletedAt: null,
      project: activeReportProjectWhere(),
      reportType: ReportType.RLQ
    },
    select: {
      id: true,
      projectId: true,
      reportType: true,
      sequenceNumber: true,
      status: true,
      specialConditions: true
    }
  });

  const existingByLinkKey = new Map();
  existingRlqs.forEach(item => {
    const special = item.specialConditions || {};
    const linkKey = String(special.serviceLinkKey || '').trim();
    const serviceId = String(special.serviceId || '').trim();
    if (linkKey) existingByLinkKey.set(linkKey, item);
    if (serviceId) existingByLinkKey.set(serviceId, item);
  });

  const allApprovedRdos = await tx.report.findMany({
    where: approvedRdoHistoryWhere(report.projectId),
    orderBy: [{ reportDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      reportDate: true,
      createdAt: true,
      services: {
        select: { id: true, serviceType: true, startTime: true, endTime: true, extraData: true }
      }
    }
  });

  for (const service of limpezaServices) {
    const fields = service.extraData || {};
    const serviceLinkKey = serviceHistoryKey(service) || String(service.id || '').trim();
    const serviceHistory = [];
    for (const rdo of allApprovedRdos) {
      for (const svc of rdo.services || []) {
        if (svc.serviceType !== service.serviceType) continue;
        if (hasSharedServiceHistoryKey(service, svc) || svc.id === service.id) {
          serviceHistory.push({ rdo, svc, fields: svc.extraData || {} });
        }
      }
    }
    if (!serviceHistory.length) {
      serviceHistory.push({ rdo: report, svc: service, fields });
    }
    const consolidatedFields = buildHistoricalServiceData(fields, serviceHistory);

    const collabField =
      consolidatedFields['Colaboradores do serviço'] ||
      consolidatedFields['Colaboradores do serviÃ§o'] ||
      consolidatedFields['Colaboradores do servico'];
    const collabIds = [...new Set(Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [])];

    const ulqField =
      consolidatedFields['Unidade de Limpeza Química'] ||
      consolidatedFields['Unidade de Limpeza QuÃ­mica'] ||
      consolidatedFields['Unidade de Limpeza Quimica'];
    const ulqIds = Array.isArray(ulqField?.ids) ? ulqField.ids.filter(Boolean)
      : (ulqField && typeof ulqField === 'string' ? [ulqField] : []);

    const [collaborators, ulqUnits] = await Promise.all([
      collabIds.length ? tx.collaborator.findMany({ where: { id: { in: collabIds } } }) : Promise.resolve([]),
      resolveReportUnits(tx, ulqIds)
    ]);

    const resolvedCollaborators = resolveCollaboratorsByShift(report, collaborators);
    const resolvedUnits = ulqUnits.map(u => u.code);

    const rlqPayload = {
      projectId: report.projectId,
      createdByUserId: report.createdByUserId,
      reviewedByUserId: report.reviewedByUserId,
      reportType: ReportType.RLQ,
      status: ReportStatus.APPROVED,
      reportDate: report.reportDate,
      arrivalTime: service.startTime || report.arrivalTime,
      departureTime: service.endTime || report.departureTime,
      lunchBreak: report.lunchBreak,
      daytimeCount: resolvedCollaborators.length || report.daytimeCount,
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0,
      nighttimeOvertimeMinutes: 0,
      totalOvertimeMinutes: 0,
      approvedAt: report.approvedAt || new Date(),
      specialConditions: {
        parentRdoId: report.id,
        serviceId: service.id,
        serviceLinkKey: serviceLinkKey || String(service.id),
        serviceData: consolidatedFields,
        resolvedCollaborators,
        resolvedUnits,
        __leaderSnapshot: report.specialConditions?.__leaderSnapshot || null
      }
    };

    const existingRlq = serviceLinkKey ? findExistingByLinkKeys(existingByLinkKey, service, service.id) : null;

    if (existingRlq) {
      await validateDerivedReportSequenceMove(tx, existingRlq, report.projectId, ReportType.RLQ);
      await tx.reportCollaborator.deleteMany({ where: { reportId: existingRlq.id } });
      await tx.reportService.deleteMany({ where: { reportId: existingRlq.id } });
      await tx.report.update({
        where: { id: existingRlq.id },
        data: {
          ...rlqPayload,
          collaborators: {
            create: collabIds.map(id => ({ collaboratorId: id }))
          },
          services: {
            create: [{
              serviceType: service.serviceType,
              equipmentId: service.equipmentId || null,
              system: service.system || null,
              material: service.material || null,
              startTime: service.startTime || null,
              endTime: service.endTime || null,
              finalized: true,
              extraData: consolidatedFields
            }]
          }
        }
      });
      continue;
    }

    const rlqSeq = await reserveSequence(tx, report.projectId, ReportType.RLQ);

    await tx.report.create({
      data: {
        ...rlqPayload,
        sequenceNumber: rlqSeq,
        collaborators: {
          create: collabIds.map(id => ({ collaboratorId: id }))
        },
        services: {
          create: [{
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: true,
            extraData: consolidatedFields
          }]
        }
      }
    });
  }
}

function hasReportFieldValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.ids)) return value.ids.filter(Boolean).length > 0;
    if (Array.isArray(value.codes)) return value.codes.filter(Boolean).length > 0;
    if (Array.isArray(value.labels)) return value.labels.filter(Boolean).length > 0;
    return Object.values(value).some(item => hasReportFieldValue(item));
  }
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function getReportField(fields, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields || {}, name) && hasReportFieldValue(fields[name])) {
      return fields[name];
    }
  }
  return undefined;
}

function stringifyHistoryKeyValue(value) {
  if (Array.isArray(value)) return value.map(stringifyHistoryKeyValue).filter(Boolean).join('|');
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => {
        const text = stringifyHistoryKeyValue(item);
        return text ? `${key}:${text}` : '';
      })
      .filter(Boolean)
      .join('|');
  }
  return String(value || '');
}

function historyKeyPart(value) {
  return stringifyHistoryKeyValue(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

function firstHistoryKeyPart(fields, names) {
  const value = getReportField(fields, names);
  return historyKeyPart(value);
}

function serviceHistoryDisambiguatorParts(service) {
  const fields = service?.extraData || {};
  const type = String(service?.serviceType || '').trim().toLowerCase();
  const material = historyKeyPart(service?.material) || firstHistoryKeyPart(fields, [
    'Material da tubulação',
    'Material da tubulacao',
    'Material do equipamento'
  ]);
  const parts = material ? [`material:${material}`] : [];

  if (type === 'filtragem' || type === 'flushing') {
    const oilType = firstHistoryKeyPart(fields, ['Tipo de óleo', 'Tipo de oleo', 'Tipo de Ã³leo', 'tipoOleo']);
    const oilVolume = firstHistoryKeyPart(fields, ['Volume de óleo', 'Volume de oleo', 'Volume de Ã³leo', 'volumeOleo']);
    if (oilType) parts.push(`oleo:${oilType}`);
    if (oilVolume) parts.push(`volume:${oilVolume}`);
    if (type === 'flushing') {
      const flushingTubing = firstHistoryKeyPart(fields, ['Flushing em tubulação?', 'Flushing em tubulacao?', 'flushingTubulacao']);
      const flushingType = firstHistoryKeyPart(fields, ['Tipo de flushing', 'tipoFlushing']);
      if (flushingTubing) parts.push(`tubulacao:${flushingTubing}`);
      if (flushingType) parts.push(`flushing:${flushingType}`);
    }
  }

  if (type === 'pressao') {
    const workPressure = firstHistoryKeyPart(fields, ['Pressão de trabalho', 'Pressao de trabalho', 'pressaoTrabalho']);
    const testPressure = firstHistoryKeyPart(fields, ['Pressão de teste', 'Pressao de teste', 'pressaoTeste']);
    const testFluid = firstHistoryKeyPart(fields, ['Fluido de teste', 'fluidoTeste']);
    const testOil = firstHistoryKeyPart(fields, ['Qual óleo?', 'Qual oleo?', 'qualOleo']);
    if (workPressure) parts.push(`ptrabalho:${workPressure}`);
    if (testPressure) parts.push(`pteste:${testPressure}`);
    if (testFluid) parts.push(`fluido:${testFluid}`);
    if (testOil) parts.push(`oleo:${testOil}`);
  }

  if (type === 'limpeza') {
    const tubing = firstHistoryKeyPart(fields, ['Limpeza de tubulação?', 'Limpeza de tubulacao?', 'limpezaTubulacao']);
    const method = firstHistoryKeyPart(fields, ['Método de limpeza', 'Metodo de limpeza', 'metodos']);
    const location = firstHistoryKeyPart(fields, ['Local de limpeza', 'local']);
    const inspection = firstHistoryKeyPart(fields, ['Tipo de inspeção', 'Tipo de inspecao', 'tipoInspecao']);
    if (tubing) parts.push(`tubulacao:${tubing}`);
    if (method) parts.push(`metodo:${method}`);
    if (location) parts.push(`local:${location}`);
    if (inspection) parts.push(`inspecao:${inspection}`);
  }

  return parts;
}

function isYesReportField(value) {
  return /sim/i.test(Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value || ''));
}

function explicitServiceHistoryKey(service) {
  const fields = service?.extraData || {};
  return String(fields.__ongoingKey || fields.__serviceLinkKey || fields.__sourceServiceId || '').trim();
}

function semanticServiceHistoryKey(service) {
  const fields = service?.extraData || {};
  const equipment = getReportField(fields, ['Equipamento(s)', 'Equipamento', 'ID da embarcação', 'ID da embarcacao']) || service?.equipmentId || '';
  const system = getReportField(fields, ['Sistema']) || service?.system || '';
  const serviceType = String(service?.serviceType || '').trim().toLowerCase();
  const base = [
    serviceType,
    historyKeyPart(equipment),
    historyKeyPart(system)
  ];
  if (serviceType === 'inibicao') {
    const step = getReportField(fields, ['Steps', 'Step', 'steps', 'step']) || '';
    base.push(historyKeyPart(step));
  } else {
    base.push(...serviceHistoryDisambiguatorParts(service));
  }
  return base.join('||');
}

export function serviceHistoryKey(service) {
  const explicit = explicitServiceHistoryKey(service);
  if (explicit && !explicit.includes('||')) return explicit;
  return semanticServiceHistoryKey(service) || explicit;
}

export function serviceHistoryKeys(service) {
  const keys = new Set();
  const explicit = explicitServiceHistoryKey(service);
  const semantic = semanticServiceHistoryKey(service);
  if (explicit) {
    if (semantic) keys.add(semantic);
    keys.add(explicit);
    const parts = explicit.split('||');
    if (parts.length >= 4) keys.add(parts.slice(1).join('||'));
  } else {
    keys.add(semantic);
  }

  return Array.from(keys).filter(Boolean);
}

export function hasSharedServiceHistoryKey(left, right) {
  const leftExplicit = explicitServiceHistoryKey(left);
  const rightExplicit = explicitServiceHistoryKey(right);
  if (leftExplicit && rightExplicit) {
    return leftExplicit === rightExplicit;
  }
  if (leftExplicit) {
    const rightKeys = new Set(serviceHistoryKeys(right));
    return serviceHistoryKeys(left).some(key => rightKeys.has(key));
  }
  if (rightExplicit) {
    const rightKeys = new Set(serviceHistoryKeys(right));
    return serviceHistoryKeys(left).some(key => rightKeys.has(key));
  }
  const rightKeys = new Set(serviceHistoryKeys(right));
  return serviceHistoryKeys(left).some(key => rightKeys.has(key));
}

function serviceSelectedReportTypes(service) {
  const fields = service?.extraData || {};
  const raw = getReportField(fields, ['Tipo de relatório', 'Tipo de relatorio', 'tipoRelatorio']);
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return values.map(value => String(value || '').trim().toUpperCase()).filter(Boolean);
}

function serviceWantsReportType(service, reportType) {
  return serviceSelectedReportTypes(service).includes(String(reportType).toUpperCase());
}

function findExistingByLinkKeys(existingByLinkKey, service, serviceId) {
  for (const key of serviceHistoryKeys(service)) {
    const existing = existingByLinkKey.get(key);
    if (existing) return existing;
  }
  return serviceId ? existingByLinkKey.get(String(serviceId)) : null;
}

function serviceReferenceKeys(service) {
  const keys = new Set(serviceHistoryKeys(service));
  const fields = service?.extraData || {};
  [service?.id, fields.__serviceLinkKey, fields.__sourceServiceId, fields.serviceId].forEach(value => {
    const key = String(value || '').trim();
    if (key) keys.add(key);
  });
  return Array.from(keys).filter(Boolean);
}

function servicesShareReference(left, right) {
  if (!left || !right) return false;
  if (left.serviceType !== right.serviceType) return false;
  if (left.id && right.id && left.id === right.id) return true;
  const rightKeys = new Set(serviceReferenceKeys(right));
  return serviceReferenceKeys(left).some(key => rightKeys.has(key));
}

function demotedFinalizedServiceRefs(existingServices = [], nextServices = []) {
  const refs = [];
  const matchedNextIndexes = new Set();

  for (let index = 0; index < existingServices.length; index += 1) {
    const existingService = existingServices[index];
    if (existingService?.finalized !== true) continue;
    const reportTypes = derivedReportTypesForService(existingService);
    if (!reportTypes.length) continue;

    let nextIndex = nextServices.findIndex((candidate, candidateIndex) => (
      !matchedNextIndexes.has(candidateIndex) && servicesShareReference(existingService, candidate)
    ));

    if (nextIndex < 0) {
      const candidate = nextServices[index];
      if (candidate?.serviceType === existingService.serviceType) {
        nextIndex = index;
      }
    }

    const nextService = nextIndex >= 0 ? nextServices[nextIndex] : null;
    if (!nextService || nextService.finalized === true) continue;
    matchedNextIndexes.add(nextIndex);
    refs.push({
      service: existingService,
      serviceType: existingService.serviceType,
      reportTypes,
      keys: serviceReferenceKeys(existingService)
    });
  }

  return refs;
}

function derivedReportMatchesServiceRef(report, ref) {
  if (!report || !ref?.reportTypes?.includes(report.reportType)) return false;
  const special = report.specialConditions || {};
  if (special.serviceOnly === true || !special.parentRdoId) return false;
  const reportKeys = [
    special.serviceLinkKey,
    special.serviceId,
    special.serviceData?.__serviceLinkKey,
    special.serviceData?.__sourceServiceId
  ].map(value => String(value || '').trim()).filter(Boolean);
  if (!reportKeys.length) return false;
  return reportKeys.some(key => ref.keys.includes(key));
}

async function serviceHasFinalizedContinuation(tx, projectId, currentReportId, ref) {
  const approvedRdos = await tx.report.findMany({
    where: approvedRdoHistoryWhere(projectId),
    select: {
      id: true,
      services: {
        select: {
          id: true,
          serviceType: true,
          finalized: true,
          extraData: true
        }
      }
    }
  });

  return approvedRdos.some(report => (
    report.id !== currentReportId &&
    (report.services || []).some(service => service.finalized === true && servicesShareReference(ref.service, service))
  ));
}

async function deleteUnfinalizedDerivedReports(tx, sourceReport, serviceRefs) {
  if (!sourceReport?.id || sourceReport.reportType !== ReportType.RDO || !serviceRefs.length) return [];

  const candidates = await tx.report.findMany({
    where: {
      projectId: sourceReport.projectId,
      deletedAt: null,
      reportType: { in: Array.from(new Set(serviceRefs.flatMap(ref => ref.reportTypes))) }
    },
    select: {
      id: true,
      projectId: true,
      reportType: true,
      sequenceNumber: true,
      status: true,
      specialConditions: true,
      reportSignatures: {
        select: {
          status: true
        }
      }
    }
  });

  const idsToDelete = new Set();
  const affectedTypes = new Set();

  for (const ref of serviceRefs) {
    if (await serviceHasFinalizedContinuation(tx, sourceReport.projectId, sourceReport.id, ref)) {
      continue;
    }

    for (const candidate of candidates) {
      if (!derivedReportMatchesServiceRef(candidate, ref)) continue;
      assertReportMutable(candidate);
      idsToDelete.add(candidate.id);
      affectedTypes.add(candidate.reportType);
    }
  }

  if (!idsToDelete.size) return [];

  const deletedAt = new Date();
  await tx.report.updateMany({
    where: {
      id: { in: Array.from(idsToDelete) }
    },
    data: {
      deletedAt,
      sequenceNumber: null
    }
  });

  for (const reportType of affectedTypes) {
    await renumberProjectReports(tx, sourceReport.projectId, reportType);
  }

  return Array.from(idsToDelete);
}

export function buildHistoricalServiceData(currentFields, serviceHistory) {
  const data = { ...(currentFields || {}) };
  const serviceCollaboratorFieldNames = [
    'Colaboradores do serviço',
    'Colaboradores do serviÃ§o',
    'Colaboradores do servico'
  ];
  const firstField = names => {
    for (const item of serviceHistory) {
      const value = getReportField(item.fields, names);
      if (hasReportFieldValue(value)) return value;
    }
    return undefined;
  };
  const lastField = names => {
    for (let i = serviceHistory.length - 1; i >= 0; i--) {
      const value = getReportField(serviceHistory[i].fields, names);
      if (hasReportFieldValue(value)) return value;
    }
    return undefined;
  };
  const copyIfPresent = (targetKey, value) => {
    if (value !== undefined) data[targetKey] = value;
  };
  const historicalCollaboratorIds = [];
  const historicalCollaboratorNamesById = new Map();
  const seenHistoricalCollaborators = new Set();
  for (const item of serviceHistory) {
    const value = getReportField(item.fields, serviceCollaboratorFieldNames);
    const ids = Array.isArray(value?.ids) ? value.ids.filter(Boolean) : [];
    const names = Array.isArray(value?.names) ? value.names : [];
    ids.forEach((id, index) => {
      const key = String(id || '').trim();
      if (!key) return;
      const name = String(names[index] || '').trim();
      if (name && !historicalCollaboratorNamesById.has(key)) {
        historicalCollaboratorNamesById.set(key, name);
      }
      if (seenHistoricalCollaborators.has(key)) return;
      seenHistoricalCollaborators.add(key);
      historicalCollaboratorIds.push(key);
    });
  }
  if (historicalCollaboratorIds.length) {
    data['Colaboradores do serviço'] = {
      ids: historicalCollaboratorIds,
      names: historicalCollaboratorIds.map(id => historicalCollaboratorNamesById.get(id) || id)
    };
  }

  copyIfPresent('Contagem inicial NAS', firstField(['Contagem inicial NAS', 'NAS inicial', 'Valor NAS inicial']));
  copyIfPresent('Contagem inicial ISO', firstField(['Contagem inicial ISO', 'ISO inicial', 'Classe ISO inicial', 'Valor ISO inicial']));
  copyIfPresent('Contagem final NAS', lastField(['Contagem final NAS', 'NAS final', 'Valor NAS final']));
  copyIfPresent('Contagem final ISO', lastField(['Contagem final ISO', 'ISO final', 'Classe ISO final', 'Valor ISO final']));
  copyIfPresent('Umidade inicial (ppm)', firstField(['Umidade inicial (ppm)']));
  copyIfPresent('Umidade final (ppm)', lastField(['Umidade final (ppm)']));
  copyIfPresent('Contador utilizado', lastField(['Contador utilizado']));
  copyIfPresent('Foto do laudo do contador', lastField(['Foto do laudo do contador', 'Foto laudo do contador']));
  copyIfPresent('Equipamento de desidratação', lastField(['Equipamento de desidratação', 'Equipamento de desidratacao']));
  copyIfPresent('Foto análise inicial', lastField(['Foto análise inicial', 'Foto analise inicial']));
  copyIfPresent('Foto análise final', lastField(['Foto análise final', 'Foto analise final']));
  const allSteps = [];
  const seenSteps = new Set();
  for (const item of serviceHistory) {
    const steps = getReportField(item.fields, ['Etapas realizadas no dia']);
    const arr = Array.isArray(steps) ? steps : (steps ? [steps] : []);
    for (const step of arr) {
      const label = String(step || '').trim();
      const key = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (label && !seenSteps.has(key)) {
        seenSteps.add(key);
        allSteps.push(label);
      }
    }
  }
  if (allSteps.length) data['Etapas realizadas no dia'] = allSteps;

  const hasParticleData = serviceHistory.some(item => (
    isYesReportField(getReportField(item.fields, ['Houve contagem de partículas?', 'Houve contagem de particulas?'])) ||
    getReportField(item.fields, ['Contador utilizado', 'Contagem inicial NAS', 'Contagem final NAS', 'Contagem inicial ISO', 'Contagem final ISO', 'Foto do laudo do contador', 'Foto laudo do contador'])
  ));
  if (hasParticleData) data['Houve contagem de partículas?'] = 'Sim';

  const hasHumidityData = serviceHistory.some(item => (
    isYesReportField(getReportField(item.fields, ['Houve desidratação?', 'Houve desidratacao?', 'Houve análise de umidade?', 'Houve analise de umidade?'])) ||
    getReportField(item.fields, ['Umidade inicial (ppm)', 'Umidade final (ppm)', 'Equipamento de desidratação', 'Equipamento de desidratacao'])
  ));
  if (hasHumidityData) {
    data['Houve desidratação?'] = 'Sim';
    data['Houve análise de umidade?'] = 'Sim';
  }

  return data;
}

async function syncApprovedRcpReports(tx, report) {
  if (!report || report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED) {
    return;
  }

  const rcpServices = (report.services || []).filter(
    s => (s.serviceType === 'flushing' || s.serviceType === 'filtragem') && s.finalized === true
  );

  if (!rcpServices.length) {
    return;
  }

  // For RCPU, one report per serviceLinkKey for the whole project (not per parentRdoId).
  const existingRcps = await tx.report.findMany({
    where: {
      projectId: report.projectId,
      deletedAt: null,
      project: activeReportProjectWhere(),
      reportType: ReportType.RCPU
    },
    select: { id: true, projectId: true, reportType: true, sequenceNumber: true, status: true, reportDate: true, specialConditions: true }
  });

  const existingByLinkKey = new Map();
  existingRcps.forEach(item => {
    const special = item.specialConditions || {};
    const linkKey = String(special.serviceLinkKey || '').trim();
    const serviceId = String(special.serviceId || '').trim();
    if (linkKey) existingByLinkKey.set(linkKey, item);
    if (serviceId) existingByLinkKey.set(serviceId, item);
  });

  // Fetch all approved RDOs once for totalMinutes calculation.
  const allApprovedRdos = await tx.report.findMany({
    where: approvedRdoHistoryWhere(report.projectId),
    orderBy: [{ reportDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      reportDate: true,
      createdAt: true,
      services: {
        select: { id: true, serviceType: true, equipmentId: true, system: true, material: true, startTime: true, endTime: true, extraData: true }
      }
    }
  });

  for (const service of rcpServices) {
    const fields = service.extraData || {};
    const serviceLinkKey = serviceHistoryKey(service) || String(service.id || '').trim();

    const serviceHistory = [];
    for (const rdo of allApprovedRdos) {
      for (const svc of rdo.services || []) {
        if (svc.serviceType !== service.serviceType) continue;
        if (hasSharedServiceHistoryKey(service, svc) || svc.id === service.id) {
          serviceHistory.push({ rdo, svc, fields: svc.extraData || {} });
        }
      }
    }
    if (!serviceHistory.length) {
      serviceHistory.push({ rdo: report, svc: service, fields });
    }
    const consolidatedFields = buildHistoricalServiceData(fields, serviceHistory);

    const collabField =
      consolidatedFields['Colaboradores do serviço'] ||
      consolidatedFields['Colaboradores do serviÃ§o'] ||
      consolidatedFields['Colaboradores do servico'];
    const collabIds = [...new Set(Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [])];

    const unitFieldVal = service.serviceType === 'filtragem'
      ? (consolidatedFields['Unidade de filtragem'] || consolidatedFields['Unidade de Filtragem'])
      : (consolidatedFields['Unidade de Flushing'] || consolidatedFields['Unidade de flushing']);
    const unitIds = Array.isArray(unitFieldVal?.ids) ? unitFieldVal.ids.filter(Boolean)
      : (unitFieldVal && typeof unitFieldVal === 'string' ? [unitFieldVal] : []);

    const thermoFieldVal =
      consolidatedFields['Equipamento de desidratação'] ||
      consolidatedFields['Equipamento de desidrataÃ§Ã£o'] ||
      consolidatedFields['Equipamento de desidratacao'];
    const thermoIds = Array.isArray(thermoFieldVal?.ids) ? thermoFieldVal.ids.filter(Boolean)
      : (thermoFieldVal && typeof thermoFieldVal === 'string' ? [thermoFieldVal] : []);

    const counterRaw = consolidatedFields['Contador utilizado'];
    const counterId = counterRaw && typeof counterRaw === 'string' ? counterRaw
      : (counterRaw?.id || null);

    const [collaborators, units, thermoUnits, counter] = await Promise.all([
      collabIds.length ? tx.collaborator.findMany({ where: { id: { in: collabIds } } }) : Promise.resolve([]),
      resolveReportUnits(tx, unitIds),
      resolveReportUnits(tx, thermoIds),
      resolveReportCounter(tx, counterId)
    ]);

    const existingRcp = serviceLinkKey ? findExistingByLinkKeys(existingByLinkKey, service, service.id) : null;
    const resolvedCollaborators = resolveCollaboratorsByShift(report, collaborators);
    const resolvedUnits = units.map(u => u.code);
    const resolvedThermoUnit = thermoUnits.length ? thermoUnits[0].code : '';
    const resolvedCounter = preserveCounterCalibrationSnapshot(existingRcp, report.reportDate, counter ? {
      code: counter.code,
      serialNumber: counter.serialNumber,
      certificate: counter.currentCalibrationCertificate
    } : null);

    // Sum minutes across all approved RDOs with the same service linkKey.
    let totalMinutes = 0;
    for (const item of serviceHistory) totalMinutes += calcServiceMinutes(item.svc.startTime, item.svc.endTime);

    const rcpPayload = {
      projectId: report.projectId,
      createdByUserId: report.createdByUserId,
      reviewedByUserId: report.reviewedByUserId,
      reportType: ReportType.RCPU,
      status: ReportStatus.APPROVED,
      reportDate: report.reportDate,
      arrivalTime: service.startTime || report.arrivalTime,
      departureTime: service.endTime || report.departureTime,
      lunchBreak: report.lunchBreak,
      daytimeCount: resolvedCollaborators.length || report.daytimeCount,
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0,
      nighttimeOvertimeMinutes: 0,
      totalOvertimeMinutes: 0,
      approvedAt: report.approvedAt || new Date(),
      specialConditions: {
        parentRdoId: report.id,
        serviceId: service.id,
        serviceLinkKey: serviceLinkKey || String(service.id),
        serviceType: service.serviceType,
        serviceData: consolidatedFields,
        resolvedCollaborators,
        resolvedUnits,
        resolvedThermoUnit,
        resolvedCounter,
        totalMinutes,
        __leaderSnapshot: report.specialConditions?.__leaderSnapshot || null
      }
    };

    if (existingRcp) {
      await validateDerivedReportSequenceMove(tx, existingRcp, report.projectId, ReportType.RCPU);
      await tx.reportCollaborator.deleteMany({ where: { reportId: existingRcp.id } });
      await tx.reportService.deleteMany({ where: { reportId: existingRcp.id } });
      await tx.report.update({
        where: { id: existingRcp.id },
        data: {
          ...rcpPayload,
          collaborators: {
            create: collabIds.map(id => ({ collaboratorId: id }))
          },
          services: {
            create: [{
              serviceType: service.serviceType,
              equipmentId: service.equipmentId || null,
              system: service.system || null,
              material: service.material || null,
              startTime: service.startTime || null,
              endTime: service.endTime || null,
              finalized: true,
              extraData: consolidatedFields
            }]
          }
        }
      });
      continue;
    }

    const rcpSeq = await reserveSequence(tx, report.projectId, ReportType.RCPU);
    await tx.report.create({
      data: {
        ...rcpPayload,
        sequenceNumber: rcpSeq,
        collaborators: {
          create: collabIds.map(id => ({ collaboratorId: id }))
        },
        services: {
          create: [{
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: true,
            extraData: consolidatedFields
          }]
        }
      }
    });
  }
}

async function syncApprovedRlmReports(tx, report) {
  if (!report || report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED) {
    return;
  }

  const mecanicaServices = (report.services || []).filter(
    s => s.serviceType === 'mecanica' && s.finalized === true
  );

  if (!mecanicaServices.length) {
    return;
  }

  const existingRlms = await tx.report.findMany({
    where: {
      projectId: report.projectId,
      deletedAt: null,
      project: activeReportProjectWhere(),
      reportType: ReportType.RLM
    },
    select: { id: true, projectId: true, reportType: true, sequenceNumber: true, status: true, specialConditions: true }
  });

  const existingByLinkKey = new Map();
  existingRlms.forEach(item => {
    const special = item.specialConditions || {};
    if (special.parentRdoId !== report.id) return;
    const linkKey = String(special.serviceLinkKey || special.serviceId || '').trim();
    if (linkKey) existingByLinkKey.set(linkKey, item);
  });

  const allApprovedRdos = await tx.report.findMany({
    where: approvedRdoHistoryWhere(report.projectId),
    orderBy: [{ reportDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      reportDate: true,
      createdAt: true,
      services: {
        select: { id: true, serviceType: true, startTime: true, endTime: true, extraData: true }
      }
    }
  });

  for (const service of mecanicaServices) {
    const fields = service.extraData || {};
    const serviceLinkKey = String(
      fields.__serviceLinkKey ||
      fields.__sourceServiceId ||
      service.id ||
      ''
    ).trim();
    const serviceHistory = [];
    for (const rdo of allApprovedRdos) {
      for (const svc of rdo.services || []) {
        if (svc.serviceType !== service.serviceType) continue;
        if (hasSharedServiceHistoryKey(service, svc) || svc.id === service.id) {
          serviceHistory.push({ rdo, svc, fields: svc.extraData || {} });
        }
      }
    }
    if (!serviceHistory.length) {
      serviceHistory.push({ rdo: report, svc: service, fields });
    }
    const consolidatedFields = buildHistoricalServiceData(fields, serviceHistory);

    const collabField =
      consolidatedFields['Colaboradores do serviço'] ||
      consolidatedFields['Colaboradores do serviÃ§o'] ||
      consolidatedFields['Colaboradores do servico'];
    const collabIds = [...new Set(Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [])];

    const collaborators = collabIds.length
      ? await tx.collaborator.findMany({ where: { id: { in: collabIds } } })
      : [];

    const resolvedCollaborators = resolveCollaboratorsByShift(report, collaborators);

    const rlmPayload = {
      projectId: report.projectId,
      createdByUserId: report.createdByUserId,
      reviewedByUserId: report.reviewedByUserId,
      reportType: ReportType.RLM,
      status: ReportStatus.APPROVED,
      reportDate: report.reportDate,
      arrivalTime: service.startTime || report.arrivalTime,
      departureTime: service.endTime || report.departureTime,
      lunchBreak: report.lunchBreak,
      daytimeCount: resolvedCollaborators.length || report.daytimeCount,
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0,
      nighttimeOvertimeMinutes: 0,
      totalOvertimeMinutes: 0,
      approvedAt: report.approvedAt || new Date(),
      specialConditions: {
        parentRdoId: report.id,
        serviceId: service.id,
        serviceLinkKey: serviceLinkKey || String(service.id),
        serviceData: consolidatedFields,
        resolvedCollaborators,
        __leaderSnapshot: report.specialConditions?.__leaderSnapshot || null
      }
    };

    const existingRlm = serviceLinkKey ? findExistingByLinkKeys(existingByLinkKey, service, service.id) : null;

    if (existingRlm) {
      await validateDerivedReportSequenceMove(tx, existingRlm, report.projectId, ReportType.RLM);
      await tx.reportCollaborator.deleteMany({ where: { reportId: existingRlm.id } });
      await tx.reportService.deleteMany({ where: { reportId: existingRlm.id } });
      await tx.report.update({
        where: { id: existingRlm.id },
        data: {
          ...rlmPayload,
          collaborators: {
            create: collabIds.map(id => ({ collaboratorId: id }))
          },
          services: {
            create: [{
              serviceType: service.serviceType,
              equipmentId: service.equipmentId || null,
              system: service.system || null,
              material: service.material || null,
              startTime: service.startTime || null,
              endTime: service.endTime || null,
              finalized: true,
              extraData: consolidatedFields
            }]
          }
        }
      });
      continue;
    }

    const rlmSeq = await reserveSequence(tx, report.projectId, ReportType.RLM);
    await tx.report.create({
      data: {
        ...rlmPayload,
        sequenceNumber: rlmSeq,
        collaborators: {
          create: collabIds.map(id => ({ collaboratorId: id }))
        },
        services: {
          create: [{
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: true,
            extraData: consolidatedFields
          }]
        }
      }
    });
  }
}

async function syncApprovedInhibitionReports(tx, report, targetReportType) {
  if (!report || report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED) {
    return;
  }

  const inibicaoServices = (report.services || []).filter(
    s => s.serviceType === 'inibicao' && s.finalized === true && serviceWantsReportType(s, targetReportType)
  );

  if (!inibicaoServices.length) {
    return;
  }

  const existingReports = await tx.report.findMany({
    where: {
      projectId: report.projectId,
      deletedAt: null,
      project: activeReportProjectWhere(),
      reportType: targetReportType
    },
    select: { id: true, projectId: true, reportType: true, sequenceNumber: true, status: true, specialConditions: true }
  });

  const existingByLinkKey = new Map();
  existingReports.forEach(item => {
    const special = item.specialConditions || {};
    const linkKey = String(special.serviceLinkKey || '').trim();
    const serviceId = String(special.serviceId || '').trim();
    if (linkKey) existingByLinkKey.set(linkKey, item);
    if (serviceId) existingByLinkKey.set(serviceId, item);
  });

  const allApprovedRdos = await tx.report.findMany({
    where: approvedRdoHistoryWhere(report.projectId),
    orderBy: [{ reportDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      reportDate: true,
      createdAt: true,
      services: {
        select: { id: true, serviceType: true, equipmentId: true, system: true, material: true, startTime: true, endTime: true, extraData: true }
      }
    }
  });

  for (const service of inibicaoServices) {
    const fields = service.extraData || {};
    const serviceLinkKey = serviceHistoryKey(service) || String(service.id || '').trim();

    const serviceHistory = [];
    for (const rdo of allApprovedRdos) {
      for (const svc of rdo.services || []) {
        if (svc.serviceType !== service.serviceType) continue;
        if (hasSharedServiceHistoryKey(service, svc) || svc.id === service.id) {
          serviceHistory.push({ rdo, svc, fields: svc.extraData || {} });
        }
      }
    }
    if (!serviceHistory.length) {
      serviceHistory.push({ rdo: report, svc: service, fields });
    }
    const consolidatedFields = buildHistoricalServiceData(fields, serviceHistory);

    const collabIds = uniqueIds((report.collaborators || []).map(link => link.collaboratorId).filter(Boolean));
    const collaborators = collabIds.length
      ? await tx.collaborator.findMany({ where: { id: { in: collabIds } } })
      : [];
    const resolvedCollaborators = resolveCollaboratorsByShift(report, collaborators);

    const payload = {
      projectId: report.projectId,
      createdByUserId: report.createdByUserId,
      reviewedByUserId: report.reviewedByUserId,
      reportType: targetReportType,
      status: ReportStatus.APPROVED,
      reportDate: report.reportDate,
      arrivalTime: service.startTime || report.arrivalTime,
      departureTime: service.endTime || report.departureTime,
      lunchBreak: report.lunchBreak,
      daytimeCount: resolvedCollaborators.length || report.daytimeCount,
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0,
      nighttimeOvertimeMinutes: 0,
      totalOvertimeMinutes: 0,
      approvedAt: report.approvedAt || new Date(),
      specialConditions: {
        parentRdoId: report.id,
        serviceId: service.id,
        serviceLinkKey: serviceLinkKey || String(service.id),
        serviceType: service.serviceType,
        serviceData: consolidatedFields,
        resolvedCollaborators,
        __leaderSnapshot: report.specialConditions?.__leaderSnapshot || null
      }
    };

    const existingReport = serviceLinkKey ? findExistingByLinkKeys(existingByLinkKey, service, service.id) : null;

    if (existingReport) {
      await validateDerivedReportSequenceMove(tx, existingReport, report.projectId, targetReportType);
      await tx.reportCollaborator.deleteMany({ where: { reportId: existingReport.id } });
      await tx.reportService.deleteMany({ where: { reportId: existingReport.id } });
      await tx.report.update({
        where: { id: existingReport.id },
        data: {
          ...payload,
          collaborators: {
            create: collabIds.map(id => ({ collaboratorId: id }))
          },
          services: {
            create: [{
              serviceType: service.serviceType,
              equipmentId: service.equipmentId || null,
              system: service.system || null,
              material: service.material || null,
              startTime: service.startTime || null,
              endTime: service.endTime || null,
              finalized: true,
              extraData: consolidatedFields
            }]
          }
        }
      });
      continue;
    }

    const sequenceNumber = await reserveSequence(tx, report.projectId, targetReportType);
    await tx.report.create({
      data: {
        ...payload,
        sequenceNumber,
        collaborators: {
          create: collabIds.map(id => ({ collaboratorId: id }))
        },
        services: {
          create: [{
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: true,
            extraData: consolidatedFields
          }]
        }
      }
    });
  }
}

async function syncApprovedRlfReports(tx, report) {
  return syncApprovedInhibitionReports(tx, report, ReportType.RLF);
}

async function syncApprovedRliReports(tx, report) {
  return syncApprovedInhibitionReports(tx, report, ReportType.RLI);
}

function independentReportTypesForService(service) {
  switch (service.serviceType) {
    case 'pressao':
      return [ReportType.RTP];
    case 'limpeza':
      return [ReportType.RLQ];
    case 'flushing':
    case 'filtragem':
      return [ReportType.RCPU];
    case 'mecanica':
      return [ReportType.RLM];
    default:
      return [];
  }
}

function serviceCollaboratorIds(service, fallbackIds = []) {
  const fields = service.extraData || {};
  const collabField =
    fields['Colaboradores do serviço'] ||
    fields['Colaboradores do serviÃ§o'] ||
    fields['Colaboradores do servico'];
  const ids = Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [];
  return uniqueIds(ids.length ? ids : fallbackIds);
}

function serviceUnitIds(fields, names) {
  const field = getReportField(fields, names);
  if (Array.isArray(field?.ids)) return field.ids.filter(Boolean);
  if (field && typeof field === 'string') return [field];
  return [];
}

function sourceReportForIndependentService(project, data, collaboratorIds, reviewedByUserId) {
  return {
    id: null,
    projectId: data.projectId,
    createdByUserId: data.createdByUserId,
    reviewedByUserId,
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED,
    reportDate: new Date(data.reportDate),
    arrivalTime: '00:00',
    departureTime: '00:00',
    lunchBreak: '00:00:00',
    daytimeCount: collaboratorIds.length,
    approvedAt: new Date(),
    project,
    collaborators: collaboratorIds.map(collaboratorId => ({ collaboratorId })),
    specialConditions: withLeaderSnapshot({}, projectLeaderSnapshot(project))
  };
}

async function buildIndependentSpecialConditions(tx, reportType, sourceReport, service) {
  const fields = expandUploadGroupsInServiceData(service.extraData || {}, service.extraData || {});
  const collabIds = serviceCollaboratorIds(service, (sourceReport.collaborators || []).map(link => link.collaboratorId));
  const collaborators = collabIds.length
    ? await tx.collaborator.findMany({ where: { id: { in: collabIds } } })
    : [];
  const resolvedCollaborators = resolveCollaboratorsByShift(sourceReport, collaborators);
  const serviceLinkKey = serviceHistoryKey(service) || String(service.id || '').trim();
  const base = {
    serviceOnly: true,
    source: 'SERVICE_ONLY',
    serviceLinkKey: serviceLinkKey || undefined,
    serviceType: service.serviceType,
    serviceData: fields,
    resolvedCollaborators,
    __leaderSnapshot: sourceReport.specialConditions?.__leaderSnapshot || null
  };

  if (reportType === ReportType.RTP) {
    const manoIds = serviceUnitIds(fields, ['Manômetros utilizados', 'ManÃ´metros utilizados', 'Manometros utilizados']);
    const uthIds = serviceUnitIds(fields, [
      'Unidade de Teste Hidrostático (UTH)',
      'Unidade de Teste HidrostÃ¡tico (UTH)',
      'Unidade de Teste Hidrostatico (UTH)'
    ]);
    const [manometers, uthUnits] = await Promise.all([
      resolveReportManometers(tx, manoIds),
      resolveReportUnits(tx, uthIds)
    ]);
    return {
      ...base,
      resolvedManometers: manometers.map(m => ({
        id: m.id,
        code: m.code,
        scale: m.scale,
        certCode: m.calibrationCertCode,
        certificate: m.currentCalibrationCertificate,
        calibratedAt: m.calibratedAt ? m.calibratedAt.toISOString().slice(0, 10) : '',
        expiresAt: m.expiresAt ? m.expiresAt.toISOString().slice(0, 10) : ''
      })),
      resolvedUnits: uthUnits.map(u => u.code)
    };
  }

  if (reportType === ReportType.RLQ) {
    const ulqIds = serviceUnitIds(fields, [
      'Unidade de Limpeza Química',
      'Unidade de Limpeza QuÃ­mica',
      'Unidade de Limpeza Quimica'
    ]);
    const units = await resolveReportUnits(tx, ulqIds);
    return { ...base, resolvedUnits: units.map(u => u.code) };
  }

  if (reportType === ReportType.RCPU) {
    const unitFieldNames = service.serviceType === 'filtragem'
      ? ['Unidade de filtragem', 'Unidade de Filtragem']
      : ['Unidade de Flushing', 'Unidade de flushing'];
    const unitIds = serviceUnitIds(fields, unitFieldNames);
    const thermoIds = serviceUnitIds(fields, [
      'Equipamento de desidratação',
      'Equipamento de desidrataÃ§Ã£o',
      'Equipamento de desidratacao'
    ]);
    const counterRaw = fields['Contador utilizado'];
    const counterId = counterRaw && typeof counterRaw === 'string' ? counterRaw : (counterRaw?.id || null);
    const [units, thermoUnits, counter] = await Promise.all([
      resolveReportUnits(tx, unitIds),
      resolveReportUnits(tx, thermoIds),
      resolveReportCounter(tx, counterId)
    ]);
    return {
      ...base,
      resolvedUnits: units.map(u => u.code),
      resolvedThermoUnit: thermoUnits.length ? thermoUnits[0].code : '',
      resolvedCounter: counter ? {
        code: counter.code,
        serialNumber: counter.serialNumber,
        certificate: counter.currentCalibrationCertificate
      } : null,
      totalMinutes: calcServiceMinutes(service.startTime, service.endTime)
    };
  }

  return base;
}

async function createIndependentServiceReports(tx, project, data, managerUserId) {
  const collaboratorIds = uniqueIds(data.collaboratorIds);
  const sourceReport = sourceReportForIndependentService(project, data, collaboratorIds, managerUserId);
  const createdReports = [];

  for (const service of data.services) {
    const normalizedService = {
      ...service,
      id: String(service.extraData?.__serviceLinkKey || service.extraData?.__sourceServiceId || ''),
      finalized: true,
      extraData: normalizeStoredReportUploadUrls(service.extraData || {})
    };
    const reportTypes = independentReportTypesForService(normalizedService);
    for (const reportType of reportTypes) {
      const sequenceNumber = await reserveSequence(tx, data.projectId, reportType);
      const specialConditions = await buildIndependentSpecialConditions(tx, reportType, sourceReport, normalizedService);
      const reportCollaboratorIds = serviceCollaboratorIds(normalizedService, collaboratorIds);
      const created = await tx.report.create({
        data: {
          projectId: data.projectId,
          createdByUserId: managerUserId,
          reviewedByUserId: managerUserId,
          reportType,
          sequenceNumber,
          status: ReportStatus.APPROVED,
          reportDate: new Date(data.reportDate),
          arrivalTime: normalizedService.startTime || '00:00',
          departureTime: normalizedService.endTime || '00:00',
          lunchBreak: '00:00:00',
          daytimeCount: reportCollaboratorIds.length || collaboratorIds.length,
          daytimeWorkedMinutes: 0,
          nighttimeWorkedMinutes: 0,
          daytimeOvertimeMinutes: 0,
          nighttimeOvertimeMinutes: 0,
          totalOvertimeMinutes: 0,
          approvedAt: new Date(),
          specialConditions,
          pendingDerivedTypes: [],
          collaborators: {
            create: reportCollaboratorIds.map(collaboratorId => ({ collaboratorId }))
          },
          services: {
            create: [{
              serviceType: normalizedService.serviceType,
              equipmentId: normalizedService.equipmentId || null,
              system: normalizedService.system || null,
              material: normalizedService.material || null,
              startTime: normalizedService.startTime || null,
              endTime: normalizedService.endTime || null,
              finalized: true,
              extraData: normalizedService.extraData
            }]
          }
        },
        include
      });
      createdReports.push(created);
    }
  }

  return createdReports;
}

// Constrói o `where` da listagem de relatórios a partir de (auth, query). Extraído para que a
// listagem (`GET /`) e os contadores (`POST /counts`) usem exatamente a mesma lógica de filtro
// e visibilidade por papel — assim o total dos badges nunca diverge da lista paginada.
async function buildReportListWhere(auth, query) {
  const where = { deletedAt: null, project: activeReportProjectWhere() };
  const statusFilter = parseReportStatusFilter(query);
  const searchTerm = parseReportSearchTerm(query);
  const usingReviewQueueFilter = applyReportReviewQueueFilter(where, query.reviewQueue);

  if (!usingReviewQueueFilter && statusFilter.length === 1) {
    where.status = statusFilter[0];
  } else if (!usingReviewQueueFilter && statusFilter.length > 1) {
    where.status = { in: statusFilter };
  }

  if (query.projectId) {
    where.projectId = String(query.projectId);
  }

  if (query.reportType) {
    const reportType = String(query.reportType).trim().toUpperCase();
    if (!Object.values(ReportType).includes(reportType)) {
      const error = new Error('Tipo de relatório inválido.');
      error.statusCode = 400;
      throw error;
    }
    where.reportType = reportType;
  }

  if (query.createdByUserId) {
    where.createdByUserId = String(query.createdByUserId);
  }

  if (auth.user.role === 'CLIENT') {
    assignClientReportProjectWhere(where, await clientProjectAccessWhereWithSigners(prisma, auth));
  } else if (auth.user.role === 'COORDINATOR') {
    assignActiveReportProjectWhere(where, { managerOnly: false });
  } else if (auth.user.role === 'COLLABORATOR') {
    const me = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { collaboratorId: true }
    });
    assignActiveReportProjectWhere(where, collaboratorReportProjectWhere(me?.collaboratorId, auth.user.id));
  } else if (query.mine === 'true') {
    where.createdByUserId = auth.user.id;
    assignActiveReportProjectWhere(where, { managerOnly: false });
  }
  if (auth.user.role !== 'MANAGER' && Object.keys(where.project || {}).length === 1) {
    assignActiveReportProjectWhere(where, { managerOnly: false });
  }
  applyReportProjectActiveFilter(where, query.projectActive);
  const searchWhere = buildReportSearchWhere(searchTerm);
  if (searchWhere && auth.user.role !== 'CLIENT') {
    where.AND = [...(where.AND || []), searchWhere];
  }
  return { where, searchTerm };
}

router.get('/', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  const pagination = parseReportListPagination(req.query);
  const useSummarySelect = reportListUsesSummarySelect(req.query);
  const reportSortDirection = parseReportSortDirection(req.query);
  const projectSortDirection = parseProjectSortDirection(req.query);
  const { where, searchTerm } = await buildReportListWhere(req.auth, req.query);

  const tGet0 = Date.now();
  const orderBy = reportSortDirection
    ? [{ sequenceNumber: reportSortDirection }, { reportDate: reportSortDirection }, { createdAt: reportSortDirection }]
    : projectSortDirection
      ? [{ project: { code: projectSortDirection } }, { project: { name: projectSortDirection } }, { reportDate: 'desc' }, { createdAt: 'desc' }]
    : [{ reportDate: 'desc' }, { createdAt: 'desc' }];
  const reportListQueryShape = useSummarySelect
    ? { select: listSummarySelect }
    : { include };
  const canPaginateInDatabase = pagination && req.auth.user.role !== 'CLIENT';
  let items;
  let total = null;
  let groups = [];
  let projectTotal = null;

  if (pagination && canPaginateInDatabase) {
    const result = await prisma.$transaction(async tx => {
      const pageItems = await tx.report.findMany({
        where,
        ...reportListQueryShape,
        orderBy,
        skip: pagination.skip,
        take: pagination.take
      });
      const [totalCount, groupTotals, totalProjects] = await Promise.all([
        tx.report.count({ where }),
        reportGroupTotalsForVisibleProjects(where, pageItems, tx),
        reportProjectTotal(where, tx)
      ]);
      return { items: pageItems, total: totalCount, groups: groupTotals, projectTotal: totalProjects };
    });
    items = result.items;
    total = result.total;
    groups = result.groups;
    projectTotal = result.projectTotal;
  } else {
    items = await prisma.report.findMany({
      where,
      ...reportListQueryShape,
      orderBy
    });
  }

  logSlowOperation('reports.list.query', Date.now() - tGet0, { count: items.length, role: req.auth.user.role });
  if (req.auth.user.role === 'CLIENT') {
    const needsProjectVisibilityContext = !!(req.query.projectId || req.query.reportType);
    const byId = needsProjectVisibilityContext
      ? await clientVisibilityMapForReports(items)
      : new Map(items.map(item => [item.id, item]));
    const visibleItems = items
      .filter(item => canClientSeeReport(item, byId))
      .filter(item => reportMatchesSearch(item, searchTerm));
    if (pagination) {
      const pageItems = visibleItems.slice(pagination.skip, pagination.skip + pagination.take);
      const groups = reportGroupTotalsFromItems(visibleItems);
      const projectTotal = reportProjectTotalFromItems(visibleItems);
      grantReportsUploadAccess(req.auth, pageItems);
      return res.json(paginatedReportResponse(pageItems, visibleItems.length, pagination, groups, { projectTotal }));
    }
    grantReportsUploadAccess(req.auth, visibleItems);
    return res.json(visibleItems);
  }
  grantReportsUploadAccess(req.auth, items);
  if (pagination) {
    return res.json(paginatedReportResponse(items, total ?? items.length, pagination, groups, { projectTotal: projectTotal ?? reportProjectTotalFromItems(items) }));
  }
  res.json(items);
}));

// P7 — contadores de badges em um único round-trip. Recebe N conjuntos de filtros (mesma
// semântica de `GET /`) e devolve o total de cada um na mesma ordem, evitando 3 chamadas
// `pageSize:1` separadas. Cada filtro usa `buildReportListWhere`, então o total casa com a lista.
const reportCountsSchema = z.object({
  queries: z.array(z.record(z.any())).min(1).max(8)
});

router.post('/counts', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  const { queries } = reportCountsSchema.parse(req.body);
  // Para CLIENT a visibilidade depende de pós-filtro em memória (canClientSeeReport), que não é
  // expressável só em `count` do banco. A UI do cliente não usa esses badges, então recusamos.
  if (req.auth.user.role === 'CLIENT') {
    const error = new Error('Contadores não disponíveis para este perfil.');
    error.statusCode = 403;
    throw error;
  }
  const totals = await Promise.all(queries.map(async query => {
    const { where } = await buildReportListWhere(req.auth, query);
    return prisma.report.count({ where });
  }));
  res.json({ totals });
}));

router.post('/batch-download', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  const data = batchDownloadSchema.parse(req.body);
  if (data.format === 'docx' && req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode baixar DOCX em lote.' });
  }

  const ids = uniqueIds(data.ids);
  const reports = await fetchReportsForIds(ids);
  if (reports.length !== ids.length) {
    return res.status(404).json({ error: 'Um ou mais relatórios selecionados não foram encontrados.' });
  }
  await assertBatchAccess(req.auth, reports);

  const zip = new AdmZip();
  for (const report of reports) {
    const file = data.format === 'docx'
      ? await getReportDocxDownload(report)
      : await getReportPdfDownload(report);
    zip.addFile(file.fileName, file.buffer);
  }

  const archiveName = `relatorios_${data.format}_${new Date().toISOString().slice(0, 10)}.zip`;
  sendDownloadBuffer(res, {
    contentType: 'application/zip',
    fileName: archiveName,
    buffer: zip.toBuffer()
  });
}));

router.get('/public-sign/:token', publicSignatureLimiter, asyncHandler(async (req, res) => {
  let signature = await publicSignatureFromToken(req.params.token);
  let status = publicSignatureStatus(signature);
  let batchSignatures = [];

  if (signature && status === 'EXPIRED' && signature.status === 'PENDING') {
    const expired = await prisma.$transaction(tx => expirePendingPublicSignature(tx, signature, signatureEvidenceFromRequest(req)));
    if (expired) {
      status = 'EXPIRED';
    } else {
      signature = await publicSignatureFromToken(req.params.token);
      status = publicSignatureStatus(signature);
    }
  } else if (signature && status === 'ACTIVE') {
    await createSignatureAuditLog(prisma, {
      reportId: signature.reportId,
      versionId: signature.versionId,
      userId: null,
      action: ReportAuditAction.TOKEN_ACCESSED,
      description: 'Link publico de assinatura acessado.',
      evidence: signatureEvidenceFromRequest(req)
    });
  }

  if (signature && !publicSignatureBatchScopeUnavailable(status)) {
    batchSignatures = await activePublicSignatureBatchFromAnchor(signature);
  }

  const responseSignature = batchSignatures[0] || signature;
  const responseStatus = batchSignatures.length ? 'ACTIVE' : status;
  const payload = publicSignaturePayload(responseSignature, responseStatus);
  if (payload.report && batchSignatures.length > 1) {
    payload.batch = publicSignatureBatchPayload(signature, batchSignatures);
  }
  res.json(payload);
}));

router.get('/public-sign/:token/pdf', publicSignatureLimiter, asyncHandler(async (req, res) => {
  const signatureId = String(req.query.signatureId || '').trim() || null;
  const signature = await publicSignatureForTokenScopeOrThrow(req.params.token, signatureId);
  const sourcePath = reportSourcePdfPath(signature.version.sourcePdfUrl);
  if (!sourcePath) return res.status(404).json({ error: 'PDF da assinatura não encontrado.' });

  sendDownloadBuffer(res, {
    contentType: 'application/pdf',
    fileName: reportPdfFileName(signature.report),
    buffer: await verifiedSourcePdfBuffer(sourcePath, signature.version)
  });
}));

router.post('/public-sign/:token/confirm', publicSignatureLimiter, asyncHandler(async (req, res) => {
  const data = publicSignatureConfirmSchema.parse(req.body || {});
  await assertRenderableReportSignatureImageDataUrl(data.signatureImageDataUrl);
  const evidence = signatureEvidenceFromRequest(req);
  let signedVersion;
  let signatureResult = { alreadySigned: false };
  let item = await prisma.$transaction(async tx => {
    const signature = await publicSignatureForTokenScopeOrThrow(req.params.token, data.signatureId, tx, { retryable: true });
    const completesRequiredSignatures = signatureWouldCompleteRequired(signature.version, signature.id);
    await assertSignatureFinalizationPreflight(signature.version);
    signatureResult = await signInternalReportVersion(tx, {
      report: signature.report,
      version: signature.version,
      signer: {
        name: data.signerName,
        email: signature.signerEmail
      },
      userId: null,
      evidence,
      signatureImageDataUrl: data.signatureImageDataUrl,
      privacyNoticeVersion: data.privacyNoticeVersion,
      deferAuditLog: completesRequiredSignatures
    });
    signedVersion = await activeVersionWithSignatures(tx, signature.reportId);
    return tx.report.findUniqueOrThrow({
      where: { id: signature.reportId },
      include
    });
  });

  signedVersion = await completedSignatureVersionAfterCommit(prisma, item.id) || signedVersion;

  let completed = false;
  if (signedVersion && allRequiredSignaturesCompleted(signedVersion)) {
    try {
      item = await finalizeInternalSignatureRound(item, signedVersion, evidence, null, {
        signedAudit: signatureResult.signedSignature
      });
      completed = true;
    } catch (error) {
      await resetSignedSignatureForFinalizationRetry(prisma, signatureResult).catch(resetError => {
        console.error('Falha ao tornar assinatura retryable após erro de finalização.', resetError);
      });
      throw error;
    }
  }

  if (completed || !signatureResult.alreadySigned) {
    const finalVersion = completed && item.versions?.[0]
      ? { ...signedVersion, finalDocumentHash: item.versions[0].finalDocumentHash }
      : signedVersion;
    const signedSignature = signatureResult.signedSignature
      || finalVersion?.signatures?.find(signature => data.signatureId ? signature.id === data.signatureId : internalSignatureTokenHash(req.params.token) === signature.tokenHash);
    queueInternalSignatureNotification(item, finalVersion, {
      name: signedSignature?.signerName,
      email: signedSignature?.signerEmail
    }, completed);
  }

  if (completed) {
    await reconcileProjectClientSignatureRequirements(item.projectId, {
      userId: null,
      evidence,
      sendReleasedEmails: false
    });
    const releasedServiceReports = await releasedServiceReportsAfterRdoSignature(item);
    if (releasedServiceReports.length) {
      queueReleasedServiceReportsEmailAfterRdoSignature(item, releasedServiceReports);
    }
  }

  res.json({ success: true, completed, report: withInternalSignatureProgress(item) });
}));

router.post('/public-sign/:token/reject', publicSignatureLimiter, asyncHandler(async (req, res) => {
  const data = publicSignatureRejectSchema.parse(req.body || {});
  const evidence = signatureEvidenceFromRequest(req);
  const item = await rejectPublicInternalSignature({
    token: req.params.token,
    signatureId: data.signatureId,
    comment: data.comment,
    evidence
  });

  queueClientRejectionNotification(item, data.comment);
  res.json({ success: true, report: item });
}));

router.get('/validate-signature/:validationCode', publicSignatureLimiter, asyncHandler(async (req, res) => {
  const validationCode = String(req.params.validationCode || '').trim();
  const version = validationCode
    ? await prisma.reportVersion.findUnique({
      where: { validationCode },
      include: {
        report: {
          include: {
            project: true
          }
        },
        signatures: {
          orderBy: { createdAt: 'asc' }
        }
      }
    })
    : null;

  res.json(publicValidationPayload(version));
}));

router.get('/:id', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  let item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(item)) return res.status(404).json({ error: 'Relatório não encontrado.' });

  const clientVisibilityById = req.auth.user.role === 'CLIENT'
    ? await clientVisibilityMapForReports([item])
    : null;
  if (!(await canAccessReport(req.auth, item, { clientVisibilityById }))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }

  grantReportUploadAccess(req.auth, item);
  res.json(item);
}));

router.get('/:id/pdf', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  let item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(item)) return res.status(404).json({ error: 'Relatório não encontrado.' });

  const clientVisibilityById = req.auth.user.role === 'CLIENT'
    ? await clientVisibilityMapForReports([item])
    : null;
  if (!(await canAccessReport(req.auth, item, { clientVisibilityById }))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }

  if (item.status !== ReportStatus.SIGNED) {
    item = await refreshDerivedReportSource(item);
  }

  const file = await runWithPdfAbortSignal(abortController.signal, () => getReportPdfDownload(item));
  sendDownloadBuffer(res, {
    contentType: 'application/pdf',
    fileName: file.fileName,
    buffer: file.buffer
  });
}));

router.get('/:id/docx', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  let item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(item)) return res.status(404).json({ error: 'Relatório não encontrado.' });

  if (!(await canAccessReport(req.auth, item))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }

  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode baixar o DOCX.' });
  }

  item = await refreshDerivedReportSource(item);
  const saved = await generateReportDocxAsset(item);
  sendDownloadBuffer(res, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileName: saved.fileName,
    buffer: await fs.readFile(saved.targetPath)
  });
}));

router.delete('/:id/services/:serviceId', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  if (req.auth.user.role === 'CLIENT' || req.auth.user.role === 'COORDINATOR') {
    return res.status(403).json({ error: `A conta ${req.auth.user.role} não pode editar relatórios.` });
  }

  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(existing)) return res.status(404).json({ error: 'Relatório não encontrado.' });
  assertReportMutable(existing);

  if (!(await canAccessReport(req.auth, existing))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }
  if (req.auth.user.role === 'COLLABORATOR' && !collaboratorCanMutateReport(req.auth, existing)) {
    return res.status(403).json({ error: 'Você pode visualizar este relatório, mas não pode editá-lo.' });
  }

  const service = await prisma.reportService.findFirst({
    where: { id: req.params.serviceId, reportId: req.params.id },
    select: { id: true }
  });
  if (!service) {
    return res.status(404).json({ error: 'Serviço não encontrado.' });
  }

  const item = await prisma.$transaction(async tx => {
    await tx.reportService.delete({ where: { id: req.params.serviceId } });
    return tx.report.findUniqueOrThrow({
      where: { id: req.params.id },
      include
    });
  });

  await organizeAndSyncReportUploadAttachments(item);
  statisticsProjectsCache.clear();
  res.json(item);
}));

router.post('/service-only', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode criar relatórios somente de serviço.' });
  }

  const data = serviceOnlySchema.parse(req.body);
  assertCompleteTubeRows(data.services);
  const unsupportedTypes = Array.from(new Set(data.services
    .filter(service => !independentReportTypesForService(service).length)
    .map(service => service.serviceType)));
  if (unsupportedTypes.length) {
    return res.status(400).json({
      error: `Tipo de serviço sem relatório independente disponível: ${unsupportedTypes.join(', ')}.`
    });
  }

  const createdReports = await prisma.$transaction(async tx => {
    const project = await tx.project.findFirstOrThrow({
      where: { id: data.projectId, ...activeReportProjectWhere() },
      include: { operator: true, authorizedUsers: true }
    });
    assertProjectAllowsInhibition(project, data.services);

    return createIndependentServiceReports(tx, project, {
      ...data,
      createdByUserId: req.auth.user.id
    }, req.auth.user.id);
  });

  for (const report of createdReports) {
    await organizeAndSyncReportUploadAttachments(report, { auth: req.auth });
  }

  statisticsProjectsCache.clear();
  res.status(201).json(createdReports);
}));

router.post('/', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  if (req.auth.user.role === 'CLIENT') {
    return res.status(403).json({ error: `A conta ${req.auth.user.role} não pode criar relatórios.` });
  }
  const data = schema.parse(req.body);
  assertCompleteTubeRows(data.services);
  const reportStatus = req.auth.user.role === 'MANAGER' ? data.status : ReportStatus.PENDING;
  const collaboratorIds = uniqueIds(data.collaboratorIds);
  const pendingDerivedTypes = collectPendingDerivedTypes(data.services);
  const tPost0 = Date.now();
  const item = await prisma.$transaction(async tx => {
    const project = await tx.project.findFirstOrThrow({
      where: { id: data.projectId, ...activeReportProjectWhere() },
      include: { operator: true, authorizedUsers: true }
    });
    assertProjectAllowsInhibition(project, data.services);
    if (project.managerOnly && req.auth.user.role !== 'MANAGER') {
      const error = new Error('Este projeto é visível somente para o gestor.');
      error.statusCode = 403;
      throw error;
    }
    if (req.auth.user.role === 'COLLABORATOR' && !collaboratorCanAccessProject(req.auth, project)) {
      const error = new Error('Este projeto não está vinculado ao colaborador logado.');
      error.statusCode = 403;
      throw error;
    }
    await assertUniqueReportDate(tx, {
      projectId: data.projectId,
      reportType: data.reportType,
      reportDate: data.reportDate
    });
    await assertApprovedReportSignatureEmailPreflight({
      reportType: data.reportType,
      status: reportStatus,
      project
    }, tx);
    const sequenceNumber = await reserveSequence(tx, data.projectId, data.reportType);
    const overtime = calculateReportOvertime(project, data);
    const leaderSnapshot = project.operator ? {
      name: project.operator.name || null,
      role: project.operator.role || null,
      signatureImage: project.operator.signatureImage || null
    } : null;
    const specialConditions = await enrichNightCollaboratorsInSpecialConditions(
      tx,
      normalizeStoredReportUploadUrls(data.specialConditions || {})
    );

    const created = await tx.report.create({
      data: {
        projectId: data.projectId,
        createdByUserId: req.auth.user.role === 'MANAGER' ? data.createdByUserId : req.auth.user.id,
        reportType: data.reportType,
        sequenceNumber,
        status: reportStatus,
        reportDate: new Date(data.reportDate),
        arrivalTime: data.arrivalTime,
        departureTime: data.departureTime,
        lunchBreak: data.lunchBreak,
        daytimeCount: data.daytimeCount,
        daytimeWorkedMinutes: overtime.daytimeWorkedMinutes,
        nighttimeWorkedMinutes: overtime.nighttimeWorkedMinutes,
        daytimeOvertimeMinutes: overtime.daytimeOvertimeMinutes,
        nighttimeOvertimeMinutes: overtime.nighttimeOvertimeMinutes,
        totalOvertimeMinutes: overtime.totalOvertimeMinutes,
        overtimeReason: data.overtimeReason || null,
        dailyDescription: data.dailyDescription || null,
        reviewedByUserId: reportStatus === ReportStatus.APPROVED ? req.auth.user.id : null,
        approvedAt: reportStatus === ReportStatus.APPROVED ? new Date() : null,
        specialConditions: withLeaderSnapshot({
          ...specialConditions,
          overtimeSummary: overtime,
        }, leaderSnapshot),
        pendingDerivedTypes,
        collaborators: {
          create: collaboratorIds.map(collaboratorId => ({ collaboratorId }))
        },
        services: {
          create: data.services.map(service => ({
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: typeof service.finalized === 'boolean' ? service.finalized : null,
            extraData: normalizeStoredReportUploadUrls(service.extraData || {})
          }))
        }
      },
      include
    });

    await syncApprovedRtpReports(tx, created);
    await syncApprovedRlqReports(tx, created);
    await syncApprovedRcpReports(tx, created);
    await syncApprovedRlmReports(tx, created);
    await syncApprovedRlfReports(tx, created);
    await syncApprovedRliReports(tx, created);
    return created;
  });
  const tPostTx = Date.now();
  const organizedItem = await organizeAndSyncReportUploadAttachments(item, { auth: req.auth }) || item;
  const tPostOrg = Date.now();
  if (organizedItem.reportType === 'RDO' && organizedItem.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: derivedReportsForProjectWhere(organizedItem.projectId),
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === organizedItem.id) {
        await organizeAndSyncReportUploadAttachments(d, { auth: req.auth });
      }
    }
  }
  logSlowOperation('reports.create', Date.now() - tPost0, { txMs: tPostTx - tPost0, organizeMs: tPostOrg - tPostTx, reportType: organizedItem.reportType, status: organizedItem.status });
  let signaturePreparation = null;
  if (organizedItem.status === ReportStatus.APPROVED) {
    signaturePreparation = await ensureInternalSignatureRoundAndNotify(organizedItem, req.auth.user.id, signatureEvidenceFromRequest(req));
    queueApprovedReportNotification(organizedItem);
  }
  statisticsProjectsCache.clear();
  res.status(201).json(reportWithSignatureEmailDelivery(organizedItem, signaturePreparation));
}));

router.put('/:id', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  if (req.auth.user.role === 'CLIENT') {
    return res.status(403).json({ error: `A conta ${req.auth.user.role} não pode editar relatórios.` });
  }
  const data = updateSchema.parse(req.body);
  assertCompleteTubeRows(data.services);
  const collaboratorIds = uniqueIds(data.collaboratorIds);
  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(existing)) return res.status(404).json({ error: 'Relatório não encontrado.' });
  const isServiceOnlyReport = existing.specialConditions?.serviceOnly === true;
  if (isServiceOnlyReport && req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode editar relatórios somente de serviço.' });
  }
  if (isServiceOnlyReport) {
    const firstService = data.services[0];
    if (!firstService || !independentReportTypesForService(firstService).includes(data.reportType)) {
      return res.status(400).json({ error: 'Tipo de serviço incompatível com este relatório independente.' });
    }
  }
  if (req.auth.user.role === 'COORDINATOR' && existing.createdByUserId !== req.auth.user.id) {
    return res.status(403).json({ error: 'O coordenador só pode editar relatórios criados por ele.' });
  }
  assertReportMutable(existing);
  if (!(await canAccessReport(req.auth, existing))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }
  if (req.auth.user.role === 'COLLABORATOR' && !collaboratorCanMutateReport(req.auth, existing)) {
    return res.status(403).json({ error: 'Você pode visualizar este relatório, mas não pode editá-lo.' });
  }
  if (req.auth.user.role !== 'MANAGER') {
    const targetProject = await prisma.project.findFirstOrThrow({
      where: { id: data.projectId, ...activeReportProjectWhere() },
      select: {
        isActive: true,
        deletedAt: true,
        visibleToCollaborators: true,
        managerOnly: true,
        operatorId: true,
        authorizedUsers: true
      }
    });
    if (targetProject.managerOnly) {
      return res.status(403).json({ error: 'Este projeto é visível somente para o gestor.' });
    }
    if (req.auth.user.role === 'COLLABORATOR' && !collaboratorCanAccessProject(req.auth, targetProject)) {
      return res.status(403).json({ error: 'Este projeto não está vinculado ao colaborador logado.' });
    }
  }
  const hasApprovedVersion = !!(existing.approvedAt || existing.status === ReportStatus.APPROVED || existing.specialConditions?.__editOriginalSnapshot);
  const isManagerFixingClientRejection = req.auth.user.role === 'MANAGER' && hasActiveClientRejection(existing);
  const evidence = signatureEvidenceFromRequest(req);
  const unfinalizedDerivedRefs = data.deleteUnfinalizedDerivedReports === true
    ? demotedFinalizedServiceRefs(existing.services || [], data.services || [])
    : [];
  const trustedStoragePaths = trustedStoragePathsFromSnapshot(buildReportSnapshot(existing));

  const tPut0 = Date.now();
  const item = await prisma.$transaction(async tx => {
    const project = await tx.project.findFirstOrThrow({
      where: { id: data.projectId, ...activeReportProjectWhere() },
      include: { operator: true, authorizedUsers: true }
    });
    assertProjectAllowsInhibition(project, data.services);
    await assertUniqueReportDate(tx, {
      projectId: data.projectId,
      reportType: data.reportType,
      reportDate: data.reportDate,
      excludeReportId: existing.id
    });
    const overtime = calculateReportOvertime(project, data);
    const leaderSnapshot = projectLeaderSnapshot(project);
    const serviceOnlySpecialConditions = isServiceOnlyReport
      ? await buildIndependentSpecialConditions(
          tx,
          data.reportType,
          sourceReportForIndependentService(project, {
            ...data,
            createdByUserId: existing.createdByUserId || req.auth.user.id
          }, collaboratorIds, existing.reviewedByUserId || req.auth.user.id),
          {
            ...data.services[0],
            id: String(data.specialConditions?.serviceLinkKey || data.specialConditions?.serviceId || existing.services?.[0]?.id || ''),
            finalized: true,
            extraData: normalizeStoredReportUploadUrls(data.services[0]?.extraData || {})
          }
        )
      : null;
    const managerProvidedSequence = req.auth.user.role === 'MANAGER' && data.sequenceNumber;
    const targetSequenceNumber = managerProvidedSequence ? data.sequenceNumber : existing.sequenceNumber;
    const sequenceGroupChanged = existing.projectId !== data.projectId || existing.reportType !== data.reportType;
    const specialConditions = await enrichNightCollaboratorsInSpecialConditions(
      tx,
      normalizeStoredReportUploadUrls(data.specialConditions || {})
    );
    const internalEditState = req.auth.user.role === 'MANAGER'
      ? extractInternalEditState(existing.specialConditions)
      : (hasApprovedVersion
          ? {
              __editOriginalSnapshot: cloneJson(existing.specialConditions?.__editOriginalSnapshot) || buildReportSnapshot(existing),
              __editMeta: {
                editedByUserId: req.auth.user.id,
                editedAt: new Date().toISOString(),
                previousStatus: existing.status
              }
            }
          : {});
    const overtimeRejected = specialConditions?.overtimeAccepted === false;
    const storedSpecialConditionsBase = {
      ...(req.auth.user.role === 'MANAGER'
        ? withClientRejectionCleared(stripInternalEditState(specialConditions))
        : stripInternalEditState(specialConditions)),
      ...(serviceOnlySpecialConditions || {}),
      overtimeSummary: overtime,
      ...internalEditState
    };
    const storedSpecialConditions = overtimeRejected
      ? markOvertimeRejected(storedSpecialConditionsBase)
      : (() => {
          const next = cloneJson(plainObject(storedSpecialConditionsBase));
          delete next.overtimeAccepted;
          return next;
        })();
    await tx.reportCollaborator.deleteMany({ where: { reportId: req.params.id } });
    await tx.reportService.deleteMany({ where: { reportId: req.params.id } });
    const sequenceSwap = (managerProvidedSequence || sequenceGroupChanged) && Number.isInteger(targetSequenceNumber)
      ? await prepareReportSequenceChange(tx, existing, data.projectId, data.reportType, targetSequenceNumber)
      : null;
    await invalidateUnsignedInternalSignatureRound(tx, {
      reportId: existing.id,
      userId: req.auth.user.id,
      evidence,
      description: 'Rodada de assinatura invalidada por edicao do relatorio antes da primeira assinatura.'
    });
    const nextStatus = req.auth.user.role === 'MANAGER'
      ? (isManagerFixingClientRejection ? ReportStatus.APPROVED : existing.status)
      : ReportStatus.PENDING;
    await assertApprovedReportSignatureEmailPreflight({
      ...existing,
      project,
      reportType: data.reportType,
      status: nextStatus
    }, tx);

    const updated = await tx.report.update({
      where: { id: req.params.id },
      data: {
        projectId: data.projectId,
        reportType: data.reportType,
        ...(managerProvidedSequence ? { sequenceNumber: data.sequenceNumber } : {}),
        reportDate: new Date(data.reportDate),
        arrivalTime: data.arrivalTime,
        departureTime: data.departureTime,
        lunchBreak: data.lunchBreak,
        daytimeCount: data.daytimeCount,
        daytimeWorkedMinutes: overtime.daytimeWorkedMinutes,
        nighttimeWorkedMinutes: overtime.nighttimeWorkedMinutes,
        daytimeOvertimeMinutes: overtime.daytimeOvertimeMinutes,
        nighttimeOvertimeMinutes: overtime.nighttimeOvertimeMinutes,
        totalOvertimeMinutes: overtime.totalOvertimeMinutes,
        overtimeReason: data.overtimeReason || null,
        dailyDescription: data.dailyDescription || null,
        specialConditions: withLeaderSnapshot(storedSpecialConditions, leaderSnapshot),
        pendingDerivedTypes: isServiceOnlyReport ? [] : collectPendingDerivedTypes(data.services),
        status: nextStatus,
        reviewNotes: req.auth.user.role === 'MANAGER'
          ? existing.reviewNotes
          : (hasApprovedVersion ? COLLABORATOR_EDIT_NOTE : null),
        reviewedByUserId: req.auth.user.role === 'MANAGER'
          ? (isManagerFixingClientRejection ? req.auth.user.id : existing.reviewedByUserId)
          : null,
        returnedAt: req.auth.user.role === 'MANAGER' ? existing.returnedAt : null,
        approvedAt: req.auth.user.role === 'MANAGER'
          ? (isManagerFixingClientRejection ? new Date() : existing.approvedAt)
          : null,
        collaborators: {
          create: collaboratorIds.map(collaboratorId => ({ collaboratorId }))
        },
        services: {
          create: data.services.map(service => ({
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: isServiceOnlyReport ? true : (typeof service.finalized === 'boolean' ? service.finalized : null),
            extraData: normalizeStoredReportUploadUrls(service.extraData || {})
          }))
        }
      },
      include
    });

    if ((managerProvidedSequence || sequenceGroupChanged) && Number.isInteger(targetSequenceNumber)) {
      await finishReportSequenceChange(tx, sequenceSwap);
      await syncProjectReportSequence(tx, data.projectId, data.reportType, targetSequenceNumber);
    }

    await syncApprovedRtpReports(tx, updated);
    await syncApprovedRlqReports(tx, updated);
    await syncApprovedRcpReports(tx, updated);
    await syncApprovedRlmReports(tx, updated);
    await syncApprovedRlfReports(tx, updated);
    await syncApprovedRliReports(tx, updated);
    if (unfinalizedDerivedRefs.length) {
      await deleteUnfinalizedDerivedReports(tx, existing, unfinalizedDerivedRefs);
    }
    return updated;
  });
  const tPutTx = Date.now();

  const organizedItem = await organizeAndSyncReportUploadAttachments(item, {
    auth: req.auth,
    trustedStoragePaths
  }) || item;
  const tPutOrg = Date.now();
  if (organizedItem.reportType === 'RDO' && organizedItem.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: derivedReportsForProjectWhere(organizedItem.projectId),
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === organizedItem.id) {
        await organizeAndSyncReportUploadAttachments(d, { auth: req.auth });
      }
    }
  }
  logSlowOperation('reports.update', Date.now() - tPut0, { txMs: tPutTx - tPut0, organizeMs: tPutOrg - tPutTx, reportType: organizedItem.reportType, status: organizedItem.status });
  let signaturePreparation = null;
  if (organizedItem.status === ReportStatus.APPROVED) {
    signaturePreparation = await ensureInternalSignatureRoundAndNotify(organizedItem, req.auth.user.id, evidence);
    if (isManagerFixingClientRejection) queueReapprovedReportNotification(organizedItem);
  }
  statisticsProjectsCache.clear();
  res.json(reportWithSignatureEmailDelivery(organizedItem, signaturePreparation));
}));

router.patch('/:id/sequence', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode alterar a numeração dos relatórios.' });
  }

  const data = sequenceSchema.parse(req.body);
  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(existing)) return res.status(404).json({ error: 'Relatório não encontrado.' });
  assertReportMutable(existing);

  const item = await prisma.$transaction(async tx => {
    const sequenceSwap = await prepareReportSequenceChange(tx, existing, existing.projectId, existing.reportType, data.sequenceNumber);
    const updated = await tx.report.update({
      where: { id: req.params.id },
      data: {
        sequenceNumber: data.sequenceNumber
      },
      include
    });
    await finishReportSequenceChange(tx, sequenceSwap);
    await syncProjectReportSequence(tx, updated.projectId, updated.reportType, data.sequenceNumber);
    return updated;
  });

  await organizeAndSyncReportUploadAttachments(item);
  res.json(item);
}));

router.post('/:id/cancel-edit', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  if (req.auth.user.role === 'CLIENT' || req.auth.user.role === 'COORDINATOR') {
    return res.status(403).json({ error: `A conta ${req.auth.user.role} não pode desfazer edições de relatórios.` });
  }
  if (req.auth.user.role === 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o colaborador pode desfazer a própria edição pendente.' });
  }

  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(existing)) return res.status(404).json({ error: 'Relatório não encontrado.' });
  assertReportMutable(existing);

  if (!(await canAccessReport(req.auth, existing))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }
  if (!collaboratorCanMutateReport(req.auth, existing)) {
    return res.status(403).json({ error: 'Você pode visualizar este relatório, mas não pode desfazer esta edição.' });
  }

  const originalSnapshot = cloneJson(existing.specialConditions?.__editOriginalSnapshot);
  if (!originalSnapshot) {
    return res.status(400).json({ error: 'Este relatório não possui uma edição pendente para desfazer.' });
  }

  const item = await prisma.$transaction(async tx => restoreReportFromSnapshot(tx, req.params.id, originalSnapshot));

  const trustedStoragePaths = trustedStoragePathsFromSnapshot(originalSnapshot);
  await organizeAndSyncReportUploadAttachments(item, { trustedStoragePaths });
  if (item.reportType === 'RDO' && item.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: derivedReportsForProjectWhere(item.projectId),
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === item.id) await organizeAndSyncReportUploadAttachments(d);
    }
  }

  res.json(item);
}));

router.post('/:id/discard-edit', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode descartar uma edição pendente.' });
  }

  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(existing)) return res.status(404).json({ error: 'Relatório não encontrado.' });
  assertReportMutable(existing);

  const originalSnapshot = cloneJson(existing.specialConditions?.__editOriginalSnapshot);
  if (!originalSnapshot) {
    return res.status(400).json({ error: 'Este relatório não possui uma edição pendente para descartar.' });
  }

  const item = await prisma.$transaction(async tx => restoreReportFromSnapshot(tx, req.params.id, originalSnapshot));

  const trustedStoragePaths = trustedStoragePathsFromSnapshot(originalSnapshot);
  await organizeAndSyncReportUploadAttachments(item, { trustedStoragePaths });
  if (item.reportType === 'RDO' && item.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: derivedReportsForProjectWhere(item.projectId),
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === item.id) await organizeAndSyncReportUploadAttachments(d);
    }
  }

  res.json(item);
}));

router.delete('/:id', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode excluir relatórios.' });
  }

  const item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(item)) return res.status(404).json({ error: 'Relatório não encontrado.' });
  assertReportMutable(item);

  const originalSnapshot = cloneJson(item.specialConditions?.__editOriginalSnapshot);
  if (originalSnapshot && item.status !== ReportStatus.APPROVED) {
    return res.status(409).json({
      error: 'Não é permitido excluir o relatório a partir de uma edição pendente. Use a opção de descartar edição.'
    });
  }

  await prisma.$transaction(async tx => {
    const idsToDelete = [item.id];
    const affectedTypes = new Set([item.reportType]);

    if (item.reportType === ReportType.RDO) {
      const derivedReports = await tx.report.findMany({
        where: derivedReportsForProjectWhere(item.projectId),
        select: {
          id: true,
          reportType: true,
          specialConditions: true
        }
      });

      derivedReports.forEach(report => {
        const special = report.specialConditions || {};
        if (special.parentRdoId === item.id) {
          idsToDelete.push(report.id);
          affectedTypes.add(report.reportType);
        }
      });
    }

    await tx.report.updateMany({
      where: {
        id: { in: Array.from(new Set(idsToDelete)) }
      },
      data: {
        deletedAt: new Date(),
        sequenceNumber: null
      }
    });

    for (const reportType of affectedTypes) {
      await renumberProjectReports(tx, item.projectId, reportType);
    }
  });

  statisticsProjectsCache.clear();
  res.status(204).end();
}));

router.patch('/:id/status', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode revisar relatórios.' });
  }

  const data = statusSchema.parse(req.body);
  let approvedTransition = false;
  const previous = await prisma.report.findUnique({
    where: { id: req.params.id },
    include
  });
  if (!previous || isReportUnavailable(previous)) return res.status(404).json({ error: 'Relatório não encontrado.' });
  if (previous?.status === ReportStatus.SIGNED) {
    return res.status(409).json({ error: 'Relatório assinado não pode mais ser alterado.' });
  }
  const wasClientRejection = hasActiveClientRejection(previous);
  const evidence = signatureEvidenceFromRequest(req);

  const tPatch0 = Date.now();
  const item = await prisma.$transaction(async tx => {
    let nextSpecialConditions = data.status === ReportStatus.APPROVED
      ? await enrichNightCollaboratorsInSpecialConditions(
          tx,
          withClientRejectionCleared(stripInternalEditState(previous?.specialConditions || {}))
        )
      : withoutLegacyExternalSignatureState(previous?.specialConditions || {});
    const rejectOvertime = data.status === ReportStatus.APPROVED && data.acceptOvertime === false;
    if (rejectOvertime) {
      nextSpecialConditions = markOvertimeRejected(nextSpecialConditions);
    } else if (data.status === ReportStatus.APPROVED) {
      nextSpecialConditions = cloneJson(plainObject(nextSpecialConditions));
      delete nextSpecialConditions.overtimeAccepted;
    }
    await assertApprovedReportSignatureEmailPreflight({
      ...previous,
      status: data.status,
      specialConditions: nextSpecialConditions
    }, tx);

    const updated = await tx.report.update({
      where: { id: req.params.id },
      data: {
        status: data.status,
        reviewNotes: data.reviewNotes || null,
        reviewedByUserId: req.auth.user.id,
        approvedAt: data.status === ReportStatus.APPROVED ? new Date() : null,
        returnedAt: data.status === ReportStatus.RETURNED ? new Date() : null,
        ...(data.status === ReportStatus.APPROVED ? {} : {
          zapsignDocToken: null,
          zapsignSignerToken: null,
          zapsignRequestedAt: null,
          zapsignSignedAt: null,
          zapsignDocUrl: null
        }),
        ...(nextSpecialConditions !== undefined ? { specialConditions: nextSpecialConditions } : {})
      },
      include
    });

    if (data.status !== ReportStatus.APPROVED) {
      await invalidateUnsignedInternalSignatureRound(tx, {
        reportId: req.params.id,
        userId: req.auth.user.id,
        evidence,
        description: 'Rodada de assinatura invalidada por alteracao de status do relatorio.',
        invalidateSignedRound: true
      });
    }

    if (data.status === ReportStatus.APPROVED && previous?.status !== ReportStatus.APPROVED) {
      approvedTransition = true;
      await syncApprovedRtpReports(tx, updated);
      await syncApprovedRlqReports(tx, updated);
      await syncApprovedRcpReports(tx, updated);
      await syncApprovedRlmReports(tx, updated);
      await syncApprovedRlfReports(tx, updated);
      await syncApprovedRliReports(tx, updated);
    }

    return updated;
  });
  const tPatchTx = Date.now();

  let signaturePreparation = null;
  if (data.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: derivedReportsForProjectWhere(item.projectId),
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === item.id) await organizeAndSyncReportUploadAttachments(d);
    }
    if (approvedTransition) {
      signaturePreparation = await ensureInternalSignatureRoundAndNotify(item, req.auth.user.id, evidence);
      if (wasClientRejection) {
        queueReapprovedReportNotification(item);
      } else {
        queueApprovedReportNotification(item);
      }
    } else {
      signaturePreparation = await ensureInternalSignatureRoundAndNotify(item, req.auth.user.id, evidence);
    }
  }
  logSlowOperation('reports.status.update', Date.now() - tPatch0, { txMs: tPatchTx - tPatch0, newStatus: data.status });
  statisticsProjectsCache.clear();
  res.json(reportWithSignatureEmailDelivery(item, signaturePreparation));
}));

router.post('/:id/request-signature', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'CLIENT') {
    return res.status(403).json({ error: 'Apenas o cliente pode solicitar a assinatura digital.' });
  }

  const data = requestSignatureSchema.parse(req.body || {});
  await assertRenderableReportSignatureImageDataUrl(data.signatureImageDataUrl);

  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(existing)) return res.status(404).json({ error: 'Relatório não encontrado.' });

  if (!(await canAccessReport(req.auth, existing))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }
  if (existing.reportType !== ReportType.RDO) {
    return res.status(400).json({ error: 'Apenas RDO pode iniciar assinatura digital.' });
  }
  if (existing.status === ReportStatus.SIGNED) {
    return res.status(409).json({ error: 'Relatório já está assinado.' });
  }
  if (hasActiveClientRejection(existing)) {
    return res.status(409).json({ error: 'Relatório reprovado pelo cliente. O gestor precisa alterar o relatório antes de uma nova assinatura.' });
  }
  if (existing.status !== ReportStatus.APPROVED) {
    return res.status(409).json({ error: 'Somente relatórios aprovados pelo gestor podem ser assinados.' });
  }
  const comment = String(data.comment || '').trim();
  const resolvedSigner = resolveInternalClientSigner(existing, req.auth.user);
  const alreadySignedSignature = (existing.reportSignatures || []).find(signature =>
    signerEmailValue(signature.signerEmail) === resolvedSigner.email
    && signature.status === ReportSignatureStatus.SIGNED
  );
  const signer = {
    ...resolvedSigner,
    name: data.signerName
  };
  const evidence = signatureEvidenceFromRequest(req);

  const prepared = existing;

  const activeVersion = await prisma.reportVersion.findFirst({
    where: { reportId: prepared.id, status: 'ACTIVE' },
    include: { signatures: true },
    orderBy: { versionNumber: 'desc' }
  });
  const retryFinalization = authenticatedSignatureFinalizationRetryable(existing, activeVersion, alreadySignedSignature);
  if (alreadySignedSignature && !retryFinalization) {
    return res.status(409).json({ error: 'Este assinante já assinou o relatório.' });
  }

  let sourcePdfUrl = activeVersion?.sourcePdfUrl || '';
  let sourceDocumentHash = activeVersion?.sourceDocumentHash || '';
  let generatedSourcePath = '';
  const expectedReportUpdatedAt = reportUpdatedAtToken(prepared);
  if (!activeVersion) {
    const saved = await generateReportPdfAsset(prepared);
    generatedSourcePath = saved.targetPath;
    const pdfBuffer = await fs.readFile(saved.targetPath);
    sourcePdfUrl = saved.publicUrl;
    sourceDocumentHash = sha256Hex(pdfBuffer);
  }

  let signedVersion;
  let signatureResult = { alreadySigned: false };
  let issuedTokens = [];
  let item;
  if (retryFinalization) {
    await assertSignatureFinalizationPreflight(activeVersion);
    signedVersion = activeVersion;
    signatureResult = { alreadySigned: true, signedSignature: alreadySignedSignature };
    item = existing;
  } else {
    try {
      item = await prisma.$transaction(async tx => {
        const current = await tx.report.findUniqueOrThrow({
          where: { id: prepared.id },
          include
        });
        if (current.status !== ReportStatus.APPROVED) {
          const error = new Error('A solicitação de assinatura foi atualizada por outra operação.');
          error.statusCode = 409;
          throw error;
        }
        assertSignatureSourceCurrent(current, expectedReportUpdatedAt);
        const version = await ensureInternalSignatureRound(tx, {
          report: current,
          sourcePdfUrl,
          sourceDocumentHash,
          createdByUserId: req.auth.user.id,
          evidence
        });
        const signingSignature = signatureForSigner(version, signer.email);
        if (signingSignature?.status === ReportSignatureStatus.SIGNED) {
          const error = new Error('Este assinante já assinou o relatório.');
          error.statusCode = 409;
          throw error;
        }
        const completesRequiredSignatures = signatureWouldCompleteRequired(version, signingSignature?.id);
        await assertSignatureFinalizationPreflight(version);
        signatureResult = await signInternalReportVersion(tx, {
          report: current,
          version,
          signer,
          userId: req.auth.user.id,
          evidence,
          signatureImageDataUrl: data.signatureImageDataUrl,
          privacyNoticeVersion: data.privacyNoticeVersion,
          deferAuditLog: completesRequiredSignatures
        });
        signedVersion = await activeVersionWithSignatures(tx, current.id);
        assertSignatureRequestEmailDeliveryConfigured(current, signedVersion);
        issuedTokens = await issuePendingSignatureTokens(tx, signedVersion);
        return tx.report.findUniqueOrThrow({
          where: { id: current.id },
          include
        });
      });
      if (generatedSourcePath && signedVersion?.sourcePdfUrl !== sourcePdfUrl) {
        await fs.unlink(generatedSourcePath).catch(() => {});
      }
    } catch (error) {
      if (generatedSourcePath) await fs.unlink(generatedSourcePath).catch(() => {});
      throw error;
    }
  }

  signedVersion = await completedSignatureVersionAfterCommit(prisma, item.id) || signedVersion;

  let completed = false;
  if (signedVersion && allRequiredSignaturesCompleted(signedVersion)) {
    try {
      item = await finalizeInternalSignatureRound(item, signedVersion, evidence, req.auth.user.id, {
        signedAudit: signatureResult.signedSignature
      });
      completed = true;
    } catch (error) {
      await resetSignedSignatureForFinalizationRetry(prisma, signatureResult).catch(resetError => {
        console.error('Falha ao tornar assinatura retryable após erro de finalização.', resetError);
      });
      throw error;
    }
  }

  if (completed) {
    await persistClientSignatureApprovalReview(prisma, {
      reportId: item.id,
      clientUserId: req.auth.user.id,
      comment,
      evidence
    });
    item = await prisma.report.findUniqueOrThrow({
      where: { id: item.id },
      include
    });
  }

  if (completed || !signatureResult.alreadySigned) {
    const finalVersion = completed && item.versions?.[0]
      ? { ...signedVersion, finalDocumentHash: item.versions[0].finalDocumentHash }
      : signedVersion;
    queueInternalSignatureNotification(item, finalVersion, signer, completed);
  }
  const signatureEmailDelivery = issuedTokens.length
    ? await deliverIssuedSignatureRequestEmails(item, issuedTokens)
    : null;
  if (item.status === ReportStatus.SIGNED) {
    await reconcileProjectClientSignatureRequirements(item.projectId, {
      userId: req.auth.user.id,
      evidence,
      sendReleasedEmails: false
    });
  }
  const releasedServiceReports = item.status === ReportStatus.SIGNED
    ? await releasedServiceReportsAfterRdoSignature(item)
    : [];
  if (releasedServiceReports.length) {
    queueReleasedServiceReportsEmailAfterRdoSignature(item, releasedServiceReports);
  }

  res.json({
    ok: true,
    signed: true,
    completed: item.status === ReportStatus.SIGNED,
    report: withInternalSignatureProgress(item),
    ...(releasedServiceReports.length ? { releasedServiceReports } : {}),
    ...(signatureEmailDelivery && !signatureEmailDelivery.ok ? { signatureEmailDelivery } : {})
  });
}));

router.get('/:id/signatures', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  const item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(item)) return res.status(404).json({ error: 'Relatório não encontrado.' });
  if (!(await canAccessReport(req.auth, item))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }
  res.json(item.reportSignatures || []);
}));

router.get('/:id/audit', requireAuth, requireRdoManager, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode consultar a auditoria do relatório.' });
  }

  const auditReport = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    select: { id: true, deletedAt: true, project: { select: { deletedAt: true } } }
  });
  if (isReportUnavailable(auditReport)) return res.status(404).json({ error: 'Relatório não encontrado.' });

  const logs = await prisma.reportAuditLog.findMany({
    where: { reportId: req.params.id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      },
      version: {
        select: {
          id: true,
          versionNumber: true,
          status: true,
          sourceDocumentHash: true,
          finalDocumentHash: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json(logs);
}));

router.post('/:id/client-review', requireAuth, requireRdoAccess, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'CLIENT') {
    return res.status(403).json({ error: 'Apenas o cliente pode registrar esta ação.' });
  }

  const data = clientReviewSchema.parse(req.body);
  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  if (isReportUnavailable(existing)) return res.status(404).json({ error: 'Relatório não encontrado.' });

  if (!(await canAccessReport(req.auth, existing))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }
  if (existing.reportType !== ReportType.RDO) {
    return res.status(400).json({ error: 'Apenas RDO pode receber assinatura do cliente.' });
  }
  if (existing.status === ReportStatus.SIGNED) {
    return res.status(409).json({ error: 'Relatório já está assinado.' });
  }
  if (hasActiveClientRejection(existing)) {
    return res.status(409).json({ error: 'Este relatório já foi reprovado. Aguarde a alteração do gestor para avaliar novamente.' });
  }
  if (existing.status !== ReportStatus.APPROVED) {
    return res.status(409).json({ error: 'Somente relatórios aprovados pelo gestor podem ser avaliados pelo cliente.' });
  }
  if (data.action === 'APPROVED') {
    return res.status(409).json({ error: 'Use o fluxo de assinatura para concluir a aprovação do relatório.' });
  }

  const clientRejectionReviewer = clientReviewerLabel(existing, req.auth.user);
  const evidence = signatureEvidenceFromRequest(req);
  const item = await prisma.$transaction(async tx => {
    await tx.clientReportReview.create({
      data: {
        reportId: existing.id,
        clientUserId: req.auth.user.id,
        action: data.action === 'APPROVED' ? ClientReviewAction.APPROVED : ClientReviewAction.REJECTED,
        comment: data.comment || null,
        ipAddress: evidence.ipAddress,
        userAgent: evidence.userAgent
      }
    });

    return rejectAuthenticatedClientSignatureRound(tx, {
      report: existing,
      authUser: req.auth.user,
      comment: data.comment || null,
      evidence
    });
  });

  if (data.action === 'REJECTED') {
    queueClientRejectionNotification({ ...item, clientRejectionReviewer }, data.comment || '');
  }

  res.json(item);
}));

export default router;
