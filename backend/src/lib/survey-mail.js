import env from '../config/env.js';
import {
  buildSurveyInviteEmailTemplate,
  buildSurveyReminderEmailTemplate,
  buildSurveyRespondedEmailTemplate
} from './email-templates.js';
import { sendMail } from './mailer.js';

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
    createdAt: survey.createdAt,
    ...(questions ? { questions } : {}),
    status: responded ? 'RESPONDED' : expired ? 'EXPIRED' : active ? 'ACTIVE' : 'UNKNOWN'
  };
}

export function surveyProjectLabel(project) {
  return [project?.code, project?.name].filter(Boolean).join(' - ') || project?.name || 'Projeto';
}

export async function sendSurveyInvite({ survey, project, token }) {
  const surveyUrl = surveyResponseUrl(token);
  const optOutUrl = surveyOptOutUrl(token);
  const template = buildSurveyInviteEmailTemplate({
    clientName: project.clientName,
    projectCode: project.code,
    projectName: project.name,
    surveyUrl,
    optOutUrl,
    expiresLabel: '30 dias'
  });
  await sendMail({ to: survey.emailTo, ...template });
}

export async function sendSurveyReminder({ survey, project, token }) {
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
  await sendMail({ to: survey.emailTo, ...template });
}

export async function notifySurveyResponded({ survey, project }) {
  const recipient = survey.sentBy?.email;
  if (!recipient) return;
  const responses = survey.responses && typeof survey.responses === 'object' ? survey.responses : {};
  const template = buildSurveyRespondedEmailTemplate({
    clientName: project.clientName,
    projectCode: project.code,
    projectName: project.name,
    nps: responses.nps,
    appUrl: env.appUrl || ''
  });
  await sendMail({ to: recipient, ...template });
}
