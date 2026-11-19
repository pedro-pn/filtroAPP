import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { recordLoginFailure } from '../../lib/abuse/monitor.js';
import asyncHandler from '../../lib/async-handler.js';
import env from '../../config/env.js';
import {
  ACCOUNT_PASSWORD_SETUP_EXPIRES_LABEL,
  issueAccountPasswordSetup
} from '../../lib/accounts/password-setup.js';
import { createEmailChangeToken, createPasswordResetToken, createSession, hashToken, publicUser } from '../../lib/auth.js';
import { normalizeCnpj } from '../../lib/cnpj.js';
import {
  buildEmailChangeConfirmationTemplate,
  buildInternalUserWelcomeEmailTemplate,
  buildPasswordResetEmailTemplate
} from '../../lib/email-templates.js';
import { getMissingMailerConfig, sendClientMail, sendMail } from '../../lib/mailer.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';
import {
  consumeNotificationPreferenceToken,
  findNotificationPreferenceToken,
  notificationPreferenceData,
  notificationPreferences,
  notificationPreferenceTokenStatus
} from '../../lib/notification-preferences.js';
import { hashPassword, PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE, verifyPassword } from '../../lib/password.js';
import { CLIENT_PRIVACY_NOTICE_VERSION } from '../../lib/privacy-consent.js';
import prisma from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  bearerSessionAllowed,
  clearSessionCookie,
  requestCookie,
  setSessionCookie,
  setTrustedDeviceCookie,
  TRUSTED_DEVICE_COOKIE
} from '../../lib/accounts/session-cookie.js';
import {
  consumeTwoFactorBypass,
  createTwoFactorChallenge,
  deliverTwoFactorCode,
  findOpenChallenge,
  issueTrustedDevice,
  logAuthSecurityEvent,
  maskEmail,
  refreshTwoFactorChallenge,
  revokeTrustedDevices,
  TRUSTED_DEVICE_DAYS,
  TwoFactorRequirement,
  twoFactorChallengeNeeded,
  twoFactorRequirement,
  twoFactorStatusForUser,
  validateTrustedDevice,
  verifyTwoFactorChallenge
} from '../../lib/accounts/two-factor.js';

const router = Router();
const EMAIL_CHANGE_TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Hash "dummy" calculado uma vez no carregamento do módulo. Serve para rodar um
// scrypt de custo equivalente quando o usuário informado não existe, mantendo o
// tempo de resposta do login constante (mitiga enumeração por timing — CWE-208).
const dummyPasswordHashPromise = hashPassword('constant-time-login-guard');

const loginSchema = z.object({
  username: z.string().min(1, 'Informe o usuário.'),
  password: z.string().min(1, 'Informe a senha.'),
  rememberMe: z.boolean().optional(),
  trustedDeviceToken: z.string().max(200).optional()
});
const twoFactorVerifySchema = z.object({
  challengeToken: z.string().min(1, 'Desafio inválido.').max(200),
  code: z.string().min(1, 'Informe o código.').max(20),
  rememberDevice: z.boolean().optional()
});
const twoFactorChallengeSchema = z.object({
  challengeToken: z.string().min(1, 'Desafio inválido.').max(200)
});
const twoFactorEnableConfirmSchema = z.object({
  challengeToken: z.string().min(1, 'Desafio inválido.').max(200),
  code: z.string().min(1, 'Informe o código.').max(20)
});
const twoFactorDisableSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual.')
});
const forgotPasswordSchema = z.object({
  identifier: z.string().min(1, 'Informe o usuário, e-mail ou CNPJ.')
});
const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token obrigatório.'),
  password: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE)
});
const resendPasswordSetupSchema = z.object({
  token: z.string().min(1, 'Token obrigatório.')
});
const emailChangeTokenSchema = z.object({
  token: z.string().min(1, 'Token obrigatório.')
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual.'),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH, `A nova senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
});
const accountSchema = z.object({
  email: z.union([z.string().trim().email('Informe um e-mail válido.'), z.literal(''), z.null()]).optional(),
  notificationPreferences: z.object({
    reports: z.boolean(),
    signatures: z.boolean(),
    signatureReminders: z.boolean().optional().default(true),
    surveyReminders: z.boolean(),
    calibrationReminders: z.boolean().optional().default(true)
  }).optional()
});
const notificationPreferenceSchema = z.object({
  reports: z.boolean(),
  signatures: z.boolean(),
  signatureReminders: z.boolean().optional().default(true),
  surveyReminders: z.boolean(),
  calibrationReminders: z.boolean().optional().default(true)
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

const LOGIN_RATE_LIMIT_MESSAGE = 'Muitas tentativas de login. Tente novamente mais tarde.';

// Três camadas no login, todas com a mesma resposta 429 genérica (sem revelar se o
// usuário existe):
// 1. IP + usuário: 8 tentativas/15 min — o mesmo atacante na mesma conta.
const loginRateLimit = createMemoryRateLimit({
  name: 'login-ip-usuario',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 8,
  message: LOGIN_RATE_LIMIT_MESSAGE,
  keyGenerator: req => `${authRateLimitIp(req)}:login:${authRateLimitIdentifier(req.body?.username)}`
});

// 2. Só IP: 50 falhas/15 min em qualquer usuário — barra password spraying a partir
//    de um IP. Conta apenas falhas para não travar equipes inteiras atrás do mesmo NAT.
const loginIpRateLimit = createMemoryRateLimit({
  name: 'login-ip',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 50,
  message: LOGIN_RATE_LIMIT_MESSAGE,
  maxKeys: 10_000,
  skipSuccessfulRequests: true,
  keyGenerator: req => `login-ip:${authRateLimitIp(req)}`
});

// 3. Só usuário: 20 falhas/15 min vindas de qualquer IP — barra ataque distribuído
//    contra uma conta (ex.: admin). Custo aceito: um atacante pode bloquear o login
//    daquela conta por até 15 min; a senha continua protegida.
const loginUsernameRateLimit = createMemoryRateLimit({
  name: 'login-usuario',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 20,
  message: LOGIN_RATE_LIMIT_MESSAGE,
  maxKeys: 10_000,
  skipSuccessfulRequests: true,
  keyGenerator: req => `login-user:${authRateLimitIdentifier(req.body?.username)}`
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

const resendPasswordSetupRateLimit = createMemoryRateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 5,
  message: 'Muitas solicitações de novo link. Tente novamente mais tarde.',
  keyGenerator: req => `${authRateLimitIp(req)}:resend-password-setup:${hashToken(String(req.body?.token || '').trim())}`
});

const TWO_FACTOR_RATE_LIMIT_MESSAGE = 'Muitas tentativas de verificação. Tente novamente mais tarde.';
const twoFactorVerifyRateLimit = createMemoryRateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 30,
  message: TWO_FACTOR_RATE_LIMIT_MESSAGE,
  maxKeys: 10_000,
  keyGenerator: req => `two-factor-verify:${authRateLimitIp(req)}`
});
const twoFactorResendRateLimit = createMemoryRateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 10,
  message: 'Muitos pedidos de novo código. Tente novamente mais tarde.',
  maxKeys: 10_000,
  keyGenerator: req => `two-factor-resend:${authRateLimitIp(req)}`
});
const twoFactorEnableRateLimit = createMemoryRateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 10,
  message: TWO_FACTOR_RATE_LIMIT_MESSAGE,
  keyGenerator: req => `two-factor-enable:${req.auth?.user?.id || authRateLimitIp(req)}`
});

const LOGIN_USER_INCLUDE = { collaborator: { include: { jobRole: true } }, moduleRoles: true };

const TWO_FACTOR_FAILURE_MESSAGES = {
  INVALID: 'Código inválido ou expirado.',
  EXPIRED: 'O código expirou. Peça um novo código ou entre de novo.',
  LOCKED: 'Muitas tentativas com este código. Peça um novo código ou entre de novo.'
};

function twoFactorChallengeResponse(res, { challengeToken, challenge, user }) {
  return res.json({
    twoFactorRequired: true,
    challengeToken,
    emailHint: maskEmail(user.email),
    expiresAt: challenge.expiresAt,
    trustedDeviceDays: TRUSTED_DEVICE_DAYS
  });
}

function twoFactorDeliveryFailed(res) {
  return res.status(503).json({
    error: 'Não foi possível enviar o código de verificação agora. Tente de novo em alguns minutos ou fale com o administrador.',
    code: 'TWO_FACTOR_DELIVERY_FAILED'
  });
}

// A sessão vai no cookie HttpOnly `fv_session`. Durante a transição (spec 041) o
// token ainda aparece no corpo, para o app antigo aberto em alguma aba e scripts.
async function sessionResponse(res, user, { rememberMe = false, extra = {}, trustedDevice = null } = {}) {
  const session = await createSession(user.id, { rememberMe });
  setSessionCookie(res, session.token, session.expiresAt);
  const transition = bearerSessionAllowed();
  if (trustedDevice) setTrustedDeviceCookie(res, trustedDevice.token, trustedDevice.expiresAt);
  return res.json({
    ...(transition ? { token: session.token } : {}),
    expiresAt: session.expiresAt,
    user: publicUser(user),
    ...extra,
    ...(trustedDevice ? {
      trustedDeviceExpiresAt: trustedDevice.expiresAt,
      ...(transition ? { trustedDeviceToken: trustedDevice.token } : {})
    } : {})
  });
}

// Navegador lembrado: cookie HttpOnly; o corpo só é aceito para migrar o valor que
// o app antigo guardou no localStorage (o login seguinte já usa o cookie).
function trustedDeviceTokenFrom(req, data) {
  return requestCookie(req, TRUSTED_DEVICE_COOKIE) || data.trustedDeviceToken || '';
}

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
    const mailer = user.role === 'CLIENT' || user.accountType === 'CLIENT' ? sendClientMail : sendMail;
    mailer({
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

async function queueAccountPasswordSetupEmail(user) {
  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length || !env.appUrl) {
    console.warn('Novo convite de senha não enviado por falta de configuração SMTP/APP_URL.', {
      missingMailerConfig,
      hasAppUrl: !!env.appUrl
    });
    return false;
  }

  const passwordSetup = await issueAccountPasswordSetup({
    userId: user.id,
    prismaClient: prisma,
    envConfig: env,
    createToken: createPasswordResetToken
  });
  const roleLabels = {
    MANAGER: 'gestor',
    COLLABORATOR: 'colaborador',
    COORDINATOR: 'coordenador',
    CLIENT: 'cliente'
  };
  const template = buildInternalUserWelcomeEmailTemplate({
    userName: user.name || user.username,
    username: user.username,
    setupUrl: passwordSetup.url,
    expiresLabel: ACCOUNT_PASSWORD_SETUP_EXPIRES_LABEL,
    roleLabel: roleLabels[user.role] || 'usuário'
  });

  setImmediate(() => {
    const mailer = user.role === 'CLIENT' || user.accountType === 'CLIENT' ? sendClientMail : sendMail;
    mailer({
      to: user.email,
      ...template
    }).catch(error => {
      console.error('Falha ao reenviar convite para definição de senha.', {
        userId: user.id,
        expiresAt: passwordSetup.expiresAt,
        error: error?.message || error
      });
    });
  });
  return true;
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
    const mailer = user.role === 'CLIENT' || user.accountType === 'CLIENT' ? sendClientMail : sendMail;
    mailer({
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
    include: { collaborator: { include: { jobRole: true } }, moduleRoles: true }
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

router.post('/login', loginRateLimit, loginIpRateLimit, loginUsernameRateLimit, asyncHandler(async (req, res) => {
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
    // Verificação "dummy" para equalizar o tempo de resposta quando o usuário não
    // existe (ou está inativo), evitando enumeração de usuários por canal lateral de tempo.
    await verifyPassword(data.password, await dummyPasswordHashPromise);
    // Detecção de abuso: conta por IP e por conta existente (o texto digitado como
    // usuário não é guardado quando não corresponde a uma conta).
    recordLoginFailure({ ip: authRateLimitIp(req), userId: candidates[0]?.id ?? null });
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }

  if (twoFactorChallengeNeeded(user)) {
    if (await consumeTwoFactorBypass(prisma, user)) {
      await logAuthSecurityEvent(prisma, { userId: user.id, type: 'TWO_FACTOR_BYPASS_USED', req });
      return sessionResponse(res, user, { rememberMe: !!data.rememberMe });
    }
    const deviceToken = trustedDeviceTokenFrom(req, data);
    const device = await validateTrustedDevice(prisma, { userId: user.id, token: deviceToken });
    if (device) {
      return sessionResponse(res, user, {
        rememberMe: !!data.rememberMe,
        // Veio do corpo (localStorage antigo): passa a morar no cookie.
        trustedDevice: requestCookie(req, TRUSTED_DEVICE_COOKIE) ? null : { token: deviceToken, expiresAt: device.expiresAt }
      });
    }
    if (!user.email) {
      return res.status(403).json({
        error: 'Esta conta exige verificação em duas etapas, mas não tem e-mail cadastrado. Peça a outro administrador para cadastrar o seu e-mail.',
        code: 'TWO_FACTOR_EMAIL_MISSING'
      });
    }
    const { challengeToken, code, challenge } = await createTwoFactorChallenge(prisma, {
      userId: user.id,
      purpose: 'LOGIN',
      rememberSession: !!data.rememberMe
    });
    const delivery = await deliverTwoFactorCode({ user, code, purpose: 'LOGIN' });
    if (!delivery.delivered) {
      await prisma.twoFactorChallenge.deleteMany({ where: { id: challenge.id } });
      return twoFactorDeliveryFailed(res);
    }
    await logAuthSecurityEvent(prisma, { userId: user.id, type: 'TWO_FACTOR_CHALLENGE_SENT', req, metadata: { purpose: 'LOGIN' } });
    return twoFactorChallengeResponse(res, { challengeToken, challenge, user });
  }

  return sessionResponse(res, user, { rememberMe: !!data.rememberMe });
}));

// Segunda etapa do login: o código enviado por e-mail troca o desafio por uma sessão.
router.post('/2fa/verify', twoFactorVerifyRateLimit, asyncHandler(async (req, res) => {
  const data = twoFactorVerifySchema.parse(req.body);
  const result = await verifyTwoFactorChallenge(prisma, { challengeToken: data.challengeToken, code: data.code, purpose: 'LOGIN' });
  if (!result.ok) {
    if (result.challenge) {
      await logAuthSecurityEvent(prisma, {
        userId: result.challenge.userId,
        type: 'TWO_FACTOR_FAILED',
        req,
        metadata: { reason: result.reason }
      });
    }
    return res.status(401).json({
      error: TWO_FACTOR_FAILURE_MESSAGES[result.reason] || TWO_FACTOR_FAILURE_MESSAGES.INVALID,
      code: `TWO_FACTOR_${result.reason || 'INVALID'}`,
      ...(result.remainingAttempts !== undefined ? { remainingAttempts: result.remainingAttempts } : {})
    });
  }

  const user = await prisma.user.findUnique({ where: { id: result.challenge.userId }, include: LOGIN_USER_INCLUDE });
  if (!user?.isActive) {
    return res.status(401).json({ error: TWO_FACTOR_FAILURE_MESSAGES.INVALID, code: 'TWO_FACTOR_INVALID' });
  }
  await logAuthSecurityEvent(prisma, { userId: user.id, type: 'TWO_FACTOR_VERIFIED', req });

  let trustedDevice = null;
  if (data.rememberDevice) {
    const issued = await issueTrustedDevice(prisma, { userId: user.id, userAgent: req.get('user-agent') });
    trustedDevice = { token: issued.token, expiresAt: issued.device.expiresAt || new Date(Date.now() + TRUSTED_DEVICE_DAYS * 86_400_000) };
    await logAuthSecurityEvent(prisma, { userId: user.id, type: 'TRUSTED_DEVICE_ADDED', req, metadata: { deviceId: issued.device.id } });
  }
  return sessionResponse(res, user, { rememberMe: result.challenge.rememberSession, trustedDevice });
}));

router.post('/2fa/resend', twoFactorResendRateLimit, asyncHandler(async (req, res) => {
  const data = twoFactorChallengeSchema.parse(req.body);
  const result = await refreshTwoFactorChallenge(prisma, { challengeToken: data.challengeToken });
  if (!result.ok) {
    const messages = {
      SEND_LIMIT: 'Limite de reenvios atingido. Entre de novo para receber outro código.',
      COOLDOWN: 'Aguarde alguns segundos antes de pedir outro código.'
    };
    return res.status(result.reason === 'INVALID' ? 401 : 429).json({
      error: messages[result.reason] || TWO_FACTOR_FAILURE_MESSAGES.INVALID,
      code: `TWO_FACTOR_${result.reason}`
    });
  }
  const user = await prisma.user.findUnique({ where: { id: result.challenge.userId } });
  if (!user?.isActive || !user.email) {
    return res.status(401).json({ error: TWO_FACTOR_FAILURE_MESSAGES.INVALID, code: 'TWO_FACTOR_INVALID' });
  }
  const delivery = await deliverTwoFactorCode({ user, code: result.code, purpose: result.challenge.purpose });
  if (!delivery.delivered) return twoFactorDeliveryFailed(res);
  await logAuthSecurityEvent(prisma, { userId: user.id, type: 'TWO_FACTOR_CHALLENGE_SENT', req, metadata: { purpose: result.challenge.purpose, resend: true } });
  res.json({ ok: true, emailHint: maskEmail(user.email) });
}));

async function twoFactorStatusResponse(res, userId) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const devices = await prisma.trustedDevice.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' }
  });
  return res.json(twoFactorStatusForUser(user, devices));
}

router.get('/2fa', requireAuth, asyncHandler(async (req, res) => twoFactorStatusResponse(res, req.auth.user.id)));

// Ativação opcional (contas internas): confirma com um código antes de ligar.
router.post('/2fa/enable', requireAuth, twoFactorEnableRateLimit, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.user.id } });
  const requirement = twoFactorRequirement(user);
  if (requirement === TwoFactorRequirement.REQUIRED || requirement === TwoFactorRequirement.ENABLED) {
    return res.status(409).json({ error: 'A verificação em duas etapas já está ativa nesta conta.' });
  }
  if (requirement !== TwoFactorRequirement.AVAILABLE) {
    return res.status(403).json({ error: 'A verificação em duas etapas não está disponível para esta conta.' });
  }
  if (!user.email) {
    return res.status(400).json({ error: 'Cadastre um e-mail na conta antes de ativar a verificação em duas etapas.', code: 'TWO_FACTOR_EMAIL_MISSING' });
  }
  const { challengeToken, code, challenge } = await createTwoFactorChallenge(prisma, { userId: user.id, purpose: 'ENABLE' });
  const delivery = await deliverTwoFactorCode({ user, code, purpose: 'ENABLE' });
  if (!delivery.delivered) {
    await prisma.twoFactorChallenge.deleteMany({ where: { id: challenge.id } });
    return twoFactorDeliveryFailed(res);
  }
  await logAuthSecurityEvent(prisma, { userId: user.id, type: 'TWO_FACTOR_CHALLENGE_SENT', req, metadata: { purpose: 'ENABLE' } });
  res.json({ challengeToken, emailHint: maskEmail(user.email), expiresAt: challenge.expiresAt });
}));

router.post('/2fa/enable/confirm', requireAuth, twoFactorEnableRateLimit, asyncHandler(async (req, res) => {
  const data = twoFactorEnableConfirmSchema.parse(req.body);
  const open = await findOpenChallenge(prisma, data.challengeToken, { purpose: 'ENABLE' });
  if (!open || open.userId !== req.auth.user.id) {
    return res.status(401).json({ error: TWO_FACTOR_FAILURE_MESSAGES.INVALID, code: 'TWO_FACTOR_INVALID' });
  }
  const result = await verifyTwoFactorChallenge(prisma, { challengeToken: data.challengeToken, code: data.code, purpose: 'ENABLE' });
  if (!result.ok) {
    await logAuthSecurityEvent(prisma, { userId: req.auth.user.id, type: 'TWO_FACTOR_FAILED', req, metadata: { purpose: 'ENABLE', reason: result.reason } });
    return res.status(401).json({
      error: TWO_FACTOR_FAILURE_MESSAGES[result.reason] || TWO_FACTOR_FAILURE_MESSAGES.INVALID,
      code: `TWO_FACTOR_${result.reason || 'INVALID'}`
    });
  }
  await prisma.user.update({ where: { id: req.auth.user.id }, data: { twoFactorEnabled: true } });
  await logAuthSecurityEvent(prisma, { userId: req.auth.user.id, type: 'TWO_FACTOR_ENABLED', req });
  return twoFactorStatusResponse(res, req.auth.user.id);
}));

router.post('/2fa/disable', requireAuth, twoFactorEnableRateLimit, asyncHandler(async (req, res) => {
  const data = twoFactorDisableSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.user.id } });
  if (twoFactorRequirement(user) === TwoFactorRequirement.REQUIRED) {
    return res.status(403).json({ error: 'A verificação em duas etapas é obrigatória para contas de administrador.' });
  }
  if (!(await verifyPassword(data.currentPassword, user.passwordHash))) {
    return res.status(400).json({ error: 'Senha atual inválida.' });
  }
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } });
    await revokeTrustedDevices(tx, user.id);
  });
  await logAuthSecurityEvent(prisma, { userId: user.id, type: 'TWO_FACTOR_DISABLED', req });
  return twoFactorStatusResponse(res, user.id);
}));

router.delete('/2fa/devices/:id', requireAuth, asyncHandler(async (req, res) => {
  const result = await revokeTrustedDevices(prisma, req.auth.user.id, { deviceId: String(req.params.id) });
  if (result.count) {
    await logAuthSecurityEvent(prisma, { userId: req.auth.user.id, type: 'TRUSTED_DEVICES_REVOKED', req, metadata: { deviceId: String(req.params.id) } });
  }
  return twoFactorStatusResponse(res, req.auth.user.id);
}));

router.delete('/2fa/devices', requireAuth, asyncHandler(async (req, res) => {
  const result = await revokeTrustedDevices(prisma, req.auth.user.id);
  if (result.count) {
    await logAuthSecurityEvent(prisma, { userId: req.auth.user.id, type: 'TRUSTED_DEVICES_REVOKED', req, metadata: { count: result.count } });
  }
  return twoFactorStatusResponse(res, req.auth.user.id);
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
    if (user?.email && user.emailVerifiedAt) {
      emails = [user.email];
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
  const status = passwordResetTokenStatus(tokenRow);
  res.json({
    ...status,
    username: status.valid ? tokenRow.user.username : null,
    name: status.valid ? tokenRow.user.name : null,
    canRequestNewLink: token.startsWith('setup_') && !!(tokenRow?.user?.isActive && tokenRow.user.email)
  });
}));

router.post('/resend-password-setup', resendPasswordSetupRateLimit, asyncHandler(async (req, res) => {
  const data = resendPasswordSetupSchema.parse(req.body);
  const tokenRow = data.token.startsWith('setup_')
    ? await findPasswordResetToken(data.token)
    : null;

  if (tokenRow?.user?.isActive && tokenRow.user.email) {
    await queueAccountPasswordSetupEmail(tokenRow.user);
  }

  res.json({
    ok: true,
    message: 'Se a conta possuir um e-mail cadastrado, um novo link será enviado.'
  });
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

    await tx.userSession.deleteMany({
      where: { userId: tokenRow.userId }
    });
    await revokeTrustedDevices(tx, tokenRow.userId);
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
  await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: currentUser.id },
      data: { passwordHash }
    });
    await tx.userSession.deleteMany({
      where: {
        userId: currentUser.id,
        id: { not: req.auth.sessionId }
      }
    });
    // Navegadores lembrados para o 2FA também deixam de valer.
    await revokeTrustedDevices(tx, currentUser.id);
  });

  res.json({ ok: true });
}));

router.put('/account', requireAuth, asyncHandler(async (req, res) => {
  const data = accountSchema.parse(req.body);
  let currentUser = await prisma.user.findUniqueOrThrow({
    where: { id: req.auth.user.id },
    include: { collaborator: { include: { jobRole: true } }, moduleRoles: true }
  });

  if (data.notificationPreferences) {
    currentUser = await prisma.user.update({
      where: { id: currentUser.id },
      data: notificationPreferenceData(data.notificationPreferences),
      include: { collaborator: { include: { jobRole: true } }, moduleRoles: true }
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
        include: { collaborator: { include: { jobRole: true } }, moduleRoles: true }
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
    include: { collaborator: { include: { jobRole: true } }, moduleRoles: true }
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

  // O navegador lembrado do 2FA continua: sair não é "esquecer este navegador".
  clearSessionCookie(res);
  res.status(204).end();
}));

export default router;
