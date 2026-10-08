import assert from 'node:assert/strict';
import test from 'node:test';

import { listDocuments } from '../src/lib/assinaturas/service.js';

function document(id, createdAt) {
  return { id, ownerUserId: 'owner', title: 'Contrato', originalFileName: 'Contrato.pdf', status: 'CONCLUIDO',
    pageCount: 1, archivedAt: null, deletedAt: null, createdAt: new Date(createdAt), completedAt: new Date(createdAt),
    signers: [{ status: 'ASSINADO' }] };
}

test('intervalo inclui os dias completos de São Paulo e preserva proprietário, status, busca e paginação', async () => {
  const rows = [
    document('before', '2026-10-01T02:59:59Z'),
    document('first', '2026-10-01T03:00:00Z'),
    document('last', '2026-10-07T02:59:59.999Z'),
    document('after', '2026-10-07T03:00:00Z'),
    { ...document('other-owner', '2026-10-05T12:00:00Z'), ownerUserId: 'other' }
  ];
  const client = { signatureDocument: { async findMany({ where, orderBy, take, cursor, skip }) {
    assert.equal(where.ownerUserId, 'owner');
    assert.equal(where.deletedAt, null);
    assert.equal(where.archivedAt, null);
    assert.equal(where.status, 'CONCLUIDO');
    assert.equal(where.OR[0].title.contains, 'Contrato');
    assert.deepEqual(orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
    assert.equal(take, 2);
    assert.equal(cursor, undefined);
    assert.equal(skip, undefined);
    return rows.filter(row => row.ownerUserId === where.ownerUserId && row.createdAt >= where.createdAt.gte && row.createdAt < where.createdAt.lt)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, take);
  } } };
  const result = await listDocuments(client, 'owner', { dateFrom: '2026-10-01', dateTo: '2026-10-06', status: 'CONCLUIDO', q: 'Contrato', limit: 1 });
  assert.deepEqual(result.items.map(item => item.id), ['last']);
  assert.equal(result.items[0].signedCount, 1);
  assert.equal(result.nextCursor, 'last');
});

test('datas opcionais permitem intervalos abertos e a listagem sem filtro de data', async () => {
  for (const filters of [{}, { dateFrom: '2026-10-01' }, { dateTo: '2026-10-06' }]) {
    const client = { signatureDocument: { async findMany({ where }) {
      if (!filters.dateFrom && !filters.dateTo) assert.equal(where.createdAt, undefined);
      if (filters.dateFrom) assert.equal(where.createdAt.gte.toISOString(), '2026-10-01T03:00:00.000Z');
      if (filters.dateTo) assert.equal(where.createdAt.lt.toISOString(), '2026-10-07T03:00:00.000Z');
      return [];
    } } };
    assert.deepEqual(await listDocuments(client, 'owner', filters), { items: [], nextCursor: null });
  }
});

test('datas inválidas e períodos invertidos são rejeitados antes da consulta', async () => {
  const client = { signatureDocument: { async findMany() { assert.fail('Não deve consultar com datas inválidas.'); } } };
  for (const filters of [{ dateFrom: '2026-02-30' }, { dateTo: 'ontem' }, { dateFrom: ['2026-10-01'] }, { dateFrom: '2026-10-07', dateTo: '2026-10-06' }]) {
    await assert.rejects(listDocuments(client, 'owner', filters));
  }
});
