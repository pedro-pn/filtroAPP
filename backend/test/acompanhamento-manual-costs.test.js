import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import { test } from 'node:test';

import app from '../src/app.js';
import {
  normalizeManualProjectCostInput,
  summarizeManualProjectCostRows,
  getManualProjectCostsByProject
} from '../src/lib/acompanhamento/manual-costs.js';
import prisma from '../src/lib/prisma.js';

const bearerToken = 'manual-cost-test-token';

test('custos manuais vazios não consultam metadados de projeto ou usuário', async t => {
  const original = prisma.projectManualCost.findMany;
  const projectRead = prisma.project.findMany, userRead = prisma.user.findMany;
  t.after(() => { prisma.projectManualCost.findMany = original; prisma.project.findMany = projectRead; prisma.user.findMany = userRead; });
  prisma.projectManualCost.findMany = async () => [];
  prisma.project.findMany = () => { throw new Error('unexpected project read'); };
  prisma.user.findMany = () => { throw new Error('unexpected user read'); };
  assert.deepEqual(await getManualProjectCostsByProject(['p'], { includeEntries: true }), new Map());
});

test('custos manuais mantêm decimais, autoria, códigos e atualização em uma nova leitura', async t => {
  const originals = [prisma.projectManualCost.findMany, prisma.project.findMany, prisma.user.findMany];
  t.after(() => { [prisma.projectManualCost.findMany, prisma.project.findMany, prisma.user.findMany] = originals; });
  const rows = [{ id: 'm', projectId: 'p', description: 'Frete', amount: '0.10', createdByUserId: 'u' },
    { id: 'n', projectId: 'p', description: 'Material', amount: '0.20', createdByUserId: null }];
  let name = 'Pessoa', code = '1001';
  prisma.projectManualCost.findMany = async () => rows;
  prisma.project.findMany = async ({ where }) => { assert.deepEqual(where.id.in, ['p']); return [{ id: 'p', code }]; };
  prisma.user.findMany = async ({ where }) => { assert.deepEqual(where.id.in, ['u']); return [{ id: 'u', name }]; };
  const expected = () => summarizeManualProjectCostRows(rows.map(row => ({ ...row, project: { code }, createdBy: row.createdByUserId ? { id: 'u', name } : null })));
  assert.deepEqual(await getManualProjectCostsByProject(['p'], { includeEntries: true }), expected());
  name = 'Pessoa atualizada'; code = '1002';
  assert.deepEqual(await getManualProjectCostsByProject(['p'], { includeEntries: true }), expected());
  prisma.user.findMany = () => { throw new Error('summary must not resolve authors'); };
  assert.equal((await getManualProjectCostsByProject(['p'])).get('p').total, .3);
});

function managerSession() {
  return {
    id: 'session-acompanhamento-manager',
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'manager-1',
      username: 'manager',
      name: 'Gestor Acompanhamento',
      email: 'manager@example.com',
      role: 'MANAGER',
      accountType: 'ADMIN',
      isActive: true,
      moduleRoles: []
    }
  };
}

function viewerSession() {
  return {
    id: 'session-acompanhamento-viewer',
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'viewer-1',
      username: 'viewer',
      name: 'Visualizador Acompanhamento',
      email: 'viewer@example.com',
      role: 'COLLABORATOR',
      accountType: 'INTERNAL',
      isActive: true,
      moduleRoles: [{ role: 'ACOMPANHAMENTO_VIEWER' }]
    }
  };
}

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
      resolve({ statusCode: res.statusCode, body: rawBody, json: rawBody ? JSON.parse(rawBody) : null });
      return res;
    };

    app.handle(req, res, reject);
  });
}

function stubSession(t, session) {
  const originalFindUnique = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => session;
  t.after(() => {
    prisma.userSession.findUnique = originalFindUnique;
  });
}

test('normalizeManualProjectCostInput normaliza valor, texto e data', () => {
  const out = normalizeManualProjectCostInput({
    description: '  Material pago pelo cliente  ',
    amount: 123.456,
    costDate: '2026-07-20',
    note: '  desconto em NF  '
  });

  assert.equal(out.description, 'Material pago pelo cliente');
  assert.equal(out.amount, 123.46);
  assert.equal(out.costDate.toISOString(), '2026-07-20T00:00:00.000Z');
  assert.equal(out.note, 'desconto em NF');
});

test('normalizeManualProjectCostInput rejeita valores inválidos', () => {
  assert.throws(() => normalizeManualProjectCostInput({ description: '', amount: 10 }), /descrição/);
  assert.throws(() => normalizeManualProjectCostInput({ description: 'X', amount: 0 }), /maior que zero/);
  assert.throws(() => normalizeManualProjectCostInput({ description: 'X', amount: 10, costDate: 'xx' }), /Data/);
});

test('summarizeManualProjectCostRows agrega por projeto e monta categorias', () => {
  const rows = [
    {
      id: 'c1',
      projectId: 'p1',
      description: 'Material pago pelo cliente',
      amount: '100.50',
      costDate: '2026-07-20T00:00:00.000Z',
      note: null,
      createdAt: '2026-07-21T00:00:00.000Z',
      project: { code: '1001' },
      createdBy: { id: 'u1', name: 'Ana' }
    },
    {
      id: 'c2',
      projectId: 'p1',
      description: 'Frete',
      amount: 20,
      costDate: null,
      note: 'Cliente pagou',
      createdAt: '2026-07-22T00:00:00.000Z',
      project: { code: '1001' },
      createdBy: null
    }
  ];

  const summary = summarizeManualProjectCostRows(rows).get('p1');

  assert.equal(summary.total, 120.5);
  assert.deepEqual(summary.categories, [
    { categoria: 'Manual: Material pago pelo cliente', total: 100.5 },
    { categoria: 'Manual: Frete', total: 20 }
  ]);
  assert.deepEqual(summary.entries.map(item => [item.id, item.projectCode, item.amount, item.createdBy?.name ?? null]), [
    ['c2', '1001', 20, null],
    ['c1', '1001', 100.5, 'Ana']
  ]);
});

test('POST /acompanhamento/comercial/projetos/:projectId/custos-manuais cria custo manual para gestor', async t => {
  stubSession(t, managerSession());
  const originals = {
    projectFindFirst: prisma.project.findFirst,
    manualCostCreate: prisma.projectManualCost.create
  };
  const calls = [];
  prisma.project.findFirst = async args => {
    calls.push({ model: 'project.findFirst', args });
    return { id: 'project-1' };
  };
  prisma.projectManualCost.create = async args => {
    calls.push({ model: 'projectManualCost.create', args });
    return {
      id: 'manual-cost-1',
      projectId: args.data.projectId,
      description: args.data.description,
      amount: args.data.amount,
      costDate: args.data.costDate,
      note: args.data.note,
      createdAt: new Date('2026-07-21T12:00:00.000Z'),
      project: { code: '1001' },
      createdBy: { id: 'manager-1', name: 'Gestor Acompanhamento' }
    };
  };
  t.after(() => {
    prisma.project.findFirst = originals.projectFindFirst;
    prisma.projectManualCost.create = originals.manualCostCreate;
  });

  const response = await dispatchApp('POST', '/api/acompanhamento/comercial/projetos/project-1/custos-manuais', {
    description: ' Frete pago pelo cliente ',
    amount: 25.678,
    costDate: '2026-07-20',
    note: ' Descontar do cliente '
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json.description, 'Frete pago pelo cliente');
  assert.equal(response.json.amount, 25.68);
  assert.equal(response.json.costDate, '2026-07-20T00:00:00.000Z');
  assert.equal(response.json.createdBy.name, 'Gestor Acompanhamento');
  assert.deepEqual(calls.map(call => call.model), ['project.findFirst', 'projectManualCost.create']);
  assert.equal(calls[1].args.data.createdByUserId, 'manager-1');
});

test('DELETE /acompanhamento/comercial/projetos/:projectId/custos-manuais/:costId aplica soft delete', async t => {
  stubSession(t, managerSession());
  const originalUpdateMany = prisma.projectManualCost.updateMany;
  const calls = [];
  prisma.projectManualCost.updateMany = async args => {
    calls.push(args);
    return { count: 1 };
  };
  t.after(() => {
    prisma.projectManualCost.updateMany = originalUpdateMany;
  });

  const response = await dispatchApp('DELETE', '/api/acompanhamento/comercial/projetos/project-1/custos-manuais/manual-cost-1');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, { ok: true, id: 'manual-cost-1' });
  assert.deepEqual(calls[0].where, { id: 'manual-cost-1', projectId: 'project-1', deletedAt: null });
  assert.ok(calls[0].data.deletedAt instanceof Date);
});

test('custos manuais exigem gestor do Acompanhamento', async t => {
  stubSession(t, viewerSession());
  const originalFindFirst = prisma.project.findFirst;
  prisma.project.findFirst = async () => {
    assert.fail('Projeto não deve ser consultado quando a permissão bloqueia a rota.');
  };
  t.after(() => {
    prisma.project.findFirst = originalFindFirst;
  });

  const response = await dispatchApp('POST', '/api/acompanhamento/comercial/projetos/project-1/custos-manuais', {
    description: 'Frete',
    amount: 10
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.json.error, /gestor de Acompanhamento/);
});
