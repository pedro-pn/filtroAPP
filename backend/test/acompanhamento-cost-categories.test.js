import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildOmieCostCategoryWhere,
  getAdminOnlyCategoryCodes,
  getManualCostExcludedCategoryCodes,
  omitCategoryCodesWhere
} from '../src/lib/acompanhamento/cost-categories.js';
import prisma from '../src/lib/prisma.js';

test('omitCategoryCodesWhere mantém sem categoria e exclui códigos informados', () => {
  assert.deepEqual(omitCategoryCodesWhere(['2.01', '2.02']), {
    OR: [{ categoriaCodigo: null }, { categoriaCodigo: { notIn: ['2.01', '2.02'] } }]
  });
  assert.deepEqual(omitCategoryCodesWhere([]), {});
});

test('buildOmieCostCategoryWhere combina exclusões manuais com categorias de salário', async () => {
  const originalCategoryFindMany = prisma.omieCategory.findMany;
  const originalPurchaseGroupBy = prisma.omiePurchase.groupBy;
  prisma.omieCategory.findMany = async (args) => {
    assert.deepEqual(args.where, { includeInAcompanhamentoCosts: false });
    return [{ codigo: '2.04.92' }];
  };
  prisma.omiePurchase.groupBy = async () => [
    { categoriaCodigo: '2.01.01', categoriaDescricao: 'Salários e ordenados' },
    { categoriaCodigo: '2.02.01', categoriaDescricao: 'Hospedagem' }
  ];

  try {
    assert.deepEqual(await getManualCostExcludedCategoryCodes(), ['2.04.92']);
    assert.deepEqual(await buildOmieCostCategoryWhere({ categoryCode: '2.02.01' }), {
      AND: [
        { categoriaCodigo: '2.02.01' },
        { OR: [{ categoriaCodigo: null }, { categoriaCodigo: { notIn: ['2.01.01', '2.04.92'] } }] }
      ]
    });
  } finally {
    prisma.omieCategory.findMany = originalCategoryFindMany;
    prisma.omiePurchase.groupBy = originalPurchaseGroupBy;
  }
});

test('categorias exclusivas de admin são omitidas somente para as demais contas', async () => {
  const originalCategoryFindMany = prisma.omieCategory.findMany;
  const originalPurchaseGroupBy = prisma.omiePurchase.groupBy;
  prisma.omieCategory.findMany = async (args) => {
    if (args.where?.adminOnly === true) return [{ codigo: '9.99.99' }];
    if (args.where?.includeInAcompanhamentoCosts === false) return [{ codigo: '2.04.92' }];
    return [];
  };
  prisma.omiePurchase.groupBy = async () => [
    { categoriaCodigo: '2.01.01', categoriaDescricao: 'Salários e ordenados' }
  ];

  try {
    assert.deepEqual(await getAdminOnlyCategoryCodes(), ['9.99.99']);
    assert.deepEqual(await buildOmieCostCategoryWhere({ includeAdminOnly: true }), {
      AND: [{ OR: [{ categoriaCodigo: null }, { categoriaCodigo: { notIn: ['2.01.01', '2.04.92'] } }] }]
    });
    assert.deepEqual(await buildOmieCostCategoryWhere({ includeAdminOnly: false }), {
      AND: [{ OR: [{ categoriaCodigo: null }, { categoriaCodigo: { notIn: ['2.01.01', '2.04.92', '9.99.99'] } }] }]
    });
  } finally {
    prisma.omieCategory.findMany = originalCategoryFindMany;
    prisma.omiePurchase.groupBy = originalPurchaseGroupBy;
  }
});

test('químicos do Omie são excluídos somente nos projetos com saída de químicos em romaneio', async t => {
  const originalCategoryFindMany = prisma.omieCategory.findMany;
  const originalPurchaseGroupBy = prisma.omiePurchase.groupBy;
  t.after(() => {
    prisma.omieCategory.findMany = originalCategoryFindMany;
    prisma.omiePurchase.groupBy = originalPurchaseGroupBy;
  });
  prisma.omieCategory.findMany = async ({ where }) => {
    if (where.includeInAcompanhamentoCosts === false) return [{ codigo: 'manual' }];
    if (where.adminOnly === true) return [{ codigo: 'admin' }];
    return [
      { codigo: 'chemical-catalog', descricao: 'PRODUTOS QUÍMICOS' },
      { codigo: 'other', descricao: 'Insumos petroquímicos' }
    ];
  };
  prisma.omiePurchase.groupBy = async () => [
    { categoriaCodigo: 'chemical-legacy', categoriaDescricao: 'Compra de produtos quimicos' },
    { categoriaCodigo: null, categoriaDescricao: 'Químicos' },
    { categoriaCodigo: 'cleaning', categoriaDescricao: 'Serviços de limpeza química' },
    { categoriaCodigo: 'other', categoriaDescricao: 'Insumos petroquímicos' }
  ];

  const where = await buildOmieCostCategoryWhere({
    excludeChemicalProducts: true,
    includeAdminOnly: false
  });
  const baseOmittedCodes = where.AND[0].OR[1].categoriaCodigo.notIn;
  assert.ok(baseOmittedCodes.includes('manual'));
  assert.ok(baseOmittedCodes.includes('admin'));
  assert.ok(!baseOmittedCodes.includes('chemical-catalog'));
  assert.ok(!baseOmittedCodes.includes('chemical-legacy'));
  const [fallback, chemicalFilter] = where.AND[1].OR;
  assert.deepEqual(fallback, { project: { stockMovements: { none: {
    type: 'SAIDA', reason: 'USO_EM_PROJETO', quantity: { gt: 0 },
    item: { type: 'PRODUTO_QUIMICO' }, romaneio: { type: 'OUTBOUND' }, reversedBy: null
  } } } });
  const omittedCodes = chemicalFilter.AND[0].OR[1].categoriaCodigo.notIn;
  assert.deepEqual(omittedCodes, ['chemical-catalog', 'chemical-legacy']);
  assert.ok(!omittedCodes.includes('cleaning'));
  assert.ok(!omittedCodes.includes('other'));
  assert.deepEqual(chemicalFilter.AND[0].OR[0], { categoriaCodigo: null });
  assert.deepEqual(chemicalFilter.AND[1], {
    OR: [
      { categoriaDescricao: null },
      { categoriaDescricao: { notIn: ['Compra de produtos quimicos', 'Químicos'] } }
    ]
  });

  // A sede mantém a apuração financeira do Omie, sem trocar compras por consumo.
  const sedeWhere = await buildOmieCostCategoryWhere();
  assert.ok(!sedeWhere.AND[0].OR[1].categoriaCodigo.notIn.includes('chemical-catalog'));
  assert.equal(sedeWhere.AND.length, 1);

  const selectedCategory = await buildOmieCostCategoryWhere({
    categoryCode: 'chemical-catalog', excludeChemicalProducts: true
  });
  assert.deepEqual(selectedCategory.AND[0], { categoriaCodigo: 'chemical-catalog' });
  assert.ok(selectedCategory.AND[2].OR[1].AND[0].OR[1].categoriaCodigo.notIn.includes('chemical-catalog'));
});
