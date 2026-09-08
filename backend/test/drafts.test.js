import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import { hasModuleRole } from '../src/lib/module-roles.js';
import prisma from '../src/lib/prisma.js';
import { RDO_INTERNAL_ROLES } from '../src/middleware/auth.js';
import { isRdoDraftPayload, rdoDraftItems } from '../src/routes/resources/drafts.js';

const bearerToken = 'coordinator-draft-test-token';

function dispatchApp(method, pathName, body) {
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
      authorization: `Bearer ${bearerToken}`,
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
      resolve({ statusCode: res.statusCode, json: rawBody ? JSON.parse(rawBody) : null });
      return res;
    };

    app.handle(req, res, reject);
  });
}

function coordinatorSession() {
  return {
    id: 'session-coordinator',
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'coordinator-1',
      username: 'coordinator',
      name: 'Coordenador',
      email: 'coordinator@example.com',
      role: 'COORDINATOR',
      accountType: 'INTERNAL',
      isActive: true,
      moduleRoles: [{ role: 'RDO_COORDINATOR' }]
    }
  };
}

test('draft access covers every internal role allowed to create RDO reports', () => {
  const reportCreators = [
    { role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['rdo:manager'] },
    { role: 'COORDINATOR', accountType: 'INTERNAL', moduleRoles: ['rdo:coordinator'] },
    { role: 'COLLABORATOR', accountType: 'INTERNAL', moduleRoles: ['rdo:collaborator'] }
  ];

  for (const user of reportCreators) {
    assert.equal(hasModuleRole(user, RDO_INTERNAL_ROLES), true, `${user.role} deve poder salvar rascunhos`);
  }
  assert.equal(hasModuleRole(
    { role: 'CLIENT', accountType: 'CLIENT', moduleRoles: ['rdo:client'] },
    RDO_INTERNAL_ROLES
  ), false);
});

test('coordinator can persist an RDO draft through the authenticated endpoint', async t => {
  const originals = {
    sessionFindUnique: prisma.userSession.findUnique,
    draftFindMany: prisma.reportDraft.findMany,
    draftCreate: prisma.reportDraft.create
  };
  let createData = null;
  prisma.userSession.findUnique = async () => coordinatorSession();
  prisma.reportDraft.findMany = async () => [];
  prisma.reportDraft.create = async args => {
    createData = args.data;
    return {
      id: 'draft-coordinator',
      ...args.data,
      project: { id: args.data.projectId, code: '5822' },
      createdAt: new Date('2026-08-14T12:00:00.000Z'),
      updatedAt: new Date('2026-08-14T12:00:00.000Z')
    };
  };
  t.after(() => {
    prisma.userSession.findUnique = originals.sessionFindUnique;
    prisma.reportDraft.findMany = originals.draftFindMany;
    prisma.reportDraft.create = originals.draftCreate;
  });

  const response = await dispatchApp('POST', '/api/rdo/drafts', {
    projectId: 'project-5822',
    reportDate: '2026-08-14',
    title: '5822 - Projeto teste',
    payload: { projectId: 'project-5822', reportDate: '2026-08-14', services: [] }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json.id, 'draft-coordinator');
  assert.equal(createData.userId, 'coordinator-1');
  assert.equal(createData.payload.__module, 'rdo');
});

test('RDO draft filtering keeps legacy untagged drafts visible', () => {
  const items = [
    { id: 'legacy', payload: { projectId: 'project-1' } },
    { id: 'rdo', payload: { __module: 'rdo', projectId: 'project-1' } },
    { id: 'romaneio', payload: { __module: 'romaneio', projectId: 'project-1' } }
  ];

  assert.deepEqual(rdoDraftItems(items).map(item => item.id), ['legacy', 'rdo']);
});

test('RDO draft payload check only excludes romaneio drafts', () => {
  assert.equal(isRdoDraftPayload({ projectId: 'project-1' }), true);
  assert.equal(isRdoDraftPayload({ __module: 'rdo' }), true);
  assert.equal(isRdoDraftPayload({ __module: 'romaneio' }), false);
});
