import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHistoricalServiceData,
  hasSharedServiceHistoryKey,
  serviceHistoryKey,
  storagePathUpdatesFromUrlMap
} from '../src/routes/resources/reports.js';

test('storagePathUpdatesFromUrlMap maps organized source uploads to relative storage paths', () => {
  const oldPath = 'Missão 5762 - Karoon/1780693884524-5d2902ea-8abc-47a3-b8b4-365626817988.jpg';
  const newPath = 'Missão 5762 - Karoon/Registros Fotográficos/RCPU/Guindaste de popa - Água de injeção - foto 1.jpg';
  const urlMap = new Map([
    [
      `/relatorios/${oldPath.split('/').map(encodeURIComponent).join('/')}`,
      `/relatorios/${newPath.split('/').map(encodeURIComponent).join('/')}`
    ],
    [
      oldPath,
      `/relatorios/${newPath.split('/').map(encodeURIComponent).join('/')}`
    ]
  ]);

  assert.deepEqual(storagePathUpdatesFromUrlMap(urlMap), [
    { oldPath, newPath }
  ]);
});

test('RCPU service history joins final explicit key to legacy semantic initial service', () => {
  const initialService = {
    serviceType: 'filtragem',
    system: 'Sistema A',
    extraData: {
      'Equipamento(s)': 'UF-01',
      Sistema: 'Sistema A',
      'Colaboradores do serviço': { ids: ['carlos-id'], names: ['Carlos'] },
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
      'Colaboradores do serviço': { ids: ['maria-id'], names: ['Maria'] },
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
  assert.deepEqual(consolidated['Colaboradores do serviço'], {
    ids: ['carlos-id', 'maria-id'],
    names: ['Carlos', 'Maria']
  });
});

test('service history does not merge services with different explicit keys', () => {
  const left = { serviceType: 'filtragem', extraData: { __serviceLinkKey: 'service-a', 'Equipamento(s)': 'UF-01' } };
  const right = { serviceType: 'filtragem', extraData: { __serviceLinkKey: 'service-b', 'Equipamento(s)': 'UF-01' } };

  assert.equal(hasSharedServiceHistoryKey(left, right), false);
});

test('RCPU service history separates filtration by oil type and volume', () => {
  const pendingFiltration = {
    serviceType: 'filtragem',
    system: 'Sistema óleo',
    extraData: {
      'Equipamento(s)': 'UFG-01',
      Sistema: 'Sistema óleo',
      'Tipo de óleo': 'ISO VG 46',
      'Volume de óleo': '120 L'
    }
  };
  const finalizedFiltration = {
    serviceType: 'filtragem',
    system: 'Sistema óleo',
    extraData: {
      'Equipamento(s)': 'UFG-01',
      Sistema: 'Sistema óleo',
      'Tipo de óleo': 'ISO VG 68',
      'Volume de óleo': '300 L'
    }
  };

  assert.notEqual(serviceHistoryKey(pendingFiltration), serviceHistoryKey(finalizedFiltration));
  assert.equal(hasSharedServiceHistoryKey(pendingFiltration, finalizedFiltration), false);
});

test('RCPU service history treats old semantic explicit keys as aliases only', () => {
  const initialFiltration = {
    serviceType: 'filtragem',
    system: 'Sistema óleo',
    extraData: {
      'Equipamento(s)': 'UFG-01',
      Sistema: 'Sistema óleo',
      'Tipo de óleo': 'ISO VG 46',
      'Volume de óleo': '120 L'
    }
  };
  const sameFiltrationWithLegacyKey = {
    serviceType: 'filtragem',
    system: 'Sistema óleo',
    extraData: {
      __serviceLinkKey: 'project-1||filtragem||ufg-01||sistema oleo',
      'Equipamento(s)': 'UFG-01',
      Sistema: 'Sistema óleo',
      'Tipo de óleo': 'ISO VG 46',
      'Volume de óleo': '120 L'
    }
  };
  const otherFiltrationWithLegacyKey = {
    serviceType: 'filtragem',
    system: 'Sistema óleo',
    extraData: {
      __serviceLinkKey: 'project-1||filtragem||ufg-01||sistema oleo',
      'Equipamento(s)': 'UFG-01',
      Sistema: 'Sistema óleo',
      'Tipo de óleo': 'ISO VG 68',
      'Volume de óleo': '300 L'
    }
  };

  assert.equal(hasSharedServiceHistoryKey(sameFiltrationWithLegacyKey, initialFiltration), true);
  assert.equal(hasSharedServiceHistoryKey(otherFiltrationWithLegacyKey, initialFiltration), false);
});
