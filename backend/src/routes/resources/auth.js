import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import env from '../../config/env.js';
import { createEmailChangeToken, createPasswordResetToken, createSession, hashToken, publicUser } from '../../lib/auth.js';
import { normalizeCnpj } from '../../lib/cnpj.js';
import { buildEmailChangeConfirmationTemplate, buildPasswordResetEmailTemplate } from '../../lib/email-templates.js';
import { getMissingMailerConfig, sendMail } from '../../lib/mailer.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';
import {
  consumeNotificationPreferenceToken,
  findNotificationPreferenceToken,
  notificationPreferenceData,
  notificationPreferences,
  notificationPreferenceTokenStatus
} from '../../lib/notification-preferences.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { CLIENT_PRIVACY_NOTICE_VERSION } from '../../lib/privacy-consent.js';
import prisma from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();
const EMAIL_CHANGE_TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const loginSchema = z.object({
  username: z.string().min(1, 'Informe o usuário.'),
  password: z.string().min(1, 'Informe a senha.'),
  rememberMe: z.boolean().optional()
});
const forgotPasswordSchema = z.object({
  identifier: z.string().min(1, 'Informe o usuário, e-mail ou CNPJ.')
});
const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token obrigatório.'),
  password: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres.')
});
const emailChangeTokenSchema = z.object({
  token: z.string().min(1, 'Token obrigatório.')
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual.'),
  newPassword: z.string().min(6, 'A nova senha deve ter pelo menos 6 caracteres.')
});
const accountSchema = z.object({
  email: z.union([z.string().trim().email('Informe um e-mail válido.'), z.literal(''), z.null()]).optional(),
  notificationPreferences: z.object({
    reports: z.boolean(),
    signatures: z.boolean(),
    signatureReminders: z.boolean().optional().default(true),
    surveyReminders: z.boolean()
  }).optional()
});
const notificationPreferenceSchema = z.object({
  reports: z.boolean(),
  signatures: z.boolean(),
  signatureReminders: z.boolean().optional().default(true),
  surveyReminders: z.boolean()
});
const clientPrivacyConsentSchema = z.object({
  privacyNoticeAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Aceite o termo de privacidade para continuar.' })
  }),
  privacyNoticeVersion: z.literal(CLIENT_PRIVACY_NOTICE_VERSION)
});

function resetUrlForToken(token) {
  const base = String(env.appUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

function emailChangeConfirmUrlForToken(token) {
  const base = String(env.appUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/confirmar-email?token=${encodeURIComponent(token)}`;
}

function passwordResetSuccessMessage(res) {
  res.json({
    ok: true,
    message: 'Se houver uma conta correspondente, o link de recuperação será enviado.'
  });
}

function isUniqueConstraintError(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code === 'P2002'
    : error?.code === 'P2002' || error?.code === '23505';
}

function accountEmailConflictError() {
  const error = new Error('Já existe uma conta cadastrada para este e-mail.');
  error.status = 409;
  return error;
}

function authRateLimitIdentifier(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'missing';
  const normalizedCnpj = normalizeCnpj(raw);
  return normalizedCnpj.length === 14 ? normalizedCnpj : raw;
}

function authRateLimitIp(req) {
  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

const loginRateLimit = createMemoryRateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 8,
  message: 'Muitas tentativas de login. Tente novamente mais tarde.',
  keyGenerator: req => `${authRateLimitIp(req)}:login:${authRateLimitIdentifier(req.body?.username)}`
});

const forgotPasswordRateLimit = createMemoryRateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 5,
  message: 'Muitas tentativas de recuperação de senha. Tente novamente mais tarde.',
  keyGenerator: req => `${authRateLimitIp(req)}:forgot-password:${authRateLimitIdentifier(req.body?.identifier)}`
});

const resetPasswordRateLimit = createMemoryRateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 8,
  message: 'Muitas tentativas de redefinição de senha. Tente novamente mais tarde.',
  keyGenerator: req => `${authRateLimitIp(req)}:reset-password:${hashToken(String(req.body?.token || '').trim())}`
});

async function findPasswordResetToken(token) {
  const tokenHash = hashToken(token);
  return prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });
}

async function findEmailChangeToken(token) {
  const tokenHash = hashToken(token);
  return prisma.emailChangeToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });
}

function passwordResetTokenStatus(tokenRow) {
  if (!tokenRow) return { valid: false, expired: false, used: false };
  const expired = tokenRow.expiresAt <= new Date();
  const used = !!tokenRow.usedAt;
  const activeUser = !!tokenRow.user?.isActive;
  return {
    valid: !expired && !used && activeUser,
    expired,
    used
  };
}

function emailChangeTokenStatus(tokenRow) {
  if (!tokenRow) return { valid: false, expired: false, used: false };
  const now = new Date();
  const createdAt = tokenRow.createdAt ? new Date(tokenRow.createdAt) : null;
  const maxAgeExpired = createdAt && !Number.isNaN(createdAt.getTime())
    ? now.getTime() - createdAt.getTime() > EMAIL_CHANGE_TOKEN_MAX_AGE_MS
    : false;
  const expired = tokenRow.expiresAt <= now || maxAgeExpired;
  const used = !!tokenRow.usedAt;
  const activeUser = !!tokenRow.user?.isActive;
  return {
    valid: !expired && !used && activeUser,
    expired,
    used
  };
}

function normalizeAccountEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmailLikeUsername(value) {
  return normalizeAccountEmail(value).includes('@');
}

function parseClientSigner(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? value : null;
}

function replaceProjectEmailLinks(project, oldEmails, nextEmail) {
  const normalizedOldEmails = new Set((Array.isArray(oldEmails) ? oldEmails : [oldEmails])
    .map(normalizeAccountEmail)
    .filter(Boolean));
  const normalizedNext = normalizeAccountEmail(nextEmail);
  const data = {};
  normalizedOldEmails.delete(normalizedNext);
  if (!normalizedOldEmails.size || !normalizedNext) return data;

  let nextPrimary = project.clientEmailPrimary || '';
  if (normalizedOldEmails.has(normalizeAccountEmail(nextPrimary))) {
    nextPrimary = normalizedNext;
    data.clientEmailPrimary = normalizedNext;
  }

  if (Array.isArray(project.clientEmailCc)) {
    const nextCc = [];
    let ccChanged = false;
    for (const email of project.clientEmailCc) {
      const normalizedEmail = normalizeAccountEmail(email);
      const value = normalizedOldEmails.has(normalizedEmail) ? normalizedNext : normalizedEmail;
      if (normalizedOldEmails.has(normalizedEmail) || value !== email) ccChanged = true;
      if (value && value !== normalizeAccountEmail(nextPrimary) && !nextCc.includes(value)) {
        nextCc.push(value);
      }
    }
    if (ccChanged || nextCc.length !== project.clientEmailCc.length) {
      data.clientEmailCc = nextCc;
    }
  }

  if (Array.isArray(project.clientSigners)) {
    const seenSignerEmails = new Set();
    const nextSigners = [];
    let signerChanged = false;
    for (const rawSigner of project.clientSigners) {
      const signer = parseClientSigner(rawSigner);
      if (!signer) {
        nextSigners.push(rawSigner);
        continue;
      }
      const normalizedEmail = normalizeAccountEmail(signer.email);
      const signerEmail = normalizedOldEmails.has(normalizedEmail) ? normalizedNext : normalizedEmail;
      if (normalizedOldEmails.has(normalizedEmail) || signerEmail !== signer.email) signerChanged = true;
      if (!signerEmail || signerEmail === normalizeAccountEmail(nextPrimary) || seenSignerEmails.has(signerEmail)) {
        signerChanged = true;
        continue;
      }
      seenSignerEmails.add(signerEmail);
      nextSigners.push({
        ...signer,
        email: signerEmail
      });
    }
    if (signerChanged) {
      data.clientSigners = nextSigners;
    }
  }

  return data;
}

async function migrateClientProjectEmailLinks(tx, oldEmails, nextEmail) {
  const normalizedOldEmails = new Set((Array.isArray(oldEmails) ? oldEmails : [oldEmails])
    .map(normalizeAccountEmail)
    .filter(Boolean));
  const normalizedNext = normalizeAccountEmail(nextEmail);
  normalizedOldEmails.delete(normalizedNext);
  if (!normalizedOldEmails.size || !normalizedNext || typeof tx.project?.findMany !== 'function') {
    return 0;
  }

  const projects = await tx.project.findMany({
    select: {
      id: true,
      clientEmailPrimary: true,
      clientEmailCc: true,
      clientSigners: true
    }
  });
  let updatedCount = 0;
  for (const project of projects) {
    const data = replaceProjectEmailLinks(project, Array.from(normalizedOldEmails), normalizedNext);
    if (!Object.keys(data).length) continue;
    await tx.project.update({
      where: { id: project.id },
      data
    });
    updatedCount += 1;
  }
  return updatedCount;
}

async function findAccountEmailConflict(email, currentUserId) {
  const normalizedEmail = normalizeAccountEmail(email);
  if (!normalizedEmail) return null;
  return prisma.user.findFirst({
    where: {
      id: { not: currentUserId },
      OR: [
        { username: { equals: normalizedEmail, mode: 'insensitive' } },
        { email: { equals: normalizedEmail, mode: 'insensitive' } }
      ]
    },
    select: { id: true }
  });
}

async function queuePasswordResetEmail({ user, emails }) {
  const uniqueEmails = Array.from(new Set((emails || []).map(email => String(email || '').trim().toLowerCase()).filter(Boolean)));
  if (!uniqueEmails.length) return;
  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length || !env.appUrl) {
    console.warn('Recuperação de senha não enviada por falta de configuração SMTP/APP_URL.', {
      missingMailerConfig,
      hasAppUrl: !!env.appUrl
    });
    return;
  }

  const { token, expiresAt } = await createPasswordResetToken(user.id);
  const resetUrl = resetUrlForToken(token);
  const template = buildPasswordResetEmailTemplate({
    userName: user.name || user.username,
    resetUrl,
    expiresLabel: '1 hora'
  });

  setImmediate(() => {
    sendMail({
      to: uniqueEmails[0],
      ...(uniqueEmails.length > 1 ? { cc: uniqueEmails.slice(1) } : {}),
      ...template
    }).catch(error => {
      console.error('Falha ao enviar e-mail de recuperação de senha.', {
        userId: user.id,
        expiresAt,
        error: error?.message || error
      });
    });
  });
}

async function queueEmailChangeConfirmationEmail({ user, email }) {
  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length || !env.appUrl) {
    const error = new Error('Não foi possível enviar a confirmação de e-mail no momento.');
    error.status = 503;
    error.details = {
      missingMailerConfig,
      hasAppUrl: !!env.appUrl
    };
    throw error;
  }

  await prisma.emailChangeToken.deleteMany({
    where: {
      userId: user.id,
      usedAt: null
    }
  });

  const { token, expiresAt } = await createEmailChangeToken(user.id, email);
  const confirmUrl = emailChangeConfirmUrlForToken(token);
  const template = buildEmailChangeConfirmationTemplate({
    userName: user.name || user.username,
    email,
    confirmUrl,
    expiresLabel: '1 hora'
  });

  setImmediate(() => {
    sendMail({
      to: email,
      ...template
    }).catch(error => {
      console.error('Falha ao enviar confirmação de troca de e-mail.', {
        userId: user.id,
        email,
        expiresAt,
        error: error?.message || error
      });
    });
  });

  return { expiresAt };
}

async function findLoginCandidates(identifier) {
  const rawIdentifier = String(identifier || '').trim();
  const normalizedEmailIdentifier = rawIdentifier.toLowerCase();
  const normalizedIdentifier = normalizeCnpj(rawIdentifier);
  const usernameCandidates = Array.from(new Set([
    rawIdentifier,
    normalizedIdentifier.length === 14 ? normalizedIdentifier : ''
  ].filter(Boolean)));

  const users = await prisma.user.findMany({
    where: {
      OR: [
        ...usernameCandidates.map(candidate => ({ username: { equals: candidate, mode: 'insensitive' } })),
        { email: { equals: rawIdentifier.toLowerCase(), mode: 'insensitive' } }
      ]
    },
    include: { collaborator: true, moduleRoles: true }
  });

  const exactUsername = user => usernameCandidates.some(candidate => (
    String(user.username || '').toLowerCase() === String(candidate).toLowerCase()
  ));
  const exactEmail = user => (
    rawIdentifier.includes('@')
      && String(user.email || '').toLowerCase() === normalizedEmailIdentifier
  );

  let filteredUsers = users;
  if (rawIdentifier.includes('@')) {
    const clientEmailMatches = users.filter(user => (
      user.role === 'CLIENT'
      && String(user.email || '').toLowerCase() === normalizedEmailIdentifier
    ));
    if (clientEmailMatches.length > 1) {
      const canonicalClient = clientEmailMatches.slice().sort((a, b) => {
        const usernameDelta = Number(String(b.username || '').toLowerCase() === normalizedEmailIdentifier)
          - Number(String(a.username || '').toLowerCase() === normalizedEmailIdentifier);
        if (usernameDelta) return usernameDelta;
        const activeDelta = Number(b.isActive) - Number(a.isActive);
        if (activeDelta) return activeDelta;
        return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
      })[0];
      filteredUsers = users.filter(user => (
        user.role !== 'CLIENT'
        || String(user.email || '').toLowerCase() !== normalizedEmailIdentifier
        || user.id === canonicalClient.id
      ));
    }
  }

  return filteredUsers.sort((a, b) => {
    const usernameDelta = Number(exactUsername(b)) - Number(exactUsername(a));
    if (usernameDelta) return usernameDelta;
    const emailDelta = Number(exactEmail(b)) - Number(exactEmail(a));
    if (emailDelta) return emailDelta;
    return a.createdAt - b.createdAt;
  });
}

router.post('/login', loginRateLimit, asyncHandler(async (req, res) => {
  const data = loginSchema.parse(req.body);
  const candidates = await findLoginCandidates(data.username);
  let user = null;

  for (const candidate of candidates) {
    if (!candidate?.isActive) continue;
    const valid = await verifyPassword(data.password, candidate.passwordHash);
    if (valid) {
      user = candidate;
      break;
    }
  }

  if (!user) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }

  const session = await createSession(user.id, { rememberMe: !!data.rememberMe });

  res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: publicUser(user)
  });
}));

router.post('/forgot-password', forgotPasswordRateLimit, asyncHandler(async (req, res) => {
  const data = forgotPasswordSchema.parse(req.body);
  const rawIdentifier = String(data.identifier || '').trim();
  const normalizedIdentifier = normalizeCnpj(rawIdentifier);

  if (!rawIdentifier) return passwordResetSuccessMessage(res);

  let user = null;
  let emails = [];

  if (rawIdentifier.includes('@')) {
    user = await prisma.user.findFirst({
      where: { username: { equals: rawIdentifier.toLowerCase(), mode: 'insensitive' } }
    });
    if (!user) {
      user = await prisma.user.findFirst({
        where: { email: { equals: rawIdentifier.toLowerCase(), mode: 'insensitive' } },
        orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'asc' }]
      });
    }
    if (user?.email) emails = [user.email];
  } else if (normalizedIdentifier.length === 14) {
    user = await prisma.user.findFirst({
      where: {
        username: { equals: normalizedIdentifier, mode: 'insensitive' },
        role: 'CLIENT',
        isActive: true
      }
    });
    if (user) {
      const projects = await prisma.project.findMany({
        where: {
          clientCnpj: normalizedIdentifier,
          deletedAt: null,
          managerOnly: false,
          isActive: true
        },
        select: { clientEmailPrimary: true }
      });
      emails = Array.from(new Set(projects.map(project => project.clientEmailPrimary).filter(Boolean)));
    }
  } else {
    user = await prisma.user.findFirst({
      where: { username: { equals: rawIdentifier, mode: 'insensitive' } }
    });
    if (user?.email) emails = [user.email];
  }

  if (user && user.isActive && emails.length) {
    await prisma.passwordResetToken.deleteMany({
      where: {
        userId: user.id,
        usedAt: null
      }
    });
    await queuePasswordResetEmail({ user, emails });
  }

  passwordResetSuccessMessage(res);
}));

router.get('/reset-password-status', asyncHandler(async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    return res.status(400).json({ error: 'Token ausente.' });
  }

  const tokenRow = await findPasswordResetToken(token);
  res.json(passwordResetTokenStatus(tokenRow));
}));

router.post('/reset-password', resetPasswordRateLimit, asyncHandler(async (req, res) => {
  const data = resetPasswordSchema.parse(req.body);
  const tokenRow = await findPasswordResetToken(data.token);
  const status = passwordResetTokenStatus(tokenRow);

  if (!status.valid) {
    return res.status(400).json({ error: 'Token inválido, expirado ou já utilizado.' });
  }

  const passwordHash = await hashPassword(data.password);
  const consumedAt = new Date();

  await prisma.$transaction(async tx => {
    const consume = await tx.passwordResetToken.updateMany({
      where: {
        id: tokenRow.id,
        usedAt: null,
        expiresAt: { gt: consumedAt }
      },
      data: { usedAt: consumedAt }
    });

    if (consume.count !== 1) {
      const error = new Error('Token inválido, expirado ou já utilizado.');
      error.status = 400;
      throw error;
    }

    await tx.user.update({
      where: { id: tokenRow.userId },
      data: { passwordHash }
    });
  });

  res.json({ ok: true });
}));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const data = changePasswordSchema.parse(req.body);
  const currentUser = await prisma.user.findUniqueOrThrow({
    where: { id: req.auth.user.id }
  });
  const valid = await verifyPassword(data.currentPassword, currentUser.passwordHash);
  if (!valid) {
    return res.status(400).json({ error: 'Senha atual inválida.' });
  }

  const passwordHash = await hashPassword(data.newPassword);
  await prisma.user.update({
    where: { id: currentUser.id },
    data: { passwordHash }
  });

  res.json({ ok: true });
}));

router.put('/account', requireAuth, asyncHandler(async (req, res) => {
  const data = accountSchema.parse(req.body);
  let currentUser = await prisma.user.findUniqueOrThrow({
    where: { id: req.auth.user.id },
    include: { collaborator: true, moduleRoles: true }
  });

  if (data.notificationPreferences) {
    currentUser = await prisma.user.update({
      where: { id: currentUser.id },
      data: notificationPreferenceData(data.notificationPreferences),
      include: { collaborator: true, moduleRoles: true }
    });
    if (data.email === undefined) {
      return res.json({ user: publicUser(currentUser) });
    }
  }

  if (data.email === undefined) {
    return res.json({ user: publicUser(currentUser) });
  }

  const nextEmail = data.email ? normalizeAccountEmail(data.email) : '';
  if (!nextEmail) {
    return res.status(400).json({ error: 'Informe um e-mail válido para confirmar a alteração.' });
  }

  const currentEmail = normalizeAccountEmail(currentUser.email);
  if (currentEmail === nextEmail && currentUser.emailVerifiedAt) {
    return res.json({ user: publicUser(currentUser), emailChangePending: false });
  }

  const conflict = await findAccountEmailConflict(nextEmail, currentUser.id);
  if (conflict) {
    return res.status(409).json({ error: 'Já existe uma conta cadastrada para este e-mail.' });
  }

  const { expiresAt } = await queueEmailChangeConfirmationEmail({
    user: currentUser,
    email: nextEmail
  });

  res.status(202).json({
    user: publicUser(currentUser),
    emailChangePending: true,
    pendingEmail: nextEmail,
    expiresAt,
    message: 'Enviamos um link de confirmação para o novo e-mail.'
  });
}));

router.get('/notification-preferences/:token', asyncHandler(async (req, res) => {
  const token = String(req.params.token || '').trim();
  const tokenRow = await findNotificationPreferenceToken(token);
  const status = notificationPreferenceTokenStatus(tokenRow);
  res.json({
    ...status,
    userName: status.valid ? tokenRow.user.name : '',
    email: status.valid ? tokenRow.user.email || tokenRow.user.username : '',
    preferences: status.valid ? notificationPreferences(tokenRow.user) : null
  });
}));

router.put('/notification-preferences/:token', asyncHandler(async (req, res) => {
  const token = String(req.params.token || '').trim();
  const preferences = notificationPreferenceSchema.parse(req.body || {});
  const user = await consumeNotificationPreferenceToken(token, preferences);
  res.json({
    ok: true,
    preferences: notificationPreferences(user)
  });
}));

router.get('/email-change-status', asyncHandler(async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    return res.status(400).json({ error: 'Token ausente.' });
  }

  const tokenRow = await findEmailChangeToken(token);
  const status = emailChangeTokenStatus(tokenRow);
  res.json({
    ...status,
    email: status.valid ? tokenRow.email : null
  });
}));

router.post('/confirm-email-change', asyncHandler(async (req, res) => {
  const data = emailChangeTokenSchema.parse(req.body);
  const tokenRow = await findEmailChangeToken(data.token);
  const status = emailChangeTokenStatus(tokenRow);

  if (!status.valid) {
    return res.status(400).json({ error: 'Token inválido, expirado ou já utilizado.' });
  }

  const nextEmail = normalizeAccountEmail(tokenRow.email);
  if (!nextEmail) {
    return res.status(400).json({ error: 'Token inválido, expirado ou já utilizado.' });
  }

  const conflict = await findAccountEmailConflict(nextEmail, tokenRow.userId);
  if (conflict) {
    return res.status(409).json({ error: 'Já existe uma conta cadastrada para este e-mail.' });
  }

  const confirmedAt = new Date();
  let user;
  try {
    user = await prisma.$transaction(async tx => {
      const consume = await tx.emailChangeToken.updateMany({
        where: {
          id: tokenRow.id,
          usedAt: null,
          expiresAt: { gt: confirmedAt }
        },
        data: { usedAt: confirmedAt }
      });

      if (consume.count !== 1) {
        const error = new Error('Token inválido, expirado ou já utilizado.');
        error.status = 400;
        throw error;
      }

      const txConflict = await tx.user.findFirst({
        where: {
          id: { not: tokenRow.userId },
          OR: [
            { username: { equals: nextEmail, mode: 'insensitive' } },
            { email: { equals: nextEmail, mode: 'insensitive' } }
          ]
        },
        select: { id: true }
      });
      if (txConflict) {
        throw accountEmailConflictError();
      }

      const currentUsername = normalizeAccountEmail(tokenRow.user.username);
      const currentEmail = normalizeAccountEmail(tokenRow.user.email);
      const shouldUpdateUsername = isEmailLikeUsername(currentUsername);
      const migrationSources = Array.from(new Set([
        currentEmail,
        shouldUpdateUsername ? currentUsername : ''
      ].filter(email => email && email !== nextEmail)));

      if (tokenRow.user.role === 'CLIENT' && tokenRow.user.accountType === 'CLIENT') {
        await migrateClientProjectEmailLinks(tx, migrationSources, nextEmail);
      }

      return tx.user.update({
        where: { id: tokenRow.userId },
        data: {
          ...(shouldUpdateUsername ? { username: nextEmail } : {}),
          email: nextEmail,
          emailVerifiedAt: confirmedAt
        },
        include: { collaborator: true, moduleRoles: true }
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw accountEmailConflictError();
    }
    throw error;
  }

  res.json({ ok: true, user: publicUser(user) });
}));

router.post('/client-privacy-consent', requireAuth, asyncHandler(async (req, res) => {
  const data = clientPrivacyConsentSchema.parse(req.body || {});
  if (req.auth.user.accountType !== 'CLIENT' && req.auth.user.role !== 'CLIENT') {
    return res.status(403).json({ error: 'Aceite disponível apenas para contas de cliente.' });
  }

  const user = await prisma.user.update({
    where: { id: req.auth.user.id },
    data: {
      privacyPolicyAcceptedAt: new Date(),
      privacyPolicyVersion: data.privacyNoticeVersion
    },
    include: { collaborator: true, moduleRoles: true }
  });

  res.json({ user: publicUser(user) });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.auth.user });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await prisma.userSession.deleteMany({
    where: { id: req.auth.sessionId }
  });

  res.status(204).end();
}));

export default router;
