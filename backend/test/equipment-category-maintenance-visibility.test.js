import assert from 'node:assert/strict';
import test from 'node:test';

import equipamentosRouter from '../src/routes/resources/equipamentos.js';
import prisma from '../src/lib/prisma.js';

function routeHandler(path, method) {
  const layer = equipamentosRouter.stack.find(
    item => item.route?.path === path && item.route.methods?.[method]
  );
  assert.ok(layer, `Rota ${method.toUpperCase()} ${path} não encontrada.`);
  return layer.route.stack.at(-1).handle;
}

function invokeForJson(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(value) {
        resolve({ statusCode: this.statusCode, value });
      }
    };
    handler(req, res, reject);
  });
}

test('cadastro de categoria persiste a opção de exibição na manutenção', async () => {
  const originalFindUnique = prisma.equipmentCategory.findUnique;
  const originalCreate = prisma.equipmentCategory.create;
  let createData = null;
  prisma.equipmentCategory.findUnique = async () => null;
  prisma.equipmentCategory.create = async ({ data }) => {
    createData = data;
    return { id: 'category-1', ...data };
  };
  try {
    const response = await invokeForJson(routeHandler('/categories', 'post'), {
      body: { name: 'Consumíveis', showInMaintenance: false }
    });

    assert.equal(response.statusCode, 201);
    assert.equal(createData.showInMaintenance, false);
    assert.equal(response.value.showInMaintenance, false);
  } finally {
    prisma.equipmentCategory.findUnique = originalFindUnique;
    prisma.equipmentCategory.create = originalCreate;
  }
});

test('edição de categoria atualiza somente a opção de manutenção solicitada', async () => {
  const originalFindUnique = prisma.equipmentCategory.findUnique;
  const originalUpdate = prisma.equipmentCategory.update;
  let updateData = null;
  prisma.equipmentCategory.findUnique = async () => ({
    name: 'Consumíveis',
    syncToRomaneio: false
  });
  prisma.equipmentCategory.update = async ({ data }) => {
    updateData = data;
    return { id: 'category-1', name: 'Consumíveis', ...data };
  };
  try {
    const response = await invokeForJson(
      routeHandler('/categories/:id', 'put'),
      {
        params: { id: 'category-1' },
        body: { showInMaintenance: true }
      }
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(updateData, { showInMaintenance: true });
    assert.equal(response.value.showInMaintenance, true);
  } finally {
    prisma.equipmentCategory.findUnique = originalFindUnique;
    prisma.equipmentCategory.update = originalUpdate;
  }
});
