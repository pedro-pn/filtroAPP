import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canEditEfetivoChecklistArea,
  canEditEfetivoCommercial,
  requireJobRolePatchAccess,
  requireEfetivoManager,
  requireEfetivoViewer
} from '../src/lib/efetivo/access.js';

function runGuard(guard, user, body = undefined) {
  let nextCalled = false;
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  guard({ auth: user ? { user } : null, body }, res, () => { nextCalled = true; });
  return { nextCalled, statusCode: res.statusCode, body: res.body };
}

const viewer = { accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] };
const manager = { accountType: 'INTERNAL', moduleRoles: ['efetivo:manager'] };
const unrelated = { accountType: 'INTERNAL', moduleRoles: ['acompanhamento:manager'] };
const admin = { accountType: 'ADMIN', moduleRoles: [] };
const commercial = { accountType: 'INTERNAL', moduleRoles: ['efetivo:commercial'] };
const operations = { accountType: 'INTERNAL', moduleRoles: ['efetivo:operations'] };
const administrative = { accountType: 'INTERNAL', moduleRoles: ['efetivo:administrative'] };

test('viewer lê o indicador, mas não passa pelos guards das rotas de escrita', () => {
  assert.equal(runGuard(requireEfetivoViewer, viewer).nextCalled, true);
  assert.equal(runGuard(requireEfetivoManager, viewer).statusCode, 403);
});

test('comercial lê o Efetivo e edita somente a frente comercial', () => {
  assert.equal(runGuard(requireEfetivoViewer, commercial).nextCalled, true);
  assert.equal(runGuard(requireEfetivoManager, commercial).statusCode, 403);
  assert.equal(canEditEfetivoCommercial(commercial), true);
  assert.equal(canEditEfetivoCommercial(viewer), false);
  assert.equal(canEditEfetivoCommercial(manager), true);
  assert.equal(canEditEfetivoCommercial(admin), true);
});

test('papéis de área acessam o módulo e editam somente as seções correspondentes', () => {
  assert.equal(runGuard(requireEfetivoViewer, operations).nextCalled, true);
  assert.equal(runGuard(requireEfetivoViewer, administrative).nextCalled, true);
  assert.equal(runGuard(requireEfetivoManager, operations).statusCode, 403);
  assert.equal(canEditEfetivoChecklistArea(operations, ['efetivo:operations']), true);
  assert.equal(canEditEfetivoChecklistArea(operations, ['efetivo:assets']), false);
  assert.equal(canEditEfetivoChecklistArea(administrative, ['efetivo:administrative']), true);
});

test('somente manager do Efetivo ou admin altera referência e função operacional', () => {
  assert.equal(runGuard(requireEfetivoManager, manager).nextCalled, true);
  assert.equal(runGuard(requireEfetivoManager, admin).nextCalled, true);
  assert.equal(runGuard(requireEfetivoManager, unrelated).statusCode, 403);
});

test('usuário sem papel do módulo recebe 403 até para leitura', () => {
  assert.equal(runGuard(requireEfetivoViewer, unrelated).statusCode, 403);
  assert.equal(runGuard(requireEfetivoViewer, null).statusCode, 403);
});

test('alteração de função operacional exige Efetivo manager e preserva o guard padrão dos demais campos', () => {
  const rdoManager = { accountType: 'ADMIN', moduleRoles: ['rdo:manager'] };
  const bothManagers = { accountType: 'ADMIN', moduleRoles: ['rdo:manager', 'efetivo:manager'] };

  assert.equal(runGuard(requireJobRolePatchAccess, manager, { isOperational: false }).nextCalled, true);
  assert.equal(runGuard(requireJobRolePatchAccess, viewer, { isOperational: false }).statusCode, 403);
  assert.equal(runGuard(requireJobRolePatchAccess, rdoManager, { name: 'Novo cargo' }).nextCalled, true);
  assert.equal(runGuard(requireJobRolePatchAccess, manager, { name: 'Novo cargo' }).statusCode, 403);
  assert.equal(runGuard(requireJobRolePatchAccess, bothManagers, { name: 'Novo cargo', isOperational: false }).nextCalled, true);
});
