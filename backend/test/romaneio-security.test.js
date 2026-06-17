import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import AdmZip from 'adm-zip';

import app from '../src/app.js';
import { buildRomaneioDocx, buildRomaneioFileName } from '../src/lib/romaneio-docx.js';
import { parseEquipmentRows, syncCatalogRows, syncRomaneioCatalog } from '../src/lib/romaneio-catalog.js';
import prisma from '../src/lib/prisma.js';
import {
  buildRomaneioItems,
  cleanupFailedRomaneioCreate,
  requireRomaneioEditor,
  requireRomaneioManager,
  requireRomaneioModuleAccess,
  resolveRomaneioProjectReference,
  romaneioProjectWhereForUser,
  romaneioEmailFailureResult,
  shouldCleanupFailedRomaneioCreate,
  visibleRomaneioWhere
} from '../src/routes/resources/romaneios.js';

const bearerToken = 'romaneio-test-token';

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function romaneioOnlyManagerSession() {
  return {
    id: 'session-romaneio-manager',
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'romaneio-manager-1',
      username: 'romaneio-manager',
      name: 'Romaneio Manager',
      email: 'romaneio@example.com',
      role: 'COORDINATOR',
      accountType: 'INTERNAL',
      isActive: true,
      moduleRoles: [{ role: 'ROMANEIO_MANAGER' }]
    }
  };
}

function romaneioOnlyOperatorSession() {
  return {
    id: 'session-romaneio-operator',
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'romaneio-operator-1',
      username: 'romaneio-operator',
      name: 'Romaneio Operator',
      email: 'romaneio-operator@example.com',
      role: 'COORDINATOR',
      accountType: 'INTERNAL',
      isActive: true,
      moduleRoles: [{ role: 'ROMANEIO_OPERATOR' }]
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

function stubRomaneioOnlyManager(t) {
  const originalFindUnique = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => romaneioOnlyManagerSession();
  t.after(() => {
    prisma.userSession.findUnique = originalFindUnique;
  });
}

function stubRomaneioOnlyOperator(t) {
  const originalFindUnique = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => romaneioOnlyOperatorSession();
  t.after(() => {
    prisma.userSession.findUnique = originalFindUnique;
  });
}

test('Romaneio module access rejects internal accounts without romaneio roles', () => {
  const req = {
    auth: {
      user: { accountType: 'INTERNAL', moduleRoles: ['epi:technician'] }
    }
  };
  const res = responseRecorder();
  let nextCalled = false;

  requireRomaneioModuleAccess(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);

  req.auth.user.moduleRoles = ['romaneio:operator'];
  requireRomaneioModuleAccess(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('Romaneio manager guard rejects admin accounts without manager role', () => {
  const req = {
    auth: {
      user: { accountType: 'ADMIN', moduleRoles: ['romaneio:operator'] }
    }
  };
  const res = responseRecorder();
  let nextCalled = false;

  requireRomaneioManager(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);

  req.auth.user.moduleRoles = ['romaneio:manager'];
  requireRomaneioManager(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('Romaneio editor guard allows only managers and coordinators', () => {
  const req = {
    auth: {
      user: { role: 'COLLABORATOR', moduleRoles: ['romaneio:operator'] }
    }
  };
  const res = responseRecorder();
  let nextCalled = false;

  requireRomaneioEditor(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);

  req.auth.user.role = 'COORDINATOR';
  requireRomaneioEditor(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('Romaneio DOCX header includes cargo weight', async () => {
  const bytes = await buildRomaneioDocx({
    id: 'romaneio-weight',
    project: {
      code: 'P-001',
      name: 'Projeto',
      clientName: 'Cliente',
      contractCode: 'PROP-1',
      clientCnpj: '11222333000144',
      location: 'Base'
    },
    romaneioDate: new Date('2026-06-02T12:00:00.000-03:00'),
    vehiclePlate: 'ABC1234',
    driverName: 'Motorista',
    cargoWeight: 150,
    cargoWeightUnit: 'kg',
    items: [{
      itemName: 'Item',
      itemCode: 'I-1',
      categoryName: 'Categoria',
      quantity: 1,
      unitLabel: 'unidade',
      sortOrder: 0
    }]
  });
  const xml = new AdmZip(Buffer.from(bytes)).readAsText('word/document.xml');

  assert.match(xml, /Peso da carga/);
  assert.match(xml, /150 kg/);
  assert.doesNotMatch(xml, /15 kg/);
  assert.doesNotMatch(xml, /&lt;&lt;weight&gt;&gt;|<<weight>>/);
});

test('Romaneio generated file name uses project mission and date', () => {
  const fileName = buildRomaneioFileName({
    project: {
      code: 'FG-K2-101-KW',
      name: 'Projeto Teste'
    },
    romaneioDate: new Date('2026-06-02T12:00:00.000-03:00')
  });

  assert.equal(fileName, 'Romaneio - Missão FG-K2-101-KW - Projeto Teste - 02-06-2026.docx');
  assert.equal(fileName.replace(/\.docx$/i, '.pdf'), 'Romaneio - Missão FG-K2-101-KW - Projeto Teste - 02-06-2026.pdf');
});

test('Romaneio item builder allows only previously linked inactive catalog items', async t => {
  const originalFindMany = prisma.romaneioCatalogItem.findMany;
  let allowInactive = false;
  prisma.romaneioCatalogItem.findMany = async args => {
    const allowedIds = args.where.OR.flatMap(condition => condition.id?.in || []);
    allowInactive = allowedIds.includes('catalog-inactive');
    return allowInactive ? [{
      id: 'catalog-inactive',
      code: 'OLD-1',
      name: 'Item antigo',
      categoryName: 'Categoria',
      kind: 'EQUIPMENT',
      measureType: 'UNIT',
      defaultUnitLabel: 'unidade',
      isSerialized: true,
      isActive: false
    }] : [];
  };
  t.after(() => {
    prisma.romaneioCatalogItem.findMany = originalFindMany;
  });
  const item = {
    catalogItemId: 'catalog-inactive',
    quantity: 1
  };

  await assert.rejects(
    () => buildRomaneioItems([item]),
    /Item do catálogo inválido ou inativo/
  );

  const result = await buildRomaneioItems([item], {
    allowedInactiveCatalogItemIds: ['catalog-inactive']
  });

  assert.equal(allowInactive, true);
  assert.equal(result[0].catalogItemId, 'catalog-inactive');
  assert.equal(result[0].itemName, 'Item antigo');
});

test('Romaneio catalog GET only reads active catalog rows', async t => {
  stubRomaneioOnlyManager(t);
  const originalFindMany = prisma.romaneioCatalogItem.findMany;
  const originalTransaction = prisma.$transaction;
  const calls = [];
  prisma.romaneioCatalogItem.findMany = async args => {
    calls.push(args);
    return [{
      id: 'catalog-1',
      code: 'EQ 1',
      name: 'Equipamento 1',
      categoryName: 'EQUIPAMENTOS',
      kind: 'EQUIPMENT',
      measureType: 'UNIT',
      defaultUnitLabel: 'unidade',
      isSerialized: true,
      isActive: true
    }];
  };
  prisma.$transaction = async () => {
    throw new Error('catalog GET should not run sync writes');
  };
  t.after(() => {
    prisma.romaneioCatalogItem.findMany = originalFindMany;
    prisma.$transaction = originalTransaction;
  });

  const response = await dispatchApp('GET', '/api/romaneio/catalog');

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.length, 1);
  assert.deepEqual(calls[0], {
    where: { isActive: true },
    orderBy: [{ categoryName: 'asc' }, { code: 'asc' }, { name: 'asc' }]
  });
});

test('cleanupFailedRomaneioCreate removes generated files and the created row', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'romaneio-cleanup-'));
  const docxPath = path.join(dir, 'romaneio.docx');
  const pdfPath = path.join(dir, 'romaneio.pdf');
  await fs.writeFile(docxPath, 'docx');
  await fs.writeFile(pdfPath, 'pdf');
  const deletes = [];

  await cleanupFailedRomaneioCreate({
    romaneioId: 'romaneio-1',
    files: {
      docx: { targetPath: docxPath },
      pdf: { targetPath: pdfPath }
    },
    client: {
      romaneio: {
        delete: async args => {
          deletes.push(args);
        }
      }
    }
  });

  await assert.rejects(() => fs.access(docxPath), /ENOENT/);
  await assert.rejects(() => fs.access(pdfPath), /ENOENT/);
  assert.deepEqual(deletes, [{ where: { id: 'romaneio-1' } }]);
});

test('romaneioEmailFailureResult stores SMTP failures without failing creation', () => {
  assert.deepEqual(
    romaneioEmailFailureResult(new Error('SMTP indisponivel')),
    { status: 'erro no envio', error: 'SMTP indisponivel' }
  );
});

test('romaneio creation cleanup preserves rows after files are persisted before email status update', () => {
  assert.equal(shouldCleanupFailedRomaneioCreate({ completed: false, filesPersisted: false }), true);
  assert.equal(shouldCleanupFailedRomaneioCreate({ completed: false, filesPersisted: true }), false);
  assert.equal(shouldCleanupFailedRomaneioCreate({ completed: true, filesPersisted: true }), false);
});

test('Romaneio visibility queries exclude soft-deleted projects', () => {
  assert.deepEqual(
    visibleRomaneioWhere(),
    { project: { deletedAt: null } }
  );
  assert.deepEqual(
    visibleRomaneioWhere({ id: 'romaneio-1', project: { code: { contains: 'P-001' } } }),
    {
      id: 'romaneio-1',
      project: {
        code: { contains: 'P-001' },
        deletedAt: null
      }
    }
  );
  assert.deepEqual(
    romaneioProjectWhereForUser({ role: 'MANAGER' }),
    { deletedAt: null }
  );
  assert.deepEqual(
    romaneioProjectWhereForUser({ role: 'COORDINATOR' }),
    { deletedAt: null, isActive: true, managerOnly: false }
  );
  assert.deepEqual(
    visibleRomaneioWhere({ id: 'romaneio-1' }, { role: 'COORDINATOR' }),
    {
      id: 'romaneio-1',
      project: { deletedAt: null, isActive: true, managerOnly: false }
    }
  );
});

test('Romaneio project list hides manager-only and inactive projects from operators', async t => {
  stubRomaneioOnlyOperator(t);
  const originalFindMany = prisma.project.findMany;
  const calls = [];
  prisma.project.findMany = async args => {
    calls.push(args);
    return [];
  };
  t.after(() => {
    prisma.project.findMany = originalFindMany;
  });

  const response = await dispatchApp('GET', '/api/romaneio/projects');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0].where, {
    deletedAt: null,
    isActive: true,
    managerOnly: false
  });
  assert.equal(calls[0].select.clientCnpj, undefined);
  assert.equal(calls[0].select.clientEmailPrimary, undefined);
});

test('Romaneio project list keeps manager-only projects visible to global managers', async t => {
  const originalFindUnique = prisma.userSession.findUnique;
  const originalFindMany = prisma.project.findMany;
  const calls = [];
  prisma.userSession.findUnique = async () => ({
    ...romaneioOnlyManagerSession(),
    user: {
      ...romaneioOnlyManagerSession().user,
      role: 'MANAGER',
      accountType: 'ADMIN'
    }
  });
  prisma.project.findMany = async args => {
    calls.push(args);
    return [];
  };
  t.after(() => {
    prisma.userSession.findUnique = originalFindUnique;
    prisma.project.findMany = originalFindMany;
  });

  const response = await dispatchApp('GET', '/api/romaneio/projects');

  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].where.managerOnly, undefined);
});

test('Romaneio project code lookup keeps project visibility filters', async () => {
  const calls = [];
  const client = {
    project: {
      async findFirst(args) {
        calls.push(args);
        return { id: 'visible-project' };
      }
    }
  };

  const project = await resolveRomaneioProjectReference(
    { projectCode: ' 5797 ' },
    { role: 'COORDINATOR' },
    client
  );

  assert.deepEqual(project, { id: 'visible-project' });
  assert.deepEqual(calls[0].where, {
    code: { equals: '5797', mode: 'insensitive' },
    deletedAt: null,
    managerOnly: false,
    isActive: true
  });
  assert.deepEqual(calls[0].select, { id: true });
});

test('Romaneio project code lookup rejects non-numeric manual project codes', async () => {
  const client = {
    project: {
      async findFirst() {
        throw new Error('non-numeric project code must not query projects');
      },
      async create() {
        throw new Error('non-numeric project code must not create projects');
      }
    }
  };

  const project = await resolveRomaneioProjectReference(
    { projectCode: '5798-A' },
    { role: 'COORDINATOR' },
    client,
    { createPending: true }
  );

  assert.equal(project, null);
});

test('Romaneio project code lookup creates pending project when the code is new', async () => {
  const calls = [];
  const client = {
    project: {
      async findFirst(args) {
        calls.push(['findFirst', args]);
        return null;
      },
      async create(args) {
        calls.push(['create', args]);
        return { id: 'pending-project' };
      }
    }
  };

  const project = await resolveRomaneioProjectReference(
    { projectCode: ' 5798 ' },
    { role: 'COORDINATOR' },
    client,
    { createPending: true }
  );

  assert.deepEqual(project, { id: 'pending-project' });
  assert.equal(calls[1][1].where.code.equals, '5798');
  assert.deepEqual(calls[2][1].data, {
    code: '5798',
    name: '',
    isActive: true,
    visibleToCollaborators: false,
    managerOnly: false,
    registrationPending: true,
    inhibitionServiceEnabled: false,
    clientName: '',
    clientCnpj: '',
    clientEmailPrimary: '',
    clientEmailCc: [],
    clientSigners: [],
    contractCode: '',
    location: ''
  });
});

test('Romaneio project code lookup recovers from concurrent pending project creation', async () => {
  const calls = [];
  let findCount = 0;
  const client = {
    project: {
      async findFirst(args) {
        calls.push(['findFirst', args]);
        findCount += 1;
        return findCount === 3 ? { id: 'pending-project' } : null;
      },
      async create(args) {
        calls.push(['create', args]);
        const error = new Error('unique project code');
        error.code = 'P2002';
        throw error;
      }
    }
  };

  const project = await resolveRomaneioProjectReference(
    { projectCode: ' 5798 ' },
    { role: 'COORDINATOR' },
    client,
    { createPending: true }
  );

  assert.deepEqual(project, { id: 'pending-project' });
  assert.deepEqual(calls.map(([name]) => name), ['findFirst', 'findFirst', 'create', 'findFirst']);
  assert.deepEqual(calls[3][1].where, {
    code: { equals: '5798', mode: 'insensitive' },
    deletedAt: null,
    managerOnly: false,
    isActive: true
  });
});

test('Romaneio list keeps operator project visibility filters when filtering by project', async t => {
  stubRomaneioOnlyOperator(t);
  const originalFindMany = prisma.romaneio.findMany;
  const calls = [];
  prisma.romaneio.findMany = async args => {
    calls.push(args);
    return [];
  };
  t.after(() => {
    prisma.romaneio.findMany = originalFindMany;
  });

  const response = await dispatchApp('GET', '/api/romaneio?projectId=hidden-project');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0].where, {
    project: { deletedAt: null, isActive: true, managerOnly: false },
    projectId: 'hidden-project'
  });
});

test('Romaneio PDF download checks operator project visibility', async t => {
  stubRomaneioOnlyOperator(t);
  const originalFindFirstOrThrow = prisma.romaneio.findFirstOrThrow;
  const calls = [];
  prisma.romaneio.findFirstOrThrow = async args => {
    calls.push(args);
    return { id: 'romaneio-1', pdfUrl: null };
  };
  t.after(() => {
    prisma.romaneio.findFirstOrThrow = originalFindFirstOrThrow;
  });

  const response = await dispatchApp('GET', '/api/romaneio/romaneio-1/pdf');

  assert.equal(response.statusCode, 404);
  assert.deepEqual(calls[0].where, {
    id: 'romaneio-1',
    project: { deletedAt: null, isActive: true, managerOnly: false }
  });
});

test('Romaneio catalog update cannot mutate RDO-owned unit rows', async t => {
  stubRomaneioOnlyManager(t);
  const originalTransaction = prisma.$transaction;
  const calls = [];
  prisma.$transaction = async callback => callback({
    romaneioCatalogItem: {
      findUniqueOrThrow: async args => {
        calls.push(['romaneioCatalogItem.findUniqueOrThrow', args]);
        return {
          id: 'catalog-unit-1',
          sourceType: 'UNIT',
          sourceId: 'unit-1',
          code: 'UF-01',
          name: 'Unidade UF-01'
        };
      },
      update: async args => {
        calls.push(['romaneioCatalogItem.update', args]);
        throw new Error('catalog item should not be updated for RDO-owned rows');
      }
    },
    unit: {
      update: async args => {
        calls.push(['unit.update', args]);
        throw new Error('unit should not be mutated from Romaneio catalog');
      }
    },
    particleCounter: {
      update: async args => {
        calls.push(['particleCounter.update', args]);
        throw new Error('counter should not be mutated from Romaneio catalog');
      }
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  const response = await dispatchApp('PUT', '/api/romaneio/catalog/catalog-unit-1', {
    code: 'UF-99',
    categoryName: 'UNIDADE DE FLUSHING'
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(calls.map(([name]) => name), ['romaneioCatalogItem.findUniqueOrThrow']);
});

test('Romaneio catalog update cannot mutate RDO-owned particle counter rows', async t => {
  stubRomaneioOnlyManager(t);
  const originalTransaction = prisma.$transaction;
  const calls = [];
  prisma.$transaction = async callback => callback({
    romaneioCatalogItem: {
      findUniqueOrThrow: async args => {
        calls.push(['romaneioCatalogItem.findUniqueOrThrow', args]);
        return {
          id: 'catalog-counter-1',
          sourceType: 'PARTICLE_COUNTER',
          sourceId: 'counter-1',
          code: 'CP-01',
          name: 'Contador de particulas SN-01'
        };
      },
      update: async args => {
        calls.push(['romaneioCatalogItem.update', args]);
        throw new Error('catalog item should not be updated for RDO-owned rows');
      }
    },
    particleCounter: {
      update: async args => {
        calls.push(['particleCounter.update', args]);
        throw new Error('counter should not be mutated from Romaneio catalog');
      }
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  const response = await dispatchApp('PUT', '/api/romaneio/catalog/catalog-counter-1', {
    code: 'CP-99',
    name: 'Contador de particulas SN-99'
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(calls.map(([name]) => name), ['romaneioCatalogItem.findUniqueOrThrow']);
});

test('Romaneio catalog category rename updates every item in the category', async t => {
  stubRomaneioOnlyManager(t);
  const originalTransaction = prisma.$transaction;
  const calls = [];
  prisma.$transaction = async callback => callback({
    romaneioCatalogItem: {
      count: async args => {
        calls.push(['romaneioCatalogItem.count', args]);
        return 0;
      },
      updateMany: async args => {
        calls.push(['romaneioCatalogItem.updateMany', args]);
        return { count: 3 };
      }
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  const response = await dispatchApp('PUT', '/api/romaneio/catalog/categories', {
    currentName: 'Mangueiras',
    newName: 'Mangueiras e conexões'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, { categoryName: 'Mangueiras e conexões', updatedCount: 3 });
  assert.deepEqual(calls[0], ['romaneioCatalogItem.count', {
    where: {
      categoryName: 'Mangueiras',
      sourceType: { in: ['UNIT', 'PARTICLE_COUNTER', 'EQUIPAMENTOS'] }
    }
  }]);
  assert.deepEqual(calls[1], ['romaneioCatalogItem.updateMany', {
    where: { categoryName: 'Mangueiras' },
    data: { categoryName: 'Mangueiras e conexões' }
  }]);
});

test('Romaneio catalog category rename rejects RDO-owned categories', async t => {
  stubRomaneioOnlyManager(t);
  const originalTransaction = prisma.$transaction;
  const calls = [];
  prisma.$transaction = async callback => callback({
    romaneioCatalogItem: {
      count: async args => {
        calls.push(['romaneioCatalogItem.count', args]);
        return 1;
      },
      updateMany: async args => {
        calls.push(['romaneioCatalogItem.updateMany', args]);
        throw new Error('catalog category should not be updated for RDO-owned rows');
      }
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  const response = await dispatchApp('PUT', '/api/romaneio/catalog/categories', {
    currentName: 'UNIDADE DE FILTRAGEM',
    newName: 'Unidades'
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(calls.map(([name]) => name), ['romaneioCatalogItem.count']);
});

test('Romaneio catalog delete rejects RDO-owned unit rows', async t => {
  stubRomaneioOnlyManager(t);
  const originalTransaction = prisma.$transaction;
  const calls = [];
  prisma.$transaction = async callback => callback({
    romaneioCatalogItem: {
      findUniqueOrThrow: async args => {
        calls.push(['romaneioCatalogItem.findUniqueOrThrow', args]);
        return { id: 'catalog-unit-1', sourceType: 'UNIT', sourceId: 'unit-1' };
      },
      update: async args => {
        calls.push(['romaneioCatalogItem.update', args]);
        throw new Error('unit catalog row should not be hidden from Romaneio catalog');
      }
    },
    unit: {
      delete: async args => {
        calls.push(['unit.delete', args]);
        throw new Error('unit should not be deleted from Romaneio catalog');
      }
    },
    particleCounter: {
      update: async args => {
        calls.push(['particleCounter.update', args]);
        throw new Error('counter should not be deactivated from Romaneio catalog');
      }
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  const response = await dispatchApp('DELETE', '/api/romaneio/catalog/catalog-unit-1');

  assert.equal(response.statusCode, 409);
  assert.deepEqual(calls[0], ['romaneioCatalogItem.findUniqueOrThrow', { where: { id: 'catalog-unit-1' } }]);
  assert.deepEqual(calls.map(([name]) => name), ['romaneioCatalogItem.findUniqueOrThrow']);
});

test('Romaneio catalog delete rejects RDO-owned particle counter rows', async t => {
  stubRomaneioOnlyManager(t);
  const originalTransaction = prisma.$transaction;
  const calls = [];
  prisma.$transaction = async callback => callback({
    romaneioCatalogItem: {
      findUniqueOrThrow: async args => {
        calls.push(['romaneioCatalogItem.findUniqueOrThrow', args]);
        return { id: 'catalog-counter-1', sourceType: 'PARTICLE_COUNTER', sourceId: 'counter-1' };
      },
      update: async args => {
        calls.push(['romaneioCatalogItem.update', args]);
        throw new Error('counter catalog row should not be hidden from Romaneio catalog');
      }
    },
    particleCounter: {
      update: async args => {
        calls.push(['particleCounter.update', args]);
        throw new Error('counter should not be deactivated from Romaneio catalog');
      }
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  const response = await dispatchApp('DELETE', '/api/romaneio/catalog/catalog-counter-1');

  assert.equal(response.statusCode, 409);
  assert.deepEqual(calls[0], ['romaneioCatalogItem.findUniqueOrThrow', { where: { id: 'catalog-counter-1' } }]);
  assert.deepEqual(calls.map(([name]) => name), ['romaneioCatalogItem.findUniqueOrThrow']);
});

test('Romaneio catalog sync restores hidden RDO-owned rows and keeps hidden file rows inactive', async t => {
  const originalTransaction = prisma.$transaction;
  const updates = [];
  const staleFileUpdates = [];
  prisma.$transaction = async callback => callback({
    companyEquipment: {
      findMany: async () => [
        { id: 'unit-1', code: 'UF-01', name: 'Unidade 01', attributes: {}, isActive: true, category: { name: 'FILTRAGEM' } },
        { id: 'counter-1', code: 'CP-01', name: 'Contador 01', attributes: { serialNumber: 'SN-01' }, isActive: true, category: { name: 'Instrumentos' } }
      ]
    },
    romaneioCatalogItem: {
      findUnique: async args => {
        const source = args.where?.sourceType_sourceId;
        if (source?.sourceType === 'EQUIPAMENTOS' && source?.sourceId === 'unit-1') {
          return { id: 'catalog-unit-1', hiddenInRomaneioAt: new Date(), sourceType: 'EQUIPAMENTOS' };
        }
        if (source?.sourceType === 'EQUIPAMENTOS' && source?.sourceId === 'counter-1') {
          return { id: 'catalog-counter-1', hiddenInRomaneioAt: new Date(), sourceType: 'EQUIPAMENTOS' };
        }
        return null;
      },
      findFirst: async () => null,
      create: async args => args,
      update: async args => {
        updates.push(args);
        return args;
      },
      updateMany: async args => {
        staleFileUpdates.push(args);
        return { count: 0 };
      }
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  await syncRomaneioCatalog();

  const unitUpdate = updates.find(item => item.where.id === 'catalog-unit-1');
  const counterUpdate = updates.find(item => item.where.id === 'catalog-counter-1');
  assert.equal(unitUpdate.data.isActive, true);
  assert.equal(unitUpdate.data.hiddenInRomaneioAt, null);
  assert.equal(counterUpdate.data.isActive, true);
  assert.equal(counterUpdate.data.hiddenInRomaneioAt, null);
  assert.equal(staleFileUpdates[0].where.sourceType, 'FILE');
  assert.equal(staleFileUpdates[0].where.sourceId.notIn.includes('equipamentos:553'), false);
  assert.equal(staleFileUpdates[0].where.sourceId.notIn.includes('equipamentos:554'), true);
  assert.deepEqual(staleFileUpdates[0].data, { isActive: false });
});

test('Romaneio catalog sync restores particle counter visibility after RDO reactivation', async t => {
  const originalTransaction = prisma.$transaction;
  const updates = [];
  let counterIsActive = false;
  prisma.$transaction = async callback => callback({
    companyEquipment: {
      findMany: async () => (counterIsActive
        ? [{ id: 'counter-1', code: 'CP-01', name: 'Contador 01', attributes: { serialNumber: 'SN-01' }, isActive: true, category: { name: 'Instrumentos' } }]
        : [{ id: 'counter-1', code: 'CP-01', name: 'Contador 01', attributes: { serialNumber: 'SN-01' }, isActive: false, category: { name: 'Instrumentos' } }])
    },
    romaneioCatalogItem: {
      findUnique: async args => {
        const source = args.where?.sourceType_sourceId;
        if (source?.sourceType === 'EQUIPAMENTOS' && source?.sourceId === 'counter-1') {
          return { id: 'catalog-counter-1', hiddenInRomaneioAt: null };
        }
        return null;
      },
      findFirst: async () => null,
      create: async args => args,
      update: async args => {
        updates.push(args);
        return args;
      },
      updateMany: async () => ({ count: 0 })
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  await syncRomaneioCatalog();
  counterIsActive = true;
  await syncRomaneioCatalog();

  assert.equal(updates[0].data.isActive, false);
  assert.equal(updates[1].data.isActive, true);
});

test('Romaneio catalog sync uses RDO unit name and category', async t => {
  const originalTransaction = prisma.$transaction;
  const updates = [];
  prisma.$transaction = async callback => callback({
    companyEquipment: {
      findMany: async () => [{
        id: 'unit-1',
        code: 'UF-01',
        name: 'Unidade de filtragem Skid 01',
        attributes: {},
        isActive: true,
        category: { name: 'Filtragem' }
      }]
    },
    romaneioCatalogItem: {
      findUnique: async args => {
        const source = args.where?.sourceType_sourceId;
        if (source?.sourceType === 'EQUIPAMENTOS' && source?.sourceId === 'unit-1') {
          return { id: 'catalog-unit-1', hiddenInRomaneioAt: null, sourceType: 'EQUIPAMENTOS' };
        }
        return null;
      },
      findFirst: async () => null,
      create: async args => args,
      update: async args => {
        updates.push(args);
        return args;
      },
      updateMany: async () => ({ count: 0 })
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  await syncRomaneioCatalog();

  assert.equal(updates[0].data.name, 'Unidade de filtragem Skid 01');
  assert.equal(updates[0].data.categoryName, 'Filtragem');
});

test('Romaneio catalog sync uses RDO particle counter category', async t => {
  const originalTransaction = prisma.$transaction;
  const updates = [];
  prisma.$transaction = async callback => callback({
    companyEquipment: {
      findMany: async () => [{
        id: 'counter-1',
        code: 'CP-01',
        name: 'Contador de partículas SN-01',
        attributes: { serialNumber: 'SN-01' },
        isActive: true,
        category: { name: 'Instrumentos de medição' }
      }]
    },
    romaneioCatalogItem: {
      findUnique: async args => {
        const source = args.where?.sourceType_sourceId;
        if (source?.sourceType === 'EQUIPAMENTOS' && source?.sourceId === 'counter-1') {
          return { id: 'catalog-counter-1', hiddenInRomaneioAt: null, sourceType: 'EQUIPAMENTOS' };
        }
        return null;
      },
      findFirst: async () => null,
      create: async args => args,
      update: async args => {
        updates.push(args);
        return args;
      },
      updateMany: async () => ({ count: 0 })
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  await syncRomaneioCatalog();

  assert.equal(updates[0].data.categoryName, 'Instrumentos de medição');
});

test('Romaneio equipment parser keeps loose trailing sections in their own categories', () => {
  const rows = parseEquipmentRows([
    '\tEquipamentos Não Listados',
    'ENL\t\tpar botas de borracha',
    '',
    'Conexões de flushing',
    'Adaptador JIC 2"',
    '',
    'Vávulas',
    '\tVálvula 2"'
  ].join('\n'));

  const boots = rows.find(row => row.name === 'par botas de borracha');
  const flushing = rows.find(row => row.name === 'Adaptador JIC 2"');
  const valve = rows.find(row => row.name === 'Válvula 2"');

  assert.equal(boots.categoryName, 'Equipamentos Não Listados');
  assert.equal(boots.code, 'ENL');
  assert.equal(boots.isSerialized, false);
  assert.equal(flushing.categoryName, 'Conexões de flushing');
  assert.equal(flushing.kind, 'CONNECTION');
  assert.equal(valve.categoryName, 'Vávulas');
  assert.equal(valve.kind, 'CONNECTION');
});

test('Romaneio catalog row sync batches reads and creates only missing rows', async () => {
  const findManyCalls = [];
  const updates = [];
  const createManyCalls = [];
  const tx = {
    romaneioCatalogItem: {
      findMany: async args => {
        findManyCalls.push(args);
        if (args.where?.sourceType) {
          return [{
            id: 'catalog-unit-1',
            sourceType: 'UNIT',
            sourceId: 'unit-1',
            code: 'UF-01',
            name: 'Nome antigo',
            categoryName: 'Filtragem',
            kind: 'EQUIPMENT',
            measureType: 'UNIT',
            defaultUnitLabel: 'unidade',
            isSerialized: true,
            isActive: true,
            hiddenInRomaneioAt: null
          }];
        }
        return [{
          categoryName: 'Categoria existente',
          code: 'EX-01',
          name: 'Item existente'
        }];
      },
      update: async args => {
        updates.push(args);
        return args;
      },
      createMany: async args => {
        createManyCalls.push(args);
        return { count: args.data.length };
      }
    }
  };

  await syncCatalogRows(tx, [{
    sourceType: 'UNIT',
    sourceId: 'unit-1',
    code: 'UF-01',
    name: 'Nome novo',
    categoryName: 'Filtragem',
    kind: 'EQUIPMENT',
    measureType: 'UNIT',
    defaultUnitLabel: 'unidade',
    isSerialized: true,
    isActive: true
  }, {
    sourceType: 'FILE',
    sourceId: 'equipamentos:1',
    code: 'EX-01',
    name: 'Item existente',
    categoryName: 'Categoria existente',
    kind: 'EQUIPMENT',
    measureType: 'UNIT',
    defaultUnitLabel: 'unidade',
    isSerialized: true,
    isActive: true
  }, {
    sourceType: 'FILE',
    sourceId: 'equipamentos:2',
    code: 'NW-01',
    name: 'Item novo',
    categoryName: 'Categoria nova',
    kind: 'EQUIPMENT',
    measureType: 'UNIT',
    defaultUnitLabel: 'unidade',
    isSerialized: true,
    isActive: true
  }]);

  assert.equal(findManyCalls.length, 2);
  assert.deepEqual(updates, [{
    where: { id: 'catalog-unit-1' },
    data: {
      sourceType: 'UNIT',
      sourceId: 'unit-1',
      code: 'UF-01',
      name: 'Nome novo',
      categoryName: 'Filtragem',
      kind: 'EQUIPMENT',
      measureType: 'UNIT',
      defaultUnitLabel: 'unidade',
      isSerialized: true,
      isActive: true,
      hiddenInRomaneioAt: null
    }
  }]);
  assert.equal(createManyCalls.length, 1);
  assert.equal(createManyCalls[0].skipDuplicates, true);
  assert.deepEqual(createManyCalls[0].data.map(item => item.sourceId), ['equipamentos:2']);
});

test('Romaneio catalog sync skips catalog writes when persistent source hash is unchanged', async t => {
  const originalTransaction = prisma.$transaction;
  let storedHash = null;
  let catalogWrites = 0;
  let stateUpserts = 0;
  prisma.$transaction = async callback => callback({
    companyEquipment: {
      findMany: async () => [{
        id: 'unit-1',
        code: 'UF-01',
        name: 'Unidade de filtragem',
        attributes: {},
        isActive: true,
        category: { name: 'Filtragem' }
      }]
    },
    romaneioCatalogSyncState: {
      findUnique: async () => storedHash ? { sourceHash: storedHash } : null,
      upsert: async args => {
        storedHash = args.update.sourceHash;
        stateUpserts++;
        return args;
      }
    },
    romaneioCatalogItem: {
      findMany: async () => [],
      update: async args => {
        catalogWrites++;
        return args;
      },
      createMany: async args => {
        catalogWrites++;
        return { count: args.data.length };
      },
      updateMany: async args => {
        catalogWrites++;
        return { count: 0 };
      }
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  await syncRomaneioCatalog();
  const writesAfterFirstSync = catalogWrites;
  await syncRomaneioCatalog();

  assert.ok(storedHash);
  assert.ok(writesAfterFirstSync > 0);
  assert.equal(catalogWrites, writesAfterFirstSync);
  assert.equal(stateUpserts, 1);
});
