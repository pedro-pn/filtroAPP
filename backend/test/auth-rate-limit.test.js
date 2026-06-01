import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import { hashToken } from '../src/lib/auth.js';
import prisma from '../src/lib/prisma.js';

function dispatchApp(method, pathName, body, remoteAddress = '198.51.100.10') {
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
      } : {})
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

test('POST /auth/forgot-password by CNPJ ignores deleted manager-only inactive projects', async t => {
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
  const projectLookup = calls.find(([name]) => name === 'project.findMany')?.[1];
  assert.deepEqual(projectLookup.where, {
    clientCnpj: '11222333000144',
    deletedAt: null,
    managerOnly: false,
    isActive: true
  });
  assert.equal(calls.some(([name]) => name.startsWith('passwordResetToken.')), false);
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
