import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../src/lib/prisma.js';
import { getEquipmentUsageByProject } from '../src/lib/acompanhamento/equipment-usage.js';

test('equipment usage retains TAGs and the earliest departure, with a historical-code fallback', async t => {
  const original = prisma.romaneio.findMany;
  t.after(() => { prisma.romaneio.findMany = original; });
  prisma.romaneio.findMany = async () => [
    { projectId: 'p1', romaneioDate: '2026-08-25', items: [
      { itemCode: 'OLD 008', itemName: 'Nome histórico', catalogItem: { sourceId: 'e1', code: 'UFI 008', name: 'Unidade de filtragem' } }
    ] },
    { projectId: 'p1', romaneioDate: '2026-08-22', items: [
      { itemCode: 'OLD 008', itemName: 'Nome histórico', catalogItem: { sourceId: 'e1', code: 'UFI 008', name: 'Unidade de filtragem' } },
      { itemCode: 'UFI 009', itemName: 'Unidade de filtragem', catalogItem: { sourceId: 'e2', code: null, name: 'Unidade de filtragem' } },
      { itemCode: null, itemName: 'Sem TAG', catalogItem: { sourceId: 'e3', code: null, name: 'Sem TAG' } }
    ] }
  ];

  const result = await getEquipmentUsageByProject(['p1', 'empty']);

  assert.deepEqual(result.get('p1'), [
    { code: 'UFI 008', name: 'Unidade de filtragem', sinceDate: '2026-08-22' },
    { code: 'UFI 009', name: 'Unidade de filtragem', sinceDate: '2026-08-22' },
    { code: null, name: 'Sem TAG', sinceDate: '2026-08-22' }
  ]);
  assert.equal(result.has('empty'), false);
});
