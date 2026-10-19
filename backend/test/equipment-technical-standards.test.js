import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import { normalizeTechnicalSchema } from '../src/lib/equipment-categories.js';
import { buildTechnicalDocModel } from '../src/lib/equipment-technical-doc.js';
import { removeTechnicalStandard, saveCategoryTechnicalStandard, updateTechnicalStandard } from '../src/lib/equipamentos/technical-standards.js';
import equipamentosRouter from '../src/routes/resources/equipamentos.js';
import prisma from '../src/lib/prisma.js';

const originalSchema = normalizeTechnicalSchema([
  { key: 'potencia', label: 'Potência', type: 'measure', unit: { dimension: 'potencia', default: 'kW' } },
  { key: 'motores', label: 'Motores', type: 'group', itemSchema: [{ key: 'serie', label: 'Série', type: 'text' }] },
  { key: 'nota', label: 'Nota', type: 'text', optionalPerEquipment: true }
]);

test('migração copia integralmente schemas ativos, inativos e desabilitados sem alterar dados ou anexos', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE "EquipmentCategory" (
      "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "technicalSchema" JSONB NOT NULL DEFAULT '[]',
      "technicalDocEnabled" BOOLEAN NOT NULL DEFAULT false, "isActive" BOOLEAN NOT NULL DEFAULT true,
      "technicalTemplateId" TEXT, "createdAt" TIMESTAMP(3) DEFAULT NOW(), "updatedAt" TIMESTAMP(3) DEFAULT NOW()
    );
    CREATE TABLE "CompanyEquipment" (
      "id" TEXT PRIMARY KEY, "categoryId" TEXT, "technicalData" JSONB, "technicalFieldOverrides" JSONB,
      "technicalRevision" INTEGER, "technicalUpdatedAt" TIMESTAMP(3)
    );
    CREATE TABLE "EquipmentAttachment" ("id" TEXT PRIMARY KEY, "equipmentId" TEXT, "kind" TEXT, "storagePath" TEXT);
  `);
  // Inclui metadados adicionais e chaves legadas: a migração deve copiar o JSON exato.
  const schema = [...originalSchema, { key: 'Legacy-Key', label: 'Legado', type: 'text', customMetadata: { keep: true } }];
  for (const [id, enabled, active] of [['active', true, true], ['disabled', false, true], ['inactive', true, false]]) {
    await db.query('INSERT INTO "EquipmentCategory" ("id", "name", "technicalSchema", "technicalDocEnabled", "isActive", "technicalTemplateId") VALUES ($1, $2, $3, $4, $5, $6)', [id, 'Nome repetido', JSON.stringify(schema), enabled, active, 'docx-original']);
  }
  await db.exec(`INSERT INTO "EquipmentCategory" ("id", "name") VALUES ('empty', 'Sem campos')`);
  const values = { potencia: { value: '15', unit: 'kW' }, motores: [{ serie: 'A123' }], nota: 'Preservar' };
  await db.query('INSERT INTO "CompanyEquipment" VALUES ($1, $2, $3, $4, $5, $6)', ['eq-1', 'active', JSON.stringify(values), '{"nota":false}', 7, '2026-10-01 12:00:00']);
  await db.exec(`INSERT INTO "EquipmentAttachment" VALUES ('pdf', 'eq-1', 'TECHNICAL_DOC_GENERATED', 'historico.pdf'), ('photo', 'eq-1', 'TECHNICAL_PHOTO', 'foto.jpg')`);
  const beforeEquipment = (await db.query('SELECT * FROM "CompanyEquipment"')).rows;
  const beforeAttachments = (await db.query('SELECT * FROM "EquipmentAttachment" ORDER BY "id"')).rows;
  const migration = await readFile(new URL('../prisma/migrations/20261019120000_equipment_technical_standards/migration.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  const standards = (await db.query('SELECT * FROM "EquipmentTechnicalStandard" ORDER BY "id"')).rows;
  assert.equal(standards.length, 3);
  for (const standard of standards) assert.deepEqual(standard.technicalSchema, schema);
  const categories = (await db.query('SELECT * FROM "EquipmentCategory" ORDER BY "id"')).rows;
  for (const category of categories) {
    assert.equal(category.technicalStandardId, category.id === 'empty' ? null : `ets_${category.id}`);
    if (category.id !== 'empty') {
      assert.deepEqual(category.technicalSchema, schema);
      assert.equal(category.technicalTemplateId, 'docx-original');
    }
  }
  assert.deepEqual((await db.query('SELECT * FROM "CompanyEquipment"')).rows, beforeEquipment);
  assert.deepEqual((await db.query('SELECT * FROM "EquipmentAttachment" ORDER BY "id"')).rows, beforeAttachments);
  await assert.rejects(db.exec(`DELETE FROM "EquipmentTechnicalStandard" WHERE "id" = 'ets_active'`), /foreign key/);
});

function databaseFixture() {
  const state = {
    standards: [{ id: 'shared', name: 'Elétrico', technicalSchema: structuredClone(originalSchema) }],
    categories: [
      { id: 'cat-a', name: 'Trafos', technicalStandardId: 'shared', technicalSchema: structuredClone(originalSchema) },
      { id: 'cat-b', name: 'Geradores', technicalStandardId: 'shared', technicalSchema: structuredClone(originalSchema), isActive: false },
      { id: 'cat-c', name: 'Outros', technicalStandardId: null, technicalSchema: [] }
    ],
    equipment: ['cat-a', 'cat-b', 'cat-c'].map((categoryId, i) => ({
      id: `eq-${i}`, categoryId, technicalData: { potencia: { value: '10', unit: 'kW' }, motores: [{ serie: '123' }], nota: 'Histórico' },
      technicalFieldOverrides: { nota: false }, technicalRevision: 3, technicalUpdatedAt: null
    }))
  };
  const patchMany = (items, predicate, data) => {
    const matching = items.filter(predicate);
    matching.forEach(item => Object.assign(item, structuredClone(data)));
    return { count: matching.length };
  };
  const tx = {
    $queryRaw: async () => [],
    equipmentTechnicalStandard: {
      findUnique: async ({ where }) => structuredClone(state.standards.find(item => item.id === where.id) || null),
      create: async ({ data }) => {
        const standard = { id: `new-${state.standards.length}`, ...structuredClone(data) };
        state.standards.push(standard);
        return structuredClone(standard);
      },
      update: async ({ where, data }) => {
        const standard = state.standards.find(item => item.id === where.id);
        Object.assign(standard, structuredClone(data));
        return structuredClone(standard);
      },
      delete: async ({ where }) => {
        assert.ok(!state.categories.some(category => category.technicalStandardId === where.id), 'Não deve excluir antes de desvincular as categorias');
        const index = state.standards.findIndex(standard => standard.id === where.id);
        return state.standards.splice(index, 1)[0];
      }
    },
    equipmentCategory: {
      findUnique: async ({ where }) => structuredClone(state.categories.find(item => item.id === where.id) || null),
      update: async ({ where, data }) => {
        const category = state.categories.find(item => item.id === where.id);
        Object.assign(category, structuredClone(data));
        return structuredClone(category);
      },
      create: async ({ data }) => {
        const category = { id: 'new-category', ...structuredClone(data) };
        state.categories.push(category);
        return structuredClone(category);
      },
      updateMany: async ({ where, data }) => patchMany(state.categories, category => category.technicalStandardId === where.technicalStandardId, data)
    },
    companyEquipment: {
      updateMany: async ({ where, data }) => patchMany(state.equipment, equipment => where.categoryId
        ? equipment.categoryId === where.categoryId
        : state.categories.find(category => category.id === equipment.categoryId)?.technicalStandardId === where.category.technicalStandardId, data)
    }
  };
  return { tx, state };
}

test('editar um padrão atualiza todas as categorias e documentos sem apagar valores, overrides ou revisões', async () => {
  const { tx, state } = databaseFixture();
  const before = structuredClone(state.equipment);
  const schema = normalizeTechnicalSchema([{ key: 'potencia', label: 'Potência nominal', type: 'measure', unit: { dimension: 'potencia', default: 'kW' } }]);
  await updateTechnicalStandard(tx, 'shared', { technicalSchema: schema });
  assert.deepEqual(state.categories[0].technicalSchema, schema);
  assert.deepEqual(state.categories[1].technicalSchema, schema);
  assert.deepEqual(state.categories[2].technicalSchema, []);
  for (let i = 0; i < state.equipment.length; i++) {
    assert.deepEqual(state.equipment[i].technicalData, before[i].technicalData);
    assert.deepEqual(state.equipment[i].technicalFieldOverrides, before[i].technicalFieldOverrides);
    assert.equal(state.equipment[i].technicalRevision, 3);
    assert.equal(Boolean(state.equipment[i].technicalUpdatedAt), i < 2);
  }
  const doc = buildTechnicalDocModel(state.equipment[0], state.categories[0]);
  assert.ok(doc.rows.some(row => row.label === 'Potência nominal' && row.value.includes('10')));
  assert.ok(!doc.rows.some(row => row.label === 'Nota'));
});

test('renomear um padrão ou salvar campos idênticos mantém os PDFs atuais', async () => {
  const { tx, state } = databaseFixture();
  await updateTechnicalStandard(tx, 'shared', { name: 'Novo nome', technicalSchema: originalSchema });
  assert.equal(state.standards[0].name, 'Novo nome');
  assert.ok(state.equipment.every(equipment => equipment.technicalUpdatedAt === null));
});

test('reutilizar e remover vínculo preserva os valores individuais e usa o schema do servidor', async () => {
  const { tx, state } = databaseFixture();
  const values = structuredClone(state.equipment[2].technicalData);
  const linked = await saveCategoryTechnicalStandard(tx, 'cat-c', { technicalStandardId: 'shared', technicalSchema: [] });
  assert.deepEqual(linked.technicalSchema, originalSchema);
  assert.equal(linked.technicalStandardId, 'shared');
  await saveCategoryTechnicalStandard(tx, 'cat-c', { technicalStandardId: null });
  assert.deepEqual(state.categories[2].technicalSchema, originalSchema);
  assert.deepEqual(state.equipment[2].technicalData, values);
});

test('remover padrão em uso preserva campos, documentos e valores em categorias ativas e inativas', async () => {
  const { tx, state } = databaseFixture();
  state.categories[0].technicalDocEnabled = true;
  const before = structuredClone(state);
  const documentBefore = buildTechnicalDocModel(state.equipment[0], state.categories[0]);
  await removeTechnicalStandard(tx, 'shared');
  assert.equal(state.standards.length, 0);
  for (const [index, category] of state.categories.entries()) {
    assert.deepEqual(category, { ...before.categories[index], technicalStandardId: null });
  }
  assert.deepEqual(state.equipment, before.equipment);
  assert.deepEqual(buildTechnicalDocModel(state.equipment[0], state.categories[0]), documentBefore);
  // Salvar depois a categoria desvinculada também não pode apagar os campos herdados.
  await saveCategoryTechnicalStandard(tx, 'cat-a', { name: 'Trafos editados', technicalStandardId: null });
  assert.deepEqual(state.categories[0].technicalSchema, originalSchema);
  assert.equal(state.categories[0].technicalDocEnabled, true);
  assert.deepEqual(state.equipment, before.equipment);
});

test('cadastros inline criam um padrão e importações posteriores mantêm os vínculos sincronizados', async () => {
  const { tx, state } = databaseFixture();
  const created = await saveCategoryTechnicalStandard(tx, null, { name: 'Novo tipo', technicalSchema: originalSchema });
  assert.ok(created.technicalStandardId);
  assert.equal(state.standards.at(-1).name, 'Novo tipo');
  await saveCategoryTechnicalStandard(tx, 'cat-a', { technicalSchema: [{ key: 'novo', label: 'Novo campo', type: 'text' }] });
  assert.equal(state.categories[1].technicalSchema[0].key, 'novo');
});

test('padrão inexistente retorna 404 antes de alterar a categoria', async () => {
  const { tx, state } = databaseFixture();
  const before = structuredClone(state.categories);
  await assert.rejects(saveCategoryTechnicalStandard(tx, 'cat-c', { technicalStandardId: 'missing' }), error => error.statusCode === 404);
  await assert.rejects(updateTechnicalStandard(tx, 'missing', { name: 'X' }), error => error.statusCode === 404);
  await assert.rejects(removeTechnicalStandard(tx, 'missing'), error => error.statusCode === 404);
  assert.deepEqual(state.categories, before);
});

function routeHandler(path, method) {
  const layer = equipamentosRouter.stack.find(item => item.route?.path === path && item.route.methods?.[method]);
  assert.ok(layer, `${method} ${path}`);
  return layer.route.stack.at(-1).handle;
}

function invoke(handler, req) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { resolve({ status: this.statusCode, value }); }, end() { resolve({ status: this.statusCode }); } };
    handler(req, res, reject);
  });
}

function mockPrisma(t, model, method, implementation) {
  const original = model[method];
  model[method] = t.mock.fn(implementation);
  t.after(() => { model[method] = original; });
  return model[method];
}

test('API remove padrão em uso sem apagar campos e retorna 404 para padrão inexistente', async t => {
  const { tx, state } = databaseFixture();
  mockPrisma(t, prisma, '$transaction', callback => callback(tx));
  const response = await invoke(routeHandler('/technical-standards/:id', 'delete'), { params: { id: 'shared' } });
  assert.equal(response.status, 204);
  assert.equal(state.standards.length, 0);
  assert.deepEqual(state.categories[0].technicalSchema, originalSchema);
  assert.deepEqual(state.categories[1].technicalSchema, originalSchema);
  await assert.rejects(invoke(routeHandler('/technical-standards/:id', 'delete'), { params: { id: 'missing' } }), error => error.statusCode === 404);
  await assert.rejects(invoke(routeHandler('/technical-standards', 'post'), { body: { name: '  ', technicalSchema: [] } }), error => error.name === 'ZodError');
});

test('API cria e remove um padrão sem vínculos', async t => {
  const { tx, state } = databaseFixture();
  mockPrisma(t, prisma, '$transaction', callback => callback(tx));
  const create = mockPrisma(t, prisma.equipmentTechnicalStandard, 'create', tx.equipmentTechnicalStandard.create);
  const response = await invoke(routeHandler('/technical-standards', 'post'), { body: { name: ' Padrão ', technicalSchema: originalSchema } });
  assert.equal(response.status, 201);
  assert.equal(response.value.name, 'Padrão');
  assert.deepEqual(create.mock.calls[0].arguments[0].data.technicalSchema, originalSchema);
  assert.equal((await invoke(routeHandler('/technical-standards/:id', 'delete'), { params: { id: response.value.id } })).status, 204);
  assert.ok(!state.standards.some(standard => standard.id === response.value.id));
});

test('API de categorias reutiliza o padrão escolhido e não depende do schema enviado pelo cliente', async t => {
  const { tx } = databaseFixture();
  mockPrisma(t, prisma, '$transaction', callback => callback(tx));
  mockPrisma(t, prisma.equipmentCategory, 'findUnique', tx.equipmentCategory.findUnique);
  const response = await invoke(routeHandler('/categories', 'post'), {
    body: { name: 'Categoria reutilizada', technicalStandardId: 'shared', technicalSchema: [], technicalDocEnabled: true }
  });
  assert.equal(response.status, 201);
  assert.equal(response.value.technicalStandardId, 'shared');
  assert.deepEqual(response.value.technicalSchema, originalSchema);
});
