import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHistoricalServiceData,
  hasSharedServiceHistoryKey,
  serviceHistoryKey
} from '../src/routes/resources/reports.js';

test('RCPU service history joins final explicit key to legacy semantic initial service', () => {
  const initialService = {
    serviceType: 'filtragem',
    system: 'Sistema A',
    extraData: {
      'Equipamento(s)': 'UF-01',
      Sistema: 'Sistema A',
      'Houve contagem de partículas?': 'Sim',
      'Contagem inicial NAS': '99',
      'Contagem final NAS': '12',
      'Houve análise de umidade?': 'Sim',
      'Umidade inicial (ppm)': '80',
      'Umidade final (ppm)': '50'
    }
  };
  const semanticKey = `project-1||${serviceHistoryKey(initialService)}`;
  const finalService = {
    serviceType: 'filtragem',
    system: 'Sistema A',
    extraData: {
      __serviceLinkKey: semanticKey,
      'Equipamento(s)': 'UF-01',
      Sistema: 'Sistema A',
      'Houve contagem de partículas?': 'Sim',
      'Contagem inicial NAS': '9',
      'Contagem final NAS': '4',
      'Houve análise de umidade?': 'Sim',
      'Umidade inicial (ppm)': '45',
      'Umidade final (ppm)': '20'
    }
  };

  assert.equal(hasSharedServiceHistoryKey(finalService, initialService), true);

  const consolidated = buildHistoricalServiceData(finalService.extraData, [
    { fields: initialService.extraData },
    { fields: finalService.extraData }
  ]);

  assert.equal(consolidated['Contagem inicial NAS'], '99');
  assert.equal(consolidated['Contagem final NAS'], '4');
  assert.equal(consolidated['Umidade inicial (ppm)'], '80');
  assert.equal(consolidated['Umidade final (ppm)'], '20');
});

test('service history does not merge services with different explicit keys', () => {
  const left = { serviceType: 'filtragem', extraData: { __serviceLinkKey: 'service-a', 'Equipamento(s)': 'UF-01' } };
  const right = { serviceType: 'filtragem', extraData: { __serviceLinkKey: 'service-b', 'Equipamento(s)': 'UF-01' } };

  assert.equal(hasSharedServiceHistoryKey(left, right), false);
});
