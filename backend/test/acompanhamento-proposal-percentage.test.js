import assert from 'node:assert/strict';
import test from 'node:test';
import { applyProposalPercentage, consideredPlannedServices, scaleProposalValue, validateProposalPercentage } from '../src/lib/acompanhamento/proposal-percentage.js';
import { resolvePlannedHours } from '../src/lib/acompanhamento/planned-hours.js';

test('percentual preserva o integral, admite zero e arredonda sem perder centavos', () => {
  assert.deepEqual(applyProposalPercentage(100000), { fullPlannedTotalCost: 100000, plannedTotalCost: 100000, proposalPercentage: 100 });
  assert.equal(scaleProposalValue(100000, 70), 70000);
  assert.equal(scaleProposalValue(100.05, 50), 50.03);
  assert.equal(scaleProposalValue(0.29, 50), 0.15);
  assert.equal(scaleProposalValue(24, 33.33), 8);
  assert.equal(scaleProposalValue(100000, 0), 0);
  assert.equal(scaleProposalValue(null, 50), null);
  assert.equal(validateProposalPercentage(12.34), 12.34);
  for (const value of [-1, 101, NaN, Infinity, null, '50', 12.345]) assert.throws(() => validateProposalPercentage(value));
});

test('quantitativos previstos são ajustados sem reescrever pesos, dimensões ou valores integrais', () => {
  const services = [{ weight: 100, systems: [{ quantity: '200.25', diameter: '2', unit: 'M' }, { quantity: null, unit: 'L' }] }];
  const out = consideredPlannedServices(services, 50);
  assert.equal(out[0].systems[0].quantity, 100.13);
  assert.equal(out[0].systems[0].diameter, '2');
  assert.equal(out[0].weight, 100);
  assert.equal(out[0].systems[1].quantity, null);
  assert.equal(services[0].systems[0].quantity, '200.25');
  assert.equal(consideredPlannedServices(services, 0)[0].systems[0].quantity, 0);
});

test('horas comerciais e fallback manual usam o mesmo percentual, preservando a base de edição e conferência', () => {
  const source = { source: 'COMERCIAL_APP', externalId: 'p1', estimateSummary: { hours: { normal: 100, overtime: 20, total: 120 } } };
  const input = { sources: [source], normalHours: [{ hours: 100 }], overtime: [{ hours: 20 }] };
  const integral = resolvePlannedHours(input);
  const adjusted = resolvePlannedHours({ ...input, proposalPercentage: 50 });
  assert.equal(adjusted.normalHours[0].hours, 50);
  assert.equal(adjusted.overtime[0].hours, 10);
  assert.equal(adjusted.fullNormalHours[0].hours, 100);
  assert.deepEqual(adjusted.hoursPlan.commercial, { normal: 100, overtime: 20, total: 120 });
  assert.equal(adjusted.hoursPlan.fingerprint, integral.hoursPlan.fingerprint);
  assert.equal(adjusted.hoursPlan.pending, false);
  const manual = resolvePlannedHours({ normalHours: [{ hours: 80 }], overtime: [{ hours: 10 }], proposalPercentage: 25 });
  assert.equal(manual.normalHours[0].hours, 20);
  assert.equal(manual.overtime[0].hours, 2.5);
  assert.equal(manual.fullNormalHours[0].hours, 80);
});
