import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import express from 'express';

import app from '../src/app.js';
import env from '../src/config/env.js';
import { hashPassword } from '../src/lib/password.js';
import prisma from '../src/lib/prisma.js';
import { parseCookies, SESSION_COOKIE, TRUSTED_DEVICE_COOKIE } from '../src/lib/session-cookie.js';
import { csrfRejection, requireAuth } from '../src/middleware/auth.js';

// Spec 041: sessão em cookie HttpOnly, CSRF por cabeçalho + origem, inatividade
// e transição do Bearer. As tabelas são substituídas por estado em memória.

const sha256 = value => createHash('sha256').update(value).digest('hex');

const USER = {
  id: 'user-1',
  username: 'operadora',
  name: 'Operadora',
  email: 'operadora@filtrovali.example',
  role: 'MANAGER',
  accountType: 'ADMIN',
  isActive: true,
  twoFactorEnabled: false,
  twoFactorBypassUntil: null,
  moduleRoles: [],
  collaboratorId: null,
  collaborator: null
};

let ipCounter = 40;
const nextIp = () => `198.51.100.${++ipCounter}`;

async function installFakeDb(t) {
  const state = { sessions: [], user: { ...USER, passwordHash: await hashPassword('senha-correta-123') } };
  const saved = {
    findMany: prisma.user.findMany,
    findUnique: prisma.user.findUnique,
    session: { ...prisma.userSession },
    collaborator: prisma.collaborator.findUnique,
    enforcement: env.twoFactorEnforcement,
    until: env.sessionBearerBrowserUntil,
    idle: env.sessionIdleHours,
    origins: env.allowedOrigins,
    nodeEnv: env.nodeEnv,
    secure: env.sessionCookieSecure
  };
  prisma.user.findMany = async () => [state.user];
  prisma.user.findUnique = async ({ where }) => (where.id === state.user.id ? { ...state.user } : null);
  prisma.collaborator.findUnique = async () => null;
  Object.assign(prisma.userSession, {
    create: async ({ data }) => {
      const row = { id: `s${state.sessions.length + 1}`, createdAt: new Date(), ...data };
      state.sessions.push(row);
      return { ...row };
    },
    findUnique: async ({ where }) => {
      const row = state.sessions.find(session => session.tokenHash === where.tokenHash);
      return row ? { ...row, user: { ...state.user, moduleRoles: [] } } : null;
    },
    updateMany: async ({ where, data }) => {
      const rows = state.sessions.filter(session => session.id === where.id);
      rows.forEach(row => Object.assign(row, data));
      return { count: rows.length };
    },
    deleteMany: async ({ where }) => {
      const before = state.sessions.length;
      state.sessions = state.sessions.filter(session => session.id !== where.id);
      return { count: before - state.sessions.length };
    }
  });
  env.twoFactorEnforcement = 'off';
  t.after(() => {
    prisma.user.findMany = saved.findMany;
    prisma.user.findUnique = saved.findUnique;
    Object.assign(prisma.userSession, saved.session);
    prisma.collaborator.findUnique = saved.collaborator;
    Object.assign(env, {
      twoFactorEnforcement: saved.enforcement,
      sessionBearerBrowserUntil: saved.until,
      sessionIdleHours: saved.idle,
      allowedOrigins: saved.origins,
      nodeEnv: saved.nodeEnv,
      sessionCookieSecure: saved.secure
    });
  });
  return state;
}

async function listen(t, handler) {
  const server = await new Promise(resolve => { const instance = handler.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

function setCookies(response) {
  return response.headers.getSetCookie();
}

function cookieValue(response, name) {
  const header = setCookies(response).find(value => value.startsWith(`${name}=`));
  return header ? parseCookies(header.split(';')[0])[name] : null;
}

// Rotas mínimas atrás do requireAuth, para os casos que não dependem do login.
function protectedApp() {
  const protectedRoutes = express();
  protectedRoutes.get('/me', requireAuth, (req, res) => res.json({ id: req.auth.user.id, via: req.auth.via }));
  protectedRoutes.post('/write', requireAuth, (req, res) => res.json({ ok: true, via: req.auth.via }));
  protectedRoutes.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  return protectedRoutes;
}

async function seedSession(state, token, overrides = {}) {
  state.sessions.push({
    id: `seed-${state.sessions.length + 1}`,
    tokenHash: sha256(token),
    userId: USER.id,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    lastUsedAt: new Date(),
    ...overrides
  });
}

test('login issues an HttpOnly, SameSite=Strict session cookie; logout clears it and ends the session', async t => {
  const state = await installFakeDb(t);
  env.sessionCookieSecure = true;
  const base = await listen(t, app);
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify({ username: 'operadora', password: 'senha-correta-123' })
  });
  assert.equal(login.status, 200, await login.clone().text());
  const header = setCookies(login).find(value => value.startsWith(`${SESSION_COOKIE}=`));
  assert.ok(header, 'login must set the session cookie');
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Strict/i);
  assert.match(header, /Path=\//);
  assert.match(header, /Secure/i);
  assert.match(header, /Max-Age=\d+/i);
  const token = cookieValue(login, SESSION_COOKIE);
  assert.equal(state.sessions[0].tokenHash, sha256(token));
  assert.ok(state.sessions[0].lastUsedAt instanceof Date, 'new sessions start their idle clock');
  const body = await login.json();
  assert.equal(body.token, token, 'during the transition the token is still in the body');

  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  assert.equal(me.status, 200);

  const logout = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-filtrovali-request': '1', origin: base }
  });
  assert.equal(logout.status, 204);
  assert.match(setCookies(logout).find(value => value.startsWith(`${SESSION_COOKIE}=`)), /Expires=Thu, 01 Jan 1970/);
  assert.equal(state.sessions.length, 0);
  const after = await fetch(`${base}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  assert.equal(after.status, 401);
});

test('after the transition date the login body no longer carries the token and browser Bearer is refused', async t => {
  const state = await installFakeDb(t);
  env.sessionBearerBrowserUntil = new Date(Date.now() - 1000);
  const base = await listen(t, app);
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify({ username: 'operadora', password: 'senha-correta-123' })
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).token, undefined);
  const token = cookieValue(login, SESSION_COOKIE);

  const bearer = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(bearer.status, 401);
  assert.equal((await bearer.json()).code, 'SESSION_BEARER_RETIRED');
  const cookie = await fetch(`${base}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  assert.equal(cookie.status, 200);
  assert.equal(state.sessions.length, 1);
});

test('during the transition a Bearer request is accepted and silently upgraded to the cookie', async t => {
  const state = await installFakeDb(t);
  env.sessionBearerBrowserUntil = new Date(Date.now() + 86_400_000);
  await seedSession(state, 'legacy-token');
  const base = await listen(t, protectedApp());
  const response = await fetch(`${base}/me`, { headers: { authorization: 'Bearer legacy-token' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).via, 'bearer');
  assert.equal(cookieValue(response, SESSION_COOKIE), 'legacy-token');
  // Bearer não é alvo de CSRF (não é enviado automaticamente pelo navegador).
  const write = await fetch(`${base}/write`, { method: 'POST', headers: { authorization: 'Bearer legacy-token', origin: 'https://evil.example' } });
  assert.equal(write.status, 200);
});

test('cookie-authenticated writes require the app header and an allowed origin', async t => {
  const state = await installFakeDb(t);
  await seedSession(state, 'cookie-token');
  const base = await listen(t, protectedApp());
  env.allowedOrigins = ['https://app.filtrovali.example'];
  env.nodeEnv = 'production';
  const cookie = `${SESSION_COOKIE}=cookie-token`;
  const write = headers => fetch(`${base}/write`, { method: 'POST', headers: { cookie, ...headers } });

  const noHeader = await write({ origin: 'https://app.filtrovali.example' });
  assert.equal(noHeader.status, 403);
  assert.equal((await noHeader.json()).code, 'CSRF_HEADER_MISSING');

  const foreign = await write({ 'x-filtrovali-request': '1', origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).code, 'CSRF_ORIGIN_REJECTED');

  const foreignReferer = await write({ 'x-filtrovali-request': '1', referer: 'https://evil.example/page' });
  assert.equal(foreignReferer.status, 403);

  const allowed = await write({ 'x-filtrovali-request': '1', origin: 'https://app.filtrovali.example' });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).via, 'cookie');

  const sameHost = await write({ 'x-filtrovali-request': '1', origin: base });
  assert.equal(sameHost.status, 200, 'the server own origin is always accepted');

  const read = await fetch(`${base}/me`, { headers: { cookie, origin: 'https://evil.example' } });
  assert.equal(read.status, 200, 'reads are not CSRF targets');
});

test('csrfRejection only lets missing origins through when the app header is present', () => {
  const req = (method, headers) => ({ method, protocol: 'https', get: name => headers[name.toLowerCase()] });
  const config = { allowedOrigins: ['https://app.filtrovali.example'], nodeEnv: 'production' };
  assert.equal(csrfRejection(req('GET', {}), config), null);
  assert.equal(csrfRejection(req('POST', { host: 'app.filtrovali.example' }), config), 'CSRF_HEADER_MISSING');
  assert.equal(csrfRejection(req('DELETE', { host: 'x', 'x-filtrovali-request': '1' }), config), null);
  assert.equal(csrfRejection(req('PATCH', { host: 'x', 'x-filtrovali-request': '1', origin: 'null' }), config), 'CSRF_ORIGIN_REJECTED');
});

test('a session idle beyond the limit is ended and reported as SESSION_IDLE; activity refreshes lastUsedAt', async t => {
  const state = await installFakeDb(t);
  env.sessionIdleHours = 12;
  await seedSession(state, 'idle-token', { lastUsedAt: new Date(Date.now() - 13 * 3_600_000) });
  await seedSession(state, 'busy-token', { lastUsedAt: new Date(Date.now() - 6 * 60_000) });
  const base = await listen(t, protectedApp());

  const idle = await fetch(`${base}/me`, { headers: { cookie: `${SESSION_COOKIE}=idle-token` } });
  assert.equal(idle.status, 401);
  assert.equal((await idle.json()).code, 'SESSION_IDLE');
  assert.match(setCookies(idle).find(value => value.startsWith(`${SESSION_COOKIE}=`)), /Expires=Thu, 01 Jan 1970/);
  assert.equal(state.sessions.some(session => session.tokenHash === sha256('idle-token')), false);

  const busy = await fetch(`${base}/me`, { headers: { cookie: `${SESSION_COOKIE}=busy-token` } });
  assert.equal(busy.status, 200);
  await new Promise(resolve => setImmediate(resolve));
  const row = state.sessions.find(session => session.tokenHash === sha256('busy-token'));
  assert.ok(Date.now() - row.lastUsedAt.getTime() < 5_000, 'lastUsedAt is refreshed after 5 min');

  // Sessões antigas (antes da migration) não têm lastUsedAt: não caem por inatividade.
  await seedSession(state, 'pre-migration-token', { lastUsedAt: null, createdAt: new Date(Date.now() - 5 * 86_400_000) });
  const legacy = await fetch(`${base}/me`, { headers: { cookie: `${SESSION_COOKIE}=pre-migration-token` } });
  assert.equal(legacy.status, 200);
});

test('a revoked session (password change, admin reset, deactivation) stops the cookie immediately', async t => {
  const state = await installFakeDb(t);
  await seedSession(state, 'revoked-token');
  const base = await listen(t, protectedApp());
  assert.equal((await fetch(`${base}/me`, { headers: { cookie: `${SESSION_COOKIE}=revoked-token` } })).status, 200);
  state.sessions = [];
  const after = await fetch(`${base}/me`, { headers: { cookie: `${SESSION_COOKIE}=revoked-token` } });
  assert.equal(after.status, 401);
  assert.equal((await after.json()).code, 'SESSION_INVALID');

  await seedSession(state, 'inactive-token');
  state.user.isActive = false;
  assert.equal((await fetch(`${base}/me`, { headers: { cookie: `${SESSION_COOKIE}=inactive-token` } })).status, 401);
});

test('the trusted-device token lives in an HttpOnly cookie scoped to /api/auth', async t => {
  const state = await installFakeDb(t);
  env.twoFactorEnforcement = 'on';
  const devices = [];
  const savedDevice = { ...prisma.trustedDevice };
  Object.assign(prisma.trustedDevice, {
    findUnique: async ({ where }) => devices.find(device => device.tokenHash === where.tokenHash) || null,
    update: async () => ({})
  });
  t.after(() => Object.assign(prisma.trustedDevice, savedDevice));
  devices.push({ id: 'd1', userId: USER.id, tokenHash: sha256('device-token'), expiresAt: new Date(Date.now() + 86_400_000) });
  const base = await listen(t, app);
  const login = (headers, body = {}) => fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp(), ...headers },
    body: JSON.stringify({ username: 'operadora', password: 'senha-correta-123', ...body })
  });

  // Cookie do navegador lembrado: dispensa o código.
  const withCookie = await login({ cookie: `${TRUSTED_DEVICE_COOKIE}=device-token` });
  assert.equal(withCookie.status, 200);
  assert.ok(cookieValue(withCookie, SESSION_COOKIE));
  assert.equal((await withCookie.json()).twoFactorRequired, undefined);

  // Valor antigo do localStorage (app anterior): aceito uma vez e movido para o cookie.
  const migrated = await login({}, { trustedDeviceToken: 'device-token' });
  assert.equal(migrated.status, 200);
  const deviceCookie = setCookies(migrated).find(value => value.startsWith(`${TRUSTED_DEVICE_COOKIE}=`));
  assert.ok(deviceCookie, 'legacy device token is moved into the cookie');
  assert.match(deviceCookie, /HttpOnly/i);
  assert.match(deviceCookie, /Path=\/api\/auth/);
  assert.match(deviceCookie, /SameSite=Strict/i);
  assert.equal(state.sessions.length, 2);
});
