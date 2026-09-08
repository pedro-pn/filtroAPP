import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('contrato cobre CRUD, elegíveis, alocação e autoalocação', () => {
  const contract = fs.readFileSync(new URL('../../specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml', import.meta.url), 'utf8');
  for (const path of ['/planning/missions:', '/planning/missions/{missionId}:', '/eligible-collaborators:', '/allocations:', '/auto-allocate:']) assert.ok(contract.includes(path));
});
