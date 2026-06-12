import prisma from './prisma.js';
import { notifySurveyExpired, sendSurveyReminder } from './survey-mail.js';
import { decryptSurveyToken } from './survey-token.js';

const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
const REMINDER_GAP_MS = 3 * 24 * 60 * 60 * 1000;
const CLAIM_STALE_MS = 2 * 60 * 60 * 1000;

export function reminderDueWhere(now = new Date()) {
  const dueBefore = new Date(now.getTime() - REMINDER_GAP_MS);
  const staleClaimBefore = new Date(now.getTime() - CLAIM_STALE_MS);
  return {
    respondedAt: null,
    reminderOptOutAt: null,
    expiresAt: { gt: now },
    OR: [
      { lastReminderAt: null, sentAt: { lt: dueBefore } },
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

export function expirationDueWhere(now = new Date()) {
  return {
    respondedAt: null,
    expiresAt: { lte: now },
    expirationNotifiedAt: null
  };
}

function encryptedTokenPayload(survey) {
  return {
    tokenEncrypted: survey.tokenEncrypted,
    tokenIv: survey.tokenIv,
    tokenAuthTag: survey.tokenAuthTag
  };
}

export async function processSurveyReminders({ limit = 25 } = {}) {
  const now = new Date();
  const candidates = await prisma.satisfactionSurvey.findMany({
    where: reminderDueWhere(now),
    take: limit,
    orderBy: { sentAt: 'asc' },
    include: { project: true }
  });

  let sent = 0;
  for (const survey of candidates) {
    const claimTime = new Date();
    const claim = await prisma.satisfactionSurvey.updateMany({
      where: {
        id: survey.id,
        ...reminderDueWhere(now)
      },
      data: { reminderClaimedAt: claimTime }
    });
    if (claim.count !== 1) continue;

    try {
      const token = decryptSurveyToken(encryptedTokenPayload(survey));
      await sendSurveyReminder({ survey, project: survey.project, token });
      await prisma.satisfactionSurvey.update({
        where: { id: survey.id },
        data: {
          lastReminderAt: new Date(),
          reminderClaimedAt: null,
          reminderCount: { increment: 1 }
        }
      });
      sent += 1;
    } catch (error) {
      await prisma.satisfactionSurvey.update({
        where: { id: survey.id },
        data: { reminderClaimedAt: null }
      }).catch(() => {});
      console.error('Falha ao enviar lembrete de pesquisa.', { surveyId: survey.id, error: error?.message || error });
    }
  }

  return { checked: candidates.length, sent };
}

async function expirationNotificationRecipients(project, client = prisma) {
  const roles = project?.managerOnly ? ['MANAGER'] : ['MANAGER', 'COORDINATOR'];
  const users = await client.user.findMany({
    where: {
      role: { in: roles },
      isActive: true,
      email: { not: null }
    },
    select: { email: true }
  });
  return users.map(user => user.email).filter(Boolean);
}

export async function processSurveyExpirations({
  limit = 25,
  client = prisma,
  notifyExpired = notifySurveyExpired,
  now = new Date()
} = {}) {
  const candidates = await client.satisfactionSurvey.findMany({
    where: expirationDueWhere(now),
    take: limit,
    orderBy: { expiresAt: 'asc' },
    include: { project: true }
  });

  let notified = 0;
  for (const survey of candidates) {
    const claimTime = new Date();
    const claim = await client.satisfactionSurvey.updateMany({
      where: {
        id: survey.id,
        ...expirationDueWhere(now)
      },
      data: { expirationNotifiedAt: claimTime }
    });
    if (claim.count !== 1) continue;

    try {
      const recipients = await expirationNotificationRecipients(survey.project, client);
      await notifyExpired({ survey, project: survey.project, recipients });
      notified += 1;
    } catch (error) {
      console.error('Falha ao notificar expiração de pesquisa.', { surveyId: survey.id, error: error?.message || error });
    }
  }

  return { checked: candidates.length, notified };
}

function runSurveyJobs() {
  return Promise.all([
    processSurveyReminders(),
    processSurveyExpirations()
  ]);
}

export function startSurveyReminderJob() {
  const run = () => {
    runSurveyJobs().catch(error => {
      console.error('Falha no job de pesquisas.', error);
    });
  };
  run();
  const timer = setInterval(run, REMINDER_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
