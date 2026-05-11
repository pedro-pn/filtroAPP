import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { hashToken } from '../../lib/auth.js';
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

const responseSchema = z.object({
  nps: z.number().int().min(0).max(10),
  serviceQuality: z.number().int().min(1).max(5),
  communication: z.number().int().min(1).max(5),
  deadlines: z.number().int().min(1).max(5),
  documentation: z.number().int().min(1).max(5),
  improvement: z.string().max(2000).optional().default(''),
  highlight: z.string().max(2000).optional().default('')
});

function requireManagerOrCoordinator(req, res, next) {
  if (!req.auth || !['MANAGER', 'COORDINATOR'].includes(req.auth.user.role)) {
    return res.status(403).json({ error: 'Acesso restrito ao gestor ou coordenador.' });
  }
  next();
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
  if (project?.clientCnpj === auth.user.username) return true;
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
    const updated = await prisma.satisfactionSurvey.update({
      where: { id: active.id },
      data: {
        emailTo: project.clientEmailPrimary,
        sentAt: new Date()
      },
      include: { project: true, sentBy: true }
    });
    return { survey: updated, token, reused: true };
  }

  const tokenData = surveyTokenData();
  const survey = await prisma.satisfactionSurvey.create({
    data: {
      projectId: project.id,
      tokenHash: tokenData.tokenHash,
      tokenEncrypted: tokenData.tokenEncrypted,
      tokenIv: tokenData.tokenIv,
      tokenAuthTag: tokenData.tokenAuthTag,
      emailTo: project.clientEmailPrimary,
      expiresAt: expiresAt(),
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
      project: {
        code: survey.project?.code || '',
        name: survey.project?.name || '',
        clientName: survey.project?.clientName || ''
      }
    }
  };
}

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
  const token = decryptSurveyToken(encryptedTokenPayload(survey));
  await sendSurveyInvite({ survey, project: survey.project, token });
  const updated = await prisma.satisfactionSurvey.update({
    where: { id: survey.id },
    data: { sentAt: new Date(), emailTo: survey.project.clientEmailPrimary || survey.emailTo },
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

router.get('/', requireAuth, requireManagerOrCoordinator, asyncHandler(async (_req, res) => {
  const items = await prisma.satisfactionSurvey.findMany({
    include: { project: true },
    orderBy: { createdAt: 'desc' }
  });
  res.json(items.map(item => ({
    ...safeSurvey(item),
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
  res.json(publicSurveyPayload(survey));
}));

router.post('/respond/:token', publicLimiter, asyncHandler(async (req, res) => {
  const survey = await surveyFromToken(req.params.token, { project: true, sentBy: true });
  const status = responseStatus(survey);
  if (status !== 'ACTIVE') {
    return res.status(status === 'INVALID' ? 404 : 400).json({ error: 'Pesquisa indisponível.', status });
  }

  const responses = responseSchema.parse(req.body);
  const updated = await prisma.satisfactionSurvey.update({
    where: { id: survey.id },
    data: {
      responses,
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
