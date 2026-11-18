import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import { hashToken } from '../src/lib/auth.js';
import prisma from '../src/lib/prisma.js';
import { sessionRevocationWhere } from '../src/routes/resources/users.js';

function dispatchApp(method, pathName, body, headers = {}) {
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
      ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
      ...headers
    };
    req.socket = new PassThrough();
    req.socket.remoteAddress = '198.51.100.90';
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

const ADMIN_TOKEN = 'admin-session-token';
const adminSession = {
  id: 'session-admin',
  tokenHash: hashToken(ADMIN_TOKEN),
  expiresAt: new Date(Date.now() + 60_000),
  user: {
    id: 'user-admin',
    username: 'admin',
    name: 'Admin',
    email: 'admin@example.com',
    role: 'MANAGER',
    accountType: 'ADMIN',
    isActive: true,
    collaboratorId: null,
    collaborator: null,
    moduleRoles: [{ module: 'HUB', role: 'HUB_ADMIN' }]
  }
};

function targetUser(overrides = {}) {
  return {
    id: 'user-target',
    username: 'colaborador',
    name: 'Colaborador',
    email: null,
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    isActive: true,
    collaboratorId: null,
    collaborator: null,
    reportEmissionPermissions: [],
    acompanhamentoExtraPermissions: [],
    rdoExtraPermissions: [],
    moduleRoles: [{ module: 'RDO', role: 'RDO_COLLABORATOR' }],
    ...overrides
  };
}

function mockPrisma(t) {
  const originals = {
    sessionFindUnique: prisma.userSession.findUnique,
    userFindUniqueOrThrow: prisma.user.findUniqueOrThrow,
    userUpdate: prisma.user.update,
    transaction: prisma.$transaction
  };
  const calls = [];
  prisma.userSession.findUnique = async () => adminSession;
  prisma.user.findUniqueOrThrow = async () => targetUser();
  prisma.user.update = async args => {
    calls.push(['user.update', args]);
    return targetUser();
  };
  prisma.$transaction = async callback => callback({
    user: {
      update: async args => {
        calls.push(['tx.user.update', args]);
        return targetUser();
      }
    },
    userSession: {
      deleteMany: async args => {
        calls.push(['tx.userSession.deleteMany', args]);
        return { count: 2 };
      }
    }
  });
  t.after(() => {
    prisma.userSession.findUnique = originals.sessionFindUnique;
    prisma.user.findUniqueOrThrow = originals.userFindUniqueOrThrow;
    prisma.user.update = originals.userUpdate;
    prisma.$transaction = originals.transaction;
  });
  return calls;
}

const authHeader = { authorization: `Bearer ${ADMIN_TOKEN}` };

test('PUT /admin/accounts/:id with a new password revokes every session of the target account', async t => {
  const calls = mockPrisma(t);

  const response = await dispatchApp('PUT', '/api/admin/accounts/user-target', { password: 'senha-nova-123' }, authHeader);

  assert.equal(response.statusCode, 200, response.body);
  const update = calls.find(([name]) => name === 'tx.user.update')?.[1];
  assert.ok(update?.data.passwordHash, 'password hash must be written inside the transaction');
  const revoke = calls.find(([name]) => name === 'tx.userSession.deleteMany')?.[1];
  assert.deepEqual(revoke?.where, { userId: 'user-target' });
});

test('PUT /admin/accounts/:id deactivating the account revokes its sessions', async t => {
  const calls = mockPrisma(t);

  const response = await dispatchApp('PUT', '/api/admin/accounts/user-target', { isActive: false }, authHeader);

  assert.equal(response.statusCode, 200, response.body);
  const revoke = calls.find(([name]) => name === 'tx.userSession.deleteMany')?.[1];
  assert.deepEqual(revoke?.where, { userId: 'user-target' });
});

test('PUT /admin/accounts/:id without password or deactivation keeps sessions', async t => {
  const calls = mockPrisma(t);

  const response = await dispatchApp('PUT', '/api/admin/accounts/user-target', { name: 'Novo nome' }, authHeader);

  assert.equal(response.statusCode, 200, response.body);
  assert.ok(calls.some(([name]) => name === 'user.update'));
  assert.ok(!calls.some(([name]) => name === 'tx.userSession.deleteMany'));
});

test('PUT /admin/accounts/:id rejects admin-defined passwords shorter than 10 characters', async t => {
  const calls = mockPrisma(t);

  const response = await dispatchApp('PUT', '/api/admin/accounts/user-target', { password: 'curta1234' }, authHeader);

  assert.equal(response.statusCode, 400, response.body);
  assert.equal(calls.length, 0);
});

test('sessionRevocationWhere keeps the current session when admins edit their own account', () => {
  const auth = { sessionId: 'session-admin', user: { id: 'user-admin' } };
  assert.deepEqual(sessionRevocationWhere('user-admin', auth), {
    userId: 'user-admin',
    id: { not: 'session-admin' }
  });
  assert.deepEqual(sessionRevocationWhere('user-target', auth), { userId: 'user-target' });
});
