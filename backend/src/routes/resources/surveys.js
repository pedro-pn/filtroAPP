import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { hashToken } from '../../lib/auth.js';
import { normalizeCnpj } from '../../lib/cnpj.js';
import prisma from '../../lib/prisma.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';
import {
  notifySurveyResponded,
  safeSurvey,
  sendSurveyInvite,
  surveyResponseUrl
} from '../../lib/survey-mail.js';
import { decryptSurveyToken, surveyTokenData } from '../../lib/survey-token.js';
import { requireAuth, requireManager } from '../../middleware/auth.js';

const router = Router();
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

function requireManagerOrCoordinator(req, res, next) {
  if (!req.auth || !['MANAGER', 'COORDINATOR'].includes(req.auth.user.role)) {
    return res.status(403).json({ error: 'Acesso restrito ao gestor ou coordenador.' });
  }
  next();
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

function clientCanAccessProject(auth, project) {
  if (project?.managerOnly) return false;
  if (project?.clientCnpj === normalizeCnpj(auth.user.username)) return true;
  const userEmail = String(auth.user.email || '').trim().toLowerCase();
  if (!userEmail) return false;
  if (String(project?.clientEmailPrimary || '').trim().toLowerCase() === userEmail) return true;
  return Array.isArray(project?.clientEmailCc)
    && project.clientEmailCc.some(cc => String(cc || '').trim().toLowerCase() === userEmail);
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
  if (responseStatus(survey) !== 'ACTIVE') {
    return res.status(400).json({ error: 'Apenas pesquisas ativas podem ser reenviadas.' });
  }
  const questions = storedSurveyQuestions(survey) || await activeSurveyQuestionSnapshot();
  const token = decryptSurveyToken(encryptedTokenPayload(survey));
  await sendSurveyInvite({ survey, project: survey.project, token });
  const updated = await prisma.satisfactionSurvey.update({
    where: { id: survey.id },
    data: { sentAt: new Date(), emailTo: survey.project.clientEmailPrimary || survey.emailTo, questions },
    include: { project: true, sentBy: true }
  });
  res.json({ survey: safeSurvey(updated), reused: true });
}));

router.get('/projects/:projectId', requireAuth, requireManagerOrCoordinator, asyncHandler(async (req, res) => {
  const items = await prisma.satisfactionSurvey.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { createdAt: 'desc' }
  });
  res.json(items.map(safeSurvey));
}));

router.get('/', requireAuth, requireManagerOrCoordinator, asyncHandler(async (req, res) => {
  const now = new Date();
  const items = await prisma.satisfactionSurvey.findMany({
    where: {
      OR: [
        { respondedAt: { not: null } },
        { respondedAt: null, expiresAt: { gt: now } }
      ]
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

router.get('/client/projects/:projectId/active-link', requireAuth, asyncHandler(async (req, res) => {
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
  const responses = validateSurveyResponses(req.body, questions);
  const updated = await prisma.satisfactionSurvey.update({
    where: { id: survey.id },
    data: {
      responses,
      questions,
      respondedAt: new Date(),
      submittedIp: req.ip || req.socket?.remoteAddress || null,
      submittedUserAgent: String(req.headers['user-agent'] || '').slice(0, 500) || null
    },
    include: { project: true, sentBy: true }
  });

  notifySurveyResponded({ survey: updated, project: updated.project }).catch(error => {
    console.error('Falha ao notificar resposta de pesquisa.', { surveyId: updated.id, error: error?.message || error });
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
