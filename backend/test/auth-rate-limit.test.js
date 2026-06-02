import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import { hashToken } from '../src/lib/auth.js';
import { hashPassword } from '../src/lib/password.js';
import prisma from '../src/lib/prisma.js';

function dispatchApp(method, pathName, body, remoteAddress = '198.51.100.10', headers = {}) {
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
      ...(payload ? {
        'content-type': 'application/json',
        'content-length': String(payload.length)
      } : {}),
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

test('POST /auth/login rate limits by IP and normalized username before password checks', async t => {
  const originalFindMany = prisma.user.findMany;
  const usernames = [];
  prisma.user.findMany = async args => {
    const username = args.where.OR[0].username.equals;
    usernames.push(username);
    return [];
  };
  t.after(() => {
    prisma.user.findMany = originalFindMany;
  });

  const body = { username: 'RateLimitLogin@example.com', password: 'senha-incorreta' };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await dispatchApp('POST', '/api/auth/login', body, '198.51.100.20');
    assert.equal(response.statusCode, 401);
  }

  const blocked = await dispatchApp('POST', '/api/auth/login', body, '198.51.100.20');
  assert.equal(blocked.statusCode, 429);
  assert.equal(usernames.filter(item => item === 'RateLimitLogin@example.com').length, 8);

  const otherUser = await dispatchApp('POST', '/api/auth/login', {
    username: 'outro-login@example.com',
    password: 'senha-incorreta'
  }, '198.51.100.20');
  assert.equal(otherUser.statusCode, 401);

  const otherIp = await dispatchApp('POST', '/api/auth/login', body, '198.51.100.21');
  assert.equal(otherIp.statusCode, 401);
});

test('POST /auth/forgot-password rate limits by IP and identifier before account lookup', async t => {
  const originalFindFirst = prisma.user.findFirst;
  const identifiers = [];
  prisma.user.findFirst = async args => {
    identifiers.push(args.where.username.equals);
    return null;
  };
  t.after(() => {
    prisma.user.findFirst = originalFindFirst;
  });

  const body = { identifier: 'rate-limit-forgot-user' };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await dispatchApp('POST', '/api/auth/forgot-password', body, '198.51.100.30');
    assert.equal(response.statusCode, 200);
  }

  const blocked = await dispatchApp('POST', '/api/auth/forgot-password', body, '198.51.100.30');
  assert.equal(blocked.statusCode, 429);
  assert.equal(identifiers.filter(item => item === 'rate-limit-forgot-user').length, 5);

  const otherIdentifier = await dispatchApp('POST', '/api/auth/forgot-password', {
    identifier: 'rate-limit-forgot-other'
  }, '198.51.100.30');
  assert.equal(otherIdentifier.statusCode, 200);
});

test('POST /auth/forgot-password by CNPJ does not provision or reactivate inactive clients', async t => {
  const originals = {
    userFindFirst: prisma.user.findFirst,
    userUpdate: prisma.user.update,
    projectFindMany: prisma.project.findMany,
    tokenDeleteMany: prisma.passwordResetToken.deleteMany,
    tokenCreate: prisma.passwordResetToken.create
  };
  const calls = [];
  prisma.user.findFirst = async args => {
    calls.push(['user.findFirst', args]);
    return null;
  };
  prisma.user.update = async args => {
    calls.push(['user.update', args]);
    throw new Error('forgot-password must not reactivate client accounts');
  };
  prisma.project.findMany = async args => {
    calls.push(['project.findMany', args]);
    return [{
      clientEmailPrimary: 'cliente@example.com',
      deletedAt: new Date(),
      managerOnly: false,
      isActive: false
    }];
  };
  prisma.passwordResetToken.deleteMany = async args => {
    calls.push(['passwordResetToken.deleteMany', args]);
    throw new Error('forgot-password must not create reset flow for inactive CNPJ clients');
  };
  prisma.passwordResetToken.create = async args => {
    calls.push(['passwordResetToken.create', args]);
    throw new Error('forgot-password must not create reset tokens for inactive CNPJ clients');
  };
  t.after(() => {
    prisma.user.findFirst = originals.userFindFirst;
    prisma.user.update = originals.userUpdate;
    prisma.project.findMany = originals.projectFindMany;
    prisma.passwordResetToken.deleteMany = originals.tokenDeleteMany;
    prisma.passwordResetToken.create = originals.tokenCreate;
  });

  const response = await dispatchApp('POST', '/api/auth/forgot-password', {
    identifier: '11.222.333/0001-44'
  }, '198.51.100.31');

  assert.equal(response.statusCode, 200);
  const cnpjLookup = calls.find(([name]) => name === 'user.findFirst')?.[1];
  assert.equal(cnpjLookup.where.username.equals, '11222333000144');
  assert.equal(cnpjLookup.where.role, 'CLIENT');
  assert.equal(cnpjLookup.where.isActive, true);
  assert.equal(calls.some(([name]) => name === 'user.update'), false);
  assert.equal(calls.some(([name]) => name === 'project.findMany'), false);
  assert.equal(calls.some(([name]) => name.startsWith('passwordResetToken.')), false);
});

test('POST /auth/forgot-password by CNPJ does not use project emails for reset authority', async t => {
  const originals = {
    userFindFirst: prisma.user.findFirst,
    projectFindMany: prisma.project.findMany,
    tokenDeleteMany: prisma.passwordResetToken.deleteMany,
    tokenCreate: prisma.passwordResetToken.create
  };
  const calls = [];
  prisma.user.findFirst = async args => {
    calls.push(['user.findFirst', args]);
    return {
      id: 'client-active',
      username: '11222333000144',
      email: null,
      role: 'CLIENT',
      accountType: 'CLIENT',
      isActive: true
    };
  };
  prisma.project.findMany = async args => {
    calls.push(['project.findMany', args]);
    return [];
  };
  prisma.passwordResetToken.deleteMany = async args => {
    calls.push(['passwordResetToken.deleteMany', args]);
    throw new Error('forgot-password must not create reset flow without eligible active client projects');
  };
  prisma.passwordResetToken.create = async args => {
    calls.push(['passwordResetToken.create', args]);
    throw new Error('forgot-password must not create reset token without eligible active client projects');
  };
  t.after(() => {
    prisma.user.findFirst = originals.userFindFirst;
    prisma.project.findMany = originals.projectFindMany;
    prisma.passwordResetToken.deleteMany = originals.tokenDeleteMany;
    prisma.passwordResetToken.create = originals.tokenCreate;
  });

  const response = await dispatchApp('POST', '/api/auth/forgot-password', {
    identifier: '11.222.333/0001-44'
  }, '198.51.100.32');

  assert.equal(response.statusCode, 200);
  assert.equal(calls.some(([name]) => name === 'project.findMany'), false);
  assert.equal(calls.some(([name]) => name.startsWith('passwordResetToken.')), false);
});

test('POST /auth/forgot-password by CNPJ sends reset only to verified account email', async t => {
  const originals = {
    setImmediate: global.setImmediate,
    userFindFirst: prisma.user.findFirst,
    projectFindMany: prisma.project.findMany,
    tokenDeleteMany: prisma.passwordResetToken.deleteMany,
    tokenCreate: prisma.passwordResetToken.create
  };
  const env = (await import('../src/config/env.js')).default;
  const previousEnv = {
    appUrl: env.appUrl,
    smtpHost: env.smtpHost,
    smtpPort: env.smtpPort,
    smtpUser: env.smtpUser,
    smtpPass: env.smtpPass,
    smtpFrom: env.smtpFrom
  };
  const calls = [];
  env.appUrl = 'https://app.example.com';
  env.smtpHost = 'smtp.example.com';
  env.smtpPort = 587;
  env.smtpUser = 'user';
  env.smtpPass = 'pass';
  env.smtpFrom = 'noreply@example.com';
  global.setImmediate = callback => {
    calls.push(['setImmediate', callback]);
    return {};
  };
  prisma.user.findFirst = async args => {
    calls.push(['user.findFirst', args]);
    return {
      id: 'client-active',
      username: '11222333000144',
      email: 'conta-verificada@example.com',
      emailVerifiedAt: new Date(),
      name: 'Cliente CNPJ',
      role: 'CLIENT',
      accountType: 'CLIENT',
      isActive: true
    };
  };
  prisma.project.findMany = async args => {
    calls.push(['project.findMany', args]);
    return [
      { clientEmailPrimary: 'projeto-a@example.com' },
      { clientEmailPrimary: 'projeto-b@example.com' }
    ];
  };
  prisma.passwordResetToken.deleteMany = async args => {
    calls.push(['passwordResetToken.deleteMany', args]);
    return { count: 0 };
  };
  prisma.passwordResetToken.create = async args => {
    calls.push(['passwordResetToken.create', args]);
    return { id: 'token-1', ...args.data };
  };
  t.after(() => {
    Object.assign(env, previousEnv);
    global.setImmediate = originals.setImmediate;
    prisma.user.findFirst = originals.userFindFirst;
    prisma.project.findMany = originals.projectFindMany;
    prisma.passwordResetToken.deleteMany = originals.tokenDeleteMany;
    prisma.passwordResetToken.create = originals.tokenCreate;
  });

  const response = await dispatchApp('POST', '/api/auth/forgot-password', {
    identifier: '11.222.333/0001-44'
  }, '198.51.100.33');

  assert.equal(response.statusCode, 200);
  assert.equal(calls.some(([name]) => name === 'project.findMany'), false);
  assert.equal(calls.some(([name]) => name === 'passwordResetToken.create'), true);
  assert.equal(calls.some(([name]) => name === 'setImmediate'), true);
});

test('POST /auth/reset-password rate limits by IP and token before token lookup', async t => {
  const originalFindUnique = prisma.passwordResetToken.findUnique;
  const tokenHashes = [];
  prisma.passwordResetToken.findUnique = async args => {
    tokenHashes.push(args.where.tokenHash);
    return null;
  };
  t.after(() => {
    prisma.passwordResetToken.findUnique = originalFindUnique;
  });

  const body = { token: 'rate-limit-reset-token', password: 'nova-senha' };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await dispatchApp('POST', '/api/auth/reset-password', body, '198.51.100.40');
    assert.equal(response.statusCode, 400);
  }

  const blocked = await dispatchApp('POST', '/api/auth/reset-password', body, '198.51.100.40');
  assert.equal(blocked.statusCode, 429);
  assert.equal(tokenHashes.filter(item => item === hashToken('rate-limit-reset-token')).length, 8);

  const otherToken = await dispatchApp('POST', '/api/auth/reset-password', {
    token: 'rate-limit-reset-other',
    password: 'nova-senha'
  }, '198.51.100.40');
  assert.equal(otherToken.statusCode, 400);
});

test('POST /auth/reset-password revokes existing user sessions after password reset', async t => {
  const originals = {
    tokenFindUnique: prisma.passwordResetToken.findUnique,
    transaction: prisma.$transaction
  };
  const calls = [];
  const tokenRow = {
    id: 'reset-token-row',
    userId: 'user-reset-sessions',
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: 'user-reset-sessions', isActive: true }
  };
  prisma.passwordResetToken.findUnique = async args => {
    calls.push(['passwordResetToken.findUnique', args]);
    return tokenRow;
  };
  prisma.$transaction = async callback => callback({
    passwordResetToken: {
      updateMany: async args => {
        calls.push(['tx.passwordResetToken.updateMany', args]);
        return { count: 1 };
      }
    },
    user: {
      update: async args => {
        calls.push(['tx.user.update', args]);
        return { id: tokenRow.userId };
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
    prisma.passwordResetToken.findUnique = originals.tokenFindUnique;
    prisma.$transaction = originals.transaction;
  });

  const response = await dispatchApp('POST', '/api/auth/reset-password', {
    token: 'valid-reset-token',
    password: 'nova-senha'
  }, '198.51.100.41');

  assert.equal(response.statusCode, 200);
  const sessionDelete = calls.find(([name]) => name === 'tx.userSession.deleteMany')?.[1];
  assert.deepEqual(sessionDelete.where, { userId: tokenRow.userId });
});

test('POST /auth/change-password revokes other sessions and preserves current session', async t => {
  const originals = {
    sessionFindUnique: prisma.userSession.findUnique,
    userFindUniqueOrThrow: prisma.user.findUniqueOrThrow,
    transaction: prisma.$transaction
  };
  const calls = [];
  const token = 'current-session-token';
  const session = {
    id: 'session-current',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'user-change-password',
      username: 'change-password-user',
      name: 'Usuário',
      email: 'usuario@example.com',
      role: 'MANAGER',
      accountType: 'INTERNAL',
      isActive: true,
      moduleRoles: [{ module: 'RDO', role: 'RDO_MANAGER' }]
    }
  };
  const passwordHash = await hashPassword('senha-atual');
  prisma.userSession.findUnique = async args => {
    calls.push(['userSession.findUnique', args]);
    return session;
  };
  prisma.user.findUniqueOrThrow = async args => {
    calls.push(['user.findUniqueOrThrow', args]);
    return { ...session.user, passwordHash };
  };
  prisma.$transaction = async callback => callback({
    user: {
      update: async args => {
        calls.push(['tx.user.update', args]);
        return { id: session.user.id };
      }
    },
    userSession: {
      deleteMany: async args => {
        calls.push(['tx.userSession.deleteMany', args]);
        return { count: 1 };
      }
    }
  });
  t.after(() => {
    prisma.userSession.findUnique = originals.sessionFindUnique;
    prisma.user.findUniqueOrThrow = originals.userFindUniqueOrThrow;
    prisma.$transaction = originals.transaction;
  });

  const response = await dispatchApp('POST', '/api/auth/change-password', {
    currentPassword: 'senha-atual',
    newPassword: 'nova-senha'
  }, '198.51.100.42', { authorization: `Bearer ${token}` });

  assert.equal(response.statusCode, 200);
  const sessionDelete = calls.find(([name]) => name === 'tx.userSession.deleteMany')?.[1];
  assert.deepEqual(sessionDelete.where, {
    userId: session.user.id,
    id: { not: session.id }
  });
});
