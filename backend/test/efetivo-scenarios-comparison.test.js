import assert from 'node:assert/strict';
import test from 'node:test';

import { plannedHireCapacityOn } from '../src/lib/efetivo/planning/scenarios.js';

test('contratação hipotética conta somente após disponibilidade e sem criar pessoa', () => {
  const hires = [{ jobRoleId: 'r1', quantity: 3, availableFrom: '2026-09-01' }, { jobRoleId: 'r2', quantity: 2, availableFrom: '2026-10-01' }];
  assert.equal(plannedHireCapacityOn(hires, '2026-09-15'), 3);
  assert.equal(plannedHireCapacityOn(hires, '2026-10-01'), 5);
});
