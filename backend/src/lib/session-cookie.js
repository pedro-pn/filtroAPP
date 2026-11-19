import env from '../config/env.js';

// Sessão do navegador em cookie HttpOnly (spec 041). O token nunca chega ao
// JavaScript da página: um XSS ou extensão não consegue levá-lo embora.
export const SESSION_COOKIE = 'fv_session';
// Navegador lembrado do 2FA: só é lido no login, por isso o caminho é restrito a /api/auth.
export const TRUSTED_DEVICE_COOKIE = 'fv_trusted_device';
export const TRUSTED_DEVICE_COOKIE_PATH = '/api/auth';
// Cabeçalho que o app envia em toda escrita autenticada por cookie (CSRF).
export const CSRF_HEADER = 'x-filtrovali-request';

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || Object.hasOwn(cookies, name)) continue;
    const raw = part.slice(index + 1).trim().replace(/^"(.*)"$/, '$1');
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

export function requestCookie(req, name) {
  return parseCookies(req.headers?.cookie)[name] || '';
}

function baseCookieOptions(config = env) {
  return {
    httpOnly: true,
    secure: Boolean(config.sessionCookieSecure),
    sameSite: 'strict'
  };
}

function maxAgeUntil(expiresAt) {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

export function setSessionCookie(res, token, expiresAt, config = env) {
  res.cookie(SESSION_COOKIE, token, { ...baseCookieOptions(config), path: '/', maxAge: maxAgeUntil(expiresAt) });
}

export function clearSessionCookie(res, config = env) {
  res.clearCookie(SESSION_COOKIE, { ...baseCookieOptions(config), path: '/' });
}

export function setTrustedDeviceCookie(res, token, expiresAt, config = env) {
  res.cookie(TRUSTED_DEVICE_COOKIE, token, {
    ...baseCookieOptions(config),
    path: TRUSTED_DEVICE_COOKIE_PATH,
    maxAge: maxAgeUntil(expiresAt)
  });
}

export function clearTrustedDeviceCookie(res, config = env) {
  res.clearCookie(TRUSTED_DEVICE_COOKIE, { ...baseCookieOptions(config), path: TRUSTED_DEVICE_COOKIE_PATH });
}

// Durante a transição (até SESSION_BEARER_BROWSER_UNTIL) o token de sessão ainda
// vale em `Authorization: Bearer` e continua na resposta do login, para o app
// antigo aberto em alguma aba e scripts que usam a sessão. Depois, só o cookie.
export function bearerSessionAllowed(now = new Date(), config = env) {
  const until = config.sessionBearerBrowserUntil;
  return !until || now.getTime() < new Date(until).getTime();
}
