import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import env from '../../config/env.js';
import { createPasswordResetToken, createSession, hashToken, publicUser } from '../../lib/auth.js';
import { ensureClientAccountForCnpj } from '../../lib/client-account.js';
import { normalizeCnpj } from '../../lib/cnpj.js';
import { buildPasswordResetEmailTemplate } from '../../lib/email-templates.js';
import { getMissingMailerConfig, sendMail } from '../../lib/mailer.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import prisma from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  rememberMe: z.boolean().optional()
});
const forgotPasswordSchema = z.object({
  identifier: z.string().min(1)
});
const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6)
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6)
});
const accountSchema = z.object({
  email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional()
});

function resetUrlForToken(token) {
  const base = String(env.appUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

function passwordResetSuccessMessage(res) {
  res.json({
    ok: true,
    message: 'Se houver uma conta correspondente, o link de recuperação será enviado.'
  });
}

async function findPasswordResetToken(token) {
  const tokenHash = hashToken(token);
  return prisma.passwordResetToken.findUnique({
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

async function findLoginCandidates(identifier) {
  const rawIdentifier = String(identifier || '').trim();
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
    include: { collaborator: true }
  });

  const exactUsername = user => usernameCandidates.some(candidate => (
    String(user.username || '').toLowerCase() === String(candidate).toLowerCase()
  ));
  const exactEmail = user => (
    rawIdentifier.includes('@')
      && String(user.email || '').toLowerCase() === rawIdentifier.toLowerCase()
  );

  return users.sort((a, b) => {
    const usernameDelta = Number(exactUsername(b)) - Number(exactUsername(a));
    if (usernameDelta) return usernameDelta;
    const emailDelta = Number(exactEmail(b)) - Number(exactEmail(a));
    if (emailDelta) return emailDelta;
    return a.createdAt - b.createdAt;
  });
}

router.post('/login', asyncHandler(async (req, res) => {
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

router.post('/forgot-password', asyncHandler(async (req, res) => {
  const data = forgotPasswordSchema.parse(req.body);
  const rawIdentifier = String(data.identifier || '').trim();
  const normalizedIdentifier = normalizeCnpj(rawIdentifier);

  if (!rawIdentifier) return passwordResetSuccessMessage(res);

  let user = null;
  let emails = [];

  if (rawIdentifier.includes('@')) {
    user = await prisma.user.findFirst({
      where: { email: { equals: rawIdentifier.toLowerCase(), mode: 'insensitive' } }
    });
    if (user?.email) emails = [user.email];
  } else if (normalizedIdentifier.length === 14) {
    user = await prisma.user.findFirst({
      where: { username: { equals: normalizedIdentifier, mode: 'insensitive' } }
    });
    if (!user) {
      const ensured = await ensureClientAccountForCnpj(prisma, normalizedIdentifier, { notify: false });
      user = ensured.user;
    }
    if (user) {
      const projects = await prisma.project.findMany({
        where: { clientCnpj: normalizedIdentifier },
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

router.post('/reset-password', asyncHandler(async (req, res) => {
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
  const user = await prisma.user.update({
    where: { id: req.auth.user.id },
    data: {
      ...(data.email !== undefined ? { email: data.email ? data.email.toLowerCase() : null } : {})
    },
    include: { collaborator: true }
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
