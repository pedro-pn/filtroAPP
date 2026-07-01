import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeRdoServiceType,
  realizedFromExtraData,
  isServiceFinalized,
  buildProgress
} from '../src/lib/acompanhamento-avanco.js';

test('isServiceFinalized: coluna booleana e campo textual do extraData', () => {
  assert.equal(isServiceFinalized({ finalized: true }), true);
  assert.equal(isServiceFinalized({ finalized: false }), false);
  assert.equal(isServiceFinalized({ finalized: null, extraData: { 'Serviço finalizado?': 'Sim' } }), true);
  assert.equal(isServiceFinalized({ extraData: { 'Serviço finalizado?': 'Não' } }), false);
  assert.equal(isServiceFinalized({}), false);
  assert.equal(isServiceFinalized(null), false);
});

test('normalizeRdoServiceType aceita os vários formatos do RDO', () => {
  assert.equal(normalizeRdoServiceType('limpeza'), 'LIMPEZA_QUIMICA');
  assert.equal(normalizeRdoServiceType('LIMPEZA'), 'LIMPEZA_QUIMICA');
  assert.equal(normalizeRdoServiceType('Limpeza química'), 'LIMPEZA_QUIMICA');
  assert.equal(normalizeRdoServiceType('pressao'), 'TESTE_PRESSAO');
  assert.equal(normalizeRdoServiceType('Teste de pressão'), 'TESTE_PRESSAO');
  assert.equal(normalizeRdoServiceType('flushing'), 'FLUSHING');
  assert.equal(normalizeRdoServiceType('Filtragem'), 'FILTRAGEM');
  assert.equal(normalizeRdoServiceType('mecanica'), null);
  assert.equal(normalizeRdoServiceType('inibicao'), null);
  assert.equal(normalizeRdoServiceType(''), null);
});

test('realizedFromExtraData soma tubulação (cm→m) e óleo (mL→L)', () => {
  const r = realizedFromExtraData({
    tubes: [
      { c: '100', lengthUnit: 'm' },
      { c: '250', lengthUnit: 'cm' }, // = 2.5 m
      { c: '1.234,5', lengthUnit: 'm' } // BR: 1234.5 m
    ],
    volumeOleo: '500',
    volumeOleoUnit: 'mL' // = 0.5 L
  });
  assert.equal(r.tubulacaoM, 100 + 2.5 + 1234.5);
  assert.equal(r.oleoL, 0.5);
});

test('realizedFromExtraData tolera dados ausentes', () => {
  assert.deepEqual(realizedFromExtraData(null), { tubulacaoM: 0, oleoL: 0 });
  assert.deepEqual(realizedFromExtraData({ tubes: 'x' }), { tubulacaoM: 0, oleoL: 0 });
});

test('buildProgress: execução por sistema limitada a 100% e ponderada por peso', () => {
  const planned = [
    { serviceType: 'LIMPEZA_QUIMICA', weight: 3, systems: [{ systemType: 'TUBULACAO', quantity: 1000, unit: 'M' }] },
    { serviceType: 'FILTRAGEM', weight: 1, systems: [{ systemType: 'OLEO', quantity: 200, unit: 'L' }] }
  ];
  const realized = new Map([
    ['LIMPEZA_QUIMICA', { tubulacaoM: 500, oleoL: 0 }], // 50%
    ['FILTRAGEM', { tubulacaoM: 0, oleoL: 400 }] // 200% -> cap 100%
  ]);
  const out = buildProgress(planned, realized);
  assert.equal(out.hasScope, true);
  assert.equal(out.services[0].executionPct, 50);
  assert.equal(out.services[1].executionPct, 100); // cap
  // (3*50 + 1*100) / (3+1) = 250/4 = 62.5
  assert.equal(out.progressPct, 62.5);
});

test('buildProgress: serviço com sistema de múltiplas medidas usa a média', () => {
  const planned = [
    { serviceType: 'FLUSHING', weight: 1, systems: [
      { systemType: 'TUBULACAO', quantity: 100, unit: 'M' }, // 100% (real 100)
      { systemType: 'OLEO', quantity: 100, unit: 'L' } // 0% (real 0)
    ] }
  ];
  const realized = new Map([['FLUSHING', { tubulacaoM: 100, oleoL: 0 }]]);
  const out = buildProgress(planned, realized);
  assert.equal(out.services[0].executionPct, 50); // média de 100% e 0%
  assert.equal(out.progressPct, 50);
});

test('buildProgress: sem meta cadastrada não entra no avanço (progressPct null)', () => {
  const planned = [
    { serviceType: 'LIMPEZA_QUIMICA', weight: 1, systems: [{ systemType: 'TUBULACAO', quantity: null, unit: 'M' }] }
  ];
  const out = buildProgress(planned, new Map());
  assert.equal(out.services[0].executionPct, null);
  assert.equal(out.progressPct, null);
  assert.equal(out.hasScope, false);
});
