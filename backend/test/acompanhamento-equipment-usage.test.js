import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../src/lib/prisma.js';
import { getEquipmentUsageByProject } from '../src/lib/acompanhamento/equipment-usage.js';

test('equipment usage retains TAGs and the earliest departure, with a historical-code fallback', async t => {
  const original = [prisma.romaneio.findMany, prisma.romaneioItem.findMany, prisma.romaneioCatalogItem.findMany];
  t.after(() => { [prisma.romaneio.findMany, prisma.romaneioItem.findMany, prisma.romaneioCatalogItem.findMany] = original; });
  const parents = [
    { id: 'r1', projectId: 'p1', romaneioDate: '2026-08-25', items: [
      { itemCode: 'OLD 008', itemName: 'Nome histórico', catalogItem: { sourceId: 'e1', code: 'UFI 008', name: 'Unidade de filtragem' } }
    ] },
    { id: 'r2', projectId: 'p1', romaneioDate: '2026-08-22', items: [
      { itemCode: 'OLD 008', itemName: 'Nome histórico', catalogItem: { sourceId: 'e1', code: 'UFI 008', name: 'Unidade de filtragem' } },
      { itemCode: 'UFI 009', itemName: 'Unidade de filtragem', catalogItem: { sourceId: 'e2', code: null, name: 'Unidade de filtragem' } },
      { itemCode: null, itemName: 'Sem TAG', catalogItem: { sourceId: 'e3', code: null, name: 'Sem TAG' } }
    ] }
  ];
  prisma.romaneio.findMany = async () => parents.map(({ items, ...parent }) => parent);
  prisma.romaneioItem.findMany = async args => {
    assert.deepEqual(args.where, { romaneioId: { in: ['r1','r2'] }, catalogItem: { sourceType: 'EQUIPAMENTOS' } });
    return parents.flatMap(parent => parent.items.map(({ catalogItem, ...item }) => ({
      ...item, romaneioId: parent.id, catalogItemId: catalogItem.sourceId
    })));
  };
  prisma.romaneioCatalogItem.findMany = async () => [...new Map(parents.flatMap(parent => parent.items)
    .map(({ catalogItem }) => [catalogItem.sourceId, { ...catalogItem, id: catalogItem.sourceId }])).values()];

  const result = await getEquipmentUsageByProject(['p1', 'empty']);

  assert.deepEqual(result.get('p1'), [
    { code: 'UFI 008', name: 'Unidade de filtragem', sinceDate: '2026-08-22' },
    { code: 'UFI 009', name: 'Unidade de filtragem', sinceDate: '2026-08-22' },
    { code: null, name: 'Sem TAG', sinceDate: '2026-08-22' }
  ]);
  assert.equal(result.has('empty'), false);
});

test('equipment usage does not query children of empty parents or catalogs of empty items', async t => {
  const original = [prisma.romaneio.findMany, prisma.romaneioItem.findMany, prisma.romaneioCatalogItem.findMany];
  t.after(() => { [prisma.romaneio.findMany, prisma.romaneioItem.findMany, prisma.romaneioCatalogItem.findMany] = original; });
  prisma.romaneio.findMany = async () => [];
  prisma.romaneioItem.findMany = () => { throw new Error('empty parents have no children'); };
  prisma.romaneioCatalogItem.findMany = () => { throw new Error('empty items have no catalog'); };
  assert.deepEqual(await getEquipmentUsageByProject(['p1']), new Map());
  prisma.romaneio.findMany = async () => [{ id: 'r1', projectId: 'p1', romaneioDate: new Date() }];
  prisma.romaneioItem.findMany = async () => [];
  assert.deepEqual(await getEquipmentUsageByProject(['p1']), new Map());
});
