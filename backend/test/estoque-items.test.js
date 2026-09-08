import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import { z } from 'zod';

import app from '../src/app.js';
import prisma from '../src/lib/prisma.js';
import { makeEstoqueSchemas } from '../../shared/schemas/estoque.js';

const bearerToken = 'estoque-items-test-token';

function managerSession() {
  return {
    id: 'session-estoque-manager',
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'estoque-manager-1',
      username: 'estoque-manager',
      name: 'Gestor Estoque',
      email: 'estoque@example.com',
      role: 'MANAGER',
      accountType: 'ADMIN',
      isActive: true,
      moduleRoles: [{ role: 'ESTOQUE_MANAGER' }]
    }
  };
}

function stockItem(overrides = {}) {
  return {
    id: 'stock-item-1',
    type: 'PRODUTO_QUIMICO',
    categoryId: 'stock-category-1',
    category: stockCategory(),
    code: 'PQ-001',
    name: 'Produto Quimico',
    manufacturer: null,
    description: null,
    unitLabel: 'kg',
    minQuantity: null,
    location: null,
    filterModel: null,
    filterKind: null,
    filterMicron: null,
    unNumber: null,
    casNumber: null,
    documents: [],
    checklistEnabled: false,
    checklistItems: null,
    isActive: true,
    createdAt: new Date('2026-07-09T12:00:00.000Z'),
    updatedAt: new Date('2026-07-09T12:00:00.000Z'),
    _count: { movements: 0 },
    ...overrides
  };
}

function stockCategory(overrides = {}) {
  return {
    id: 'stock-category-1',
    type: 'PRODUTO_QUIMICO',
    name: 'Produtos químicos',
    checklistEnabled: false,
    checklistItems: [],
    isActive: true,
    createdAt: new Date('2026-07-09T12:00:00.000Z'),
    updatedAt: new Date('2026-07-09T12:00:00.000Z'),
    _count: { items: 0 },
    ...overrides
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

function stubAuthenticatedManager(t) {
  const originalFindUnique = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => managerSession();
  t.after(() => {
    prisma.userSession.findUnique = originalFindUnique;
  });
}

function stubStockItemModel(t, overrides = {}) {
  const originals = {
    findUnique: prisma.stockItem.findUnique,
    findMany: prisma.stockItem.findMany,
    create: prisma.stockItem.create,
    update: prisma.stockItem.update,
    delete: prisma.stockItem.delete
  };
  Object.assign(prisma.stockItem, {
    findUnique: async () => null,
    findMany: async () => [],
    create: async args => stockItem(args.data),
    update: async args => stockItem({ id: args.where.id, ...args.data }),
    delete: async args => stockItem({ id: args.where.id }),
    ...overrides
  });
  t.after(() => {
    Object.assign(prisma.stockItem, originals);
  });
}

function stubStockCategoryModel(t, overrides = {}) {
  const originals = {
    findUnique: prisma.stockCategory.findUnique,
    findFirst: prisma.stockCategory.findFirst,
    findMany: prisma.stockCategory.findMany,
    create: prisma.stockCategory.create,
    update: prisma.stockCategory.update,
    delete: prisma.stockCategory.delete
  };
  Object.assign(prisma.stockCategory, {
    findUnique: async args => stockCategory({ id: args.where.id }),
    findFirst: async args => stockCategory({ id: args.where.id || 'stock-category-1', type: args.where.type || 'PRODUTO_QUIMICO' }),
    findMany: async () => [],
    create: async args => stockCategory(args.data),
    update: async args => stockCategory({ id: args.where.id, ...args.data }),
    delete: async args => stockCategory({ id: args.where.id }),
    ...overrides
  });
  t.after(() => {
    Object.assign(prisma.stockCategory, originals);
  });
}

test('estoque item schemas enforce fields by type and movement quantity rules', () => {
  const schemas = makeEstoqueSchemas(z);

  assert.equal(schemas.itemCreate.parse({ type: 'FILTRO', code: 'FL-010', name: 'Filtro' }).unitLabel, 'un');
  assert.throws(
    () => schemas.itemCreate.parse({ type: 'FILTRO', code: 'FL-010', name: 'Filtro', unitLabel: 'kg', casNumber: '67-56-1' }),
    /Campo incompatível/
  );
  assert.equal(
    schemas.itemCreate.parse({
      type: 'PRODUTO_QUIMICO',
      code: 'PQ-001',
      name: 'Produto',
      unitLabel: 'kg',
      casNumber: '67-56-1',
      checklistEnabled: true,
      checklistItems: [' Validade conferida ']
    }).checklistItems[0],
    'Validade conferida'
  );
  assert.equal(
    schemas.itemCreate.parse({
      type: 'PRODUTO_QUIMICO',
      code: 'PQ-001',
      name: 'Produto',
      unitLabel: 'kg',
      casNumber: '67-56-1'
    }).casNumber,
    '67-56-1'
  );
  assert.throws(
    () => schemas.itemCreate.parse({ type: 'PRODUTO_QUIMICO', code: 'PQ-001', name: 'Quimico' }),
    /unitLabel/
  );
  assert.equal(
    schemas.movement({ itemType: 'FILTRO' }).safeParse({
      reason: 'COMPRA',
      itemId: 'item-1',
      quantity: 1.5,
      date: '2026-07-09',
      nfNumber: '123'
    }).success,
    false
  );
});

test('POST /estoque/itens rejects duplicated code with 409', async t => {
  stubAuthenticatedManager(t);
  stubStockItemModel(t, {
    findUnique: async args => (args.where.code === 'PQ-001' ? { id: 'existing-item' } : null)
  });
  stubStockCategoryModel(t);

  const response = await dispatchApp('POST', '/api/estoque/itens', {
    type: 'PRODUTO_QUIMICO',
    code: 'PQ-001',
    name: 'Produto',
    unitLabel: 'kg'
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.json.error, /Código de estoque já cadastrado/);
});

test('PUT /estoque/itens/:id blocks unit changes after movements', async t => {
  stubAuthenticatedManager(t);
  stubStockItemModel(t, {
    findUnique: async args => {
      if (args.where.id) return stockItem({ _count: { movements: 1 } });
      return null;
    }
  });
  stubStockCategoryModel(t);

  const response = await dispatchApp('PUT', '/api/estoque/itens/stock-item-1', {
    code: 'PQ-001',
    name: 'Produto',
    unitLabel: 'L'
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json.error, /unidade não pode ser alterada/i);
});

test('PATCH /estoque/itens/:id/ativo toggles active state', async t => {
  stubAuthenticatedManager(t);
  stubStockItemModel(t, {
    update: async args => stockItem({ id: args.where.id, isActive: args.data.isActive })
  });
  stubStockCategoryModel(t);

  const response = await dispatchApp('PATCH', '/api/estoque/itens/stock-item-1/ativo', { isActive: false });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.isActive, false);
});

test('DELETE /estoque/itens/:id blocks items with movements and removes unused items', async t => {
  stubAuthenticatedManager(t);
  let movements = 1;
  let deleted = false;
  stubStockItemModel(t, {
    findUnique: async () => stockItem({ _count: { movements } }),
    delete: async () => {
      deleted = true;
      return stockItem();
    }
  });
  stubStockCategoryModel(t);

  const blocked = await dispatchApp('DELETE', '/api/estoque/itens/stock-item-1', undefined);
  assert.equal(blocked.statusCode, 409);
  assert.equal(deleted, false);

  movements = 0;
  const removed = await dispatchApp('DELETE', '/api/estoque/itens/stock-item-1', undefined);
  assert.equal(removed.statusCode, 204);
  assert.equal(deleted, true);
});
