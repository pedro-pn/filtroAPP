import assert from 'node:assert/strict';
import test from 'node:test';

import { publicErrorCode } from '../src/lib/http/public-error-code.js';

test('production 5xx never exposes infrastructure error codes', () => {
  assert.equal(publicErrorCode({ code: 'P1001' }, 500, true), null);
  assert.equal(publicErrorCode({ code: 'ECONNREFUSED', errno: -111, syscall: 'connect' }, 500, true), null);
  assert.equal(publicErrorCode({ code: 'ECONNREFUSED' }, 500, true), null);
  assert.equal(publicErrorCode({ code: 'ERR_INVALID_ARG_TYPE' }, 500, true), null);
  assert.equal(publicErrorCode({ code: 'UND_ERR_CONNECT_TIMEOUT' }, 502, true), null);
  assert.equal(publicErrorCode({ code: 'HEALTH_DB_TIMEOUT', syscall: 'x' }, 503, true), null);
});

test('application codes stay available to the frontend', () => {
  assert.equal(publicErrorCode({ code: 'RH_EVIDENCE_NOT_CONFIGURED' }, 503, true), 'RH_EVIDENCE_NOT_CONFIGURED');
  assert.equal(publicErrorCode({ code: 'P2002' }, 409, true), 'P2002');
  assert.equal(publicErrorCode({ code: 'VALIDATION' }, 400, true), 'VALIDATION');
  assert.equal(publicErrorCode({ code: 'P1001' }, 500, false), 'P1001');
  assert.equal(publicErrorCode({}, 500, true), null);
});
