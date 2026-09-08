import assert from 'node:assert/strict';
import test from 'node:test';

import { hexColorSchema, jobRolePlanningInputSchema, planningSettingsInputSchema } from '../src/lib/efetivo/planning/schemas.js';

test('configuração aceita cor, limite 1–365 e meta 0–100', () => {
  assert.equal(hexColorSchema.parse('#12AbEF'), '#12AbEF');
  assert.equal(jobRolePlanningInputSchema.parse({ continuousWorkLimitDays: 30 }).continuousWorkLimitDays, 30);
  assert.equal(planningSettingsInputSchema.parse({ plannedUtilizationTarget: 80 }).plannedUtilizationTarget, 80);
  assert.equal(jobRolePlanningInputSchema.safeParse({ continuousWorkLimitDays: 366 }).success, false);
  assert.equal(planningSettingsInputSchema.safeParse({ plannedUtilizationTarget: 101 }).success, false);
});
