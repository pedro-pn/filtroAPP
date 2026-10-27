import assert from 'node:assert/strict';
import test from 'node:test';
import { reportRomaneioEquipmentByProject } from '../src/lib/reports/romaneio-equipment-suggestions.js';

const equipments = [
  { id: 'ulq5', code: 'ULQ005', isActive: true },
  { id: 'ufi1', code: 'UFI001', isActive: true },
  { id: 'inactive', code: 'ULQ06', isActive: false },
  { id: 'generic', code: 'ULQ', isActive: true },
  { id: 'duplicate1', code: 'UFI02', isActive: true },
  { id: 'duplicate2', code: 'UFI 002', isActive: true }
];
const item = (projectId, itemCode, catalogItem = null) => ({ romaneio: { projectId }, itemCode, catalogItem });

test('sugere os patrimônios de todas as saídas, sem duplicar nem misturar projetos', async () => {
  let query;
  const client = { romaneioItem: { findMany: async args => {
    query = args;
    return [
      item('9999', 'ULQ 05', { sourceType: 'EQUIPAMENTOS', sourceId: 'ulq5' }),
      item('9999', 'UFI 01', { sourceType: 'UNIT', sourceId: 'legacy-unit' }),
      item('9999', 'ULQ 05'),
      item('8888', 'UFI-001'),
      item('hidden', 'ULQ005')
    ];
  } } };
  assert.deepEqual(await reportRomaneioEquipmentByProject(client, ['9999', '8888'], equipments), {
    9999: ['ulq5', 'ufi1'], 8888: ['ufi1']
  });
  assert.deepEqual(query.where, {
    romaneio: { projectId: { in: ['9999', '8888'] }, type: 'OUTBOUND' },
    kind: 'EQUIPMENT', quantity: { gt: 0 }
  });
});

test('ignora estoque, inativos, códigos genéricos e patrimônios ambíguos; vínculo explícito prevalece', async () => {
  const client = { romaneioItem: { findMany: async () => [
    item('9999', 'ULQ005', { sourceType: 'STOCK', sourceId: 'ulq5' }),
    item('9999', 'ULQ006'),
    item('9999', 'ULQ'),
    item('9999', 'UFI02'),
    item('9999', 'ULQ005', { sourceType: 'EQUIPAMENTOS', sourceId: 'inactive' }),
    item('9999', 'ULQ005', { sourceType: 'EQUIPAMENTOS', sourceId: 'missing' }),
    item('9999', 'código antigo', { sourceType: 'EQUIPAMENTOS', sourceId: 'ufi1' }),
    item('9999', 'UCT001'),
    item('9999', null)
  ] } };
  assert.deepEqual(await reportRomaneioEquipmentByProject(client, ['9999'], equipments), { 9999: ['ufi1'] });
});

test('sem projeto visível, equipamentos ou romaneio, não há sugestões', async () => {
  const calls = [];
  const client = { romaneioItem: { findMany: async args => { calls.push(args); return []; } } };
  assert.deepEqual(await reportRomaneioEquipmentByProject(client, [], equipments), {});
  assert.deepEqual(await reportRomaneioEquipmentByProject(client, ['9999'], []), {});
  assert.equal(calls.length, 0);
  assert.deepEqual(await reportRomaneioEquipmentByProject(client, ['9999'], equipments), {});
  assert.equal(calls.length, 1);
});
