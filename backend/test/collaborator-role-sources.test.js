import assert from 'node:assert/strict';
import test from 'node:test';
import { withCollaboratorRoleNames } from '../src/lib/acompanhamento/collaborator-role-sources.js';
import { collaboratorRoleAtDate } from '../src/lib/collaborators/job-role-history.js';

test('shared role names preserve effective history, missing profiles, source order and legacy relations', () => {
  const roles = new Map([['a', { id: 'a', name: 'Operador' }], ['b', { id: 'b', name: 'Técnico' }], ['c', { id: 'c', name: 'Sem perfil' }]]);
  const source = { id: 'c1', jobRoleId: 'b', jobRole: { id: 'b', name: 'Nome anterior' }, rdoCostSimulationExcluded: true,
    jobRoleHistory: [
      { jobRoleId: 'b', effectiveDate: new Date('2026-09-15') },
      { jobRoleId: 'a', effectiveDate: new Date('2026-09-01') }
    ] };
  const before = structuredClone(source), actual = withCollaboratorRoleNames(source, roles);
  assert.deepEqual(source, before);
  assert.equal(actual.jobRole.name, 'Técnico');
  assert.deepEqual(actual.jobRoleHistory.map(row => row.jobRoleId), ['b', 'a']);
  assert.equal(collaboratorRoleAtDate(actual, '2026-09-10').roleName, 'Operador');
  assert.equal(collaboratorRoleAtDate(actual, '2026-09-20').roleName, 'Técnico');
  assert.equal(collaboratorRoleAtDate(actual, '2026-08-30'), null);
  assert.equal(actual.rdoCostSimulationExcluded, true);
  assert.equal(withCollaboratorRoleNames({ jobRoleId: 'c' }, roles).jobRole.name, 'Sem perfil');
  assert.equal(withCollaboratorRoleNames({ jobRoleId: 'missing' }, roles).jobRole, null);
  const legacy = { jobRole: { name: 'Cargo do adaptador' }, jobRoleHistory: [] };
  roles.set(undefined, { name: 'Linha do catálogo sem identificador' });
  assert.deepEqual(withCollaboratorRoleNames(legacy, roles), legacy);
  assert.equal(withCollaboratorRoleNames(null, roles), null);
});
