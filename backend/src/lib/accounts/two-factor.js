import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import env from '../../config/env.js';
import { buildTwoFactorCodeEmailTemplate } from '../email-templates.js';
import { sendMail } from '../mailer.js';

// Verificação em duas etapas por e-mail (spec 039).
// - ADMIN: obrigatória. INTERNAL: opcional (ativada na página da conta). CLIENT: fora.
// - Código de 6 dígitos, válido por 10 min, 5 tentativas, uso único, até 3 envios.
// - "Lembrar este navegador" por 30 dias: token aleatório guardado só como hash.
// - TWO_FACTOR_ENFORCEMENT=off desliga tudo (emergência: SMTP fora do ar).

export const TWO_FACTOR_CODE_TTL_MS = 10 * 60 * 1000;
export const TWO_FACTOR_MAX_ATTEMPTS = 5;
export const TWO_FACTOR_MAX_SENDS = 3;
export const TWO_FACTOR_RESEND_COOLDOWN_MS = 30 * 1000;
export const TRUSTED_DEVICE_DAYS = 30;
export const TRUSTED_DEVICE_TTL_MS = TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000;
export const TWO_FACTOR_EMAIL_TIMEOUT_MS = 20 * 1000;
export const BREAK_GLASS_DEFAULT_MINUTES = 60;

// Ponto de troca do envio (testes de rota substituem por um falso).
export const twoFactorMailer = { send: message => sendMail(message) };

export const TwoFactorRequirement = Object.freeze({
  REQUIRED: 'REQUIRED',
  ENABLED: 'ENABLED',
  AVAILABLE: 'AVAILABLE',
  NONE: 'NONE'
});

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

export function twoFactorEnforced(config = env) {
  return config.twoFactorEnforcement !== 'off';
}

// REQUIRED/ENABLED pedem o código no login; AVAILABLE = pode ativar; NONE = não se aplica.
export function twoFactorRequirement(user, config = env) {
  if (!user || user.accountType === 'CLIENT' || user.role === 'CLIENT') return TwoFactorRequirement.NONE;
  if (!twoFactorEnforced(config)) return TwoFactorRequirement.NONE;
  if (user.accountType === 'ADMIN') return TwoFactorRequirement.REQUIRED;
  return user.twoFactorEnabled ? TwoFactorRequirement.ENABLED : TwoFactorRequirement.AVAILABLE;
}

export function twoFactorChallengeNeeded(user, config = env) {
  const requirement = twoFactorRequirement(user, config);
  return requirement === TwoFactorRequirement.REQUIRED || requirement === TwoFactorRequirement.ENABLED;
}

export function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.lastIndexOf('@');
  if (at <= 0) return '';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function generateTwoFactorCode(randomIntImpl = randomInt) {
  return String(randomIntImpl(0, 1_000_000)).padStart(6, '0');
}

export function normalizeTwoFactorCode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 6 ? digits : '';
}

// O hash do código é ligado ao desafio: o mesmo código não serve para outro desafio.
export function hashTwoFactorCode(challengeTokenHash, code) {
  return sha256(`${challengeTokenHash}:${code}`);
}

export async function createTwoFactorChallenge(prismaClient, {
  userId,
  purpose = 'LOGIN',
  rememberSession = false,
  now = new Date(),
  code = generateTwoFactorCode()
}) {
  const challengeToken = randomBytes(32).toString('hex');
  const tokenHash = sha256(challengeToken);
  // Desafios antigos ainda abertos do mesmo tipo deixam de valer.
  await prismaClient.twoFactorChallenge.deleteMany({ where: { userId, purpose, consumedAt: null } });
  const challenge = await prismaClient.twoFactorChallenge.create({
    data: {
      userId,
      purpose,
      tokenHash,
      codeHash: hashTwoFactorCode(tokenHash, code),
      rememberSession: !!rememberSession,
      lastSentAt: now,
      expiresAt: new Date(now.getTime() + TWO_FACTOR_CODE_TTL_MS)
    }
  });
  return { challengeToken, code, challenge };
}

export async function findOpenChallenge(prismaClient, challengeToken, { purpose, now = new Date() } = {}) {
  const token = String(challengeToken || '').trim();
  if (!token) return null;
  const challenge = await prismaClient.twoFactorChallenge.findUnique({ where: { tokenHash: sha256(token) } });
  if (!challenge || challenge.consumedAt || (purpose && challenge.purpose !== purpose)) return null;
  if (challenge.expiresAt <= now) return null;
  return challenge;
}

// Retorna { ok: true, challenge } ou { ok: false, reason: INVALID | EXPIRED | LOCKED }.
// A tentativa é contada antes da comparação, de forma atômica, para que requisições
// paralelas não passem do limite; o consumo também é atômico (uso único).
export async function verifyTwoFactorChallenge(prismaClient, { challengeToken, code, purpose = 'LOGIN', now = new Date() }) {
  const token = String(challengeToken || '').trim();
  const normalizedCode = normalizeTwoFactorCode(code);
  if (!token) return { ok: false, reason: 'INVALID' };
  const tokenHash = sha256(token);
  const challenge = await prismaClient.twoFactorChallenge.findUnique({ where: { tokenHash } });
  if (!challenge || challenge.consumedAt || challenge.purpose !== purpose) return { ok: false, reason: 'INVALID' };
  if (challenge.expiresAt <= now) return { ok: false, reason: 'EXPIRED' };
  if (challenge.attempts >= TWO_FACTOR_MAX_ATTEMPTS) return { ok: false, reason: 'LOCKED' };

  const counted = await prismaClient.twoFactorChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null, attempts: { lt: TWO_FACTOR_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } }
  });
  if (!counted.count) return { ok: false, reason: 'LOCKED' };

  const matches = !!normalizedCode && safeEqualHex(challenge.codeHash, hashTwoFactorCode(tokenHash, normalizedCode));
  if (!matches) {
    const remaining = Math.max(0, TWO_FACTOR_MAX_ATTEMPTS - (challenge.attempts + 1));
    return { ok: false, reason: remaining ? 'INVALID' : 'LOCKED', remainingAttempts: remaining, challenge };
  }

  const consumed = await prismaClient.twoFactorChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: now }
  });
  if (!consumed.count) return { ok: false, reason: 'INVALID' };
  return { ok: true, challenge };
}

// Novo código para o mesmo desafio: até 3 envios, 30 s entre eles; o prazo recomeça.
export async function refreshTwoFactorChallenge(prismaClient, { challengeToken, now = new Date(), code = generateTwoFactorCode() }) {
  const challenge = await findOpenChallenge(prismaClient, challengeToken, { now });
  if (!challenge) return { ok: false, reason: 'INVALID' };
  if (challenge.sendCount >= TWO_FACTOR_MAX_SENDS) return { ok: false, reason: 'SEND_LIMIT', challenge };
  if (now.getTime() - new Date(challenge.lastSentAt).getTime() < TWO_FACTOR_RESEND_COOLDOWN_MS) {
    return { ok: false, reason: 'COOLDOWN', challenge };
  }
  const updated = await prismaClient.twoFactorChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null, sendCount: challenge.sendCount },
    data: {
      codeHash: hashTwoFactorCode(challenge.tokenHash, code),
      attempts: 0,
      sendCount: { increment: 1 },
      lastSentAt: now,
      expiresAt: new Date(now.getTime() + TWO_FACTOR_CODE_TTL_MS)
    }
  });
  if (!updated.count) return { ok: false, reason: 'INVALID' };
  return { ok: true, code, challenge };
}

export function trustedDeviceLabel(userAgent) {
  const ua = String(userAgent || '');
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari'
            : 'Navegador';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
      : /(iPhone|iPad|iPod)/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

export async function issueTrustedDevice(prismaClient, { userId, userAgent, now = new Date() }) {
  const token = randomBytes(32).toString('hex');
  const device = await prismaClient.trustedDevice.create({
    data: {
      userId,
      tokenHash: sha256(token),
      label: trustedDeviceLabel(userAgent).slice(0, 80),
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS)
    }
  });
  return { token, device };
}

// O token só vale para a conta que o gerou e dentro do prazo; não é renovado no uso.
export async function validateTrustedDevice(prismaClient, { userId, token, now = new Date() }) {
  const value = String(token || '').trim();
  if (!value || !userId) return null;
  const device = await prismaClient.trustedDevice.findUnique({ where: { tokenHash: sha256(value) } });
  if (!device || device.userId !== userId || device.expiresAt <= now) return null;
  await prismaClient.trustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: now } }).catch(() => {});
  return device;
}

export function revokeTrustedDevices(prismaClient, userId, { deviceId } = {}) {
  return prismaClient.trustedDevice.deleteMany({ where: { userId, ...(deviceId ? { id: deviceId } : {}) } });
}

// Acesso de emergência (scripts/disable-2fa.js): vale uma vez, até o prazo.
export async function consumeTwoFactorBypass(prismaClient, user, now = new Date()) {
  if (!user?.twoFactorBypassUntil || new Date(user.twoFactorBypassUntil) <= now) return false;
  const result = await prismaClient.user.updateMany({
    where: { id: user.id, twoFactorBypassUntil: { gt: now } },
    data: { twoFactorBypassUntil: null }
  });
  return result.count > 0;
}

export function requestAuditContext(req) {
  return {
    ipAddress: String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 64) || null,
    userAgent: String(req?.get?.('user-agent') || req?.headers?.['user-agent'] || '').slice(0, 300) || null
  };
}

export async function logAuthSecurityEvent(prismaClient, { userId = null, type, req = null, metadata = null }, { logger = console } = {}) {
  try {
    await prismaClient.authSecurityEvent.create({
      data: { userId, type, ...requestAuditContext(req), ...(metadata ? { metadata } : {}) }
    });
  } catch (error) {
    // A trilha não pode derrubar o login.
    logger.warn?.(`Falha ao registrar evento de segurança ${type}.`, error?.message || error);
  }
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Tempo esgotado no envio do código.'), { code: 'TWO_FACTOR_EMAIL_TIMEOUT' })), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

// Envia o código e diz se ele saiu de fato. Envio desligado (SEND_CLIENT_EMAILS=false)
// ou falha de SMTP contam como "não entregue": o login não segue sem o código.
export async function deliverTwoFactorCode({ user, code, purpose = 'LOGIN' }, {
  sendMailImpl = twoFactorMailer.send,
  timeoutMs = TWO_FACTOR_EMAIL_TIMEOUT_MS,
  logger = console
} = {}) {
  if (!user?.email) return { delivered: false, reason: 'NO_EMAIL' };
  const template = buildTwoFactorCodeEmailTemplate({
    userName: user.name || user.username,
    code,
    purpose,
    expiresLabel: `${Math.round(TWO_FACTOR_CODE_TTL_MS / 60000)} minutos`
  });
  try {
    const result = await withTimeout(Promise.resolve(sendMailImpl({ to: user.email, ...template })), timeoutMs);
    if (result?.skipped) return { delivered: false, reason: 'EMAIL_DISABLED' };
    return { delivered: true };
  } catch (error) {
    logger.warn?.('Falha ao enviar o código de verificação em duas etapas.', error?.code || error?.message || error);
    return { delivered: false, reason: error?.code === 'TWO_FACTOR_EMAIL_TIMEOUT' ? 'TIMEOUT' : 'SEND_ERROR' };
  }
}

export function twoFactorStatusForUser(user, devices = [], { currentDeviceId = null, config = env } = {}) {
  const requirement = twoFactorRequirement(user, config);
  return {
    requirement,
    enforced: twoFactorEnforced(config),
    required: requirement === TwoFactorRequirement.REQUIRED,
    enabled: requirement === TwoFactorRequirement.REQUIRED || requirement === TwoFactorRequirement.ENABLED,
    canToggle: requirement === TwoFactorRequirement.ENABLED || requirement === TwoFactorRequirement.AVAILABLE,
    emailHint: maskEmail(user?.email),
    hasEmail: !!user?.email,
    trustedDeviceDays: TRUSTED_DEVICE_DAYS,
    trustedDevices: devices.map(device => ({
      id: device.id,
      label: device.label || 'Navegador',
      createdAt: device.createdAt,
      lastUsedAt: device.lastUsedAt,
      expiresAt: device.expiresAt,
      current: currentDeviceId ? device.id === currentDeviceId : false
    }))
  };
}
