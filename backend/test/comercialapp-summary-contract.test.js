import assert from 'node:assert/strict';
import test from 'node:test';

import { canUpgradeLegacyProposal, commercialAppPayloadSchema } from '../src/lib/acompanhamento/comercialapp-bridge.js';

const base = {
  contractVersion: 1, eventId: '11111111-1111-4111-8111-111111111111', source: 'COMERCIAL_APP',
  proposalId: 'proposal-1', proposalCode: '8700', revisionNumber: 0, projectId: 'project-1',
  nectarOpportunityId: null, approvedAt: '2026-09-30T00:00:00Z',
  client: { name: 'Cliente', cnpj: '', contact: '', email: '' },
  title: 'Proposta', site: 'Obra', scope: [], salePrice: 1500,
  plannedTotalCost: 900, expectedMargin: 40, costBreakdown: {}, proposalSnapshot: {}
};

const summary = {
  schemaVersion: 1,
  hours: { normal: 100, overtime: 20, total: 120 },
  workload: { personDays: 10, peakHeadcount: 2, phases: [] },
  costs: { labor: 500, indirect: 20, materials: 100, inputs: 50, filters: 10,
    effluent: 0, mobilization: 80, demobilization: 40, referralBonus: 0,
    direct: 900, overhead: 0, total: 900, taxesAtEstimatePrice: 100,
    commissionAtEstimatePrice: 0, representativeCommissionAtEstimatePrice: 0,
    commercialExpenseAtEstimatePrice: 0 }
};

test('receptor aceita o resumo novo e entregas anteriores sem resumo', () => {
  assert.equal(commercialAppPayloadSchema.safeParse(base).success, true);
  assert.equal(commercialAppPayloadSchema.safeParse({ ...base, estimateSummary: summary }).success, true);
  assert.equal(commercialAppPayloadSchema.safeParse({ ...base, estimateSummary: {
    ...summary, hours: { normal: 100, overtime: 20, total: 100 }
  } }).success, false);
  assert.equal(commercialAppPayloadSchema.safeParse({ ...base, estimateSummary: {
    ...summary, costs: { ...summary.costs, total: 901 }
  } }).success, false);
});

test('reenvio só atualiza o resumo e o escopo antigo da mesma proposta', () => {
  const existing = { snapshot: base };
  const enriched = { ...base, estimateSummary: summary };
  assert.equal(canUpgradeLegacyProposal(existing, enriched, { sameEvent: true }), true);
  assert.equal(canUpgradeLegacyProposal(existing, { ...enriched, salePrice: 1501 }), false);
  assert.equal(canUpgradeLegacyProposal(existing, { ...enriched, eventId: '22222222-2222-4222-8222-222222222222' }, { sameEvent: true }), false);
  assert.equal(canUpgradeLegacyProposal({ snapshot: enriched }, enriched), false);
  const oldScope = { ...base, proposalSnapshot: { scopeItems: [{ id: 'servico-1', title: 'Limpeza' }] } };
  assert.equal(canUpgradeLegacyProposal({ snapshot: oldScope }, {
    ...oldScope, scope: oldScope.proposalSnapshot.scopeItems
  }), true);
  assert.equal(canUpgradeLegacyProposal({ snapshot: oldScope }, {
    ...oldScope, scope: [{ id: 'servico-2', title: 'Serviço diferente' }]
  }), false);
});
