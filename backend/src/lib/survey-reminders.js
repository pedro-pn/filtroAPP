import prisma from './prisma.js';
import { sendSurveyReminder } from './survey-mail.js';
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

export function startSurveyReminderJob() {
  const timer = setInterval(() => {
    processSurveyReminders().catch(error => {
      console.error('Falha no job de lembretes de pesquisa.', error);
    });
  }, REMINDER_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
