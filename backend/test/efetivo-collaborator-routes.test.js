import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('contrato do Efetivo limita colaborador aos campos operacionais', () => {
  const contract = fs.readFileSync(new URL('../../specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml', import.meta.url), 'utf8');
  const input = contract.slice(contract.indexOf('    CollaboratorInput:'), contract.indexOf('    CollaboratorPlanning:'));
  for (const field of ['name:', 'jobRoleId:', 'admissionDate:', 'terminationDate:', 'note:']) assert.ok(input.includes(field));
  assert.doesNotMatch(input, /password|signatureImage|cpf:/);
});
