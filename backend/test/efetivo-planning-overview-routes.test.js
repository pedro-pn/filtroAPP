import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('contrato publica projetos mínimos e visão geral', () => {
  const contract = fs.readFileSync(new URL('../../specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml', import.meta.url), 'utf8');
  assert.match(contract, /^  \/planning\/projects:/m);
  assert.match(contract, /^  \/planning\/coordinators:/m);
  assert.match(contract, /^  \/planning\/overview:/m);
  assert.match(contract, /plannedUtilization90d/);
});
