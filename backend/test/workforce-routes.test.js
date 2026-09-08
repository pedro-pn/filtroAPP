import assert from 'node:assert/strict';
import test from 'node:test';

import workforceRouter, { requireWorkforceRead } from '../src/routes/workforce.js';
import { requireEfetivoManager } from '../src/lib/efetivo/access.js';
import { workforceAbsenceInputSchema, workforceAvailabilityInputSchema } from '../src/lib/workforce/schemas.js';

test('router workforce expõe somente os contratos esperados', () => {
  const paths = workforceRouter.stack.filter(layer => layer.route).map(layer => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods)
  }));
  assert.ok(paths.some(item => item.path === '/calendar' && item.methods.includes('get')));
  assert.ok(paths.some(item => item.path === '/availability/check' && item.methods.includes('post')));
  assert.ok(paths.some(item => item.path === '/absences' && item.methods.includes('post')));
});

test('mutações exigem gestor de Efetivo e contratos rejeitam texto incompleto', () => {
  let status = null;
  requireEfetivoManager({ auth: { user: { accountType: 'INTERNAL', moduleRoles: [] } } }, {
    status(code) { status = code; return this; }, json() { return this; }
  }, () => assert.fail('não deveria autorizar'));
  assert.equal(status, 403);
  assert.equal(workforceAbsenceInputSchema.safeParse({ collaboratorId: 'c1' }).success, false);
  assert.equal(workforceAvailabilityInputSchema.safeParse({ collaboratorIds: [], startDate: '2026-01-01', endDate: '2026-01-01', context: 'PLANNING' }).success, false);
});

test('leitura compartilhada não é exposta a conta sem módulo operacional', () => {
  let status = null;
  requireWorkforceRead({ auth: { user: { accountType: 'INTERNAL', moduleRoles: [] } } }, {
    status(code) { status = code; return this; }, json() { return this; }
  }, () => assert.fail('não deveria autorizar'));
  assert.equal(status, 403);

  let allowed = false;
  requireWorkforceRead({ auth: { user: { accountType: 'INTERNAL', moduleRoles: ['rdo:collaborator'] } } }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
});
