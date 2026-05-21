import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import { syncRomaneioCatalog } from '../src/lib/romaneio-catalog.js';
import prisma from '../src/lib/prisma.js';
import {
  cleanupFailedRomaneioCreate,
  requireRomaneioManager,
  requireRomaneioModuleAccess,
  romaneioEmailFailureResult,
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

test('Romaneio catalog delete hides sourced items without deleting RDO master data', async t => {
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
        return { id: args.where.id, isActive: false };
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

  assert.equal(response.statusCode, 204);
  assert.deepEqual(calls[0], ['romaneioCatalogItem.findUniqueOrThrow', { where: { id: 'catalog-unit-1' } }]);
  assert.equal(calls[1][0], 'romaneioCatalogItem.update');
  assert.deepEqual(calls[1][1].where, { id: 'catalog-unit-1' });
  assert.equal(calls[1][1].data.isActive, false);
  assert.ok(calls[1][1].data.hiddenInRomaneioAt instanceof Date);
});

test('Romaneio catalog delete hides particle counters without deactivating RDO counters', async t => {
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
        return { id: args.where.id, isActive: false };
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

  assert.equal(response.statusCode, 204);
  assert.deepEqual(calls[0], ['romaneioCatalogItem.findUniqueOrThrow', { where: { id: 'catalog-counter-1' } }]);
  assert.equal(calls[1][0], 'romaneioCatalogItem.update');
  assert.deepEqual(calls[1][1].where, { id: 'catalog-counter-1' });
  assert.equal(calls[1][1].data.isActive, false);
  assert.ok(calls[1][1].data.hiddenInRomaneioAt instanceof Date);
});

test('Romaneio catalog sync does not reactivate hidden source-owned rows', async t => {
  const originalTransaction = prisma.$transaction;
  const updates = [];
  prisma.$transaction = async callback => callback({
    unit: {
      findMany: async () => [{ id: 'unit-1', code: 'UF-01', category: 'FILTRAGEM' }]
    },
    particleCounter: {
      findMany: async () => [{ id: 'counter-1', code: 'CP-01', serialNumber: 'SN-01', isActive: true }]
    },
    romaneioCatalogItem: {
      findUnique: async args => {
        const source = args.where?.sourceType_sourceId;
        if (source?.sourceType === 'UNIT' && source?.sourceId === 'unit-1') {
          return { id: 'catalog-unit-1', hiddenInRomaneioAt: new Date() };
        }
        if (source?.sourceType === 'PARTICLE_COUNTER' && source?.sourceId === 'counter-1') {
          return { id: 'catalog-counter-1', hiddenInRomaneioAt: new Date() };
        }
        return null;
      },
      findFirst: async () => null,
      create: async args => args,
      update: async args => {
        updates.push(args);
        return args;
      }
    }
  });
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  await syncRomaneioCatalog();

  const unitUpdate = updates.find(item => item.where.id === 'catalog-unit-1');
  const counterUpdate = updates.find(item => item.where.id === 'catalog-counter-1');
  assert.equal(unitUpdate.data.isActive, false);
  assert.equal(counterUpdate.data.isActive, false);
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
      }
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
