import {
  addNotificationPreferencesLink,
  buildCalibrationReminderEmailTemplate,
  buildCalibrationUpdatedEmailTemplate
} from './email-templates.js';
import { activeRecipientEmails, getEquipmentNotificationConfig } from './equipment-notifications.js';
import { getMissingMailerConfig, outboundEmailsEnabled, sendMail } from './mailer.js';
import prisma from './prisma.js';

const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const CalibrationReminderMilestone = {
  EXPIRED_DAY: 'EXPIRED_DAY',
  EXPIRED_REPEAT: 'EXPIRED_REPEAT'
};

function milestoneForDays(days) {
  return `D${days}`;
}

function milestoneLabels(milestone) {
  if (milestone === CalibrationReminderMilestone.EXPIRED_DAY) {
    return { label: 'expira hoje', intro: 'Os equipamentos abaixo possuem calibração com vencimento hoje.' };
  }
  if (milestone === CalibrationReminderMilestone.EXPIRED_REPEAT) {
    return { label: 'expirada', intro: 'Os equipamentos abaixo estão com a calibração expirada.' };
  }
  const match = /^D(\d+)$/.exec(milestone);
  const days = match ? match[1] : '';
  return {
    label: `vence em ${days} dias`,
    intro: `Os equipamentos abaixo possuem calibração com vencimento em ${days} dias.`
  };
}

function buildUpcomingMilestones(config) {
  const list = config.milestoneDays.map(days => ({ days, milestone: milestoneForDays(days) }));
  if (config.notifyOnDueDay) list.push({ days: 0, milestone: CalibrationReminderMilestone.EXPIRED_DAY });
  return list;
}

function startOfUtcDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(value, days) {
  return new Date(startOfUtcDay(value).getTime() + days * DAY_MS);
}

function daysBetweenUtc(start, end) {
  return Math.round((startOfUtcDay(end).getTime() - startOfUtcDay(start).getTime()) / DAY_MS);
}

function logKey(item) {
  return [
    item.equipmentType,
    item.equipmentId,
    item.milestone,
    startOfUtcDay(item.targetDate).toISOString()
  ].join('|');
}

function groupKey(item) {
  return [item.category, item.milestone].join('|');
}

function categoryLogEquipmentId(category) {
  return `CATEGORY:${category}`;
}

// Projeta um CompanyEquipment calibrável para a forma usada pelas notificações.
export function normalizeCompanyEquipment(item) {
  const attributes = item?.attributes && typeof item.attributes === 'object' ? item.attributes : {};
  return {
    equipmentType: 'EQUIPMENT',
    equipmentId: item?.id,
    category: item?.category?.name || 'Equipamentos',
    code: item?.code || '',
    serialNumber: attributes.serialNumber || '',
    calibratedAt: item?.calibratedAt || null,
    expiresAt: item?.expiresAt || null
  };
}

async function fetchCalibrationEquipment(client) {
  const items = await client.companyEquipment.findMany({
    where: { isActive: true, hasCalibration: true, expiresAt: { not: null } },
    select: {
      id: true,
      code: true,
      attributes: true,
      calibratedAt: true,
      expiresAt: true,
      category: { select: { name: true } }
    }
  });
  return items.map(normalizeCompanyEquipment).filter(equipment => equipment.expiresAt);
}

async function alreadySentUpcomingLogs(client, candidates) {
  if (!candidates.length || !client.calibrationNotificationLog?.findMany) return new Set();
  const logs = await client.calibrationNotificationLog.findMany({
    where: {
      OR: candidates.map(candidate => ({
        equipmentType: candidate.equipmentType,
        equipmentId: candidate.equipmentId,
        milestone: candidate.milestone,
        targetDate: candidate.targetDate
      }))
    },
    select: {
      equipmentType: true,
      equipmentId: true,
      milestone: true,
      targetDate: true
    }
  });
  return new Set(logs.map(logKey));
}

async function recentRepeatCategories(client, categories, now, gapDays) {
  if (!categories.length || !client.calibrationNotificationLog?.findMany) return new Set();
  const sentAfter = addUtcDays(now, -gapDays);
  const logs = await client.calibrationNotificationLog.findMany({
    where: {
      milestone: CalibrationReminderMilestone.EXPIRED_REPEAT,
      equipmentId: { in: categories.map(categoryLogEquipmentId) },
      sentAt: { gte: sentAfter }
    },
    select: { category: true }
  });
  return new Set(logs.map(log => log.category));
}

async function createLogs(client, data) {
  if (!data.length || !client.calibrationNotificationLog?.createMany) return;
  await client.calibrationNotificationLog.createMany({
    data,
    skipDuplicates: true
  });
}

function upcomingCandidates(equipment, now, milestones) {
  const daysUntilExpiration = daysBetweenUtc(now, equipment.expiresAt);
  const match = milestones.find(item => item.days === daysUntilExpiration);
  if (!match) return null;
  return {
    ...equipment,
    milestone: match.milestone,
    targetDate: startOfUtcDay(equipment.expiresAt)
  };
}

function groupCandidates(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = groupKey(candidate);
    if (!groups.has(key)) groups.set(key, {
      category: candidate.category,
      milestone: candidate.milestone,
      equipments: []
    });
    groups.get(key).equipments.push(candidate);
  }
  return Array.from(groups.values());
}

// Destinatários configurados (contas internas + e-mails avulsos).
async function recipientsForCalibration(client) {
  const emails = await activeRecipientEmails(client);
  return emails.map(email => ({ email, notificationPreferencesUrl: '' }));
}

async function sendCalibrationGroup({ group, recipients, mailer }) {
  const labels = milestoneLabels(group.milestone);
  const template = buildCalibrationReminderEmailTemplate({
    category: group.category,
    milestoneLabel: labels.label,
    introLabel: labels.intro,
    equipments: group.equipments
  });

  for (const recipient of recipients) {
    await mailer({
      to: recipient.email,
      ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
    });
  }
}

export function shouldNotifyCalibrationUpdated({ previousExpiresAt, nextExpiresAt, now = new Date() } = {}) {
  if (!previousExpiresAt || !nextExpiresAt) return false;
  const previousDate = startOfUtcDay(previousExpiresAt);
  const nextDate = startOfUtcDay(nextExpiresAt);
  if (previousDate.getTime() === nextDate.getTime()) return false;
  return nextDate.getTime() > startOfUtcDay(now).getTime();
}

// Notifica imediatamente quando a validade de um equipamento é estendida.
export async function notifyCalibrationUpdated({
  equipment,
  previousExpiresAt,
  client = prisma,
  mailer = sendMail,
  now = new Date(),
  missingMailerConfig = getMissingMailerConfig()
} = {}) {
  const normalized = normalizeCompanyEquipment(equipment || {});
  if (!shouldNotifyCalibrationUpdated({ previousExpiresAt, nextExpiresAt: normalized.expiresAt, now })) return false;
  if (mailer === sendMail && !outboundEmailsEnabled()) return false;
  if (mailer === sendMail && missingMailerConfig.length) return false;

  const config = await getEquipmentNotificationConfig(client);
  if (!config.enabled) return false;

  const recipients = await recipientsForCalibration(client);
  if (!recipients.length) return false;

  const template = buildCalibrationUpdatedEmailTemplate({
    category: normalized.category,
    equipment: normalized,
    previousExpiresAt
  });

  for (const recipient of recipients) {
    await mailer({
      to: recipient.email,
      ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
    });
  }

  return true;
}

export async function notifyCalibrationUpdatedSafely(options = {}) {
  try {
    return await notifyCalibrationUpdated(options);
  } catch (error) {
    console.error('Falha ao notificar atualização de calibração.', {
      equipmentId: options.equipment?.id,
      error: error?.message || error
    });
    return false;
  }
}

export async function processCalibrationReminders({
  client = prisma,
  mailer = sendMail,
  now = new Date(),
  missingMailerConfig = getMissingMailerConfig()
} = {}) {
  const config = await getEquipmentNotificationConfig(client);
  if (!config.enabled) return { checked: 0, sent: 0, skipped: true, reason: 'disabled' };
  if (mailer === sendMail && !outboundEmailsEnabled()) {
    return { checked: 0, sent: 0, skipped: true, reason: 'outbound_emails_disabled' };
  }
  if (mailer === sendMail && missingMailerConfig.length) return { checked: 0, sent: 0, skipped: true };

  const equipment = await fetchCalibrationEquipment(client);
  const milestones = buildUpcomingMilestones(config);
  const upcoming = equipment.map(item => upcomingCandidates(item, now, milestones)).filter(Boolean);
  const alreadySent = await alreadySentUpcomingLogs(client, upcoming);
  const pendingUpcoming = upcoming.filter(candidate => !alreadySent.has(logKey(candidate)));

  const expired = config.repeatExpired
    ? equipment.filter(item => daysBetweenUtc(now, item.expiresAt) < 0)
    : [];
  const expiredCategories = Array.from(new Set(expired.map(item => item.category)));
  const blockedRepeatCategories = await recentRepeatCategories(client, expiredCategories, now, config.repeatGapDays);
  const repeatGroups = groupCandidates(expired
    .filter(item => !blockedRepeatCategories.has(item.category))
    .map(item => ({
      ...item,
      milestone: CalibrationReminderMilestone.EXPIRED_REPEAT,
      targetDate: startOfUtcDay(now)
    })));

  const groups = [
    ...groupCandidates(pendingUpcoming),
    ...repeatGroups
  ];
  if (!groups.length) return { checked: equipment.length, sent: 0 };

  const recipients = await recipientsForCalibration(client);
  if (!recipients.length) return { checked: equipment.length, sent: 0 };

  let sent = 0;
  for (const group of groups) {
    await sendCalibrationGroup({ group, recipients, mailer });
    sent += 1;

    if (group.milestone === CalibrationReminderMilestone.EXPIRED_REPEAT) {
      await createLogs(client, [{
        equipmentType: 'CATEGORY',
        equipmentId: categoryLogEquipmentId(group.category),
        category: group.category,
        milestone: group.milestone,
        targetDate: startOfUtcDay(now)
      }]);
      continue;
    }

    await createLogs(client, group.equipments.map(item => ({
      equipmentType: item.equipmentType,
      equipmentId: item.equipmentId,
      category: item.category,
      milestone: item.milestone,
      targetDate: item.targetDate
    })));
  }

  return { checked: equipment.length, sent };
}

export function startCalibrationReminderJob() {
  const run = () => {
    processCalibrationReminders().catch(error => {
      console.error('Falha no job de lembretes de calibração.', error);
    });
  };
  run();
  const timer = setInterval(run, REMINDER_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
