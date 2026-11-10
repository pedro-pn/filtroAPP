import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';

import { getStockItemProjectActivity, stockMovementListArgs } from '../src/routes/resources/estoque.js';

test('product activity reports outbound, inbound and net quantities for every project', async () => {
  const projects = Array.from({ length: 12 }, (_, index) => ({ id: `project-${index}`, code: String(5800 + index), name: `Obra ${index}` }));
  const result = await getStockItemProjectActivity({
    stockMovement: { groupBy: async args => {
      assert.deepEqual(args.where, { itemId: 'chemical', projectId: { not: null }, reason: { not: 'ESTORNO' }, reversalOfId: null, reversedBy: { is: null } });
      return projects.flatMap(project => [
        { projectId: project.id, type: 'SAIDA', _sum: { quantity: new Prisma.Decimal('385.125') } },
        { projectId: project.id, type: 'ENTRADA', _sum: { quantity: new Prisma.Decimal('5.100') } }
      ]);
    } },
    project: { findMany: async args => {
      assert.equal(args.where.id.in.length, 12);
      return projects;
    } }
  }, 'chemical');
  assert.equal(result.length, 12, 'project totals must not be limited to a history page');
  assert.deepEqual(result[0], { project: projects[0], outbound: '385.125', inbound: '5.100', netOutbound: '380.025' });
});

test('product activity is empty for an item without project movements', async () => {
  assert.deepEqual(await getStockItemProjectActivity({ stockMovement: { groupBy: async () => [] } }, 'unused'), []);
});

test('history can hide cancellations while the default audit list remains complete', () => {
  const filtered = stockMovementListArgs({ itemId: 'chemical', includeReversed: 'false', projectId: 'seadrill', type: 'SAIDA', reason: 'USO_EM_PROJETO' });
  assert.deepEqual(filtered.where, { itemId: 'chemical', projectId: 'seadrill', type: 'SAIDA',
    reason: { not: 'ESTORNO', equals: 'USO_EM_PROJETO' }, reversalOfId: null, reversedBy: { is: null } });
  assert.deepEqual(stockMovementListArgs({ itemId: 'chemical' }).where, { itemId: 'chemical' });
});
