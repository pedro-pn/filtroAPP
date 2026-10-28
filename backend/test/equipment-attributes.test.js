import assert from 'node:assert/strict';
import test from 'node:test';

import { equipmentCalibrationCertificateCode, equipmentSerialNumber } from '../src/lib/equipment-attributes.js';

test('equipmentCalibrationCertificateCode accepts legacy and normalized field names', () => {
  assert.equal(equipmentCalibrationCertificateCode({ attributes: { calibrationCertCode: ' CERT-001 ' } }), 'CERT-001');
  assert.equal(equipmentCalibrationCertificateCode({ attributes: { calibrationcertcode: 'CERT-002' } }), 'CERT-002');
  assert.equal(equipmentCalibrationCertificateCode({ attributes: { calibrationCertCode: 'CERT-001', calibrationcertcode: 'CERT-002' } }), 'CERT-001');
  assert.equal(equipmentCalibrationCertificateCode({ attributes: { calibrationCertCode: ' ', calibrationcertcode: 'CERT-002' } }), 'CERT-002');
  assert.equal(equipmentCalibrationCertificateCode({ attributes: { calibrationcertcode: { value: 'CERT-003' } } }), 'CERT-003');
  for (const item of [null, {}, { attributes: null }, { attributes: [] }]) {
    assert.equal(equipmentCalibrationCertificateCode(item), '');
  }
});

test('equipmentSerialNumber reads legacy camelCase and normalized lowercase attributes', () => {
  assert.equal(equipmentSerialNumber({ attributes: { serialNumber: 'SN-001' } }), 'SN-001');
  assert.equal(equipmentSerialNumber({ attributes: { serialnumber: 'SN-002' } }), 'SN-002');
});

test('equipmentSerialNumber falls back to technical data serial fields', () => {
  assert.equal(equipmentSerialNumber({ attributes: {}, technicalData: { serial: 'SN-003' } }), 'SN-003');
});
