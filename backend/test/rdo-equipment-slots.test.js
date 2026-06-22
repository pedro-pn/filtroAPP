import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRdoSlotMap, categoryIdsLinkedToRdo } from '../src/lib/rdo-equipment-slots.js';

function mockClient({ overrides = [], categories = [] }) {
  return {
    rdoEquipmentSlot: { findMany: async () => overrides },
    equipmentCategory: { findMany: async () => categories }
  };
}

const categories = [
  { id: 'c-lq', systemKey: 'unit:LIMPEZA_QUIMICA' },
  { id: 'c-mano', systemKey: 'manometer' },
  { id: 'c-extra', systemKey: 'x' }
];

test('resolveRdoSlotMap usa o default (por systemKey) como array', async () => {
  const { map } = await resolveRdoSlotMap(mockClient({ categories }));
  assert.deepEqual(map['limpeza.ulq'], ['c-lq']);       // default unit:LIMPEZA_QUIMICA
  assert.deepEqual(map['pressao.manometros'], ['c-mano']); // default manometer
  assert.deepEqual(map['pressao.uth'], []);             // default unit:UTH ausente → vazio
});

test('resolveRdoSlotMap aplica override com múltiplas categorias e filtra inválidas', async () => {
  const overrides = [
    { slotKey: 'limpeza.ulq', categoryIds: ['c-lq', 'c-extra'] },
    { slotKey: 'pressao.manometros', categoryIds: ['nope'] } // inválida → fora
  ];
  const { map, slots } = await resolveRdoSlotMap(mockClient({ overrides, categories }));
  assert.deepEqual(map['limpeza.ulq'], ['c-lq', 'c-extra']);
  assert.deepEqual(map['pressao.manometros'], []);
  // a lista de slots também carrega categoryIds
  assert.deepEqual(slots.find(s => s.key === 'limpeza.ulq').categoryIds, ['c-lq', 'c-extra']);
});

test('resolveRdoSlotMap aceita o legado categoryId (array vazio)', async () => {
  const overrides = [{ slotKey: 'limpeza.ulq', categoryIds: [], categoryId: 'c-lq' }];
  const { map } = await resolveRdoSlotMap(mockClient({ overrides, categories }));
  assert.deepEqual(map['limpeza.ulq'], ['c-lq']);
});

test('categoryIdsLinkedToRdo achata todas as categorias vinculadas', async () => {
  const overrides = [{ slotKey: 'limpeza.ulq', categoryIds: ['c-lq', 'c-extra'] }];
  const linked = await categoryIdsLinkedToRdo(mockClient({ overrides, categories }));
  assert.ok(linked.has('c-lq'));
  assert.ok(linked.has('c-extra'));
  assert.ok(linked.has('c-mano')); // default do slot de manômetros
});
