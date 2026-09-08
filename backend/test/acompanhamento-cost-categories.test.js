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
