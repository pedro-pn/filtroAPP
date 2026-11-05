import assert from 'node:assert/strict';
import test from 'node:test';

import { listDocuments } from '../src/lib/assinaturas/service.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';

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
    assert.equal(where.AND[0].OR[0].ownerUserId, 'owner');
    assert.equal(where.deletedAt, null);
    assert.equal(where.archivedAt, null);
    assert.equal(where.status, 'CONCLUIDO');
    assert.equal(where.OR[0].title.contains, 'Contrato');
    assert.deepEqual(orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
    assert.equal(take, 2);
    assert.equal(cursor, undefined);
    assert.equal(skip, undefined);
    return rows.filter(row => row.ownerUserId === where.AND[0].OR[0].ownerUserId && row.createdAt >= where.createdAt.gte && row.createdAt < where.createdAt.lt)
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

test('busca por colaborador consulta assinantes no PostgreSQL, incluindo paginação, lotes e compartilhamentos', async t => {
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const { client } = database;
  for (const id of ['owner', 'other']) {
    await client.user.create({ data: { id, username: id, name: id, passwordHash: 'test-only', role: 'COLLABORATOR' } });
    await client.signatureDocumentBatch.create({ data: { id: `${id}-batch`, ownerUserId: id } });
  }
  const signer = { name: 'Messias Fortunato', email: 'messias@example.com' };
  const otherSigner = { name: 'Outra Pessoa', email: null };
  const collaboratorIds = Array.from({ length: 23 }, (_, index) => `collaborator-${String(index).padStart(2, '0')}`);
  const fixtures = [
    ...collaboratorIds.map((id, index) => ({ id, ...(index === 0 ? { status: 'CONCLUIDO' } : {}) })),
    { id: 'title-match', title: 'Envio de Messias Fortunato', signer: otherSigner },
    { id: 'file-match', originalFileName: 'Messias Fortunato anexo.pdf', signer: otherSigner },
    { id: 'batch-match', batchId: 'owner-batch', batchPosition: 0 },
    { id: 'batch-context', batchId: 'owner-batch', batchPosition: 1, signer: otherSigner },
    { id: 'shared', ownerUserId: 'other', batchId: 'other-batch' },
    { id: 'private-sibling', ownerUserId: 'other', batchId: 'other-batch' },
    { id: 'private', ownerUserId: 'other' },
    { id: 'archived', archivedAt: new Date('2026-11-01T12:00:00Z') },
    { id: 'deleted', deletedAt: new Date('2026-11-01T12:00:00Z') },
    { id: 'older', createdAt: new Date('2026-09-01T12:00:00Z') }
  ];
  for (const { signer: fixtureSigner = signer, ...fixture } of fixtures) {
    await client.signatureDocument.create({ data: {
      ownerUserId: 'owner', requesterNameSnapshot: 'Responsável', title: `Documento ${fixture.id}`,
      originalFileName: 'documento.pdf', fileSizeBytes: 100, pageCount: 1, pageDimensions: [],
      sourceDocumentHash: 'test-hash', createdAt: new Date('2026-10-30T12:00:00Z'),
      status: 'AGUARDANDO_ASSINATURAS', ...fixture,
      signers: { create: { ...fixtureSigner, position: 1, status: fixture.status === 'CONCLUIDO' ? 'ASSINADO' : 'PENDENTE' } }
    } });
  }
  // Dois assinantes que correspondem à busca não devem duplicar o documento.
  await client.signatureDocumentSigner.create({ data: { documentId: collaboratorIds[1], ...signer, position: 2 } });
  await client.signatureDocumentShare.create({ data: { documentId: 'shared', userId: 'owner', permission: 'VIEW' } });

  async function allPages(filters) {
    const items = [];
    let cursor;
    do {
      const page = await listDocuments(client, 'owner', { ...filters, cursor });
      items.push(...page.items);
      cursor = page.nextCursor;
      assert.ok(items.length <= fixtures.length, 'a paginação deve avançar sem repetir documentos');
    } while (cursor);
    assert.equal(new Set(items.map(item => item.id)).size, items.length);
    return items;
  }
  const expected = [...collaboratorIds, 'title-match', 'file-match', 'batch-match', 'shared', 'older'];

  await t.test('nome parcial ignora caixa e espaços nas bordas, mantendo busca por título e arquivo', async () => {
    for (const q of ['mess', '  mEsSiAs FoRtUnAtO  ']) {
      const items = await allPages({ q });
      assert.deepEqual(new Set(items.map(item => item.id)), new Set(expected));
      assert.equal(items.find(item => item.id === collaboratorIds[1]).signerCount, 2);
    }
  });

  await t.test('e-mail parcial encontra documentos com títulos genéricos e assinantes sem e-mail não causam erro', async () => {
    const items = await allPages({ q: 'MESSIAS@EXAMPLE' });
    assert.deepEqual(new Set(items.map(item => item.id)), new Set([...collaboratorIds, 'batch-match', 'shared', 'older']));
  });

  await t.test('busca em lotes pagina todos os resultados e mantém contexto sem expor PDFs privados', async () => {
    const items = await allPages({ grouped: true, q: 'mess', limit: 5 });
    assert.deepEqual(new Set(items.map(item => item.id)), new Set(expected.map(id => id === 'batch-match' ? 'owner-batch' : id)));
    assert.deepEqual(items.find(item => item.id === 'owner-batch').batchDocuments.map(item => item.id), ['batch-match', 'batch-context']);
    assert.equal(items.find(item => item.id === 'shared').batchDocuments, undefined);
  });

  await t.test('nome do colaborador combina com status, datas e lista de arquivados', async () => {
    for (const grouped of [false, true]) {
      const completed = await allPages({ grouped, q: 'mess', status: 'CONCLUIDO', dateFrom: '2026-10-30', dateTo: '2026-10-30' });
      assert.deepEqual(completed.map(item => item.id), [collaboratorIds[0]]);
      const archived = await allPages({ grouped, q: 'mess', archived: true });
      assert.deepEqual(archived.map(item => item.id), ['archived']);
      assert.deepEqual(await allPages({ grouped, q: 'colaborador inexistente' }), []);
    }
  });
});
