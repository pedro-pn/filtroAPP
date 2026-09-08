import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('contrato cobre comparação, contratação, aplicação e descarte', () => {
  const contract = fs.readFileSync(new URL('../../specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml', import.meta.url), 'utf8');
  for (const path of ['/planning/scenarios:', '/compare:', '/hires:', '/apply:', '/discard:']) assert.ok(contract.includes(path));
  assert.match(contract, /idempotentRetry/);
});
