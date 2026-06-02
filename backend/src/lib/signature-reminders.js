import { ReportSignatureStatus, ReportStatus, ReportType, ReportVersionStatus } from '@prisma/client';

import env from '../config/env.js';
import { addNotificationPreferencesLink, buildReportSignatureReminderEmailTemplate } from './email-templates.js';
import { getMissingMailerConfig, sendMail } from './mailer.js';
import { NotificationEmailCategory, notificationRecipientsForEmails } from './notification-preferences.js';
import prisma from './prisma.js';
import {
  createSignatureToken,
  decryptSignatureToken,
  encryptSignatureToken,
  signatureTokenHash
} from './signature-token.js';

const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
const REMINDER_GAP_MS = 3 * 24 * 60 * 60 * 1000;
const CLAIM_STALE_MS = 2 * 60 * 60 * 1000;
const SIGNATURE_TOKEN_DAYS = 30;

function appBaseUrl() {
  return String(env.appUrl || '').replace(/\/+$/, '');
}

export function publicSignatureUrl(token) {
  const base = appBaseUrl();
  const path = `/assinar/${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

function formatDatePtBr(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
}

function reportNumberLabel(report) {
  const number = report?.sequenceNumber;
  return Number.isInteger(number) ? String(number).padStart(3, '0') : report?.id || '---';
}

function tokenExpiresAt(now = new Date()) {
  return new Date(now.getTime() + SIGNATURE_TOKEN_DAYS * 24 * 60 * 60 * 1000);
}

function encryptedTokenPayload(signature) {
  return {
    tokenEncrypted: signature.tokenEncrypted,
    tokenIv: signature.tokenIv,
    tokenAuthTag: signature.tokenAuthTag
  };
}

function hasEncryptedToken(signature) {
  return Boolean(signature?.tokenEncrypted && signature?.tokenIv && signature?.tokenAuthTag);
}

export function signatureReminderDueWhere(now = new Date()) {
  const dueBefore = new Date(now.getTime() - REMINDER_GAP_MS);
  const staleClaimBefore = new Date(now.getTime() - CLAIM_STALE_MS);
  return {
    status: ReportSignatureStatus.PENDING,
    isRequired: true,
    signerEmail: { not: '' },
    report: {
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
    },
    OR: [
      { lastReminderAt: null, createdAt: { lt: dueBefore } },
      { lastReminderAt: { lt: dueBefore } }
    ],
    AND: [
      {
        OR: [
          { reminderClaimedAt: null },
          { reminderClaimedAt: { lt: staleClaimBefore } }
        ]
      }
    ]
  };
}

export async function ensureReminderSignatureToken(signature, client = prisma, now = new Date()) {
  if (hasEncryptedToken(signature)) {
    const token = decryptSignatureToken(encryptedTokenPayload(signature));
    const expiresAt = tokenExpiresAt(now);
    if (!signature.tokenHash || signature.tokenHash !== signatureTokenHash(token) || !signature.tokenExpiresAt || new Date(signature.tokenExpiresAt).getTime() <= now.getTime()) {
      await client.reportSignature.update({
        where: { id: signature.id },
        data: {
          tokenHash: signatureTokenHash(token),
          tokenExpiresAt: expiresAt
        }
      });
      return { token, expiresAt };
    }
    return { token, expiresAt: signature.tokenExpiresAt };
  }

  const token = createSignatureToken();
  const encrypted = encryptSignatureToken(token);
  const expiresAt = tokenExpiresAt(now);
  await client.reportSignature.update({
    where: { id: signature.id },
    data: {
      tokenHash: signatureTokenHash(token),
      tokenEncrypted: encrypted.tokenEncrypted,
      tokenIv: encrypted.tokenIv,
      tokenAuthTag: encrypted.tokenAuthTag,
      tokenExpiresAt: expiresAt
    }
  });
  return { token, expiresAt };
}

export async function sendSignatureReminder({ signature, token, expiresAt, mailer = sendMail, client = prisma }) {
  const [recipient] = await notificationRecipientsForEmails(
    [signature.signerEmail],
    NotificationEmailCategory.SIGNATURE_REMINDERS,
    { client }
  );
  if (!recipient) return false;

  const report = signature.report || {};
  const project = report.project || {};
  const daysValid = Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
  const template = buildReportSignatureReminderEmailTemplate({
    projectCode: project.code || '---',
    projectName: project.name || 'Sem projeto',
    reportType: report.reportType || 'RDO',
    reportNumber: reportNumberLabel(report),
    reportDate: formatDatePtBr(report.reportDate),
    signerName: signature.signerName || 'Cliente',
    signUrl: publicSignatureUrl(token),
    expiresLabel: `${daysValid} dia${daysValid !== 1 ? 's' : ''}`
  });

  await mailer({
    to: recipient.email,
    ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
  });
  return true;
}

export async function processSignatureReminders({ limit = 25, mailer = sendMail, client = prisma, missingMailerConfig = getMissingMailerConfig() } = {}) {
  if (mailer === sendMail && missingMailerConfig.length) return { checked: 0, sent: 0, skipped: true };

  const now = new Date();
  const candidates = await client.reportSignature.findMany({
    where: signatureReminderDueWhere(now),
    take: limit,
    orderBy: { createdAt: 'asc' },
    include: {
      report: { include: { project: true } },
      version: true
    }
  });

  let sent = 0;
  for (const signature of candidates) {
    const claim = await client.reportSignature.updateMany({
      where: {
        id: signature.id,
        ...signatureReminderDueWhere(now)
      },
      data: { reminderClaimedAt: new Date() }
    });
    if (claim.count !== 1) continue;

    try {
      const tokenData = await ensureReminderSignatureToken(signature, client);
      const delivered = await sendSignatureReminder({
        signature,
        token: tokenData.token,
        expiresAt: tokenData.expiresAt,
        mailer,
        client
      });
      await client.reportSignature.update({
        where: { id: signature.id },
        data: {
          lastReminderAt: new Date(),
          reminderClaimedAt: null,
          ...(delivered ? { reminderCount: { increment: 1 } } : {})
        }
      });
      if (delivered) sent += 1;
    } catch (error) {
      await client.reportSignature.update({
        where: { id: signature.id },
        data: { reminderClaimedAt: null }
      }).catch(() => {});
      console.error('Falha ao enviar lembrete de assinatura.', { signatureId: signature.id, error: error?.message || error });
    }
  }

  return { checked: candidates.length, sent };
}

export function startSignatureReminderJob() {
  const run = () => {
    processSignatureReminders().catch(error => {
      console.error('Falha no job de lembretes de assinatura.', error);
    });
  };
  run();
  const timer = setInterval(run, REMINDER_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
