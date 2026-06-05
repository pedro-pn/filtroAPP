import {
  addNotificationPreferencesLink,
  buildCalibrationReminderEmailTemplate,
  buildCalibrationUpdatedEmailTemplate
} from './email-templates.js';
import { getMissingMailerConfig, sendMail } from './mailer.js';
import {
  managerCoordinatorNotificationEmails,
  NotificationEmailCategory,
  notificationRecipientsForEmails
} from './notification-preferences.js';
import prisma from './prisma.js';

const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REPEAT_GAP_DAYS = 5;
const MANOMETER_CATEGORY = 'Manômetros';

export const CalibrationReminderMilestone = {
  D30: 'D30',
  D15: 'D15',
  D7: 'D7',
  EXPIRED_DAY: 'EXPIRED_DAY',
  EXPIRED_REPEAT: 'EXPIRED_REPEAT'
};

const UPCOMING_MILESTONES = [
  { days: 30, milestone: CalibrationReminderMilestone.D30 },
  { days: 15, milestone: CalibrationReminderMilestone.D15 },
  { days: 7, milestone: CalibrationReminderMilestone.D7 },
  { days: 0, milestone: CalibrationReminderMilestone.EXPIRED_DAY }
];

const MILESTONE_LABELS = {
  [CalibrationReminderMilestone.D30]: {
    label: 'vence em 30 dias',
    intro: 'Os equipamentos abaixo possuem calibração com vencimento em 30 dias.'
  },
  [CalibrationReminderMilestone.D15]: {
    label: 'vence em 15 dias',
    intro: 'Os equipamentos abaixo possuem calibração com vencimento em 15 dias.'
  },
  [CalibrationReminderMilestone.D7]: {
    label: 'vence em 7 dias',
    intro: 'Os equipamentos abaixo possuem calibração com vencimento em 7 dias.'
  },
  [CalibrationReminderMilestone.EXPIRED_DAY]: {
    label: 'expira hoje',
    intro: 'Os equipamentos abaixo possuem calibração com vencimento hoje.'
  },
  [CalibrationReminderMilestone.EXPIRED_REPEAT]: {
    label: 'expirada',
    intro: 'Os equipamentos abaixo estão com a calibração expirada.'
  }
};

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

function normalizeManometer(manometer) {
  return {
    equipmentType: 'MANOMETER',
    equipmentId: manometer.id,
    category: MANOMETER_CATEGORY,
    code: manometer.code,
    serialNumber: '',
    calibratedAt: manometer.calibratedAt,
    expiresAt: manometer.expiresAt
  };
}

function normalizeParticleCounter(counter) {
  return {
    equipmentType: 'PARTICLE_COUNTER',
    equipmentId: counter.id,
    category: counter.category || 'CONTADOR DE PARTICULAS',
    code: counter.code,
    serialNumber: counter.serialNumber || '',
    calibratedAt: counter.calibratedAt,
    expiresAt: counter.expiresAt
  };
}

function normalizeCalibrationEquipment(equipmentType, equipment) {
  return equipmentType === 'MANOMETER'
    ? normalizeManometer(equipment)
    : normalizeParticleCounter(equipment);
}

async function fetchCalibrationEquipment(client) {
  const [manometers, particleCounters] = await Promise.all([
    client.manometer.findMany({
      where: { isActive: true },
      select: { id: true, code: true, expiresAt: true }
    }),
    client.particleCounter.findMany({
      where: { isActive: true },
      select: { id: true, code: true, serialNumber: true, category: true, expiresAt: true }
    })
  ]);

  return [
    ...manometers.map(normalizeManometer),
    ...particleCounters.map(normalizeParticleCounter)
  ].filter(equipment => equipment.expiresAt);
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

async function recentRepeatCategories(client, categories, now) {
  if (!categories.length || !client.calibrationNotificationLog?.findMany) return new Set();
  const sentAfter = addUtcDays(now, -REPEAT_GAP_DAYS);
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

function upcomingCandidates(equipment, now) {
  const daysUntilExpiration = daysBetweenUtc(now, equipment.expiresAt);
  const match = UPCOMING_MILESTONES.find(item => item.days === daysUntilExpiration);
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

async function recipientsForCalibration(client) {
  const emails = await managerCoordinatorNotificationEmails({ client });
  return notificationRecipientsForEmails(
    emails,
    NotificationEmailCategory.CALIBRATION_REMINDERS,
    { client }
  );
}

async function sendCalibrationGroup({ group, recipients, mailer }) {
  const labels = MILESTONE_LABELS[group.milestone] || MILESTONE_LABELS[CalibrationReminderMilestone.EXPIRED_REPEAT];
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

export async function notifyCalibrationUpdated({
  equipmentType,
  equipment,
  previousExpiresAt,
  client = prisma,
  mailer = sendMail,
  now = new Date(),
  missingMailerConfig = getMissingMailerConfig()
} = {}) {
  const normalized = normalizeCalibrationEquipment(equipmentType, equipment || {});
  if (!shouldNotifyCalibrationUpdated({ previousExpiresAt, nextExpiresAt: normalized.expiresAt, now })) return false;
  if (mailer === sendMail && missingMailerConfig.length) return false;

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
      equipmentType: options.equipmentType,
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
  if (mailer === sendMail && missingMailerConfig.length) return { checked: 0, sent: 0, skipped: true };

  const equipment = await fetchCalibrationEquipment(client);
  const upcoming = equipment.map(item => upcomingCandidates(item, now)).filter(Boolean);
  const alreadySent = await alreadySentUpcomingLogs(client, upcoming);
  const pendingUpcoming = upcoming.filter(candidate => !alreadySent.has(logKey(candidate)));

  const expired = equipment.filter(item => daysBetweenUtc(now, item.expiresAt) < 0);
  const expiredCategories = Array.from(new Set(expired.map(item => item.category)));
  const blockedRepeatCategories = await recentRepeatCategories(client, expiredCategories, now);
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
