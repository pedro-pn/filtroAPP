import assert from 'node:assert/strict';
import test from 'node:test';

import { equipmentSerialNumber } from '../src/lib/equipment-attributes.js';

test('equipmentSerialNumber reads legacy camelCase and normalized lowercase attributes', () => {
  assert.equal(equipmentSerialNumber({ attributes: { serialNumber: 'SN-001' } }), 'SN-001');
  assert.equal(equipmentSerialNumber({ attributes: { serialnumber: 'SN-002' } }), 'SN-002');
});

test('equipmentSerialNumber falls back to technical data serial fields', () => {
  assert.equal(equipmentSerialNumber({ attributes: {}, technicalData: { serial: 'SN-003' } }), 'SN-003');
});
