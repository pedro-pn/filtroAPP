import assert from 'node:assert/strict';
import test from 'node:test';

import equipamentosRouter from '../src/routes/resources/equipamentos.js';
import prisma from '../src/lib/prisma.js';

function fixture(t, { equipment = [], overrides = [], systemKey = 'custom', exists = true } = {}) {
  const category = { id: 'category-1', name: 'Categoria', systemKey, isActive: true };
  const previousEquipment = structuredClone(equipment);
  const mockMethod = (delegate, name, implementation) => {
    const original = delegate[name];
    const mock = t.mock.fn(implementation);
    delegate[name] = mock;
    t.after(() => { delegate[name] = original; });
    return mock;
  };
  mockMethod(prisma.equipmentCategory, 'findUnique', async ({ where, include }) => {
    assert.equal(where.id, category.id);
    if (!exists) return null;
    const filter = include._count.select.equipment.where;
    const count = equipment.filter(item => !filter || item.isActive === filter.isActive).length;
    return { ...category, _count: { equipment: count } };
  });
  mockMethod(prisma.equipmentCategory, 'findMany', async () => [category]);
  mockMethod(prisma.rdoEquipmentSlot, 'findMany', async () => overrides);
  const update = mockMethod(prisma.equipmentCategory, 'update', async ({ where, data }) => {
    assert.equal(where.id, category.id);
    Object.assign(category, data);
    return { ...category };
  });
  const layer = equipamentosRouter.stack.find(
    item => item.route?.path === '/categories/:id' && item.route.methods?.delete
  );
  assert.ok(layer);
  const remove = () => new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { resolve({ statusCode: this.statusCode, value }); },
      end() { resolve({ statusCode: this.statusCode }); }
    };
    layer.route.stack.at(-1).handle({ params: { id: category.id } }, res, reject);
  });
  t.after(() => assert.deepEqual(equipment, previousEquipment, 'Preserva o histórico dos equipamentos.'));
  return { category, update, remove };
}

test('permite excluir categoria quando todos os equipamentos já foram removidos', async t => {
  const { category, update, remove } = fixture(t, {
    equipment: [{ id: 'eq-1', isActive: false }, { id: 'eq-2', isActive: false }]
  });

  assert.equal((await remove()).statusCode, 204);
  assert.equal(category.isActive, false);
  assert.equal(update.mock.callCount(), 1);
  assert.deepEqual(update.mock.calls[0].arguments[0].data, { isActive: false });
});

test('permite excluir categoria que nunca teve equipamentos', async t => {
  const { category, remove } = fixture(t);
  assert.equal((await remove()).statusCode, 204);
  assert.equal(category.isActive, false);
});

test('bloqueia exclusão quando ainda existe equipamento ativo entre os removidos', async t => {
  const { category, update, remove } = fixture(t, {
    equipment: [{ id: 'eq-1', isActive: false }, { id: 'eq-2', isActive: true }]
  });
  const response = await remove();

  assert.equal(response.statusCode, 409);
  assert.equal(response.value.error, 'Remova ou mova os equipamentos antes de excluir a categoria.');
  assert.equal(category.isActive, true);
  assert.equal(update.mock.callCount(), 0);
});

for (const link of ['default', 'primary', 'secondary']) {
  test(`mantém bloqueio de categoria vinculada ao RDO (${link}) mesmo com equipamentos removidos`, async t => {
    const { category, update, remove } = fixture(t, {
      equipment: [{ id: 'eq-1', isActive: false }],
      systemKey: link === 'default' ? 'manometer' : 'custom',
      overrides: link === 'default' ? [] : [{
        slotKey: 'pressao.manometros',
        categoryIds: link === 'primary' ? ['category-1'] : [],
        secondaryCategoryIds: link === 'secondary' ? ['category-1'] : []
      }]
    });
    const response = await remove();

    assert.equal(response.statusCode, 409);
    assert.match(response.value.error, /Categoria vinculada a um slot de relatório/);
    assert.equal(category.isActive, true);
    assert.equal(update.mock.callCount(), 0);
  });
}

test('retorna 404 para categoria inexistente', async t => {
  const { update, remove } = fixture(t, { exists: false });
  const response = await remove();
  assert.equal(response.statusCode, 404);
  assert.equal(response.value.error, 'Categoria não encontrada.');
  assert.equal(update.mock.callCount(), 0);
});
