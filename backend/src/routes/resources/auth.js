import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import env from '../../config/env.js';
import { createPasswordResetToken, createSession, hashToken, publicUser } from '../../lib/auth.js';
import { normalizeCnpj } from '../../lib/cnpj.js';
import { buildPasswordResetEmailTemplate } from '../../lib/email-templates.js';
import { getMissingMailerConfig, sendMail } from '../../lib/mailer.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import prisma from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
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
    message: 'Se houver uma conta correspondente, o link de recuperacao sera enviado.'
  });
}

async function queuePasswordResetEmail({ user, emails }) {
  const uniqueEmails = Array.from(new Set((emails || []).map(email => String(email || '').trim().toLowerCase()).filter(Boolean)));
  if (!uniqueEmails.length) return;
  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length || !env.appUrl) {
    console.warn('Recuperacao de senha nao enviada por falta de configuracao SMTP/APP_URL.', {
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
      console.error('Falha ao enviar e-mail de recuperacao de senha.', {
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
    return res.status(401).json({ error: 'Usuario ou senha invalidos.' });
  }

  const session = await createSession(user.id);

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

router.post('/reset-password', asyncHandler(async (req, res) => {
  const data = resetPasswordSchema.parse(req.body);
  const tokenHash = hashToken(data.token);

  const tokenRow = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt <= new Date() || !tokenRow.user?.isActive) {
    return res.status(400).json({ error: 'Token invalido, expirado ou ja utilizado.' });
  }

  const passwordHash = await hashPassword(data.password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: tokenRow.userId },
      data: { passwordHash }
    }),
    prisma.passwordResetToken.update({
      where: { id: tokenRow.id },
      data: { usedAt: new Date() }
    })
  ]);

  res.json({ ok: true });
}));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const data = changePasswordSchema.parse(req.body);
  const currentUser = await prisma.user.findUniqueOrThrow({
    where: { id: req.auth.user.id }
  });
  const valid = await verifyPassword(data.currentPassword, currentUser.passwordHash);
  if (!valid) {
    return res.status(400).json({ error: 'Senha atual invalida.' });
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
