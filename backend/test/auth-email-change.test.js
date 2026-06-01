import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import { createEmailChangeToken, hashToken } from '../src/lib/auth.js';
import prisma from '../src/lib/prisma.js';

function dispatchApp(method, pathName, body, token = 'email-change-test-token') {
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
      authorization: `Bearer ${token}`,
      host: '127.0.0.1',
      ...(payload ? {
        'content-type': 'application/json',
        'content-length': String(payload.length)
      } : {})
    };
    req.socket = new PassThrough();
    req.socket.remoteAddress = '127.0.0.1';
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

function authUser(overrides = {}) {
  return {
    id: 'user-1',
    username: 'joao',
    name: 'Joao',
    email: 'joao@example.com',
    emailVerifiedAt: new Date('2026-05-28T12:00:00.000Z'),
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    isActive: true,
    collaboratorId: null,
    collaborator: null,
    moduleRoles: [{ role: 'RDO_COLLABORATOR' }],
    ...overrides
  };
}

function stubSession(t, user = authUser()) {
  const originalSessionFindUnique = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => ({
    id: 'session-1',
    expiresAt: new Date(Date.now() + 60_000),
    user
  });
  t.after(() => {
    prisma.userSession.findUnique = originalSessionFindUnique;
  });
}

test('email change token expires in one hour and is stored hashed', async t => {
  const originalCreate = prisma.emailChangeToken.create;
  const calls = [];
  prisma.emailChangeToken.create = async args => {
    calls.push(args);
    return { id: 'token-1', ...args.data };
  };
  t.after(() => {
    prisma.emailChangeToken.create = originalCreate;
  });

  const before = Date.now();
  const result = await createEmailChangeToken('user-1', 'novo@example.com');
  const after = Date.now();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.userId, 'user-1');
  assert.equal(calls[0].data.email, 'novo@example.com');
  assert.equal(calls[0].data.tokenHash, hashToken(result.token));
  assert.ok(result.expiresAt.getTime() >= before + 60 * 60 * 1000);
  assert.ok(result.expiresAt.getTime() <= after + 60 * 60 * 1000 + 1000);
});


test('PUT /auth/account rejects email already used by another account before creating confirmation token', async t => {
  const user = authUser();
  stubSession(t, user);

  const originals = {
    userFindUniqueOrThrow: prisma.user.findUniqueOrThrow,
    userFindFirst: prisma.user.findFirst,
    emailChangeTokenCreate: prisma.emailChangeToken.create
  };
  prisma.user.findUniqueOrThrow = async args => {
    assert.deepEqual(args.include, { collaborator: true, moduleRoles: true });
    return user;
  };
  prisma.user.findFirst = async args => {
    assert.equal(args.where.OR[0].username.equals, 'ocupado@example.com');
    assert.equal(args.where.OR[1].email.equals, 'ocupado@example.com');
    return { id: 'other-user' };
  };
  prisma.emailChangeToken.create = async () => {
    throw new Error('Token não deve ser criado quando o e-mail já existe.');
  };
  t.after(() => {
    prisma.user.findUniqueOrThrow = originals.userFindUniqueOrThrow;
    prisma.user.findFirst = originals.userFindFirst;
    prisma.emailChangeToken.create = originals.emailChangeTokenCreate;
  });

  const response = await dispatchApp('PUT', '/api/auth/account', { email: 'Ocupado@Example.com' });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json.error, 'Já existe uma conta cadastrada para este e-mail.');
});

test('PUT /auth/account updates notification preferences without email change', async t => {
  const user = authUser();
  stubSession(t, user);

  const originals = {
    userFindUniqueOrThrow: prisma.user.findUniqueOrThrow,
    userUpdate: prisma.user.update
  };
  prisma.user.findUniqueOrThrow = async args => {
    assert.deepEqual(args.include, { collaborator: true, moduleRoles: true });
    return user;
  };
  prisma.user.update = async args => {
    assert.equal(args.where.id, user.id);
    assert.deepEqual(args.data, {
      notifyReportsByEmail: false,
      notifySignaturesByEmail: true,
      notifySurveyRemindersByEmail: false
    });
    return { ...user, ...args.data };
  };
  t.after(() => {
    prisma.user.findUniqueOrThrow = originals.userFindUniqueOrThrow;
    prisma.user.update = originals.userUpdate;
  });

  const response = await dispatchApp('PUT', '/api/auth/account', {
    notificationPreferences: {
      reports: false,
      signatures: true,
      surveyReminders: false
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.user.notificationPreferences, {
    reports: false,
    signatures: true,
    surveyReminders: false
  });
});

test('POST /auth/confirm-email-change consumes token once and verifies the new email', async t => {
  const token = 'confirm-token';
  const confirmedUser = authUser({
    id: 'client-1',
    username: 'novo@example.com',
    email: 'novo@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT'
  });
  const tokenRow = {
    id: 'token-1',
    tokenHash: hashToken(token),
    userId: 'client-1',
    email: 'novo@example.com',
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    user: authUser({
      id: 'client-1',
      username: 'antigo@example.com',
      email: 'antigo@example.com',
      role: 'CLIENT',
      accountType: 'CLIENT',
      isActive: true
    })
  };

  const originals = {
    emailChangeTokenFindUnique: prisma.emailChangeToken.findUnique,
    userFindFirst: prisma.user.findFirst,
    transaction: prisma.$transaction
  };
  const projectUpdates = [];
  prisma.emailChangeToken.findUnique = async args => {
    assert.equal(args.where.tokenHash, hashToken(token));
    return tokenRow;
  };
  prisma.user.findFirst = async args => {
    assert.equal(args.where.OR[1].email.equals, 'novo@example.com');
    return null;
  };
  prisma.$transaction = async callback => callback({
    emailChangeToken: {
      updateMany: async args => {
        assert.equal(args.where.id, 'token-1');
        assert.equal(args.where.usedAt, null);
        assert.ok(args.where.expiresAt.gt instanceof Date);
        return { count: 1 };
      }
    },
    user: {
      findFirst: async args => {
        assert.equal(args.where.OR[0].username.equals, 'novo@example.com');
        return null;
      },
      update: async args => {
        assert.equal(args.where.id, 'client-1');
        assert.equal(args.data.username, 'novo@example.com');
        assert.equal(args.data.email, 'novo@example.com');
        assert.ok(args.data.emailVerifiedAt instanceof Date);
        return confirmedUser;
      }
    },
    project: {
      findMany: async args => {
        assert.deepEqual(args.select, {
          id: true,
          clientEmailPrimary: true,
          clientEmailCc: true,
          clientSigners: true
        });
        return [
          {
            id: 'project-primary',
            clientEmailPrimary: 'antigo@example.com',
            clientEmailCc: ['copia@example.com'],
            clientSigners: []
          },
          {
            id: 'project-cc-signer',
            clientEmailPrimary: 'cliente@example.com',
            clientEmailCc: ['ANTIGO@example.com', 'outro@example.com'],
            clientSigners: [{ name: 'Fiscal', email: 'antigo@example.com' }]
          }
        ];
      },
      update: async args => {
        projectUpdates.push(args);
        return { id: args.where.id, ...args.data };
      }
    }
  });
  t.after(() => {
    prisma.emailChangeToken.findUnique = originals.emailChangeTokenFindUnique;
    prisma.user.findFirst = originals.userFindFirst;
    prisma.$transaction = originals.transaction;
  });

  const response = await dispatchApp('POST', '/api/auth/confirm-email-change', { token }, '');

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.user.email, 'novo@example.com');
  assert.equal(response.json.user.username, 'novo@example.com');
  assert.ok(response.json.user.emailVerifiedAt);
  assert.deepEqual(projectUpdates, [
    {
      where: { id: 'project-primary' },
      data: {
        clientEmailPrimary: 'novo@example.com'
      }
    },
    {
      where: { id: 'project-cc-signer' },
      data: {
        clientEmailCc: ['novo@example.com', 'outro@example.com'],
        clientSigners: [{ name: 'Fiscal', email: 'novo@example.com' }]
      }
    }
  ]);
});

test('POST /auth/confirm-email-change updates username for any account when username is the old email', async t => {
  const token = 'internal-confirm-token';
  const tokenRow = {
    id: 'token-internal',
    tokenHash: hashToken(token),
    userId: 'internal-1',
    email: 'novo.interno@example.com',
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    user: authUser({
      id: 'internal-1',
      username: 'antigo.interno@example.com',
      email: 'antigo.interno@example.com',
      role: 'COLLABORATOR',
      accountType: 'INTERNAL',
      isActive: true
    })
  };
  const confirmedUser = authUser({
    id: 'internal-1',
    username: 'novo.interno@example.com',
    email: 'novo.interno@example.com',
    role: 'COLLABORATOR',
    accountType: 'INTERNAL'
  });

  const originals = {
    emailChangeTokenFindUnique: prisma.emailChangeToken.findUnique,
    userFindFirst: prisma.user.findFirst,
    transaction: prisma.$transaction
  };
  prisma.emailChangeToken.findUnique = async args => {
    assert.equal(args.where.tokenHash, hashToken(token));
    return tokenRow;
  };
  prisma.user.findFirst = async args => {
    assert.equal(args.where.OR[0].username.equals, 'novo.interno@example.com');
    assert.equal(args.where.OR[1].email.equals, 'novo.interno@example.com');
    return null;
  };
  prisma.$transaction = async callback => callback({
    emailChangeToken: {
      updateMany: async () => ({ count: 1 })
    },
    user: {
      findFirst: async args => {
        assert.equal(args.where.OR[0].username.equals, 'novo.interno@example.com');
        assert.equal(args.where.OR[1].email.equals, 'novo.interno@example.com');
        return null;
      },
      update: async args => {
        assert.equal(args.where.id, 'internal-1');
        assert.equal(args.data.username, 'novo.interno@example.com');
        assert.equal(args.data.email, 'novo.interno@example.com');
        assert.ok(args.data.emailVerifiedAt instanceof Date);
        return confirmedUser;
      }
    },
    project: {
      findMany: async () => {
        throw new Error('Conta interna não deve migrar vínculos de projeto.');
      },
      update: async () => {
        throw new Error('Conta interna não deve atualizar projetos.');
      }
    }
  });
  t.after(() => {
    prisma.emailChangeToken.findUnique = originals.emailChangeTokenFindUnique;
    prisma.user.findFirst = originals.userFindFirst;
    prisma.$transaction = originals.transaction;
  });

  const response = await dispatchApp('POST', '/api/auth/confirm-email-change', { token }, '');

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.user.username, 'novo.interno@example.com');
  assert.equal(response.json.user.email, 'novo.interno@example.com');
});

test('POST /auth/confirm-email-change does not migrate project links for internal accounts', async t => {
  const token = 'internal-project-link-token';
  const tokenRow = {
    id: 'token-internal-project',
    tokenHash: hashToken(token),
    userId: 'internal-project-user',
    email: 'novo.interno@example.com',
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    user: authUser({
      id: 'internal-project-user',
      username: 'contato.cliente@example.com',
      email: 'contato.cliente@example.com',
      role: 'COLLABORATOR',
      accountType: 'INTERNAL',
      isActive: true
    })
  };
  const confirmedUser = authUser({
    id: 'internal-project-user',
    username: 'novo.interno@example.com',
    email: 'novo.interno@example.com',
    role: 'COLLABORATOR',
    accountType: 'INTERNAL'
  });

  const originals = {
    emailChangeTokenFindUnique: prisma.emailChangeToken.findUnique,
    userFindFirst: prisma.user.findFirst,
    transaction: prisma.$transaction
  };
  let projectFindManyCalled = false;
  let projectUpdateCalled = false;
  prisma.emailChangeToken.findUnique = async args => {
    assert.equal(args.where.tokenHash, hashToken(token));
    return tokenRow;
  };
  prisma.user.findFirst = async () => null;
  prisma.$transaction = async callback => callback({
    emailChangeToken: {
      updateMany: async () => ({ count: 1 })
    },
    user: {
      findFirst: async () => null,
      update: async args => {
        assert.equal(args.where.id, 'internal-project-user');
        assert.equal(args.data.username, 'novo.interno@example.com');
        assert.equal(args.data.email, 'novo.interno@example.com');
        return confirmedUser;
      }
    },
    project: {
      findMany: async () => {
        projectFindManyCalled = true;
        return [{
          id: 'project-1',
          clientEmailPrimary: 'contato.cliente@example.com',
          clientEmailCc: ['contato.cliente@example.com'],
          clientSigners: [{ name: 'Fiscal', email: 'contato.cliente@example.com' }]
        }];
      },
      update: async () => {
        projectUpdateCalled = true;
        throw new Error('Conta interna não deve atualizar projetos.');
      }
    }
  });
  t.after(() => {
    prisma.emailChangeToken.findUnique = originals.emailChangeTokenFindUnique;
    prisma.user.findFirst = originals.userFindFirst;
    prisma.$transaction = originals.transaction;
  });

  const response = await dispatchApp('POST', '/api/auth/confirm-email-change', { token }, '');

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.user.email, 'novo.interno@example.com');
  assert.equal(projectFindManyCalled, false);
  assert.equal(projectUpdateCalled, false);
});

test('POST /auth/confirm-email-change migrates project links from both current email and email-like username', async t => {
  const token = 'mixed-project-links-token';
  const tokenRow = {
    id: 'token-mixed',
    tokenHash: hashToken(token),
    userId: 'client-mixed',
    email: 'novo@example.com',
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    user: authUser({
      id: 'client-mixed',
      username: 'antigo@example.com',
      email: 'intermediario@example.com',
      role: 'CLIENT',
      accountType: 'CLIENT',
      isActive: true
    })
  };
  const confirmedUser = authUser({
    id: 'client-mixed',
    username: 'novo@example.com',
    email: 'novo@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT'
  });

  const originals = {
    emailChangeTokenFindUnique: prisma.emailChangeToken.findUnique,
    userFindFirst: prisma.user.findFirst,
    transaction: prisma.$transaction
  };
  const projectUpdates = [];
  prisma.emailChangeToken.findUnique = async args => {
    assert.equal(args.where.tokenHash, hashToken(token));
    return tokenRow;
  };
  prisma.user.findFirst = async () => null;
  prisma.$transaction = async callback => callback({
    emailChangeToken: {
      updateMany: async () => ({ count: 1 })
    },
    user: {
      findFirst: async () => null,
      update: async args => {
        assert.equal(args.where.id, 'client-mixed');
        assert.equal(args.data.username, 'novo@example.com');
        assert.equal(args.data.email, 'novo@example.com');
        return confirmedUser;
      }
    },
    project: {
      findMany: async () => [
        {
          id: 'project-a',
          clientEmailPrimary: 'antigo@example.com',
          clientEmailCc: ['intermediario@example.com', 'outro@example.com'],
          clientSigners: [{ name: 'Fiscal', email: 'intermediario@example.com' }]
        },
        {
          id: 'project-b',
          clientEmailPrimary: 'intermediario@example.com',
          clientEmailCc: ['antigo@example.com'],
          clientSigners: [{ name: 'Cliente', email: 'antigo@example.com' }]
        }
      ],
      update: async args => {
        projectUpdates.push(args);
        return { id: args.where.id, ...args.data };
      }
    }
  });
  t.after(() => {
    prisma.emailChangeToken.findUnique = originals.emailChangeTokenFindUnique;
    prisma.user.findFirst = originals.userFindFirst;
    prisma.$transaction = originals.transaction;
  });

  const response = await dispatchApp('POST', '/api/auth/confirm-email-change', { token }, '');

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.user.username, 'novo@example.com');
  assert.deepEqual(projectUpdates, [
    {
      where: { id: 'project-a' },
      data: {
        clientEmailPrimary: 'novo@example.com',
        clientEmailCc: ['outro@example.com'],
        clientSigners: []
      }
    },
    {
      where: { id: 'project-b' },
      data: {
        clientEmailPrimary: 'novo@example.com',
        clientEmailCc: [],
        clientSigners: []
      }
    }
  ]);
});

test('GET /auth/email-change-status hides email for invalid token', async t => {
  const originalFindUnique = prisma.emailChangeToken.findUnique;
  prisma.emailChangeToken.findUnique = async () => null;
  t.after(() => {
    prisma.emailChangeToken.findUnique = originalFindUnique;
  });

  const response = await dispatchApp('GET', '/api/auth/email-change-status?token=invalido', undefined, '');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    valid: false,
    expired: false,
    used: false,
    email: null
  });
});
