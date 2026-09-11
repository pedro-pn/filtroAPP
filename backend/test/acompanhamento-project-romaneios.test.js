import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import { getMissionGroupRomaneios, getProjectRomaneios } from '../src/lib/acompanhamento/project-romaneios.js';

const entries = [
  { id: 'out-2', type: 'OUTBOUND', items: [
    { id: 'equipment', itemCode: 'UFI 008', itemName: 'Nome histórico', categoryName: 'Unidades de Filtragem', quantity: '1.000', unitLabel: 'unidade', isCustom: false },
    { id: 'hose', itemCode: 'MGA 006', itemName: 'Mangueira', categoryName: 'Mangueiras', quantity: '12.500', unitLabel: 'm', isCustom: false },
    { id: 'custom', itemCode: null, itemName: 'Estopa', categoryName: 'Itens não listados', quantity: '2.000', unitLabel: 'kg', isCustom: true }
  ] },
  { id: 'in-1', type: 'INBOUND', items: [{ id: 'return', itemCode: 'UFI 008', itemName: 'Nome histórico', quantity: '1.000', unitLabel: 'unidade' }] },
  { id: 'out-1', type: 'OUTBOUND', items: [{ id: 'previous', itemCode: 'UFI 008', itemName: 'Nome histórico', quantity: '1.000', unitLabel: 'unidade' }] }
];

test('consulta inclui todos os romaneios e itens sem filtro de origem, tipo ou limite; preserva quantidades e snapshots', async () => {
  const result = await getProjectRomaneios('p1', { db: {
    project: { findFirst: async query => {
      assert.deepEqual(query.where, { id: 'p1', deletedAt: null });
      return { id: 'p1' };
    } },
    romaneio: { findMany: async query => {
      assert.deepEqual(query.where, { projectId: { in: ['p1'] }, project: { deletedAt: null } });
      assert.equal(query.take, undefined);
      assert.equal(query.select.items.where, undefined);
      assert.deepEqual(query.orderBy, [{ romaneioDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }]);
      assert.deepEqual(query.select.items.orderBy, [{ sortOrder: 'asc' }, { id: 'asc' }]);
      return entries;
    } }
  } });
  assert.deepEqual(result.romaneios, entries);
  assert.equal(result.romaneios.flatMap(row => row.items).length, 5);
});

test('projeto sem romaneio retorna lista vazia; projeto inexistente não consulta romaneios', async () => {
  assert.deepEqual(await getProjectRomaneios('p1', { db: {
    project: { findFirst: async () => ({ id: 'p1' }) },
    romaneio: { findMany: async () => [] }
  } }), { romaneios: [] });
  assert.equal(await getProjectRomaneios('missing', { db: {
    project: { findFirst: async () => null },
    romaneio: { findMany: async () => assert.fail('Não pode consultar romaneios sem projeto.') }
  } }), null);
});

test('grupo reúne todas as missões atuais, inclusive inativas, sem duplicar consultas ou incluir excluídas', async () => {
  const result = await getMissionGroupRomaneios('g1', { db: {
    acompanhamentoMissionGroup: { findUnique: async query => {
      assert.deepEqual(query.where, { id: 'g1' });
      return { status: 'ACTIVE', members: [
        { projectId: 'p1', project: { deletedAt: null, isActive: true } },
        { projectId: 'p2', project: { deletedAt: null, isActive: false } },
        { projectId: 'p1', project: { deletedAt: null, isActive: true } },
        { projectId: 'deleted', project: { deletedAt: new Date() } }
      ] };
    } },
    romaneio: { findMany: async query => {
      assert.deepEqual(query.where.projectId.in, ['p1', 'p2']);
      return entries;
    } }
  } });
  assert.deepEqual(result.romaneios, entries);
});

test('grupo inexistente ou desmesclado não permite consultar romaneios', async () => {
  for (const group of [null, { status: 'DISSOLVED', members: [] }]) {
    await assert.rejects(getMissionGroupRomaneios('g1', { db: {
      acompanhamentoMissionGroup: { findUnique: async () => group },
      romaneio: { findMany: async () => assert.fail('Não pode consultar grupo inválido.') }
    } }), error => ['GROUP_NOT_FOUND', 'GROUP_NOT_ACTIVE'].includes(error.code));
  }
});

function dispatch(app, url, authenticated = true) {
  return new Promise((resolve, reject) => {
    const req = new Readable({ read() { this.push(null); } });
    req.method = 'GET';
    req.url = url;
    req.headers = { host: '127.0.0.1', ...(authenticated ? { authorization: 'Bearer romaneio-read-test' } : {}) };
    req.socket = new PassThrough();
    req.socket.remoteAddress = '127.0.0.1';
    req.connection = req.socket;
    const chunks = [];
    const headers = new Map();
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.statusCode = 200;
    res.setHeader = (name, value) => headers.set(String(name).toLowerCase(), value);
    res.getHeader = name => headers.get(String(name).toLowerCase());
    res.getHeaders = () => Object.fromEntries(headers);
    res.removeHeader = name => headers.delete(String(name).toLowerCase());
    res.writeHead = status => { res.statusCode = status; return res; };
    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      Writable.prototype.end.call(res, callback);
      const body = Buffer.concat(chunks).toString('utf8');
      resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null });
      return res;
    };
    app.handle(req, res, reject);
  });
}

test('rotas exigem acesso ao Acompanhamento e permitem consultar itens sem papel de edição do Romaneio', async t => {
  const [{ default: app }, { default: prisma }] = await Promise.all([import('../src/app.js'), import('../src/lib/prisma.js')]);
  function stub(model, method, implementation) {
    const original = model[method];
    model[method] = implementation;
    t.after(() => { model[method] = original; });
  }
  let hasAccess = true;
  stub(prisma.userSession, 'findUnique', async () => ({
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: 'viewer', name: 'Visualizador', role: 'COLLABORATOR', accountType: 'INTERNAL', isActive: true,
      moduleRoles: hasAccess ? [{ role: 'ACOMPANHAMENTO_VIEWER' }] : [] }
  }));
  stub(prisma.project, 'findFirst', async query => query.where.id === 'missing' ? null : { id: query.where.id });
  stub(prisma.acompanhamentoMissionGroup, 'findUnique', async query => query.where.id === 'missing' ? null : ({
    status: 'ACTIVE', members: [{ projectId: 'p1', project: { deletedAt: null } }]
  }));
  stub(prisma.romaneio, 'findMany', async () => entries);
  for (const target of ['projetos/p1', 'grupos-missoes/g1']) {
    const url = `/api/acompanhamento/comercial/${target}/romaneios`;
    assert.equal((await dispatch(app, url, false)).status, 401);
    hasAccess = false;
    assert.equal((await dispatch(app, url)).status, 403);
    hasAccess = true;
    const response = await dispatch(app, url);
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.romaneios, entries);
  }
  assert.equal((await dispatch(app, '/api/acompanhamento/comercial/projetos/missing/romaneios')).status, 404);
  assert.equal((await dispatch(app, '/api/acompanhamento/comercial/grupos-missoes/missing/romaneios')).status, 404);
});
