import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREATE_SERVICE_ONLY_REPORTS,
  REVIEW_REPORTS,
  canCreateServiceOnlyRdoReports,
  canReviewRdoReports,
  normalizeRdoExtraPermissions
} from '../../shared/modules/rdo-permissions.js';
import { publicUser } from '../src/lib/auth.js';
import prisma from '../src/lib/prisma.js';
import reportsRouter from '../src/routes/resources/reports.js';
import usersRouter, { resolveAccountPayload } from '../src/routes/resources/users.js';

const coordinator = { id: 'coordinator', role: 'COORDINATOR', accountType: 'INTERNAL', moduleRoles: ['rdo:coordinator'] };
const serviceGrant = [CREATE_SERVICE_ONLY_REPORTS];

function invoke(router, method, path, request) {
  const handler = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); }
    };
    handler(request, response, reject);
  });
}

test('service-only creation requires its own coordinator grant and remains available to managers', () => {
  assert.equal(canCreateServiceOnlyRdoReports({ role: 'MANAGER' }), true);
  assert.equal(canCreateServiceOnlyRdoReports({ ...coordinator, rdoExtraPermissions: serviceGrant }), true);
  assert.equal(canReviewRdoReports({ ...coordinator, rdoExtraPermissions: serviceGrant }), false);
  for (const user of [null, coordinator,
    { ...coordinator, rdoExtraPermissions: [REVIEW_REPORTS] },
    { ...coordinator, moduleRoles: [], rdoExtraPermissions: serviceGrant },
    { role: 'COLLABORATOR', accountType: 'INTERNAL', moduleRoles: ['rdo:collaborator'], rdoExtraPermissions: serviceGrant },
    { role: 'CLIENT', accountType: 'CLIENT', moduleRoles: ['rdo:client'], rdoExtraPermissions: serviceGrant }
  ]) assert.equal(canCreateServiceOnlyRdoReports(user), false);
});

test('both RDO grants normalize independently and are cleared when the account loses its coordinator role', () => {
  const grants = [REVIEW_REPORTS, CREATE_SERVICE_ONLY_REPORTS];
  assert.deepEqual(normalizeRdoExtraPermissions([...grants, ...grants], coordinator), grants);
  const account = resolveAccountPayload({ ...coordinator, rdoExtraPermissions: grants });
  assert.deepEqual(resolveAccountPayload({ name: 'Novo nome' }, account).rdoExtraPermissions, grants);
  assert.deepEqual(resolveAccountPayload({ rdoExtraPermissions: serviceGrant }, account).rdoExtraPermissions, serviceGrant);
  assert.deepEqual(resolveAccountPayload({ role: 'COLLABORATOR', moduleRoles: ['rdo:collaborator'] }, account).rdoExtraPermissions, []);
  assert.throws(() => resolveAccountPayload({ role: 'COLLABORATOR', accountType: 'INTERNAL', moduleRoles: ['rdo:collaborator'], rdoExtraPermissions: serviceGrant }), /só podem ser concedidas/);
});

test('account update API persists and revokes the service-only grant and returns it in the session shape', async t => {
  let stored = { ...coordinator, moduleRoles: [{ role: 'RDO_COORDINATOR' }], rdoExtraPermissions: [REVIEW_REPORTS] };
  const originalFind = prisma.user.findUniqueOrThrow;
  const originalUpdate = prisma.user.update;
  t.after(() => {
    prisma.user.findUniqueOrThrow = originalFind;
    prisma.user.update = originalUpdate;
  });
  prisma.user.findUniqueOrThrow = async () => stored;
  prisma.user.update = async ({ data }) => (stored = { ...stored, ...data });
  for (const grants of [[REVIEW_REPORTS, CREATE_SERVICE_ONLY_REPORTS], [REVIEW_REPORTS]]) {
    const response = await invoke(usersRouter, 'put', '/:id', {
      params: { id: coordinator.id }, body: { rdoExtraPermissions: grants }
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(stored.rdoExtraPermissions, grants);
    assert.deepEqual(response.body.rdoExtraPermissions, grants);
    assert.equal(canCreateServiceOnlyRdoReports(publicUser(stored)), grants.includes(CREATE_SERVICE_ONLY_REPORTS));
  }
});

test('service-only API blocks missing grants before validation and admits explicitly authorized coordinators', async () => {
  for (const rdoExtraPermissions of [[], [REVIEW_REPORTS]]) {
    const response = await invoke(reportsRouter, 'post', '/service-only', {
      auth: { user: { ...coordinator, rdoExtraPermissions } }, body: {}
    });
    assert.equal(response.statusCode, 403);
    assert.match(response.body.error, /permissão/);
  }
  for (const user of [{ role: 'MANAGER' }, { ...coordinator, rdoExtraPermissions: serviceGrant }]) {
    await assert.rejects(invoke(reportsRouter, 'post', '/service-only', {
      auth: { user }, body: {}
    }), { name: 'ZodError' });
  }
});
