import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTechnicalDocModel, formatScalar } from '../src/lib/equipment-technical-doc.js';

test('formatScalar formats measure, boolean, date and multiselect', () => {
  assert.equal(formatScalar({ type: 'measure' }, { value: '9,6', unit: 'bar' }), '9,6 bar');
  assert.equal(formatScalar({ type: 'measure' }, { value: '', unit: 'bar' }), '');
  assert.equal(formatScalar({ type: 'boolean' }, true), 'Sim');
  assert.equal(formatScalar({ type: 'boolean' }, false), 'Não');
  assert.equal(formatScalar({ type: 'multiselect' }, ['A', '', 'B']), 'A, B');
  assert.equal(formatScalar({ type: 'date' }, '2026-06-18T12:00:00.000Z'), '18/06/2026');
  assert.equal(formatScalar({ type: 'text' }, '  Kittiwake '), 'Kittiwake');
});

const category = {
  name: 'Compressor',
  technicalSchema: [
    { key: 'pressao', label: 'Pressão Máxima', type: 'measure', unit: { dimension: 'pressao' }, order: 1, group: 'Pneumático' },
    { key: 'marca', label: 'Marca', type: 'text', order: 2 },
    { key: 'oculto', label: 'Interno', type: 'text', order: 3, showInDoc: false },
    { key: 'opcional', label: 'Sensor', type: 'text', order: 4, optionalPerEquipment: true },
    { key: 'vazio', label: 'Não preenchido', type: 'text', order: 5 },
    {
      key: 'motores', label: 'Motores', type: 'group', repeatable: true, itemLabel: 'Motor', order: 6,
      itemSchema: [
        { key: 'potencia', label: 'Potência', type: 'measure', unit: { dimension: 'potencia' }, order: 1 },
        { key: 'tensao', label: 'Tensão', type: 'measure', unit: { dimension: 'tensao' }, order: 2 }
      ]
    }
  ]
};

test('buildTechnicalDocModel flattens filled fields, skips empty/hidden/disabled', () => {
  const equipment = {
    code: 'CMR 001',
    name: 'Compressor 10 PCM',
    technicalRevision: 3,
    technicalFieldOverrides: { opcional: false },
    technicalData: {
      pressao: { value: '9,6', unit: 'bar' },
      marca: 'Chiaperini',
      oculto: 'não deveria aparecer',
      opcional: 'desligado',
      vazio: '',
      motores: [
        { potencia: { value: '2', unit: 'CV' }, tensao: { value: '380', unit: 'V' } },
        { potencia: { value: '', unit: 'CV' } }
      ]
    }
  };
  const model = buildTechnicalDocModel(equipment, category);

  // tokens base
  assert.equal(model.tokens.equip_codigo, 'CMR 001');
  assert.equal(model.tokens.categoria, 'Compressor');
  assert.equal(model.tokens.revisao, '3');
  assert.equal(model.tokens.pressao, '9,6 bar');
  assert.equal(model.tokens.marca, 'Chiaperini');

  // ocultos / desligados / vazios não entram nas linhas
  const keys = model.rows.map(r => r.key);
  assert.deepEqual(keys, ['pressao', 'marca']);
  assert.ok(!('oculto' in model.tokens));
  assert.ok(!('opcional' in model.tokens));
  assert.ok(!('vazio' in model.tokens));

  // seções por group
  assert.equal(model.sections[0].title, 'Pneumático');
  assert.equal(model.sections[0].rows[0].value, '9,6 bar');

  // grupo repetível: 1 motor válido (o 2º sem valores é descartado)
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].items.length, 1);
  assert.equal(model.groups[0].items[0].rows[0].value, '2 CV');
  assert.equal(model.groups[0].items[0].rows[1].value, '380 V');
  assert.equal(model.isEmpty, false);
});

test('buildTechnicalDocModel reports empty when nothing is filled', () => {
  const model = buildTechnicalDocModel({ code: 'X', name: 'Y', technicalData: {} }, category);
  assert.equal(model.isEmpty, true);
  assert.equal(model.rows.length, 0);
  assert.equal(model.groups.length, 0);
});
