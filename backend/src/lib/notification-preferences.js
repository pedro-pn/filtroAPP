import { randomBytes } from 'node:crypto';

import env from '../config/env.js';
import prisma from './prisma.js';

const TOKEN_DAYS = 30;

export const NotificationEmailCategory = {
  REPORTS: 'reports',
  SIGNATURES: 'signatures',
  SURVEY_REMINDERS: 'surveyReminders'
};

const CATEGORY_FIELDS = {
  [NotificationEmailCategory.REPORTS]: 'notifyReportsByEmail',
  [NotificationEmailCategory.SIGNATURES]: 'notifySignaturesByEmail',
  [NotificationEmailCategory.SURVEY_REMINDERS]: 'notifySurveyRemindersByEmail'
};

export function notificationPreferences(user = {}) {
  return {
    reports: user.notifyReportsByEmail !== false,
    signatures: user.notifySignaturesByEmail !== false,
    surveyReminders: user.notifySurveyRemindersByEmail !== false
  };
}

export function notificationPreferenceData(value = {}) {
  return {
    notifyReportsByEmail: value.reports !== false,
    notifySignaturesByEmail: value.signatures !== false,
    notifySurveyRemindersByEmail: value.surveyReminders !== false
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function notificationEmailForUser(user) {
  const email = normalizeEmail(user?.email);
  if (email) return email;
  const username = normalizeEmail(user?.username);
  return username.includes('@') ? username : '';
}

function appBaseUrl() {
  return String(env.appUrl || '').replace(/\/+$/, '');
}

export function notificationPreferencesUrl(tokenHash) {
  const path = `/notificacoes/${encodeURIComponent(tokenHash)}`;
  const base = appBaseUrl();
  return base ? `${base}${path}` : path;
}

export function notificationPreferenceTokenStatus(tokenRow, now = new Date()) {
  if (!tokenRow) return { valid: false, expired: false, used: false };
  const expired = tokenRow.expiresAt <= now;
  const used = Boolean(tokenRow.usedAt);
  const activeUser = tokenRow.user?.isActive !== false;
  return {
    valid: !expired && !used && activeUser,
    expired,
    used
  };
}

export async function getOrCreateNotificationPreferenceToken(userId, client = prisma, now = new Date()) {
  if (!client.notificationPreferenceToken) return null;
  const existing = await client.notificationPreferenceToken.findFirst({
    where: {
      userId,
      usedAt: null,
      expiresAt: { gt: now }
    },
    orderBy: { createdAt: 'desc' }
  });
  if (existing) return existing;

  return client.notificationPreferenceToken.create({
    data: {
      tokenHash: randomBytes(32).toString('hex'),
      userId,
      expiresAt: new Date(now.getTime() + TOKEN_DAYS * 24 * 60 * 60 * 1000)
    }
  });
}

export async function findNotificationPreferenceToken(tokenHash, client = prisma) {
  return client.notificationPreferenceToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });
}

export async function consumeNotificationPreferenceToken(tokenHash, preferences, client = prisma, now = new Date()) {
  const token = await findNotificationPreferenceToken(tokenHash, client);
  const status = notificationPreferenceTokenStatus(token, now);
  if (!status.valid) {
    const error = new Error('Link inválido, expirado ou já utilizado.');
    error.status = 400;
    error.statusInfo = status;
    throw error;
  }

  const data = notificationPreferenceData(preferences);
  const updated = await client.$transaction(async tx => {
    const consumed = await tx.notificationPreferenceToken.updateMany({
      where: {
        id: token.id,
        usedAt: null,
        expiresAt: { gt: now }
      },
      data: { usedAt: now }
    });
    if (consumed.count !== 1) {
      const error = new Error('Link inválido, expirado ou já utilizado.');
      error.status = 400;
      throw error;
    }
    return tx.user.update({
      where: { id: token.userId },
      data
    });
  });

  return updated;
}

export async function notificationRecipientsForEmails(emails, category, options = {}) {
  const client = options.client || prisma;
  const normalized = Array.from(new Set((Array.isArray(emails) ? emails : [emails])
    .map(normalizeEmail)
    .filter(Boolean)));
  if (!normalized.length) return [];
  if (!client.user?.findMany) {
    return normalized.map(email => ({
      email,
      userId: null,
      notificationPreferencesUrl: ''
    }));
  }

  const users = await client.user.findMany({
    where: {
      isActive: true,
      OR: normalized.flatMap(email => [
        { email: { equals: email, mode: 'insensitive' } },
        { username: { equals: email, mode: 'insensitive' } }
      ])
    },
    select: {
      id: true,
      username: true,
      email: true,
      notifyReportsByEmail: true,
      notifySignaturesByEmail: true,
      notifySurveyRemindersByEmail: true
    }
  });

  const usersByEmail = new Map();
  for (const user of users) {
    const email = normalizeEmail(user.email) || normalizeEmail(user.username);
    if (email && !usersByEmail.has(email)) usersByEmail.set(email, user);
  }

  const preferenceField = CATEGORY_FIELDS[category];
  const recipients = [];
  for (const email of normalized) {
    const user = usersByEmail.get(email);
    if (user && preferenceField && user[preferenceField] === false) continue;
    const token = user ? await getOrCreateNotificationPreferenceToken(user.id, client) : null;
    recipients.push({
      email,
      userId: user?.id || null,
      notificationPreferencesUrl: token ? notificationPreferencesUrl(token.tokenHash) : ''
    });
  }
  return recipients;
}

export async function coordinatorNotificationEmails(options = {}) {
  const client = options.client || prisma;
  if (!client.user?.findMany) return [];

  const users = await client.user.findMany({
    where: {
      isActive: true,
      OR: [
        { role: 'COORDINATOR' },
        { moduleRoles: { some: { role: 'RDO_COORDINATOR' } } }
      ]
    },
    select: {
      email: true,
      username: true
    }
  });

  return Array.from(new Set(users.map(notificationEmailForUser).filter(Boolean)));
}
