import assert from 'node:assert/strict';
import test from 'node:test';
import { REVIEW_REPORTS, canReviewRdoReports, normalizeRdoExtraPermissions } from '../../shared/modules/rdo-permissions.js';
import { resolveAccountPayload } from '../src/routes/resources/users.js';
import { publicUser } from '../src/lib/auth.js';

const coordinator = { accountType: 'INTERNAL', role: 'COORDINATOR', moduleRoles: ['rdo:coordinator'] };
const grant = [REVIEW_REPORTS];

test('review access requires an explicit grant on a coordinator account; the manager always has it', () => {
  assert.equal(canReviewRdoReports({ accountType: 'ADMIN', role: 'MANAGER', moduleRoles: ['rdo:manager'] }), true);
  assert.equal(canReviewRdoReports({ ...coordinator, rdoExtraPermissions: grant }), true);
  for (const user of [null, coordinator,
    { ...coordinator, moduleRoles: ['rdo:collaborator'], role: 'COLLABORATOR', rdoExtraPermissions: grant },
    { ...coordinator, moduleRoles: [], rdoExtraPermissions: grant },
    { accountType: 'CLIENT', role: 'CLIENT', moduleRoles: ['rdo:client'], rdoExtraPermissions: grant }
  ]) assert.equal(canReviewRdoReports(user), false);
});

test('account grants default to empty, survive unrelated edits, and can be revoked', () => {
  assert.deepEqual(resolveAccountPayload(coordinator).rdoExtraPermissions, []);
  const account = resolveAccountPayload({ ...coordinator, rdoExtraPermissions: grant });
  assert.deepEqual(account.rdoExtraPermissions, grant);
  assert.deepEqual(resolveAccountPayload({ name: 'Novo nome' }, account).rdoExtraPermissions, grant);
  assert.deepEqual(resolveAccountPayload({ rdoExtraPermissions: [] }, account).rdoExtraPermissions, []);
  const demoted = resolveAccountPayload({ role: 'COLLABORATOR', moduleRoles: ['rdo:collaborator'] }, account);
  assert.deepEqual(demoted.rdoExtraPermissions, []);
  assert.deepEqual(resolveAccountPayload({ role: 'COORDINATOR', moduleRoles: coordinator.moduleRoles }, demoted).rdoExtraPermissions, []);
});

test('accounts outside the coordinator role cannot receive grants', () => {
  for (const account of [
    { ...coordinator, role: 'COLLABORATOR', moduleRoles: ['rdo:collaborator'] },
    { ...coordinator, moduleRoles: [] },
    { accountType: 'CLIENT', role: 'CLIENT', moduleRoles: ['rdo:client'] },
    { accountType: 'ADMIN', role: 'MANAGER', moduleRoles: ['rdo:manager'] }
  ]) assert.throws(() => resolveAccountPayload({ ...account, rdoExtraPermissions: grant }), /só podem ser concedidas/);
  assert.throws(() => normalizeRdoExtraPermissions(['UNKNOWN'], coordinator), /inválida/);
  assert.deepEqual(normalizeRdoExtraPermissions([...grant, ...grant], coordinator), grant);
});

test('session serialization exposes persisted grants, without granting access to a demoted account', () => {
  const user = { ...coordinator, rdoExtraPermissions: grant, moduleRoles: [{ role: 'RDO_COORDINATOR' }] };
  assert.equal(canReviewRdoReports(publicUser(user)), true);
  user.moduleRoles = [{ role: 'RDO_COLLABORATOR' }];
  assert.deepEqual(publicUser(user).rdoExtraPermissions, []);
  assert.equal(canReviewRdoReports(publicUser(user)), false);
});
