import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import { hasModuleRole } from '../src/lib/module-roles.js';
import prisma from '../src/lib/prisma.js';
import { RDO_INTERNAL_ROLES } from '../src/middleware/auth.js';
import { isRdoDraftPayload, rdoDraftItems, saveRdoDraft } from '../src/routes/resources/drafts.js';

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
    draftCreate: prisma.reportDraft.create,
    transaction: prisma.$transaction
  };
  let createData = null;
  prisma.userSession.findUnique = async () => coordinatorSession();
  prisma.reportDraft.findMany = async () => [];
  prisma.$transaction = async callback => callback({ reportDraft: prisma.reportDraft, $executeRaw: async () => 0 });
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
    prisma.$transaction = originals.transaction;
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

test('API autenticada bloqueia criar e editar rascunhos de arquivados para operador e usuário autorizado', async t => {
  const originals = {
    session: prisma.userSession.findUnique, transaction: prisma.$transaction,
    findMany: prisma.reportDraft.findMany, findUnique: prisma.reportDraft.findUniqueOrThrow,
    create: prisma.reportDraft.create, update: prisma.reportDraft.update
  };
  t.after(() => {
    prisma.userSession.findUnique = originals.session;
    prisma.$transaction = originals.transaction;
    prisma.reportDraft.findMany = originals.findMany;
    prisma.reportDraft.findUniqueOrThrow = originals.findUnique;
    prisma.reportDraft.create = originals.create;
    prisma.reportDraft.update = originals.update;
  });
  let writes = 0;
  prisma.reportDraft.create = prisma.reportDraft.update = async () => { writes += 1; throw new Error('Gravação indevida'); };
  const user = { ...coordinatorSession().user, role: 'COLLABORATOR', collaboratorId: 'collaborator-1', moduleRoles: [{ role: 'RDO_COLLABORATOR' }] };
  prisma.userSession.findUnique = async () => ({ ...coordinatorSession(), user });
  prisma.reportDraft.findMany = async () => [];
  prisma.reportDraft.findUniqueOrThrow = async () => ({ id: 'draft-1', userId: user.id, projectId: 'archived', payload: {} });
  for (const authorized of [false, true]) {
    const project = {
      isActive: false, deletedAt: null, operatorId: authorized ? 'other' : user.collaboratorId,
      authorizedUsers: authorized ? [{ userId: user.id }] : []
    };
    prisma.$transaction = callback => callback({
      project: { findUnique: async () => project }, reportDraft: prisma.reportDraft, $executeRaw: async () => 0
    });
    for (const [method, path] of [['POST', '/api/rdo/drafts'], ['PUT', '/api/rdo/drafts/draft-1']]) {
      const response = await dispatchApp(method, path, { projectId: 'archived', reportDate: '2026-10-20', payload: {} });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json.code, 'PROJECT_ARCHIVED_READ_ONLY');
    }
  }
  assert.equal(writes, 0);
});

test('RDO draft filtering keeps legacy untagged drafts visible', () => {
  const items = [
    { id: 'legacy', payload: { projectId: 'project-1' } },
    { id: 'rdo', payload: { __module: 'rdo', projectId: 'project-1' } },
    { id: 'romaneio', payload: { __module: 'romaneio', projectId: 'project-1' } }
  ];

  assert.deepEqual(rdoDraftItems(items).map(item => item.id), ['legacy', 'rdo']);
});

test('rascunhos de projeto excluído somem sem ocultar projetos arquivados ou rascunhos sem projeto', () => {
  const items = [
    { id: 'excluded', project: { deletedAt: new Date() }, payload: { __module: 'rdo' } },
    { id: 'archived', project: { deletedAt: null, isActive: false }, payload: { __module: 'rdo' } },
    { id: 'unassigned', project: null, payload: {} }
  ];
  assert.deepEqual(rdoDraftItems(items).map(item => item.id), ['archived', 'unassigned']);
});

test('RDO draft payload check only excludes romaneio drafts', () => {
  assert.equal(isRdoDraftPayload({ projectId: 'project-1' }), true);
  assert.equal(isRdoDraftPayload({ __module: 'rdo' }), true);
  assert.equal(isRdoDraftPayload({ __module: 'romaneio' }), false);
});

function draftDatabase(items = [], projects = {}) {
  const rows = new Map(items.map(item => [item.id, structuredClone(item)]));
  const client = {
    $executeRaw: async () => 0,
    project: { findUnique: async ({ where }) => projects[where.id] ?? { isActive: true, deletedAt: null } },
    reportDraft: {
      async findMany({ where }) {
        return [...rows.values()].filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
      },
      async findUniqueOrThrow({ where }) {
        if (!rows.has(where.id)) throw Object.assign(new Error('Not found'), { code: 'P2025' });
        return rows.get(where.id);
      },
      async create({ data }) {
        const row = { id: `draft-${rows.size + 1}`, ...data };
        rows.set(row.id, row);
        return row;
      },
      async update({ where, data }) {
        const row = { ...rows.get(where.id), ...data };
        rows.set(row.id, row);
        return row;
      }
    }
  };
  return { rows, $transaction: callback => callback(client) };
}

test('repeated creation updates the existing RDO ID without deleting its contents first', async () => {
  const database = draftDatabase();
  const initial = { projectId: 'project-1', reportDate: '2026-10-17', payload: { dailyDescription: 'Inicial' } };
  const first = await saveRdoDraft(database, 'user-1', initial);
  const retry = await saveRdoDraft(database, 'user-1', { ...initial, payload: { dailyDescription: 'Atualizado' } });
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.item.id, first.item.id);
  assert.equal(retry.item.payload.dailyDescription, 'Atualizado');
  assert.equal(database.rows.size, 1);
});

test('RDO creation preserves romaneio, service-only, other dates and other users', async () => {
  const common = { userId: 'user-1', projectId: 'project-1', reportDate: '2026-10-17' };
  const existing = [
    { ...common, id: 'romaneio', payload: { __module: 'romaneio' } },
    { ...common, id: 'service', payload: { __module: 'rdo', serviceOnly: true } },
    { ...common, id: 'another-user', userId: 'user-2', payload: {} },
    { ...common, id: 'another-date', reportDate: '2026-10-16', payload: {} }
  ];
  const database = draftDatabase(existing);
  const saved = await saveRdoDraft(database, common.userId, { ...common, payload: {} });
  assert.equal(saved.created, true);
  for (const draft of existing) assert.deepEqual(database.rows.get(draft.id), draft);
  assert.equal(database.rows.size, 5);
});

test('legacy RDO IDs remain reusable and editing a draft does not delete another draft', async () => {
  const common = { userId: 'user-1', projectId: 'project-1', reportDate: '2026-10-17' };
  const database = draftDatabase([
    { ...common, id: 'legacy', payload: { dailyDescription: 'Legado' } },
    { ...common, id: 'duplicate', payload: { dailyDescription: 'Outra edição' } }
  ]);
  const saved = await saveRdoDraft(database, common.userId, { ...common, payload: { dailyDescription: 'Atualizado' } });
  assert.equal(saved.item.id, 'legacy');
  await saveRdoDraft(database, common.userId, { ...common, reportDate: '2026-10-18', payload: {} }, 'legacy');
  assert.equal(database.rows.get('duplicate').payload.dailyDescription, 'Outra edição');
  assert.equal(database.rows.size, 2);
});

test('editing cannot take ownership of another user or module draft', async () => {
  for (const draft of [
    { id: 'protected', userId: 'other-user', payload: {} },
    { id: 'protected', userId: 'user-1', payload: { __module: 'romaneio' } }
  ]) {
    const database = draftDatabase([draft]);
    await assert.rejects(saveRdoDraft(database, 'user-1', { payload: {} }, draft.id), { statusCode: 403 });
    assert.deepEqual(database.rows.get(draft.id), draft);
  }
});

test('colaborador não cria nem atualiza rascunho de projeto arquivado, mesmo trocando ou removendo o projeto', async () => {
  const draft = { id: 'archived-draft', userId: 'user-1', projectId: 'archived', reportDate: '2026-10-20', payload: { dailyDescription: 'Preservar' } };
  const projects = { archived: { isActive: false, deletedAt: null }, active: { isActive: true, deletedAt: null } };
  for (const [draftId, projectId] of [
    [null, 'archived'], ['archived-draft', 'archived'], ['archived-draft', 'active'], ['archived-draft', null]
  ]) {
    const database = draftDatabase([draft], projects);
    await assert.rejects(saveRdoDraft(database, 'user-1', {
      projectId, reportDate: '2026-10-20', payload: { dailyDescription: 'Não salvar' }
    }, draftId), error => error.statusCode === 403 && error.code === 'PROJECT_ARCHIVED_READ_ONLY');
    assert.equal(database.rows.size, 1);
    assert.deepEqual(database.rows.get(draft.id), draft);
  }
});

test('rascunho legado também mantém somente leitura quando o projeto arquivado está no payload', async () => {
  const draft = { id: 'legacy', userId: 'user-1', payload: { projectId: 'archived', dailyDescription: 'Preservar' } };
  const database = draftDatabase([draft], { archived: { isActive: false, deletedAt: null } });
  await assert.rejects(saveRdoDraft(database, 'user-1', { payload: {} }, draft.id), { statusCode: 403, code: 'PROJECT_ARCHIVED_READ_ONLY' });
  assert.deepEqual(database.rows.get(draft.id), draft);
});

test('colaborador mantém rascunhos sem projeto e em projetos ativos; arquivar passa a bloquear novos salvamentos', async () => {
  const projects = { project: { isActive: true, deletedAt: null } };
  const database = draftDatabase([], projects);
  const input = { projectId: 'project', reportDate: '2026-10-20', payload: { dailyDescription: 'Inicial' } };
  const first = await saveRdoDraft(database, 'user-1', input);
  projects.project.isActive = false;
  await assert.rejects(saveRdoDraft(database, 'user-1', { ...input, payload: { dailyDescription: 'Depois de arquivar' } }, first.item.id), { statusCode: 403 });
  assert.equal(database.rows.get(first.item.id).payload.dailyDescription, 'Inicial');
  const unassigned = await saveRdoDraft(database, 'user-1', { payload: {} });
  assert.equal(unassigned.created, true);
});
