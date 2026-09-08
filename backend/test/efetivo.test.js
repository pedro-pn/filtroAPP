import assert from 'node:assert/strict';
import test from 'node:test';

import { efetivoStatus } from '../src/lib/efetivo/service.js';

test('efetivo exposes module status', () => {
  assert.deepEqual(efetivoStatus(), {
    module: 'efetivo',
    status: 'ok'
  });
});
