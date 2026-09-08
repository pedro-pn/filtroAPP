import assert from 'node:assert/strict';
import test from 'node:test';

import { serviceSchema } from '../src/routes/resources/reports.js';

const validService = {
  serviceType: 'limpeza',
  startTime: '08:00',
  endTime: '12:00',
  finalized: false
};

test('API exige hora de início e término/pausa em todos os serviços', () => {
  assert.equal(serviceSchema.safeParse(validService).success, true);
  assert.equal(serviceSchema.safeParse({ ...validService, startTime: '' }).success, false);
  assert.equal(serviceSchema.safeParse({ ...validService, startTime: '   ' }).success, false);
  assert.equal(serviceSchema.safeParse({ ...validService, startTime: null }).success, false);
  assert.equal(serviceSchema.safeParse({ ...validService, endTime: '' }).success, false);
  assert.equal(serviceSchema.safeParse({ ...validService, endTime: '   ' }).success, false);
  assert.equal(serviceSchema.safeParse({ ...validService, endTime: null }).success, false);
});
