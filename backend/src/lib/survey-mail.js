import env from '../config/env.js';
import {
  addNotificationPreferencesLink,
  buildSurveyExpiredEmailTemplate,
  buildSurveyInviteEmailTemplate,
  buildSurveyReminderEmailTemplate,
  buildSurveyRespondedEmailTemplate
} from './email-templates.js';
import { sendMail } from './mailer.js';
import { coordinatorNotificationEmails, NotificationEmailCategory, notificationRecipientsForEmails } from './notification-preferences.js';

function appBaseUrl() {
  return String(env.appUrl || '').replace(/\/+$/, '');
}

export function surveyResponseUrl(token) {
  const base = appBaseUrl();
  return base ? `${base}/pesquisa/${encodeURIComponent(token)}` : `/pesquisa/${encodeURIComponent(token)}`;
}

export function surveyOptOutUrl(token) {
  const base = appBaseUrl();
  const path = `/api/surveys/reminders/${encodeURIComponent(token)}/opt-out`;
  return base ? `${base}${path}` : path;
}

export function safeSurvey(survey) {
  if (!survey) return null;
  const now = Date.now();
  const responded = Boolean(survey.respondedAt);
  const expired = !responded && survey.expiresAt && new Date(survey.expiresAt).getTime() <= now;
  const active = !responded && !expired;
  const questions = Array.isArray(survey.questions) ? survey.questions : undefined;
  return {
    id: survey.id,
    projectId: survey.projectId,
    emailTo: survey.emailTo,
    expiresAt: survey.expiresAt,
    respondedAt: survey.respondedAt,
    sentAt: survey.sentAt,
    lastReminderAt: survey.lastReminderAt,
    reminderCount: survey.reminderCount,
    reminderOptOutAt: survey.reminderOptOutAt,
    expirationNotifiedAt: survey.expirationNotifiedAt,
    followUpStatus: survey.followUpStatus,
    followUpNotes: survey.followUpNotes,
    followUpUpdatedAt: survey.followUpUpdatedAt,
    createdAt: survey.createdAt,
    ...(questions ? { questions } : {}),
    status: responded ? 'RESPONDED' : expired ? 'EXPIRED' : active ? 'ACTIVE' : 'UNKNOWN'
  };
}

export function surveyProjectLabel(project) {
  return [project?.code, project?.name].filter(Boolean).join(' - ') || project?.name || 'Projeto';
}

export async function sendSurveyInvite({ survey, project, token }) {
  const [recipient] = await notificationRecipientsForEmails([survey.emailTo], NotificationEmailCategory.SURVEY_REMINDERS);
  if (!recipient) return;
  const surveyUrl = surveyResponseUrl(token);
  const optOutUrl = surveyOptOutUrl(token);
  const daysValid = Math.max(1, Math.ceil((new Date(survey.expiresAt).getTime() - Date.now()) / 86_400_000));
  const template = buildSurveyInviteEmailTemplate({
    clientName: project.clientName,
    projectCode: project.code,
    projectName: project.name,
    surveyUrl,
    optOutUrl,
    expiresLabel: `${daysValid} dia${daysValid !== 1 ? 's' : ''}`
  });
  await sendMail({
    to: recipient.email,
    ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
  });
}

export async function sendSurveyReminder({ survey, project, token }) {
  const [recipient] = await notificationRecipientsForEmails([survey.emailTo], NotificationEmailCategory.SURVEY_REMINDERS);
  if (!recipient) return;
  const surveyUrl = surveyResponseUrl(token);
  const optOutUrl = surveyOptOutUrl(token);
  const daysRemaining = Math.max(0, Math.ceil((new Date(survey.expiresAt).getTime() - Date.now()) / 86_400_000));
  const template = buildSurveyReminderEmailTemplate({
    clientName: project.clientName,
    projectCode: project.code,
    projectName: project.name,
    surveyUrl,
    optOutUrl,
    daysRemaining
  });
  await sendMail({
    to: recipient.email,
    ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
  });
}

export async function notifySurveyResponded({ survey, project }) {
  const responses = survey.responses && typeof survey.responses === 'object' ? survey.responses : {};
  const questions = Array.isArray(survey.questions) ? survey.questions : [];
  const npsQuestion = questions.find(q => q.type === 'NPS');
  const nps = npsQuestion ? responses[npsQuestion.id] : undefined;
  const template = buildSurveyRespondedEmailTemplate({
    clientName: project.clientName,
    projectCode: project.code,
    projectName: project.name,
    nps,
    appUrl: env.appUrl || ''
  });
  const coordinatorEmails = await coordinatorNotificationEmails();
  const recipients = await notificationRecipientsForEmails(
    [survey.sentBy?.email, ...coordinatorEmails],
    NotificationEmailCategory.SURVEY_REMINDERS
  );
  await Promise.all(recipients.map(recipient => sendMail({
    to: recipient.email,
    ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
  })));
}

function formatDatePtBr(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
}

export async function notifySurveyExpired({ survey, project, recipients }) {
  const uniqueRecipients = Array.from(new Set((recipients || [])
    .map(email => String(email || '').trim().toLowerCase())
    .filter(Boolean)));
  if (!uniqueRecipients.length) return;
  const enabledRecipients = await notificationRecipientsForEmails(uniqueRecipients, NotificationEmailCategory.SURVEY_REMINDERS);
  if (!enabledRecipients.length) return;

  const template = buildSurveyExpiredEmailTemplate({
    clientName: project.clientName,
    projectCode: project.code,
    projectName: project.name,
    emailTo: survey.emailTo,
    sentAt: formatDatePtBr(survey.sentAt),
    expiresAt: formatDatePtBr(survey.expiresAt),
    appUrl: env.appUrl || ''
  });
  await Promise.all(enabledRecipients.map(recipient => sendMail({
    to: recipient.email,
    ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl)
  })));
}
