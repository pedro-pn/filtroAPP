import assert from 'node:assert/strict';
import { test } from 'node:test';

import { jsonBodyLimitForRequest } from '../src/app.js';

test('relatórios operacionais (manutenção) aceitam fotos em base64 no corpo, como o upload do RDO', () => {
  for (const path of [
    '/api/operational-reports',
    '/api/rdo/operational-reports',
    '/api/rdo/operational-reports/abc123',
    '/api/rdo/operational-reports/maintenance-records/abc123'
  ]) {
    for (const method of ['POST', 'PUT', 'PATCH']) assert.equal(jsonBodyLimitForRequest(method, path), '25mb', `${method} ${path}`);
  }
  assert.equal(jsonBodyLimitForRequest('POST', '/api/rdo/uploads'), '25mb');
});

test('o limite maior não vaza para rotas parecidas', () => {
  assert.equal(jsonBodyLimitForRequest('POST', '/api/operational-reports-export'), '1mb');
  assert.equal(jsonBodyLimitForRequest('POST', '/api/rdo/reports'), '1mb');
});
