import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { makeCommonSchemas } from '../../shared/schemas/common.js';

test('shared common schemas build with the backend Zod instance', () => {
  const common = makeCommonSchemas(z);

  const name = common.nonEmptyTrimmedString({ max: 10 }).parse('  EPI  ');
  const optional = common.optionalTrimmedString({ max: 10, emptyAs: '' }).parse('   ');
  const ids = common.stringIdList({ min: 1, max: 2 }).parse([' a ', 'b']);

  assert.equal(name, 'EPI');
  assert.equal(optional, '');
  assert.deepEqual(ids, ['a', 'b']);
  assert.throws(() => common.stringIdList({ min: 1, max: 2 }).parse([]));
});
