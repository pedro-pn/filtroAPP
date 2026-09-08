import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertScheduleWindowDates,
  syncProjectDemobilizationToMissions,
  applyManualCostsToDashboardRows,
  applyStockCostsToDashboardRows,
  buildCommercialPendencias,
  buildBudgetBreakdown,
  contractToProposalCode,
  deriveSale,
  mapProposalRow,
  parentProposalCodeFromRow,
  refreshSelectedProjectBudgetsFromProposals,
  setProjectBudgetRevisionWithClient,
  shouldRecordManualProgressHistory,
  toCnpj,
  toDate,
  toInt,
  toNumber,
  toStr
} from '../src/lib/acompanhamento/access-import.js';

test('setProjectBudgetRevisionWithClient reutiliza a seleção manual com um client transacional injetado', async () => {
  const calls = [];
  const proposal = {
    codBd: 9902,
    codProp: 3088,
    parentCodProp: null,
    serviceModality: 'INLOCO',
    salePrice: 1000,
    plannedCost: 600,
    expectedProfit: 400,
    expectedMargin: 40,
    taxes: 100,
    plannedDays: 5,
    mobilizationLeadDays: 2,
    isComplete: true
  };
  const transactionClient = {
    commercialProposal: {
      async findUnique() { return proposal; }
    },
    project: {
      async findUnique() {
        return { id: 'project-1', contractCode: '3088 Rev. 2', code: '005719' };
      },
      async update(args) {
        calls.push(['projectUpdate', args]);
      }
    },
    projectBudget: {
      async upsert(args) {
        calls.push(['budgetUpsert', args]);
        return { sourceProposalCodBd: proposal.codBd };
      }
    }
  };

  const budget = await setProjectBudgetRevisionWithClient(transactionClient, 'project-1', 9902);

  assert.equal(budget.sourceProposalCodBd, 9902);
  assert.equal(calls.find(([name]) => name === 'budgetUpsert')[1].create.sourceProposalCodBd, 9902);
  assert.equal(calls.find(([name]) => name === 'projectUpdate')[1].data.commercialProposalCode, '3088');
});

test('contractToProposalCode extrai a primeira parte numérica da proposta persistida', () => {
  assert.equal(contractToProposalCode('4096 - Rev. 1'), 4096);
  assert.equal(contractToProposalCode('4096'), 4096);
  assert.equal(contractToProposalCode(' 4096 '), 4096);
  assert.equal(contractToProposalCode('4096 rev2'), 4096);
  assert.equal(contractToProposalCode(''), null);
  assert.equal(contractToProposalCode(null), null);
  assert.equal(contractToProposalCode('sem numero'), null);
});

test('toNumber lida com number, bigint, texto sujo e nulo', () => {
  assert.equal(toNumber(185000), 185000);
  assert.equal(toNumber(7500n), 7500);
  assert.equal(toNumber('185000'), 185000);
  assert.equal(toNumber('R$ 1.234,56'), 1234.56);
  assert.equal(toNumber('1.000'), 1000);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), null);
  assert.equal(toNumber('abc'), null);
});

test('toInt trunca e tolera texto', () => {
  assert.equal(toInt('25'), 25);
  assert.equal(toInt('13,9'), 13);
  assert.equal(toInt(null), null);
});

test('toStr normaliza vazio para null', () => {
  assert.equal(toStr('  Ruan  '), 'Ruan');
  assert.equal(toStr(''), null);
  assert.equal(toStr('   '), null);
  assert.equal(toStr(null), null);
});

test('toCnpj mantém apenas dígitos', () => {
  assert.equal(toCnpj('17.164.435/0040-80'), '17164435004080');
  assert.equal(toCnpj(17164435004080n), '17164435004080');
  assert.equal(toCnpj(null), null);
});

test('toDate aceita Date e ISO, rejeita inválido', () => {
  assert.ok(toDate('2026-01-07T00:00:00.000Z') instanceof Date);
  assert.ok(toDate(new Date()) instanceof Date);
  assert.equal(toDate(null), null);
  assert.equal(toDate('xx'), null);
});

test('deriveSale prioriza valor_inloco e cai para pop_sede', () => {
  assert.deepEqual(deriveSale({ valor_inloco: '185000', margem_inloco: 39 }), {
    serviceModality: 'INLOCO',
    salePrice: 185000,
    expectedMargin: 39
  });
  assert.deepEqual(deriveSale({ valor_inloco: '0', valor_pop_sede: '7500', margem_pop_sede: 12 }), {
    serviceModality: 'POP_SEDE',
    salePrice: 7500,
    expectedMargin: 12
  });
  assert.deepEqual(deriveSale({ valor_inloco: 0, valor_pop_sede: 0 }), {
    serviceModality: null,
    salePrice: null,
    expectedMargin: null
  });
});

test('parentProposalCodeFromRow reconhece coluna de proposta mãe com nomes tolerantes', () => {
  assert.equal(parentProposalCodeFromRow({ cod_proposta_mae: '4069' }), 4069);
  assert.equal(parentProposalCodeFromRow({ cod_prop_mae: 4070n }), 4070);
  assert.equal(parentProposalCodeFromRow({ 'Cód. Proposta Mãe': '4071' }), 4071);
  assert.equal(parentProposalCodeFromRow({ cod_proposta_mae: 0 }), null);
  assert.equal(parentProposalCodeFromRow({ cod_prop: 4069 }), null);
});

test('mapProposalRow monta o staging e serializa bigint no rawRow', () => {
  const row = {
    cod_bd: 14,
    cod_prop: 4069n,
    cod_proposta_mae: 4000,
    n_rev: 0,
    cod_nectar: 27939674,
    data_proposta: '2026-01-07T00:00:00.000Z',
    nome_cliente: 'EMPRESA CONSTRUTORA BRASIL SA',
    n_cnpj: 17164435004080n,
    valor_inloco: '185000',
    valor_custos: '0',
    n_operadores: '0',
    n_dias: '25'
  };
  const mapped = mapProposalRow(row);
  assert.equal(mapped.codBd, 14);
  assert.equal(mapped.codProp, 4069);
  assert.equal(mapped.parentCodProp, 4000);
  assert.equal(mapped.clientCnpj, '17164435004080');
  assert.equal(mapped.serviceModality, 'INLOCO');
  assert.equal(mapped.salePrice, 185000);
  assert.equal(mapped.isComplete, true);
  assert.equal(mapped.plannedDays, 25);
  // rawRow deve ser JSON-serializável (bigint vira string)
  assert.equal(mapped.rawRow.cod_prop, '4069');
  assert.doesNotThrow(() => JSON.stringify(mapped.rawRow));
});

test('buildBudgetBreakdown soma valores da proposta original com adicionais e mantém discriminação', () => {
  const breakdown = buildBudgetBreakdown({
    originalSource: {
      codBd: 101,
      codProp: 4069,
      parentCodProp: null,
      nRev: 1,
      salePrice: 100000,
      plannedCost: 60000,
      expectedProfit: 40000,
      expectedMargin: 40,
      taxes: 5000
    },
    additionalSources: [
      {
        codBd: 201,
        codProp: 9001,
        parentCodProp: 4069,
        nRev: 0,
        salePrice: 25000,
        plannedCost: 10000,
        expectedProfit: 15000,
        expectedMargin: 60,
        taxes: 1000
      }
    ]
  });

  assert.equal(breakdown.salePrice, 125000);
  assert.equal(breakdown.originalSalePrice, 100000);
  assert.equal(breakdown.additionalSalePrice, 25000);
  assert.equal(breakdown.plannedTotalCost, 70000);
  assert.equal(breakdown.originalPlannedTotalCost, 60000);
  assert.equal(breakdown.additionalPlannedTotalCost, 10000);
  assert.equal(breakdown.expectedProfit, 55000);
  assert.equal(breakdown.expectedMargin, 44);
  assert.equal(breakdown.taxes, 6000);
  assert.equal(breakdown.additionals.length, 1);
  assert.equal(breakdown.additionalTotals.salePrice, 25000);
});

test('buildCommercialPendencias considera proposta principal e adicionais pendentes', () => {
  const pendencias = buildCommercialPendencias({
    projects: [
      { id: 'project-1', code: '5782', contractCode: '4136 - Rev. 0', commercialProposalCode: null },
      { id: 'project-2', code: '5783', contractCode: '5000', commercialProposalCode: '5000' },
      { id: 'project-3', code: '5784', contractCode: '7000', commercialProposalCode: null }
    ],
    proposalRevisionCounts: [
      { codProp: 4136, _count: { _all: 2 } },
      { codProp: 5000, _count: { _all: 1 } }
    ],
    additionalRevisionCounts: [
      { parentCodProp: 4136, codProp: 94136, _count: { _all: 2 } },
      { parentCodProp: 4136, codProp: 94137, _count: { _all: 1 } },
      { parentCodProp: 5000, codProp: 95000, _count: { _all: 1 } },
      { parentCodProp: 7000, codProp: 97000, _count: { _all: 1 } }
    ],
    selectedAdditionalProposals: [
      { projectId: 'project-2', codProp: 95000 }
    ]
  });

  assert.deepEqual(pendencias, [
    {
      projectId: 'project-1',
      proposalCode: '4136',
      revisionCount: 5,
      originalRevisionCount: 2,
      additionalProposalCount: 2,
      additionalRevisionCount: 3,
      pendingCount: 3,
      pendingAdditionalProposalCount: 2,
      originalPending: true,
      resolved: false
    },
    {
      projectId: 'project-2',
      proposalCode: '5000',
      revisionCount: 2,
      originalRevisionCount: 1,
      additionalProposalCount: 1,
      additionalRevisionCount: 1,
      pendingCount: 0,
      pendingAdditionalProposalCount: 0,
      originalPending: false,
      resolved: true
    },
    {
      projectId: 'project-3',
      proposalCode: '7000',
      revisionCount: 1,
      originalRevisionCount: 0,
      additionalProposalCount: 1,
      additionalRevisionCount: 1,
      pendingCount: 1,
      pendingAdditionalProposalCount: 1,
      originalPending: false,
      resolved: false
    }
  ]);
});

test('mapProposalRow marca isComplete=false quando sem valor de venda', () => {
  const mapped = mapProposalRow({ cod_bd: 1, cod_prop: 1, n_rev: 0 });
  assert.equal(mapped.isComplete, false);
  assert.equal(mapped.salePrice, null);
  assert.equal(mapped.serviceModality, null);
});

test('applyStockCostsToDashboardRows soma estoque ao realizado total preservando Omie separado', () => {
  const rows = [
    { projectId: 'project-1', realizedOmieCost: '100.50', realizedCost: '100.50', stockCost: 0 },
    { projectId: 'project-2', realizedOmieCost: null, realizedCost: null, stockCost: 0 }
  ];

  applyStockCostsToDashboardRows(rows, new Map([
    ['project-1', { total: 25.25 }],
    ['project-2', { total: 12 }]
  ]));

  assert.deepEqual(rows, [
    { projectId: 'project-1', realizedOmieCost: '100.50', realizedCost: 125.75, stockCost: 25.25 },
    { projectId: 'project-2', realizedOmieCost: null, realizedCost: 12, stockCost: 12 }
  ]);
});

test('applyManualCostsToDashboardRows soma custo manual ao realizado total', () => {
  const rows = [
    { projectId: 'project-1', realizedOmieCost: '100.50', realizedCost: 125.75, stockCost: 25.25, manualCost: 0 },
    { projectId: 'project-2', realizedOmieCost: null, realizedCost: null, stockCost: 0, manualCost: 0 }
  ];

  applyManualCostsToDashboardRows(rows, new Map([
    ['project-1', { total: 40 }],
    ['project-2', { total: 12.5 }]
  ]));

  assert.deepEqual(rows, [
    { projectId: 'project-1', realizedOmieCost: '100.50', realizedCost: 165.75, stockCost: 25.25, manualCost: 40 },
    { projectId: 'project-2', realizedOmieCost: null, realizedCost: 12.5, stockCost: 0, manualCost: 12.5 }
  ]);
});

test('refreshSelectedProjectBudgetsFromProposals atualiza orçamento vigente com dados da proposta sincronizada', async () => {
  const updates = [];
  const client = {
    projectBudget: {
      findMany: async (args) => {
        assert.deepEqual(args.where, { sourceProposalCodBd: { in: [101] } });
        return [
          { projectId: 'project-1', version: 1, sourceProposalCodBd: 101 }
        ];
      },
      update: async (args) => {
        updates.push(args);
        return args.data;
      }
    },
    commercialProposal: {
      findMany: async (args) => {
        assert.deepEqual(args.where, { codBd: { in: [101] } });
        return [
          {
            codBd: 101,
            serviceModality: 'INLOCO',
            salePrice: 120000,
            plannedCost: 34567.89,
            expectedProfit: 85432.11,
            expectedMargin: 71.19,
            taxes: 1200,
            plannedDays: 12,
            mobilizationLeadDays: 3,
            isComplete: true
          }
        ];
      }
    }
  };

  const refreshed = await refreshSelectedProjectBudgetsFromProposals(client, { codBds: [101, 101] });

  assert.equal(refreshed, 1);
  assert.deepEqual(updates, [
    {
      where: { projectId_version: { projectId: 'project-1', version: 1 } },
      data: {
        sourceProposalCodBd: 101,
        serviceModality: 'INLOCO',
        salePrice: 120000,
        plannedTotalCost: 34567.89,
        expectedProfit: 85432.11,
        expectedMargin: 71.19,
        taxes: 1200,
        plannedDays: 12,
        mobilizationLeadDays: 3,
        isComplete: true
      }
    }
  ]);
});

test('shouldRecordManualProgressHistory grava só quando o avanço manual numérico muda', () => {
  assert.equal(shouldRecordManualProgressHistory(null, 25), true);
  assert.equal(shouldRecordManualProgressHistory(10, 25), true);
  assert.equal(shouldRecordManualProgressHistory('25.0', 25), false);
  assert.equal(shouldRecordManualProgressHistory(25, null), false);
  assert.equal(shouldRecordManualProgressHistory(undefined, undefined), false);
});

// === Datas da janela do cronograma (mobilização ↔ desmobilização) ===

const MOB = new Date('2026-07-14T00:00:00.000Z');

test('desmobilização exige mobilização, porque sem as duas datas não existe janela', () => {
  assert.throws(
    () => assertScheduleWindowDates({ demobilizationDate: '2026-08-31T00:00:00.000Z' }),
    /Informe a data de mobilização antes da desmobilização/
  );
  // Limpar a mobilização na mesma requisição também deixa a janela sem início.
  assert.throws(
    () => assertScheduleWindowDates({
      mobilizationDate: null,
      demobilizationDate: '2026-08-31T00:00:00.000Z',
      currentMobilizationDate: MOB
    }),
    /Informe a data de mobilização antes da desmobilização/
  );
});

test('desmobilização anterior à mobilização é recusada, senão o intervalo se inverteria', () => {
  assert.throws(
    () => assertScheduleWindowDates({
      demobilizationDate: '2026-07-13T00:00:00.000Z',
      currentMobilizationDate: MOB
    }),
    /não pode ser anterior à mobilização/
  );
});

test('mobilização do corpo tem precedência sobre a vigente no banco', () => {
  // Campo ausente (undefined) significa "não mexeu": vale a do banco.
  assert.doesNotThrow(() => assertScheduleWindowDates({
    demobilizationDate: '2026-08-31T00:00:00.000Z',
    currentMobilizationDate: MOB
  }));
  // Enviar uma mobilização nova mais recente valida contra ela, não contra a antiga.
  assert.throws(
    () => assertScheduleWindowDates({
      mobilizationDate: '2026-09-01T00:00:00.000Z',
      demobilizationDate: '2026-08-31T00:00:00.000Z',
      currentMobilizationDate: MOB
    }),
    /não pode ser anterior à mobilização/
  );
});

test('janela de um dia só é válida e ausência de desmobilização nunca bloqueia', () => {
  assert.doesNotThrow(() => assertScheduleWindowDates({
    mobilizationDate: '2026-07-14T00:00:00.000Z',
    demobilizationDate: '2026-07-14T00:00:00.000Z'
  }));
  // Obra em andamento: sem desmobilização a regra segue conservadora e nada é validado.
  assert.doesNotThrow(() => assertScheduleWindowDates({ mobilizationDate: null, demobilizationDate: null }));
  assert.doesNotThrow(() => assertScheduleWindowDates({}));
});

test('cronograma replica a desmobilização para as programações da missão', async () => {
  const calls = [];
  const tx = {
    efetivoMissionPlan: {
      findMany: async () => [{ planId: 'official' }, { planId: 'scenario' }, { planId: 'official' }],
      updateMany: async input => { calls.push(['missions', input]); }
    },
    efetivoPlan: { updateMany: async input => { calls.push(['plans', input]); } }
  };
  await syncProjectDemobilizationToMissions(tx, 'project-1', '2026-08-31T00:00:00.000Z');
  assert.equal(calls[0][1].data.returnDate.toISOString(), '2026-08-31T00:00:00.000Z');
  assert.deepEqual(calls[1][1].where.id.in, ['official', 'scenario']);
});
