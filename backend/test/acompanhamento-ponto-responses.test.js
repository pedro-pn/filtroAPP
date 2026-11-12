import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizePontoRate } from '../src/lib/acompanhamento/ponto-responses.js';

test('point listing keeps identities, money, idle buckets and monthly filters without audit payload', () => {
  const idle = { sede: { cost: 12.34, costBase: 10.2, hours: 3 }, folga: { cost: 0, costBase: 0, hours: 0 } };
  const month = { month: '2026-09', normalHoras: 176, he70Horas: 3, he100Horas: 1,
    totalMensal: 4321.09, totalMensalBase: 4200, fixoMensal: 3000, variavelMensal: 1321.09, custoHora: 24.55, custoHoraBase: 23.86, idle };
  const rate = { collaboratorId: 'c1', name: 'Ana', role: 'Operador', hasCostProfile: true,
    normalHoras: 176, he70Horas: 3, he100Horas: 1, totalHoras: 180, folgaHours: 0,
    totalMensal: 4321.09, totalMensalBase: 4200, fixoMensal: 3000, variavelMensal: 1321.09, custoHora: 24.55, custoHoraBase: 23.86, idle, months: [month] };
  const detailed = { ...rate, allocationTrail: [{ projectId: 'p1' }], byProject: { p1: {} },
    analyticalAllocationTrail: [{ projectId: 'p1' }], months: [{ ...month, days: ['2026-09-01'], analyticalByProject: { p1: {} } }] };
  const before = structuredClone(detailed);
  assert.deepEqual(summarizePontoRate(detailed), rate);
  assert.deepEqual(detailed, before);
  const unconfigured = summarizePontoRate({ collaboratorId: 'c2', hasCostProfile: false, totalMensal: null, custoHora: null, months: [], allocationTrail: [] });
  assert.deepEqual(unconfigured, { collaboratorId: 'c2', hasCostProfile: false, totalMensal: null, custoHora: null, months: [] });
});
