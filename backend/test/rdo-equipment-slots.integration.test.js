import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import app from '../src/app.js';
import prisma from '../src/lib/prisma.js';
import { createSession } from '../src/lib/auth.js';

test('configuração de categorias principais/secundárias persiste e chega ao formulário com as permissões corretas', {
  skip: !process.env.TEST_RDO_EQUIPMENT_DATABASE_URL
}, async t => {
  assert.equal(process.env.DATABASE_URL, process.env.TEST_RDO_EQUIPMENT_DATABASE_URL);
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/filtroapp_equipment_test');
  const suffix = randomUUID();
  const users = [];
  const categories = [];
  const slotKey = 'limpeza.ulq';
  const previous = await prisma.rdoEquipmentSlot.findUnique({ where: { slotKey } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await prisma.rdoEquipmentSlot.deleteMany({ where: { slotKey } });
    if (previous) await prisma.rdoEquipmentSlot.create({ data: previous });
    await prisma.equipmentCategory.deleteMany({ where: { id: { in: categories.map(item => item.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  const newUser = async role => {
    const user = await prisma.user.create({ data: { username: `${role}-${suffix}`, name: role, passwordHash: 'synthetic',
      role: 'MANAGER', accountType: 'INTERNAL', moduleRoles: { create: [
        { module: 'EQUIPAMENTOS', role }, { module: 'RDO', role: 'RDO_MANAGER' }
      ] } } });
    users.push(user.id);
    return (await createSession(user.id)).token;
  };
  const manager = await newUser('EQUIPAMENTOS_MANAGER');
  const viewer = await newUser('EQUIPAMENTOS_VIEWER');
  for (const name of ['Principal A', 'Principal B', 'Secundária', 'Inativa']) {
    categories.push(await prisma.equipmentCategory.create({ data: { name, systemKey: `${name}-${suffix}`, isActive: name !== 'Inativa' } }));
  }
  const [a, b, secondary, inactive] = categories;
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, method, body, token = manager) => fetch(`${base}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const path = `/equipamentos/rdo-slots/${slotKey}`;
  assert.equal((await request(path, 'PUT', { categoryIds: [a.id], secondaryCategoryIds: [secondary.id] }, viewer)).status, 403);
  assert.equal((await request(path, 'PUT', { categoryIds: [a.id, b.id], secondaryCategoryIds: [secondary.id, secondary.id, a.id] })).status, 200);
  const stored = await prisma.rdoEquipmentSlot.findUnique({ where: { slotKey } });
  assert.deepEqual(stored.categoryIds, [a.id, b.id]);
  assert.deepEqual(stored.secondaryCategoryIds, [secondary.id]);
  assert.equal((await request(path, 'PUT', { categoryIds: [a.id, b.id] })).status, 200, 'clientes anteriores preservam secundárias');
  const response = await request('/rdo/bootstrap/new-report', 'GET');
  assert.equal(response.status, 200);
  const bootstrap = await response.json();
  assert.deepEqual(bootstrap.rdoSlotMap[slotKey], [a.id, b.id]);
  assert.deepEqual(bootstrap.rdoSecondarySlotMap[slotKey], [secondary.id]);
  assert.ok(bootstrap.rdoEquipmentCategories.some(item => item.id === secondary.id && item.name === secondary.name));
  assert.equal((await request(path, 'PUT', { categoryIds: [a.id], secondaryCategoryIds: [inactive.id] })).status, 400);
  assert.equal((await request(path, 'PUT', { categoryIds: [a.id], secondaryCategoryIds: ['missing'] })).status, 400);
  assert.equal((await request(`/equipamentos/categories/${secondary.id}`, 'DELETE')).status, 409, 'vínculo secundário protege categoria');
});
