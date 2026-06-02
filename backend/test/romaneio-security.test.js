import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import { parseEquipmentRows, syncRomaneioCatalog } from '../src/lib/romaneio-catalog.js';
import prisma from '../src/lib/prisma.js';
import {
  cleanupFailedRomaneioCreate,
  requireRomaneioManager,
  requireRomaneioModuleAccess,
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
      sourceType: { in: ['UNIT', 'PARTICLE_COUNTER'] }
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
    unit: {
      findMany: async () => [{ id: 'unit-1', code: 'UF-01', category: 'FILTRAGEM' }]
    },
    particleCounter: {
      findMany: async () => [{ id: 'counter-1', code: 'CP-01', serialNumber: 'SN-01', category: 'Instrumentos', isActive: true }]
    },
    romaneioCatalogItem: {
      findUnique: async args => {
        const source = args.where?.sourceType_sourceId;
        if (source?.sourceType === 'UNIT' && source?.sourceId === 'unit-1') {
          return { id: 'catalog-unit-1', hiddenInRomaneioAt: new Date(), sourceType: 'UNIT' };
        }
        if (source?.sourceType === 'PARTICLE_COUNTER' && source?.sourceId === 'counter-1') {
          return { id: 'catalog-counter-1', hiddenInRomaneioAt: new Date(), sourceType: 'PARTICLE_COUNTER' };
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
    unit: {
      findMany: async () => []
    },
    particleCounter: {
      findMany: async () => [{
        id: 'counter-1',
        code: 'CP-01',
        serialNumber: 'SN-01',
        isActive: counterIsActive
      }]
    },
    romaneioCatalogItem: {
      findUnique: async args => {
        const source = args.where?.sourceType_sourceId;
        if (source?.sourceType === 'PARTICLE_COUNTER' && source?.sourceId === 'counter-1') {
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
    unit: {
      findMany: async () => [{
        id: 'unit-1',
        code: 'UF-01',
        name: 'Unidade de filtragem Skid 01',
        category: 'Filtragem'
      }]
    },
    particleCounter: {
      findMany: async () => []
    },
    romaneioCatalogItem: {
      findUnique: async args => {
        const source = args.where?.sourceType_sourceId;
        if (source?.sourceType === 'UNIT' && source?.sourceId === 'unit-1') {
          return { id: 'catalog-unit-1', hiddenInRomaneioAt: null, sourceType: 'UNIT' };
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
    unit: {
      findMany: async () => []
    },
    particleCounter: {
      findMany: async () => [{
        id: 'counter-1',
        code: 'CP-01',
        serialNumber: 'SN-01',
        category: 'Instrumentos de medição',
        isActive: true
      }]
    },
    romaneioCatalogItem: {
      findUnique: async args => {
        const source = args.where?.sourceType_sourceId;
        if (source?.sourceType === 'PARTICLE_COUNTER' && source?.sourceId === 'counter-1') {
          return { id: 'catalog-counter-1', hiddenInRomaneioAt: null, sourceType: 'PARTICLE_COUNTER' };
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
