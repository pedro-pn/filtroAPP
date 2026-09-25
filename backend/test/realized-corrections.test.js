import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { applyDailyTubeCorrections, dailyTubeSourceTotals, latestRealizedCorrections } from '../src/lib/acompanhamento/realized-corrections.js';

const eligible = service => service.finalized === true && (service.reportType === 'RDO' || !service.specialConditions?.parentRdoId);
const source = (date, serviceType, meters, extra = {}) => ({
  reportDate: date, reportType: 'RDO', finalized: true, serviceType,
  extraData: { tubes: [{ c: String(meters), lengthUnit: 'm' }], ...extra.extraData }, ...extra
});
const revision = (date, serviceType, quantityM, number = 1) => ({ measureDate: new Date(`${date}T00:00:00.000Z`), serviceType, quantityM, revision: number });

test('corrige apenas tubos do dia e conserva óleo, relatórios derivados e dias não corrigidos', () => {
  const services = [
    source('2026-09-03', 'pressao', 280, { extraData: { volumeOleo: '500', tubes: [{ c: '280', lengthUnit: 'm' }] } }),
    source('2026-09-03', 'pressao', 280),
    source('2026-09-04', 'pressao', 70),
    source('2026-09-03', 'pressao', 280, { reportType: 'RTP', specialConditions: { parentRdoId: 'rdo-1' } })
  ];
  const corrected = applyDailyTubeCorrections(services, [revision('2026-09-03', 'TESTE_PRESSAO', 280)], eligible);
  const totals = dailyTubeSourceTotals(corrected, eligible);
  assert.equal(totals.get('2026-09-03:TESTE_PRESSAO'), 280);
  assert.equal(totals.get('2026-09-04:TESTE_PRESSAO'), 70);
  assert.equal(corrected[0].extraData.volumeOleo, '500');
  assert.equal(corrected[3].extraData.tubes[0].c, '280');
});

test('zero exclui tubos finalizados; revisão nula restaura a fonte e preserva serviços em aberto', () => {
  const services = [source('2026-09-05', 'flushing', 70, { finalized: false }), source('2026-09-05', 'flushing', 120)];
  const zero = revision('2026-09-05', 'FLUSHING', 0);
  assert.equal(dailyTubeSourceTotals(applyDailyTubeCorrections(services, [zero], eligible), eligible).get('2026-09-05:FLUSHING'), 0);
  const undone = revision('2026-09-05', 'FLUSHING', null, 2);
  assert.equal(latestRealizedCorrections([zero, undone]).get('2026-09-05:FLUSHING').revision, 2);
  assert.equal(dailyTubeSourceTotals(applyDailyTubeCorrections(services, [zero, undone], eligible), eligible).get('2026-09-05:FLUSHING'), 120);
});

test('lote conferido da missão 5800 fecha com os três totais do site', () => {
  const fixture = JSON.parse(readFileSync(new URL('../scripts/data/mission-5800-site-reframax-2026-09-24.json', import.meta.url), 'utf8'));
  const byType = Object.fromEntries(Object.keys(fixture.sourceTotalsM).map(service => [service, Math.round(fixture.sourceTotalsM[service] * 100)]));
  for (const item of fixture.corrections) byType[item.serviceType] += Math.round(item.quantityM * 100) - Math.round(item.originalMeters * 100);
  for (const [service, expected] of Object.entries(fixture.validatedTotalsM)) assert.equal(byType[service], Math.round(expected * 100));
  assert.equal(fixture.corrections.length, 24);
});
