import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_COMMERCIAL_FACTS
} from '../../shared/schemas/project-workflow.js';
import {
  assertRomaneioMobilizationAuthorized,
  romaneioProjectAvailableForType,
  romaneioProjectListWhereForUser
} from '../src/routes/resources/romaneios.js';

function authorizedWorkflow(overrides = {}) {
  return {
    projectId: 'managed-authorized',
    stage: 'READY_TO_MOBILIZE',
    version: 3,
    mobilizationAuthorizedAt: new Date('2026-09-09T12:00:00.000Z'),
    mobilizationAuthorizationVersion: 3,
    checklists: PROJECT_WORKFLOW_CHECKLISTS.map(item => ({ key: item.key, status: 'DONE' })),
    commercialFacts: PROJECT_WORKFLOW_COMMERCIAL_FACTS.map(item => ({
      key: item.key,
      status: 'CONFIRMED',
      source: 'MANUAL',
      occurredOn: new Date('2026-09-08T12:00:00.000Z'),
      reference: item.evidence === 'reference' ? 'PO-123' : null,
      note: item.evidence === 'note' ? 'Condição definida' : null
    })),
    issues: [],
    ...overrides
  };
}

test('Saída lista gerenciado autorizado e legado ativo', () => {
  assert.equal(romaneioProjectAvailableForType({
    id: 'managed-authorized', isActive: true, workflow: authorizedWorkflow()
  }, 'OUTBOUND'), true);
  assert.equal(romaneioProjectAvailableForType({
    id: 'managed-blocked', isActive: true, workflow: authorizedWorkflow({
      projectId: 'managed-blocked', mobilizationAuthorizationVersion: 2
    })
  }, 'OUTBOUND'), false);
  assert.equal(romaneioProjectAvailableForType({ id: 'legacy-active', isActive: true, workflow: null }, 'OUTBOUND'), true);
  assert.equal(romaneioProjectAvailableForType({ id: 'legacy-finished', isActive: false, workflow: null }, 'OUTBOUND'), false);
  assert.equal(romaneioProjectAvailableForType({
    id: 'managed-executing', isActive: true, workflow: authorizedWorkflow({ projectId: 'managed-executing', stage: 'EXECUTION' })
  }, 'OUTBOUND'), true);
});

test('Entrada aceita gerenciado bloqueado e legado concluído', () => {
  assert.equal(romaneioProjectAvailableForType({
    id: 'managed-blocked', isActive: false, workflow: authorizedWorkflow({ stage: 'PREPARATION' })
  }, 'INBOUND'), true);
  assert.equal(romaneioProjectAvailableForType({ id: 'legacy-finished', isActive: false, workflow: null }, 'INBOUND'), true);
});

test('consultas tipadas preservam visibilidade e pré-selecionam candidatos de Saída', () => {
  assert.deepEqual(
    romaneioProjectListWhereForUser({ role: 'COORDINATOR' }, undefined, 'OUTBOUND'),
    {
      deletedAt: null,
      managerOnly: false,
      OR: [{ isActive: true }, { workflow: { isNot: null } }]
    }
  );
  assert.deepEqual(
    romaneioProjectListWhereForUser({ role: 'COORDINATOR' }, undefined, 'INBOUND'),
    { deletedAt: null, managerOnly: false }
  );
});

test('Saída direta rejeita legado concluído e Entrada não consulta o gate', async () => {
  const calls = [];
  const database = {
    projectWorkflow: { findUnique: async () => { calls.push('workflow'); return null; } },
    project: { findUnique: async () => { calls.push('project'); return { isActive: false }; } }
  };
  await assert.rejects(
    assertRomaneioMobilizationAuthorized('OUTBOUND', 'legacy-finished', database),
    error => error.statusCode === 409 && error.code === 'ROMANEIO_OUTBOUND_PROJECT_NOT_AVAILABLE'
  );
  assert.deepEqual(calls, ['workflow', 'project']);
  calls.length = 0;
  assert.equal(await assertRomaneioMobilizationAuthorized('INBOUND', 'legacy-finished', database), null);
  assert.deepEqual(calls, []);
});

test('rotas de gravação não criam obra pendente para código ausente', () => {
  const source = fs.readFileSync(new URL('../src/routes/resources/romaneios.js', import.meta.url), 'utf8');
  const createRoute = source.slice(source.indexOf("router.post('/',"), source.indexOf("router.put('/:id'"));
  const updateRoute = source.slice(source.indexOf("router.put('/:id'"));
  assert.match(createRoute, /createPending:\s*false/);
  assert.match(updateRoute, /createPending:\s*false/);
});
