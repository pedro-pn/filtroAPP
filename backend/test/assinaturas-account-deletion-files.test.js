import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  deleteUserWithSignatureDocuments,
  processSignatureFilePurges,
  promoteUserSignatureFilePurge,
  purgeUserSignatureFileOperation,
  reconcileSignatureFilePurges,
  stageUserSignatureFiles
} from '../src/lib/assinaturas/file-quarantine.js';

function applyData(row, data) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value && typeof value === 'object' && 'increment' in value
      ? Number(row[key] || 0) + value.increment
      : value;
  }
  row.updatedAt = new Date();
  return row;
}

function matchesPurgeWhere(row, where = {}) {
  if (where.operationKey && row.operationKey !== where.operationKey) return false;
  if (typeof where.status === 'string' && row.status !== where.status) return false;
  if (where.status?.in && !where.status.in.includes(row.status)) return false;
  if (where.createdAt?.lte && row.createdAt > where.createdAt.lte) return false;
  if (where.claimedAt?.lte && (!row.claimedAt || row.claimedAt > where.claimedAt.lte)) return false;
  if (where.OR) {
    const matchesOr = where.OR.some(item => {
      if (item.nextAttemptAt === null) return row.nextAttemptAt === null;
      if (item.nextAttemptAt?.lte) return row.nextAttemptAt && row.nextAttemptAt <= item.nextAttemptAt.lte;
      return false;
    });
    if (!matchesOr) return false;
  }
  return true;
}

function purgeStore() {
  const rows = [];
  return {
    rows,
    signatureDocumentFilePurge: {
      async create({ data }) {
        const row = {
          id: `purge-${rows.length + 1}`,
          attempts: 0,
          claimedAt: null,
          nextAttemptAt: null,
          lastError: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...structuredClone(data)
        };
        rows.push(row);
        return structuredClone(row);
      },
      async update({ where, data }) {
        const row = rows.find(item => item.operationKey === where.operationKey);
        if (!row) throw new Error('Purge operation not found.');
        applyData(row, structuredClone(data));
        return structuredClone(row);
      },
      async updateMany({ where, data }) {
        const matched = rows.filter(row => matchesPurgeWhere(row, where));
        for (const row of matched) applyData(row, structuredClone(data));
        return { count: matched.length };
      },
      async findUnique({ where }) {
        const row = rows.find(item => item.operationKey === where.operationKey);
        return row ? structuredClone(row) : null;
      },
      async findMany({ where, take, select }) {
        const matched = rows.filter(row => matchesPurgeWhere(row, where)).slice(0, take);
        if (!select) return structuredClone(matched);
        return matched.map(row => Object.fromEntries(
          Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])
        ));
      }
    }
  };
}

async function writeFixture(rootDir, relativePath, contents = relativePath) {
  const target = path.join(rootDir, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
  return target;
}

test('staging parcial restaura os bytes já movidos e mantém manifesto recuperável', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-quarantine-partial-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const source = await writeFixture(rootDir, 'Assinaturas/Documentos/draft.pdf', 'draft');
  const preview = await writeFixture(rootDir, 'Assinaturas/Previews/draft-1/1.png', 'preview');
  const store = purgeStore();
  let renames = 0;
  const failingFileSystem = {
    ...fs,
    async rename(from, to) {
      renames += 1;
      if (renames === 2) throw new Error('simulated partial move failure');
      return fs.rename(from, to);
    }
  };

  await assert.rejects(() => stageUserSignatureFiles(store, 'user-1', [{
    id: 'draft-1', sourceStoragePath: 'Assinaturas/Documentos/draft.pdf', finalStoragePath: null
  }], { rootDir, fileSystem: failingFileSystem, operationKey: 'partial' }));

  assert.equal(await fs.readFile(source, 'utf8'), 'draft');
  assert.equal(await fs.readFile(preview, 'utf8'), 'preview');
  assert.equal(store.rows[0].status, 'CANCELADO');
  assert.equal(store.rows[0].manifest.every(entry => !entry.moved), true);
});

function deletionClient(documents, { failDelete = false } = {}) {
  const store = purgeStore();
  const audits = [];
  let userDeleted = false;
  function filtered(where = {}) {
    return documents.filter(document => {
      if (where.ownerUserId && document.ownerUserId !== where.ownerUserId) return false;
      if (typeof where.status === 'string' && document.status !== where.status) return false;
      if (where.status?.in && !where.status.in.includes(document.status)) return false;
      if (where.id?.in && !where.id.in.includes(document.id)) return false;
      return true;
    });
  }
  const client = {
    ...store,
    signatureDocument: {
      async count({ where }) { return filtered(where).length; },
      async findMany({ where, select }) {
        const rows = filtered(where);
        if (!select) return structuredClone(rows);
        return rows.map(row => Object.fromEntries(
          Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])
        ));
      },
      async deleteMany({ where }) {
        if (failDelete) throw new Error('simulated transaction failure');
        const ids = new Set(filtered(where).map(document => document.id));
        for (let index = documents.length - 1; index >= 0; index -= 1) {
          if (ids.has(documents[index].id)) documents.splice(index, 1);
        }
        return { count: ids.size };
      }
    },
    signatureDocumentAuditLog: {
      async createMany({ data }) { audits.push(...structuredClone(data)); return { count: data.length }; }
    },
    user: {
      async delete() {
        userDeleted = true;
        for (const document of documents) document.ownerUserId = null;
        return { id: 'user-1' };
      }
    },
    async $queryRawUnsafe() { return [{ pg_advisory_xact_lock: null }]; },
    async $transaction(operation) { return operation(client); }
  };
  return {
    client,
    audits,
    get userDeleted() { return userDeleted; }
  };
}

test('falha transacional restaura arquivos e não exclui a conta', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-quarantine-tx-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const source = await writeFixture(rootDir, 'Assinaturas/Documentos/draft.pdf', 'draft');
  const documents = [{
    id: 'draft-1', ownerUserId: 'user-1', status: 'RASCUNHO',
    sourceStoragePath: 'Assinaturas/Documentos/draft.pdf', finalStoragePath: null
  }];
  const state = deletionClient(documents, { failDelete: true });

  await assert.rejects(
    () => deleteUserWithSignatureDocuments(state.client, 'user-1', { rootDir }),
    /simulated transaction failure/
  );
  assert.equal(await fs.readFile(source, 'utf8'), 'draft');
  assert.equal(state.userDeleted, false);
  assert.equal(state.client.rows[0].status, 'CANCELADO');
});

test('manifesto PREPARANDO abandonado é reconciliado com restauração', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-quarantine-abandoned-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const source = await writeFixture(rootDir, 'Assinaturas/Documentos/abandoned.pdf', 'abandoned');
  const store = purgeStore();
  await stageUserSignatureFiles(store, 'user-1', [{
    id: 'draft-1', sourceStoragePath: 'Assinaturas/Documentos/abandoned.pdf', finalStoragePath: null
  }], { rootDir, operationKey: 'abandoned' });
  store.rows[0].createdAt = new Date('2026-01-01T00:00:00.000Z');

  const result = await reconcileSignatureFilePurges(store, {
    rootDir,
    now: new Date('2026-01-01T01:00:00.000Z')
  });
  assert.deepEqual(result, { restored: 1, staleClaims: 0 });
  assert.equal(await fs.readFile(source, 'utf8'), 'abandoned');
  assert.equal(store.rows[0].status, 'CANCELADO');
});

test('falha física pós-commit é retomada pelo job e a purga é idempotente', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-quarantine-retry-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  await writeFixture(rootDir, 'Assinaturas/Documentos/retry.pdf', 'retry');
  const store = purgeStore();
  const operation = await stageUserSignatureFiles(store, 'user-1', [{
    id: 'draft-1', sourceStoragePath: 'Assinaturas/Documentos/retry.pdf', finalStoragePath: null
  }], { rootDir, operationKey: 'retry' });
  await promoteUserSignatureFilePurge(store, operation.operationKey);
  const firstNow = new Date('2026-08-28T12:00:00.000Z');
  await assert.rejects(() => purgeUserSignatureFileOperation(store, operation.operationKey, {
    rootDir,
    now: firstNow,
    fileSystem: { ...fs, async rm() { throw new Error('disk unavailable'); } }
  }));
  assert.equal(store.rows[0].status, 'FALHOU');

  const result = await processSignatureFilePurges(store, {
    rootDir,
    now: new Date(firstNow.getTime() + 2 * 60_000)
  });
  assert.equal(result.purged, 1);
  assert.equal(store.rows[0].status, 'CONCLUIDO');
  const repeated = await purgeUserSignatureFileOperation(store, operation.operationKey, {
    rootDir,
    now: new Date(firstNow.getTime() + 3 * 60_000)
  });
  assert.equal(repeated.status, 'CONCLUIDO');
});

test('exclusão move somente documentos descartáveis e preserva bytes dos concluídos', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-quarantine-preserve-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const draftPath = await writeFixture(rootDir, 'Assinaturas/Documentos/draft.pdf', 'draft');
  const completedSource = await writeFixture(rootDir, 'Assinaturas/Documentos/completed.pdf', 'completed-source');
  const completedFinal = await writeFixture(rootDir, 'Assinaturas/Assinados/completed.pdf', 'completed-final');
  const documents = [
    {
      id: 'draft-1', ownerUserId: 'user-1', status: 'RASCUNHO',
      sourceStoragePath: 'Assinaturas/Documentos/draft.pdf', finalStoragePath: null
    },
    {
      id: 'completed-1', ownerUserId: 'user-1', status: 'CONCLUIDO',
      requesterNameSnapshot: 'Responsável histórico',
      sourceStoragePath: 'Assinaturas/Documentos/completed.pdf',
      finalStoragePath: 'Assinaturas/Assinados/completed.pdf'
    }
  ];
  const state = deletionClient(documents);

  const result = await deleteUserWithSignatureDocuments(state.client, 'user-1', {
    actorUserId: 'admin-1', rootDir
  });
  assert.deepEqual(result.assinaturas, { toDelete: 1, toPreserve: 1, finalizing: 0 });
  assert.equal(state.userDeleted, true);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].id, 'completed-1');
  assert.equal(documents[0].ownerUserId, null);
  assert.equal(documents[0].requesterNameSnapshot, 'Responsável histórico');
  assert.equal(state.audits[0].action, 'PROPRIETARIO_REMOVIDO');
  await assert.rejects(() => fs.readFile(draftPath), error => error?.code === 'ENOENT');
  assert.equal(await fs.readFile(completedSource, 'utf8'), 'completed-source');
  assert.equal(await fs.readFile(completedFinal, 'utf8'), 'completed-final');
});

test('conta sem documentos mantém a exclusão direta anterior', async () => {
  let deleteCalls = 0;
  let transactionCalls = 0;
  const client = {
    signatureDocument: { async count() { return 0; } },
    user: { async delete({ where }) { deleteCalls += 1; return where; } },
    async $transaction() { transactionCalls += 1; }
  };
  const result = await deleteUserWithSignatureDocuments(client, 'user-without-documents');
  assert.deepEqual(result, {
    assinaturas: { toDelete: 0, toPreserve: 0, finalizing: 0 },
    purgeOperationKey: null
  });
  assert.equal(deleteCalls, 1);
  assert.equal(transactionCalls, 0);
});
