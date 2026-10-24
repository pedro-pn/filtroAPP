import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

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

test('categorias secundárias não alteram a mistura principal e também protegem os vínculos', async () => {
  const overrides = [{ slotKey: 'limpeza.ulq', categoryIds: ['c-lq', 'c-mano'],
    secondaryCategoryIds: ['c-extra', 'c-extra', 'c-lq', 'inactive'] }];
  const client = mockClient({ overrides, categories });
  const { map, secondaryMap, slots, categories: available } = await resolveRdoSlotMap(client);
  assert.deepEqual(map['limpeza.ulq'], ['c-lq', 'c-mano']);
  assert.deepEqual(secondaryMap['limpeza.ulq'], ['c-extra']);
  assert.deepEqual(slots.find(slot => slot.key === 'limpeza.ulq').secondaryCategoryIds, ['c-extra']);
  assert.ok(available.some(category => category.id === 'c-extra'));
  assert.ok((await categoryIdsLinkedToRdo(client)).has('c-extra'));
});

test('migração adiciona secundárias sem converter ou perder categorias principais misturadas', async () => {
  const db = new PGlite();
  try {
    for (const name of ['20260616140000_rdo_equipment_slots', '20260622140000_rdo_slot_multi_category']) {
      await db.exec(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
    }
    await db.exec(`INSERT INTO "RdoEquipmentSlot" (id, "slotKey", "categoryIds", "updatedAt")
      VALUES ('slot', 'limpeza.ulq', '["chemical", "flushing"]', now());`);
    await db.exec(await readFile(new URL('../prisma/migrations/20261024180000_rdo_secondary_equipment_categories/migration.sql', import.meta.url), 'utf8'));
    const result = await db.query('SELECT "categoryIds", "secondaryCategoryIds" FROM "RdoEquipmentSlot"');
    assert.deepEqual(result.rows, [{ categoryIds: ['chemical', 'flushing'], secondaryCategoryIds: [] }]);
  } finally { await db.close(); }
});
