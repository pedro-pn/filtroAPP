import assert from 'node:assert/strict';
import test from 'node:test';
import { listDocuments } from '../src/lib/assinaturas/service.js';

const date = new Date('2026-10-16T15:00:00Z');
const makeDocument = (id, changes = {}) => ({ id, batchId: null, ownerUserId: 'owner', title: `Contrato ${id}`, originalFileName: `${id}.pdf`,
  status: 'AGUARDANDO_ASSINATURAS', createdAt: date, archivedAt: null, deletedAt: null, pageCount: 1, signers: [{ status: 'PENDENTE' }], ...changes });
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(condition => matches(row, condition));
    if (key === 'OR') return value.some(condition => matches(row, condition));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('some' in value) return row[key].some(child => matches(child, value.some));
      return Object.entries(value).every(([operator, expected]) => {
        if (operator === 'not') return row[key] !== expected;
        if (operator === 'lt') return row[key] < expected;
        if (operator === 'gte') return row[key] >= expected;
        if (operator === 'contains') return String(row[key]).toLowerCase().includes(expected.toLowerCase());
        return operator === 'mode';
      });
    }
    return value instanceof Date ? new Date(row[key]).getTime() === value.getTime() : row[key] === value;
  });
}
function database() {
  const documents = [makeDocument('z'), makeDocument('b'), makeDocument('foreign', { ownerUserId: 'other' })];
  const batches = [{ id: 'm', ownerUserId: 'owner', createdAt: date, documents: Array.from({ length: 33 }, (_, i) => makeDocument(`child-${i}`, {
    batchId: 'm', batchPosition: i, ...(i === 0 ? { status: 'CONCLUIDO', completedAt: date, signers: [{ status: 'ASSINADO' }] } : {})
  })) }, { id: 'x', ownerUserId: 'other', createdAt: date, documents: [makeDocument('foreign-child', { batchId: 'x', ownerUserId: 'other' })] }];
  const sort = rows => [...rows].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  const calls = [];
  return { calls, client: {
    signatureDocument: { async findMany(args) { calls.push(args); return sort(documents.filter(document => matches(document, args.where))).slice(0, args.take); } },
    signatureDocumentBatch: { async findMany(args) { calls.push(args); return sort(batches.filter(batch => matches(batch, args.where))).slice(0, args.take).map(batch => ({ ...batch,
      documents: batch.documents.filter(document => matches(document, args.include.documents.where)) })); } }
  } };
}

test('paginação conta lotes inteiros e documentos avulsos sem separar PDFs em outras páginas', async () => {
  const db = database();
  const ids = [];
  let cursor;
  do {
    const result = await listDocuments(db.client, 'owner', { grouped: true, limit: 1, cursor });
    assert.equal(result.items.length, 1);
    const item = result.items[0];
    ids.push(item.id);
    if (item.batchId) {
      assert.equal(item.batchDocuments.length, 33);
      assert.equal(item.signedCount, 1);
      assert.equal(item.signerCount, 33);
      assert.equal(item.status, 'AGUARDANDO_ASSINATURAS');
      assert.equal(item.batchDocuments[0].status, 'CONCLUIDO');
      assert.equal(item.completedAt, null);
    }
    cursor = result.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, ['z', 'm', 'b']);
  assert.equal(new Set(ids).size, ids.length);
});

test('busca e status localizam o lote e preservam os outros documentos como contexto', async () => {
  const db = database();
  const result = await listDocuments(db.client, 'owner', { grouped: true, status: 'CONCLUIDO', q: 'child-0', dateFrom: '2026-10-16', dateTo: '2026-10-16' });
  assert.deepEqual(result.items.map(item => item.id), ['m']);
  assert.equal(result.items[0].batchDocuments.length, 33);
  const batchQuery = db.calls.find(call => call.where.documents);
  assert.equal(batchQuery.where.ownerUserId, 'owner');
  assert.equal(batchQuery.where.documents.some.ownerUserId, 'owner');
  assert.equal(batchQuery.include.documents.where.ownerUserId, 'owner');
  assert.equal(batchQuery.include.documents.where.deletedAt, null);
  assert.equal(batchQuery.include.documents.where.archivedAt, null);
  assert.equal((await listDocuments(db.client, 'owner', { grouped: true, archived: true })).items.length, 0);
});

test('cursor de agrupamento inválido é rejeitado sem executar consulta', async () => {
  const db = database();
  await assert.rejects(() => listDocuments(db.client, 'owner', { grouped: true, cursor: 'invalid' }), error => error.statusCode === 400);
  assert.equal(db.calls.length, 0);
});
