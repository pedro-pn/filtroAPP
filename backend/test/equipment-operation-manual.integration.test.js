import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import sharp from 'sharp';

import app from '../src/app.js';
import { createSession } from '../src/lib/auth.js';
import prisma from '../src/lib/prisma.js';

async function pngDataUrl(color) {
  const bytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: color } }).png().toBuffer();
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

test('modelo de passos da categoria guarda fotos; equipamento copia ao ter passos próprios', {
  skip: !process.env.TEST_RDO_EQUIPMENT_DATABASE_URL
}, async t => {
  assert.equal(process.env.DATABASE_URL, process.env.TEST_RDO_EQUIPMENT_DATABASE_URL);
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/filtroapp_equipment_test');
  const suffix = randomUUID();
  const users = [];
  const categories = [];
  const catalogItems = [];
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await prisma.romaneioCatalogItem.deleteMany({ where: { id: { in: catalogItems } } });
    await prisma.companyEquipment.deleteMany({ where: { categoryId: { in: categories.map(item => item.id) } } });
    await prisma.equipmentCategory.deleteMany({ where: { id: { in: categories.map(item => item.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  const newUser = async role => {
    const user = await prisma.user.create({
      data: {
        username: `${role}-${suffix}`, name: role, passwordHash: 'synthetic', role: 'MANAGER', accountType: 'INTERNAL',
        moduleRoles: { create: [{ module: 'EQUIPAMENTOS', role }] }
      }
    });
    users.push(user.id);
    return (await createSession(user.id)).token;
  };
  const manager = await newUser('EQUIPAMENTOS_MANAGER');
  const viewer = await newUser('EQUIPAMENTOS_VIEWER');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, method, body, token = manager) => fetch(`${base}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  const category = await prisma.equipmentCategory.create({
    data: { name: 'Manual fotos', systemKey: `manual-fotos-${suffix}`, operationManualEnabled: true }
  });
  categories.push(category);
  const equipment = await prisma.companyEquipment.create({ data: { code: `MF-${suffix}`.slice(0, 30), name: 'Equipamento', categoryId: category.id } });

  // Gestor grava o modelo com uma foto nova no passo 2.
  const saved = await request(`/equipamentos/categories/${category.id}`, 'PUT', {
    operationSteps: ['Primeiro passo.', { text: 'Segundo passo.', photos: [{ fileName: 'a.png', mimeType: 'image/png', dataUrl: await pngDataUrl('#30503A') }] }]
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.operationPhotos.length, 1);
  const templatePhotoId = savedBody.operationPhotos[0].id;
  assert.deepEqual(savedBody.operationSteps, ['Primeiro passo.', { text: 'Segundo passo.', photoIds: [templatePhotoId] }]);

  // A listagem de categorias traz as fotos do modelo.
  const listed = await (await request('/equipamentos/categories', 'GET', undefined, viewer)).json();
  assert.equal(listed.find(item => item.id === category.id).operationPhotos[0].id, templatePhotoId);

  // Equipamento passa a ter passos próprios reaproveitando a foto do modelo: recebe uma CÓPIA.
  const own = await request(`/equipamentos/${equipment.id}/operation-manual`, 'PUT', {
    steps: [{ text: 'Segundo passo (próprio).', photos: [{ id: templatePhotoId }] }]
  });
  assert.equal(own.status, 200);
  const ownBody = await own.json();
  const ownPhotos = ownBody.equipment.operationPhotos;
  assert.equal(ownPhotos.length, 1);
  assert.notEqual(ownPhotos[0].id, templatePhotoId, 'o equipamento tem a própria cópia');
  assert.deepEqual(ownBody.equipment.operationSteps, [{ text: 'Segundo passo (próprio).', photoIds: [ownPhotos[0].id] }]);

  // Apagar a foto do modelo não afeta a cópia do equipamento.
  const cleared = await request(`/equipamentos/categories/${category.id}`, 'PUT', { operationSteps: ['Primeiro passo.'] });
  assert.equal((await cleared.json()).operationPhotos.length, 0);
  assert.equal(await prisma.equipmentAttachment.count({ where: { id: templatePhotoId } }), 0);
  assert.equal(await prisma.equipmentAttachment.count({ where: { id: ownPhotos[0].id } }), 1);

  // Foto de outro dono não é aceita; visualizador não grava.
  const foreign = await request(`/equipamentos/${equipment.id}/operation-manual`, 'PUT', {
    steps: [{ text: 'Passo.', photos: [{ id: 'nao-existe' }] }]
  });
  assert.equal((await foreign.json()).equipment.operationPhotos.length, 0);
  assert.equal((await request(`/equipamentos/${equipment.id}/operation-manual`, 'PUT', { steps: ['x'] }, viewer)).status, 403);

  // QR code do Romaneio: o equipamento sincronizado expõe o id do item de catálogo (e só ele).
  const listBefore = await (await request('/equipamentos/', 'GET', undefined, viewer)).json();
  assert.equal(listBefore.find(item => item.id === equipment.id).romaneioCatalogItemId, null);
  const catalog = await prisma.romaneioCatalogItem.create({
    data: { sourceType: 'EQUIPAMENTOS', sourceId: equipment.id, code: equipment.code, name: equipment.name, categoryName: category.name }
  });
  catalogItems.push(catalog.id);
  const listAfter = await (await request('/equipamentos/', 'GET', undefined, viewer)).json();
  assert.equal(listAfter.find(item => item.id === equipment.id).romaneioCatalogItemId, catalog.id);
  await prisma.romaneioCatalogItem.update({ where: { id: catalog.id }, data: { isActive: false } });
  const listInactive = await (await request('/equipamentos/', 'GET', undefined, viewer)).json();
  assert.equal(listInactive.find(item => item.id === equipment.id).romaneioCatalogItemId, null, 'item inativo no catálogo não gera QR');
});
