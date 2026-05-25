import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { hashToken } from '../../lib/auth.js';
import { clientCanAccessProject } from '../../lib/client-project-access.js';
import prisma from '../../lib/prisma.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';
import {
  notifySurveyResponded,
  safeSurvey,
  sendSurveyInvite,
  surveyResponseUrl
} from '../../lib/survey-mail.js';
import { decryptSurveyToken, surveyTokenData } from '../../lib/survey-token.js';
import { hasModuleRole } from '../../lib/module-roles.js';
import { SURVEY_NOTICE_VERSION, validatePrivacyNoticeAcknowledgement } from '../../lib/privacy-consent.js';
import { requireAuth, requireManager, requireModuleRole } from '../../middleware/auth.js';

const router = Router();
const requireRdoClient = requireModuleRole('rdo:client');
const SURVEY_DAYS = 30;
const publicLimiter = createMemoryRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Muitas tentativas. Tente novamente mais tarde.'
});

const QUESTION_TYPES = ['NPS', 'SCALE', 'SELECT', 'TEXT'];
const defaultQuestions = [
  { id: 'nps', label: 'Probabilidade de recomendar a Filtrovali', type: 'NPS', options: [], required: true, order: 1 },
  { id: 'serviceQuality', label: 'Qualidade dos serviços prestados', type: 'SCALE', options: [], required: true, order: 2 },
  { id: 'communication', label: 'Comunicação da equipe durante o projeto', type: 'SCALE', options: [], required: true, order: 3 },
  { id: 'deadlines', label: 'Cumprimento de prazos', type: 'SCALE', options: [], required: true, order: 4 },
  { id: 'documentation', label: 'Qualidade da documentação entregue', type: 'SCALE', options: [], required: true, order: 5 },
  { id: 'improvement', label: 'O que podemos melhorar?', type: 'TEXT', options: [], required: false, order: 6 },
  { id: 'highlight', label: 'Algo que gostaria de destacar?', type: 'TEXT', options: [], required: false, order: 7 }
];

const questionSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1),
  type: z.enum(QUESTION_TYPES),
  options: z.array(z.string().trim().min(1)).optional().default([]),
  required: z.boolean().default(true)
});

const questionsPayloadSchema = z.object({
  questions: z.array(questionSchema).min(1)
});

const followUpSchema = z.object({
  status: z.enum(['OPEN', 'CONTACTED', 'RESOLVED', 'NOT_APPLICABLE']).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional()
});

function requireManagerOrCoordinator(req, res, next) {
  if (!req.auth || !hasModuleRole(req.auth.user, ['rdo:manager', 'rdo:coordinator'])) {
    return res.status(403).json({ error: 'Acesso restrito ao gestor ou coordenador.' });
  }
  next();
}

// Coordinators cannot see surveys from manager-only projects.
function managerOnlyProjectFilter(role) {
  return role === 'MANAGER' ? {} : { project: { managerOnly: false } };
}

function safeQuestion(question, index = 0) {
  return {
    id: String(question.id || ''),
    label: String(question.label || ''),
    type: QUESTION_TYPES.includes(question.type) ? question.type : 'TEXT',
    options: Array.isArray(question.options) ? question.options : [],
    required: question.required !== false,
    order: Number.isFinite(Number(question.order)) ? Number(question.order) : index + 1
  };
}

async function ensureDefaultSurveyQuestions() {
  const count = await prisma.satisfactionSurveyQuestion.count();
  if (count > 0) return;
  await prisma.satisfactionSurveyQuestion.createMany({
    data: defaultQuestions.map(question => ({
      ...question,
      options: question.options
    })),
    skipDuplicates: true
  });
}

export function surveyQuestionSnapshot(questions) {
  return questions.map((question, index) => safeQuestion(question, index));
}

async function activeSurveyQuestions() {
  await ensureDefaultSurveyQuestions();
  return prisma.satisfactionSurveyQuestion.findMany({
    where: { isActive: true },
    orderBy: { order: 'asc' }
  });
}

async function activeSurveyQuestionSnapshot() {
  return surveyQuestionSnapshot(await activeSurveyQuestions());
}

export function storedSurveyQuestions(survey) {
  if (!Array.isArray(survey?.questions) || !survey.questions.length) return null;
  return surveyQuestionSnapshot(survey.questions);
}

async function questionsForSurvey(survey) {
  return storedSurveyQuestions(survey) || activeSurveyQuestionSnapshot();
}

function responseInput(body) {
  const answers = body?.answers;
  if (answers && typeof answers === 'object' && !Array.isArray(answers)) return answers;
  return body && typeof body === 'object' ? body : {};
}

export function validateSurveyPrivacyNotice(body) {
  const noticeError = validatePrivacyNoticeAcknowledgement(body, SURVEY_NOTICE_VERSION);
  if (noticeError) {
    const error = new Error(noticeError);
    error.status = 400;
    throw error;
  }
  return body?.privacyNoticeVersion ? SURVEY_NOTICE_VERSION : null;
}

function parseQuestionValue(question, rawValue) {
  const empty = rawValue === undefined || rawValue === null || rawValue === '';
  if (empty) {
    if (question.required) {
      const error = new Error(`Preencha a pergunta: ${question.label}`);
      error.status = 400;
      throw error;
    }
    return '';
  }

  if (question.type === 'NPS') {
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      const error = new Error(`Resposta inválida para: ${question.label}`);
      error.status = 400;
      throw error;
    }
    return value;
  }

  if (question.type === 'SCALE') {
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      const error = new Error(`Resposta inválida para: ${question.label}`);
      error.status = 400;
      throw error;
    }
    return value;
  }

  if (question.type === 'SELECT') {
    const value = String(rawValue);
    const options = Array.isArray(question.options) ? question.options : [];
    if (!options.includes(value)) {
      const error = new Error(`Resposta inválida para: ${question.label}`);
      error.status = 400;
      throw error;
    }
    return value;
  }

  const value = String(rawValue).trim();
  if (value.length > 2000) {
    const error = new Error(`Resposta muito longa para: ${question.label}`);
    error.status = 400;
    throw error;
  }
  return value;
}

export function validateSurveyResponses(body, questions) {
  const input = responseInput(body);
  return questions.reduce((acc, question) => {
    acc[question.id] = parseQuestionValue(question, input[question.id]);
    return acc;
  }, {});
}

function activeSurveyWhere(projectId) {
  return {
    projectId,
    respondedAt: null,
    expiresAt: { gt: new Date() }
  };
}

function expiresAt() {
  return new Date(Date.now() + SURVEY_DAYS * 24 * 60 * 60 * 1000);
}

function encryptedTokenPayload(survey) {
  return {
    tokenEncrypted: survey.tokenEncrypted,
    tokenIv: survey.tokenIv,
    tokenAuthTag: survey.tokenAuthTag
  };
}

async function findActiveSurvey(projectId) {
  return prisma.satisfactionSurvey.findFirst({
    where: activeSurveyWhere(projectId),
    orderBy: { createdAt: 'desc' },
    include: { project: true, sentBy: true }
  });
}

async function createOrReuseSurvey(project, userId) {
  const active = await findActiveSurvey(project.id);
  if (active) {
    const token = decryptSurveyToken(encryptedTokenPayload(active));
    const questions = storedSurveyQuestions(active) || await activeSurveyQuestionSnapshot();
    const updated = await prisma.satisfactionSurvey.update({
      where: { id: active.id },
      data: {
        emailTo: project.clientEmailPrimary,
        sentAt: new Date(),
        questions
      },
      include: { project: true, sentBy: true }
    });
    return { survey: updated, token, reused: true };
  }

  const tokenData = surveyTokenData();
  const questions = await activeSurveyQuestionSnapshot();
  const survey = await prisma.satisfactionSurvey.create({
    data: {
      projectId: project.id,
      tokenHash: tokenData.tokenHash,
      tokenEncrypted: tokenData.tokenEncrypted,
      tokenIv: tokenData.tokenIv,
      tokenAuthTag: tokenData.tokenAuthTag,
      emailTo: project.clientEmailPrimary,
      expiresAt: expiresAt(),
      questions,
      sentByUserId: userId
    },
    include: { project: true, sentBy: true }
  });
  return { survey, token: tokenData.token, reused: false };
}

async function surveyFromToken(token, include = {}) {
  return prisma.satisfactionSurvey.findUnique({
    where: { tokenHash: hashToken(token) },
    include
  });
}

function responseStatus(survey) {
  if (!survey) return 'INVALID';
  if (survey.respondedAt) return 'RESPONDED';
  if (new Date(survey.expiresAt).getTime() <= Date.now()) return 'EXPIRED';
  return 'ACTIVE';
}

function publicSurveyPayload(survey) {
  const status = responseStatus(survey);
  if (!survey || status === 'INVALID') return { status };
  return {
    status,
    survey: {
      id: survey.id,
      expiresAt: survey.expiresAt,
      respondedAt: survey.respondedAt,
      questions: storedSurveyQuestions(survey) || [],
      project: {
        code: survey.project?.code || '',
        name: survey.project?.name || '',
        clientName: survey.project?.clientName || ''
      }
    }
  };
}

function surveyResponseObject(survey) {
  return survey.responses && typeof survey.responses === 'object' && !Array.isArray(survey.responses)
    ? survey.responses
    : {};
}

function surveyQuestionList(survey) {
  return Array.isArray(survey.questions) ? survey.questions : [];
}

function surveyNpsValue(survey) {
  const responses = surveyResponseObject(survey);
  const npsQuestion = surveyQuestionList(survey).find(question => question.type === 'NPS');
  const value = npsQuestion ? responses[npsQuestion.id] : undefined;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

function questionAnswers(survey) {
  const responses = surveyResponseObject(survey);
  return surveyQuestionList(survey).map(question => ({
    id: question.id,
    label: question.label,
    type: question.type,
    order: question.order ?? 0,
    value: responses[question.id] ?? null
  }));
}

router.get('/questions', requireAuth, requireManagerOrCoordinator, asyncHandler(async (_req, res) => {
  const questions = await activeSurveyQuestions();
  res.json(questions.map(safeQuestion));
}));

router.put('/questions', requireAuth, requireManager, asyncHandler(async (req, res) => {
  const { questions } = questionsPayloadSchema.parse(req.body);
  const normalized = questions.map((question, index) => ({
    id: question.id && !question.id.startsWith('new-') ? question.id : null,
    label: question.label,
    type: question.type,
    options: question.type === 'SELECT' ? Array.from(new Set(question.options || [])) : [],
    required: question.required,
    order: index + 1
  }));

  const saved = await prisma.$transaction(async tx => {
    const keepIds = normalized.map(question => question.id).filter(Boolean);
    await tx.satisfactionSurveyQuestion.updateMany({
      where: keepIds.length ? { id: { notIn: keepIds } } : {},
      data: { isActive: false }
    });

    for (const question of normalized) {
      if (question.id) {
        await tx.satisfactionSurveyQuestion.update({
          where: { id: question.id },
          data: {
            label: question.label,
            type: question.type,
            options: question.options,
            required: question.required,
            order: question.order,
            isActive: true
          }
        });
      } else {
        await tx.satisfactionSurveyQuestion.create({
          data: {
            label: question.label,
            type: question.type,
            options: question.options,
            required: question.required,
            order: question.order,
            isActive: true
          }
        });
      }
    }

    return tx.satisfactionSurveyQuestion.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' }
    });
  });

  res.json(saved.map(safeQuestion));
}));

router.post('/:projectId/send', requireAuth, requireManager, asyncHandler(async (req, res) => {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: req.params.projectId }
  });

  if (project.isActive !== false) {
    return res.status(400).json({ error: 'A pesquisa só pode ser enviada para projetos arquivados.' });
  }
  if (!String(project.clientEmailPrimary || '').trim()) {
    return res.status(400).json({ error: 'Informe o e-mail principal do cliente antes de enviar a pesquisa.' });
  }

  const { survey, token, reused } = await createOrReuseSurvey(project, req.auth.user.id);
  await sendSurveyInvite({ survey, project, token });

  res.status(reused ? 200 : 201).json({ survey: safeSurvey(survey), reused });
}));

router.post('/:surveyId/resend', requireAuth, requireManager, asyncHandler(async (req, res) => {
  const survey = await prisma.satisfactionSurvey.findUniqueOrThrow({
    where: { id: req.params.surveyId },
    include: { project: true, sentBy: true }
  });
  const status = responseStatus(survey);
  if (status === 'RESPONDED') {
    return res.status(400).json({ error: 'Pesquisas respondidas não podem ser reenviadas.' });
  }
  if (survey.project.isActive !== false) {
    return res.status(400).json({ error: 'A pesquisa só pode ser reenviada para projetos arquivados.' });
  }
  if (!String(survey.project.clientEmailPrimary || survey.emailTo || '').trim()) {
    return res.status(400).json({ error: 'Informe o e-mail principal do cliente antes de reenviar a pesquisa.' });
  }

  if (status === 'EXPIRED') {
    const { survey: newSurvey, token, reused } = await createOrReuseSurvey(survey.project, req.auth.user.id);
    await sendSurveyInvite({ survey: newSurvey, project: survey.project, token });
    return res.status(reused ? 200 : 201).json({ survey: safeSurvey(newSurvey), reused });
  }

  const questions = storedSurveyQuestions(survey) || await activeSurveyQuestionSnapshot();
  const token = decryptSurveyToken(encryptedTokenPayload(survey));
  await sendSurveyInvite({ survey, project: survey.project, token });
  const updated = await prisma.satisfactionSurvey.update({
    where: { id: survey.id },
    data: { sentAt: new Date(), emailTo: survey.project.clientEmailPrimary || survey.emailTo, questions, sentByUserId: req.auth.user.id },
    include: { project: true, sentBy: true }
  });
  res.json({ survey: safeSurvey(updated), reused: true });
}));

router.patch('/:surveyId/follow-up', requireAuth, requireManagerOrCoordinator, asyncHandler(async (req, res) => {
  const payload = followUpSchema.parse(req.body);
  const updated = await prisma.satisfactionSurvey.update({
    where: {
      id: req.params.surveyId,
      ...managerOnlyProjectFilter(req.auth.user.role)
    },
    data: {
      followUpStatus: payload.status || null,
      followUpNotes: payload.notes || null,
      followUpUpdatedAt: payload.status || payload.notes ? new Date() : null
    }
  });
  res.json(safeSurvey(updated));
}));

router.get('/dashboard', requireAuth, requireManagerOrCoordinator, asyncHandler(async (req, res) => {
  const reqYear = parseInt(req.query.year, 10);
  const year = Number.isFinite(reqYear) ? reqYear : new Date().getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const [yearSurveys, yearRows] = await Promise.all([
    prisma.satisfactionSurvey.findMany({
      where: {
        ...managerOnlyProjectFilter(req.auth.user.role),
        sentAt: { gte: yearStart, lt: yearEnd }
      },
      select: {
        id: true, sentAt: true, respondedAt: true, expiresAt: true,
        responses: true, questions: true,
        followUpStatus: true, followUpNotes: true, followUpUpdatedAt: true,
        project: { select: { code: true, name: true, clientName: true, operator: { select: { name: true } } } }
      }
    }),
    prisma.$queryRaw`SELECT DISTINCT EXTRACT(YEAR FROM "sentAt")::int AS year FROM "SatisfactionSurvey" ORDER BY year DESC`
  ]);

  const availableYears = yearRows.map(row => Number(row.year)).filter(Number.isFinite);
  if (!availableYears.includes(year)) availableYears.unshift(year);

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const monthSurveys = yearSurveys.filter(s => new Date(s.sentAt).getMonth() + 1 === month);
    const responded = monthSurveys.filter(s => s.respondedAt);

    const sums = {};
    const counts = {};
    const meta = {};

    for (const survey of responded) {
      const questions = Array.isArray(survey.questions) ? survey.questions : [];
      const responses = (survey.responses && typeof survey.responses === 'object' && !Array.isArray(survey.responses))
        ? survey.responses : {};

      for (const question of questions) {
        if (question.type === 'TEXT') continue;
        const value = responses[question.id];
        if (typeof value !== 'number') continue;
        if (!sums[question.id]) {
          sums[question.id] = 0;
          counts[question.id] = 0;
          meta[question.id] = { label: question.label, order: question.order ?? 0, type: question.type };
        }
        sums[question.id] += value;
        counts[question.id] += 1;
      }
    }

    const questionAverages = Object.keys(sums)
      .map(id => ({
        id,
        label: meta[id].label,
        order: meta[id].order,
        type: meta[id].type,
        avg: Math.round((sums[id] / counts[id]) * 100) / 100,
        count: counts[id]
      }))
      .sort((a, b) => a.order - b.order);

    const npsValues = [];
    for (const survey of responded) {
      const npsValue = surveyNpsValue(survey);
      if (npsValue !== null) npsValues.push(npsValue);
    }
    const npsPromoters = npsValues.filter(v => v >= 9).length;
    const npsDetractors = npsValues.filter(v => v <= 6).length;
    const npsTotal = npsValues.length;
    const npsScore = npsTotal > 0 ? Math.round(((npsPromoters - npsDetractors) / npsTotal) * 100) : null;
    const npsCounts = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i), 0]));
    for (const v of npsValues) npsCounts[String(v)]++;
    const npsDistribution = {
      promoters: npsPromoters,
      neutrals: npsTotal - npsPromoters - npsDetractors,
      detractors: npsDetractors,
      total: npsTotal,
      score: npsScore,
      counts: npsCounts
    };

    const surveys = monthSurveys.map(s => ({
      id: s.id,
      sentAt: s.sentAt,
      projectCode: s.project?.code || '',
      projectName: s.project?.name || '',
      clientName: s.project?.clientName || '',
      operatorName: s.project?.operator?.name || '',
      respondedAt: s.respondedAt,
      expiresAt: s.expiresAt,
      npsScore: surveyNpsValue(s),
      questionAnswers: questionAnswers(s),
      followUpStatus: s.followUpStatus,
      followUpNotes: s.followUpNotes,
      followUpUpdatedAt: s.followUpUpdatedAt
    }));

    return { month, sent: monthSurveys.length, responded: responded.length, questionAverages, npsDistribution, surveys };
  });

  res.json({ year, years: availableYears, months });
}));

router.get('/projects/:projectId', requireAuth, requireManagerOrCoordinator, asyncHandler(async (req, res) => {
  const items = await prisma.satisfactionSurvey.findMany({
    where: {
      ...managerOnlyProjectFilter(req.auth.user.role),
      projectId: req.params.projectId
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(items.map(safeSurvey));
}));

router.get('/', requireAuth, requireManagerOrCoordinator, asyncHandler(async (req, res) => {
  const items = await prisma.satisfactionSurvey.findMany({
    where: {
      ...managerOnlyProjectFilter(req.auth.user.role)
    },
    include: { project: true },
    orderBy: { createdAt: 'desc' }
  });
  const canViewResponses = ['MANAGER', 'COORDINATOR'].includes(req.auth.user.role);
  res.json(items.map(item => ({
    ...safeSurvey(item),
    ...(canViewResponses ? { responses: item.responses } : {}),
    project: item.project ? {
      id: item.project.id,
      code: item.project.code,
      name: item.project.name,
      clientName: item.project.clientName,
      isActive: item.project.isActive
    } : null
  })));
}));

router.get('/client/projects/:projectId/active-link', requireAuth, requireRdoClient, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'CLIENT') {
    return res.status(403).json({ error: 'Acesso restrito ao cliente.' });
  }
  const project = await prisma.project.findUniqueOrThrow({ where: { id: req.params.projectId } });
  if (!clientCanAccessProject(req.auth, project)) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar esta pesquisa.' });
  }
  const survey = await findActiveSurvey(project.id);
  if (!survey) return res.status(404).json({ error: 'Nenhuma pesquisa ativa encontrada.' });
  const token = decryptSurveyToken(encryptedTokenPayload(survey));
  res.json({ url: surveyResponseUrl(token), expiresAt: survey.expiresAt });
}));

router.get('/respond/:token', publicLimiter, asyncHandler(async (req, res) => {
  const survey = await surveyFromToken(req.params.token, { project: true });
  if (!survey) return res.json(publicSurveyPayload(survey));
  const questions = await questionsForSurvey(survey);
  res.json(publicSurveyPayload({ ...survey, questions }));
}));

router.post('/respond/:token', publicLimiter, asyncHandler(async (req, res) => {
  const survey = await surveyFromToken(req.params.token, { project: true, sentBy: true });
  const status = responseStatus(survey);
  if (status !== 'ACTIVE') {
    return res.status(status === 'INVALID' ? 404 : 400).json({ error: 'Pesquisa indisponível.', status });
  }

  const questions = await questionsForSurvey(survey);
  const privacyNoticeVersion = validateSurveyPrivacyNotice(req.body || {});
  const responses = validateSurveyResponses(req.body, questions);
  const now = new Date();

  // Atomic claim: only succeeds if the survey is still unanswered at write time,
  // preventing a race condition where two concurrent submissions both pass the
  // ACTIVE check above and the second overwrites the first.
  const claim = await prisma.satisfactionSurvey.updateMany({
    where: { id: survey.id, respondedAt: null, expiresAt: { gt: now } },
    data: {
      responses,
      questions,
      respondedAt: now,
      submittedIp: req.ip || req.socket?.remoteAddress || null,
      submittedUserAgent: String(req.headers['user-agent'] || '').slice(0, 500) || null,
      privacyNoticeAcceptedAt: privacyNoticeVersion ? now : null,
      privacyNoticeVersion
    }
  });

  if (claim.count !== 1) {
    return res.status(400).json({ error: 'Pesquisa indisponível.', status: 'RESPONDED' });
  }

  const updated = await prisma.satisfactionSurvey.findUnique({
    where: { id: survey.id },
    include: { project: true, sentBy: true }
  });

  notifySurveyResponded({ survey: updated, project: updated.project }).catch(error => {
    console.error('Falha ao notificar resposta de pesquisa.', { surveyId: survey.id, error: error?.message || error });
  });

  res.json({ success: true });
}));

async function optOut(req, res) {
  const survey = await surveyFromToken(req.params.token);
  if (survey && !survey.respondedAt) {
    await prisma.satisfactionSurvey.update({
      where: { id: survey.id },
      data: { reminderOptOutAt: new Date() }
    });
  }
  const wantsHtml = String(req.headers.accept || '').includes('text/html');
  if (wantsHtml && req.method === 'GET') {
    return res.type('html').send('<!doctype html><meta charset="utf-8"><title>Lembretes cancelados</title><p>Os lembretes desta pesquisa foram cancelados.</p>');
  }
  res.json({ success: true });
}

router.post('/reminders/:token/opt-out', publicLimiter, asyncHandler(optOut));
router.get('/reminders/:token/opt-out', publicLimiter, asyncHandler(optOut));

export default router;
