import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import env from '../src/config/env.js';
import { hashPassword } from '../src/lib/password.js';
import prisma from '../src/lib/prisma.js';
import { twoFactorMailer } from '../src/lib/accounts/two-factor.js';

let ipCounter = 10;
function nextIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function dispatchApp(method, pathName, body, remoteAddress = nextIp(), headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = new Readable({
      read() {
        if (payload) this.push(payload);
        this.push(null);
      }
    });
    req.method = method;
    req.url = pathName;
    req.headers = {
      host: '127.0.0.1',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130',
      ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
      ...headers
    };
    req.socket = new PassThrough();
    req.socket.remoteAddress = remoteAddress;
    req.socket.encrypted = false;
    req.connection = req.socket;
    const chunks = [];
    const responseHeaders = new Map();
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    res.statusCode = 200;
    res.setHeader = (name, value) => responseHeaders.set(String(name).toLowerCase(), value);
    res.getHeader = name => responseHeaders.get(String(name).toLowerCase());
    res.getHeaders = () => Object.fromEntries(responseHeaders);
    res.removeHeader = name => responseHeaders.delete(String(name).toLowerCase());
    res.writeHead = (statusCode, headersToSet = {}) => {
      res.statusCode = statusCode;
      Object.entries(headersToSet).forEach(([name, value]) => res.setHeader(name, value));
      return res;
    };
    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      Writable.prototype.end.call(res, callback);
      const rawBody = Buffer.concat(chunks).toString('utf8');
      resolve({ statusCode: res.statusCode, body: rawBody, json: rawBody ? JSON.parse(rawBody) : null });
      return res;
    };
    app.handle(req, res, reject);
  });
}

// Estado em memória que substitui as tabelas usadas pelo fluxo de login.
async function installFakeDb(t, user) {
  const state = { challenges: [], devices: [], sessions: [], events: [], mails: [], user: { ...user } };
  const passwordHash = await hashPassword('senha-correta-123');
  state.user.passwordHash = passwordHash;
  const originals = {
    findMany: prisma.user.findMany,
    findUnique: prisma.user.findUnique,
    updateMany: prisma.user.updateMany,
    sessionCreate: prisma.userSession.create,
    challenge: { ...prisma.twoFactorChallenge },
    device: { ...prisma.trustedDevice },
    eventCreate: prisma.authSecurityEvent.create,
    send: twoFactorMailer.send,
    enforcement: env.twoFactorEnforcement
  };
  const pick = (rows, where) => rows.filter(row => Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('lt' in condition) return row[key] < condition.lt;
      if ('gt' in condition) return row[key] > condition.gt;
      return true;
    }
    return row[key] === condition;
  }));
  const apply = (row, data) => Object.entries(data).forEach(([key, value]) => {
    row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
  });
  let seq = 0;
  prisma.user.findMany = async () => [state.user];
  prisma.user.findUnique = async ({ where }) => (where.id === state.user.id ? { ...state.user } : null);
  prisma.user.updateMany = async ({ where, data }) => {
    const hit = pick([state.user], where);
    hit.forEach(row => apply(row, data));
    return { count: hit.length };
  };
  prisma.userSession.create = async ({ data }) => {
    state.sessions.push(data);
    return { id: `s${state.sessions.length}`, ...data };
  };
  Object.assign(prisma.twoFactorChallenge, {
    create: async ({ data }) => {
      const row = { id: `c${++seq}`, attempts: 0, sendCount: 1, consumedAt: null, purpose: 'LOGIN', ...data };
      state.challenges.push(row);
      return { ...row };
    },
    findUnique: async ({ where }) => {
      const row = pick(state.challenges, where)[0];
      return row ? { ...row } : null;
    },
    updateMany: async ({ where, data }) => {
      const hit = pick(state.challenges, where);
      hit.forEach(row => apply(row, data));
      return { count: hit.length };
    },
    deleteMany: async ({ where }) => {
      const keep = state.challenges.filter(row => !pick([row], where).length);
      const removed = state.challenges.length - keep.length;
      state.challenges = keep;
      return { count: removed };
    }
  });
  Object.assign(prisma.trustedDevice, {
    create: async ({ data }) => {
      const row = { id: `d${++seq}`, ...data };
      state.devices.push(row);
      return { ...row };
    },
    findUnique: async ({ where }) => {
      const row = pick(state.devices, where)[0];
      return row ? { ...row } : null;
    },
    update: async ({ where, data }) => {
      const row = pick(state.devices, where)[0];
      apply(row, data);
      return { ...row };
    }
  });
  prisma.authSecurityEvent.create = async ({ data }) => {
    state.events.push(data);
    return data;
  };
  twoFactorMailer.send = async message => {
    state.mails.push(message);
    return {};
  };
  env.twoFactorEnforcement = 'on';
  t.after(() => {
    prisma.user.findMany = originals.findMany;
    prisma.user.findUnique = originals.findUnique;
    prisma.user.updateMany = originals.updateMany;
    prisma.userSession.create = originals.sessionCreate;
    Object.assign(prisma.twoFactorChallenge, originals.challenge);
    Object.assign(prisma.trustedDevice, originals.device);
    prisma.authSecurityEvent.create = originals.eventCreate;
    twoFactorMailer.send = originals.send;
    env.twoFactorEnforcement = originals.enforcement;
  });
  return state;
}

const ADMIN = {
  id: 'admin-1',
  username: 'admin',
  name: 'Administrador',
  email: 'admin@filtrovali.example',
  role: 'MANAGER',
  accountType: 'ADMIN',
  isActive: true,
  twoFactorEnabled: false,
  twoFactorBypassUntil: null,
  moduleRoles: [],
  collaborator: null
};

const codeFromMail = mail => mail.text.match(/\b(\d{6})\b/)[1];

test('admin login returns a challenge (no session) and the e-mailed code completes it', async t => {
  const state = await installFakeDb(t, ADMIN);
  const login = await dispatchApp('POST', '/api/auth/login', { username: 'admin', password: 'senha-correta-123', rememberMe: true });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json.twoFactorRequired, true);
  assert.equal(login.json.token, undefined, 'no session before the second step');
  assert.equal(login.json.emailHint, 'ad***@filtrovali.example');
  assert.equal(state.sessions.length, 0);
  assert.equal(state.mails.length, 1);
  assert.equal(state.mails[0].to, ADMIN.email);

  const wrong = await dispatchApp('POST', '/api/auth/2fa/verify', { challengeToken: login.json.challengeToken, code: '000000' });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json.code, 'TWO_FACTOR_INVALID');

  const verify = await dispatchApp('POST', '/api/auth/2fa/verify', {
    challengeToken: login.json.challengeToken,
    code: codeFromMail(state.mails[0]),
    rememberDevice: true
  });
  assert.equal(verify.statusCode, 200, verify.body);
  assert.ok(verify.json.token);
  assert.ok(verify.json.trustedDeviceToken);
  assert.equal(state.sessions.length, 1);
  const thirtyDaysish = new Date(state.sessions[0].expiresAt).getTime() - Date.now();
  assert.ok(thirtyDaysish > 20 * 86_400_000, 'rememberMe from the password step is kept');
  assert.deepEqual(state.events.map(event => event.type), ['TWO_FACTOR_CHALLENGE_SENT', 'TWO_FACTOR_FAILED', 'TWO_FACTOR_VERIFIED', 'TRUSTED_DEVICE_ADDED']);

  const reuse = await dispatchApp('POST', '/api/auth/2fa/verify', { challengeToken: login.json.challengeToken, code: codeFromMail(state.mails[0]) });
  assert.equal(reuse.statusCode, 401, 'single use');

  // Navegador lembrado: o próximo login entra direto, sem e-mail.
  const again = await dispatchApp('POST', '/api/auth/login', {
    username: 'admin',
    password: 'senha-correta-123',
    trustedDeviceToken: verify.json.trustedDeviceToken
  });
  assert.equal(again.statusCode, 200, again.body);
  assert.ok(again.json.token);
  assert.equal(state.mails.length, 1);
});

test('wrong password never reaches the second step', async t => {
  const state = await installFakeDb(t, ADMIN);
  const login = await dispatchApp('POST', '/api/auth/login', { username: 'admin', password: 'errada-errada' });
  assert.equal(login.statusCode, 401);
  assert.equal(state.challenges.length, 0);
  assert.equal(state.mails.length, 0);
});

test('admin without e-mail cannot finish the login', async t => {
  const state = await installFakeDb(t, { ...ADMIN, email: null });
  const login = await dispatchApp('POST', '/api/auth/login', { username: 'admin', password: 'senha-correta-123' });
  assert.equal(login.statusCode, 403);
  assert.equal(login.json.code, 'TWO_FACTOR_EMAIL_MISSING');
  assert.equal(state.sessions.length, 0);
});

test('when the code cannot be e-mailed the login stops and the challenge is discarded', async t => {
  const state = await installFakeDb(t, ADMIN);
  twoFactorMailer.send = async () => ({ skipped: true, reason: 'outbound_emails_disabled' });
  const login = await dispatchApp('POST', '/api/auth/login', { username: 'admin', password: 'senha-correta-123' });
  assert.equal(login.statusCode, 503);
  assert.equal(login.json.code, 'TWO_FACTOR_DELIVERY_FAILED');
  assert.equal(state.challenges.length, 0);
  assert.equal(state.sessions.length, 0);
});

test('break-glass bypass lets the admin in once without a code', async t => {
  const state = await installFakeDb(t, { ...ADMIN, twoFactorBypassUntil: new Date(Date.now() + 60_000) });
  const first = await dispatchApp('POST', '/api/auth/login', { username: 'admin', password: 'senha-correta-123' });
  assert.equal(first.statusCode, 200, first.body);
  assert.ok(first.json.token);
  assert.equal(state.events.at(-1).type, 'TWO_FACTOR_BYPASS_USED');
  const second = await dispatchApp('POST', '/api/auth/login', { username: 'admin', password: 'senha-correta-123' });
  assert.equal(second.json.twoFactorRequired, true, 'the bypass is single use');
});

test('kill switch TWO_FACTOR_ENFORCEMENT=off and internal accounts without 2FA log in directly', async t => {
  const state = await installFakeDb(t, ADMIN);
  env.twoFactorEnforcement = 'off';
  const admin = await dispatchApp('POST', '/api/auth/login', { username: 'admin', password: 'senha-correta-123' });
  assert.ok(admin.json.token);
  env.twoFactorEnforcement = 'on';
  state.user = { ...state.user, accountType: 'INTERNAL', role: 'COORDINATOR' };
  const internal = await dispatchApp('POST', '/api/auth/login', { username: 'admin', password: 'senha-correta-123' });
  assert.ok(internal.json.token);
  state.user.twoFactorEnabled = true;
  const optedIn = await dispatchApp('POST', '/api/auth/login', { username: 'admin', password: 'senha-correta-123' });
  assert.equal(optedIn.json.twoFactorRequired, true);
  assert.equal(state.mails.length, 1);
});
