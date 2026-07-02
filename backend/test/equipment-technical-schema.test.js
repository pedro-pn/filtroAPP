import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeTechnicalSchema } from '../src/lib/equipment-categories.js';
import {
  measurementCatalog,
  dimensionFromUnitHint,
  normalizeUnit,
  defaultUnitFor
} from '../src/lib/equipment-units.js';
import {
  buildTechnicalSchemaFromTracking,
  countTechnicalFields
} from '../src/lib/equipment-technical-seed.js';

test('normalizeTechnicalSchema keeps known types and slugifies keys', () => {
  const out = normalizeTechnicalSchema([
    { label: 'Tipo de Fluido', type: 'text' },
    { label: 'Reagentes', type: 'textarea' },
    { label: 'Canais', type: 'number' }
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].key, 'tipo_de_fluido');
  assert.equal(out[1].type, 'textarea');
  assert.equal(out[2].type, 'number');
  // defaults
  assert.equal(out[0].showInDoc, true);
  assert.equal(out[0].optionalPerEquipment, false);
});

test('normalizeTechnicalSchema validates measure unit dimension and falls back', () => {
  const [valid, invalid] = normalizeTechnicalSchema([
    { label: 'Pressão Máxima', type: 'measure', unit: { dimension: 'pressao' } },
    { label: 'Algo', type: 'measure', unit: { dimension: 'inexistente' } }
  ]);
  assert.equal(valid.unit.dimension, 'pressao');
  assert.equal(valid.unit.default, 'bar');
  assert.equal(invalid.unit.dimension, null);
});

test('normalizeTechnicalSchema normalizes repeatable group with itemSchema (no nesting)', () => {
  const [group] = normalizeTechnicalSchema([
    {
      label: 'Motores',
      type: 'group',
      repeatable: true,
      itemSchema: [
        { label: 'Potência', type: 'measure', unit: { dimension: 'potencia' } },
        { label: 'Tensão', type: 'measure', unit: { dimension: 'tensao' } },
        { label: 'Sub grupo', type: 'group' } // deve virar text (sem aninhar)
      ]
    }
  ]);
  assert.equal(group.type, 'group');
  assert.equal(group.repeatable, true);
  assert.equal(group.itemSchema.length, 3);
  assert.equal(group.itemSchema[0].unit.dimension, 'potencia');
  assert.equal(group.itemSchema[2].type, 'text');
});

test('normalizeTechnicalSchema drops duplicate keys and keeps select options', () => {
  const out = normalizeTechnicalSchema([
    { label: 'Display', type: 'select', options: ['Visual', 'Digital', ''] },
    { key: 'display', label: 'Display 2', type: 'text' }
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].options, ['Visual', 'Digital']);
});

test('buildTechnicalSchemaFromTracking maps tracking types and infers measure dimension', () => {
  const schema = buildTechnicalSchemaFromTracking([
    { label: 'Tipo de Fluido', key: 'tipo_de_fluido', type: 'short_text', unit_hint: null },
    { label: 'Reagentes', key: 'reagentes', type: 'long_text' },
    { label: 'Canais', key: 'canais', type: 'integer_or_text' },
    { label: 'Pressão Máxima', key: 'pressao_maxima', type: 'measurement_text', unit_hint: 'bar / kgf/cm² / psi' }
  ]);
  assert.equal(schema.length, 4);
  assert.equal(schema[0].type, 'text');
  assert.equal(schema[1].type, 'textarea');
  assert.equal(schema[2].type, 'number');
  assert.equal(schema[3].type, 'measure');
  assert.equal(schema[3].unit.dimension, 'pressao');
  assert.equal(schema[3].unit.default, 'bar');
});

test('buildTechnicalSchemaFromTracking flags optional from notes and wraps allow_multiple as group', () => {
  const schema = buildTechnicalSchemaFromTracking([
    { label: 'Câmera', key: 'camera', type: 'short_text', notes: 'Não aparece em todos os exemplos da categoria. ' },
    { label: 'Motor Elétrico', key: 'motor_eletrico', type: 'measurement_text', unit_hint: 'CV / kW / hp / W', allow_multiple: true }
  ]);
  const [optional, group] = schema;
  assert.equal(optional.optionalPerEquipment, true);
  assert.equal(group.type, 'group');
  assert.equal(group.repeatable, true);
  assert.equal(group.itemSchema.length, 1);
  assert.equal(group.itemSchema[0].type, 'measure');
  assert.equal(group.itemSchema[0].unit.dimension, 'potencia');
  assert.equal(countTechnicalFields(schema), 3); // 1 + (grupo 1 + subcampo 1)
});

test('measurement catalog maps unit hints from the tracking JSON', () => {
  assert.equal(dimensionFromUnitHint('bar / kgf/cm² / psi'), 'pressao');
  assert.equal(dimensionFromUnitHint('L/min ou m³/h'), 'vazao');
  assert.equal(dimensionFromUnitHint('CV / kW / hp / W'), 'potencia');
  assert.equal(dimensionFromUnitHint('CV / kW / kVA / hp / W'), 'potencia');
  assert.equal(dimensionFromUnitHint('rpm'), 'rotacao');
  assert.equal(dimensionFromUnitHint(null), null);
  assert.equal(defaultUnitFor('pressao'), 'bar');
  assert.equal(normalizeUnit('potencia', 'kVA'), 'kVA');
  assert.equal(normalizeUnit('pressao', 'psi'), 'psi');
  assert.equal(normalizeUnit('pressao', 'xx'), 'bar');
  assert.ok(measurementCatalog().find(d => d.key === 'potencia')?.units.includes('kVA'));
  assert.ok(measurementCatalog().length >= 13);
});
