import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_TAXES_AND_BILLING, canViewProjectFinancials, normalizeAcompanhamentoExtraPermissions } from '../../shared/modules/acompanhamento-permissions.js';
import { projectFinancialsForUser } from '../src/lib/acompanhamento/financial-access.js';
import { resolveAccountPayload } from '../src/routes/resources/users.js';
import { publicUser } from '../src/lib/auth.js';

const manager = { accountType: 'INTERNAL', role: 'COLLABORATOR', moduleRoles: ['acompanhamento:manager'] };
const grant = [PROJECT_TAXES_AND_BILLING];

test('financial access requires an explicit grant and the manager role; ADMIN has automatic access', () => {
  assert.equal(canViewProjectFinancials({ accountType: 'ADMIN', moduleRoles: [] }), true);
  assert.equal(canViewProjectFinancials({ ...manager, acompanhamentoExtraPermissions: grant }), true);
  for (const user of [null, manager,
    { ...manager, moduleRoles: ['acompanhamento:viewer'], acompanhamentoExtraPermissions: grant },
    { ...manager, moduleRoles: [], acompanhamentoExtraPermissions: grant },
    { ...manager, accountType: 'CLIENT', acompanhamentoExtraPermissions: grant }
  ]) assert.equal(canViewProjectFinancials(user), false);
});

test('account grants default to empty, survive unrelated edits, and can be revoked', () => {
  assert.deepEqual(resolveAccountPayload(manager).acompanhamentoExtraPermissions, []);
  const account = resolveAccountPayload({ ...manager, acompanhamentoExtraPermissions: grant });
  assert.deepEqual(account.acompanhamentoExtraPermissions, grant);
  assert.deepEqual(resolveAccountPayload({ name: 'Novo nome' }, account).acompanhamentoExtraPermissions, grant);
  assert.deepEqual(resolveAccountPayload({ acompanhamentoExtraPermissions: [] }, account).acompanhamentoExtraPermissions, []);
  const demoted = resolveAccountPayload({ moduleRoles: ['acompanhamento:viewer'] }, account);
  assert.deepEqual(demoted.acompanhamentoExtraPermissions, []);
  assert.deepEqual(resolveAccountPayload({ moduleRoles: manager.moduleRoles }, demoted).acompanhamentoExtraPermissions, []);
});

test('accounts outside the module manager role cannot receive grants', () => {
  for (const account of [
    { ...manager, moduleRoles: ['acompanhamento:viewer'] },
    { ...manager, moduleRoles: [] },
    { accountType: 'CLIENT', role: 'CLIENT', moduleRoles: ['rdo:client'] },
    { accountType: 'ADMIN', role: 'MANAGER', moduleRoles: ['rdo:manager'] }
  ]) assert.throws(() => resolveAccountPayload({ ...account, acompanhamentoExtraPermissions: grant }), /só podem ser concedidas/);
  assert.throws(() => normalizeAcompanhamentoExtraPermissions(['UNKNOWN'], manager), /inválida/);
  assert.deepEqual(normalizeAcompanhamentoExtraPermissions([...grant, ...grant], manager), grant);
});

test('session serialization exposes persisted grants, without granting access to a demoted account', () => {
  const user = { ...manager, acompanhamentoExtraPermissions: grant, moduleRoles: [{ role: 'ACOMPANHAMENTO_MANAGER' }] };
  assert.equal(canViewProjectFinancials(publicUser(user)), true);
  user.moduleRoles = [{ role: 'ACOMPANHAMENTO_VIEWER' }];
  assert.deepEqual(publicUser(user).acompanhamentoExtraPermissions, []);
  assert.equal(canViewProjectFinancials(publicUser(user)), false);
});

test('dashboard, cards and detail responses omit actual billing and tax calculations without changing operational costs or budgets', () => {
  const original = {
    projectId: 'p1', invoicedRevenue: 125000, invoicedIss: 5000, invoiceCount: 2,
    presumedProfitTaxes: { basisAmount: 125000, totalTax: 18000, netAfterTaxes: 107000 },
    faturamento: { previsto: 150000, realizado: 125000, notas: 2 },
    plannedTotalCost: 80000, realizedCost: 70000, taxes: 20000,
    consumo: { gasto: 70000 }, budgetBreakdown: { original: { salePrice: 150000, taxes: 20000 } }
  };
  const before = structuredClone(original);
  for (const kind of ['PROJECT', 'GROUP']) {
    const [filtered] = projectFinancialsForUser([{ ...original, kind }], manager);
    assert.equal(filtered.canViewProjectFinancials, false);
    for (const field of ['invoicedRevenue', 'invoicedIss', 'invoiceCount', 'presumedProfitTaxes']) assert.equal(Object.hasOwn(filtered, field), false, field);
    assert.deepEqual(filtered.faturamento, { previsto: 150000 });
    assert.deepEqual(filtered.consumo, original.consumo);
    assert.deepEqual(filtered.budgetBreakdown, original.budgetBreakdown);
    assert.equal(filtered.realizedCost, original.realizedCost);
  }
  assert.deepEqual(original, before);
  for (const user of [{ accountType: 'ADMIN' }, { ...manager, acompanhamentoExtraPermissions: grant }]) {
    assert.deepEqual(projectFinancialsForUser(original, user), { ...original, canViewProjectFinancials: true });
  }
});
