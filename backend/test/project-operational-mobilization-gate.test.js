import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_COMMERCIAL_FACTS
} from '../../shared/schemas/project-workflow.js';
import {
  assertProjectMobilizationAuthorized,
  projectOperationalMobilizationDecision
} from '../src/lib/efetivo/project-workflow/operational-gate.js';

export function managedWorkflow(overrides = {}) {
  return {
    projectId: 'project-1',
    stage: 'READY_TO_MOBILIZE',
    version: 7,
    mobilizationAuthorizedAt: new Date('2026-09-09T12:00:00.000Z'),
    mobilizationAuthorizationVersion: 7,
    checklists: PROJECT_WORKFLOW_CHECKLISTS.map(item => ({ key: item.key, status: 'DONE' })),
    commercialFacts: PROJECT_WORKFLOW_COMMERCIAL_FACTS.map(item => ({
      key: item.key,
      status: 'CONFIRMED',
      source: 'MANUAL',
      occurredOn: new Date('2026-09-08T00:00:00.000Z'),
      reference: item.evidence === 'reference' ? 'DOC-1' : null,
      note: item.evidence === 'note' ? 'Condição definida' : null
    })),
    documentationCategories: ['DOCUMENT', 'EXAM', 'TRAINING', 'CERTIFICATION'].map(type => ({ type, required: false, requirements: [] })),
    issues: [],
    ...overrides
  };
}

function database(workflow) {
  return { projectWorkflow: { findUnique: async () => workflow } };
}

test('projeto sem gestão permanece no modo legado não controlado', async () => {
  const decision = await projectOperationalMobilizationDecision(database(null), 'project-1');
  assert.equal(decision.status, 'LEGACY_NOT_ENFORCED');
  assert.equal(decision.enforced, false);
  assert.equal(decision.allowed, true);
});

test('autorização vigente libera a operação do projeto gerenciado', async () => {
  const decision = await assertProjectMobilizationAuthorized(database(managedWorkflow()), 'project-1');
  assert.equal(decision.status, 'AUTHORIZED');
  assert.equal(decision.enforced, true);
  assert.equal(decision.allowed, true);
  assert.equal(decision.authorizationStatus, 'AUTHORIZED');
});

test('autorização vigente também libera operações durante a execução', async () => {
  const mobilizing = await assertProjectMobilizationAuthorized(database(managedWorkflow({ stage: 'MOBILIZATION' })), 'project-1');
  assert.equal(mobilizing.status, 'AUTHORIZED');
  const decision = await assertProjectMobilizationAuthorized(database(managedWorkflow({ stage: 'EXECUTION' })), 'project-1');
  assert.equal(decision.status, 'AUTHORIZED');
  assert.equal(decision.allowed, true);
});

test('desmobilização encerra a autorização para novas saídas operacionais', async () => {
  const decision = await projectOperationalMobilizationDecision(database(managedWorkflow({ stage: 'DEMOBILIZATION' })), 'project-1');
  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.allowed, false);
  assert.equal(decision.authorizationStatus, 'SUSPENDED');
});

test('autorização suspensa bloqueia com contrato uniforme e explicável', async () => {
  await assert.rejects(
    assertProjectMobilizationAuthorized(database(managedWorkflow({ version: 8 })), 'project-1'),
    error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'PROJECT_MOBILIZATION_NOT_AUTHORIZED');
      assert.match(error.message, /Gestão de Projetos/);
      assert.ok(error.issues.some(issue => /revalid/i.test(issue.message)));
      assert.equal(error.mobilizationControl.authorizationStatus, 'SUSPENDED');
      return true;
    }
  );
});

test('gate incompleto informa os bloqueios sem aceitar data histórica', async () => {
  const workflow = managedWorkflow({
    stage: 'PREPARATION',
    version: 9,
    checklists: managedWorkflow().checklists.filter(item => item.key !== 'D15_QSMS_RELEASE_CONFIRMED')
  });
  const decision = await projectOperationalMobilizationDecision(database(workflow), 'project-1');
  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.allowed, false);
  assert.equal(decision.authorizationStatus, 'SUSPENDED');
  assert.ok(decision.blockers.some(item => item.key === 'D15_QSMS_RELEASE_CONFIRMED'));
});

test('romaneio valida saída antes de gerar arquivos e preserva entrada', () => {
  const source = fs.readFileSync(new URL('../src/routes/resources/romaneios.js', import.meta.url), 'utf8');
  const createRoute = source.slice(source.indexOf("router.post('/',"), source.indexOf("router.put('/:id'"));
  const updateRoute = source.slice(source.indexOf("router.put('/:id'"));
  assert.match(createRoute, /assertRomaneioMobilizationAuthorized/);
  assert.match(updateRoute, /assertRomaneioMobilizationAuthorized/);
  assert.ok(createRoute.indexOf('assertRomaneioMobilizationAuthorized') < createRoute.indexOf('saveRomaneioPdf(preview)'));
  assert.ok(updateRoute.indexOf('assertRomaneioMobilizationAuthorized') < updateRoute.indexOf('saveRomaneioPdf(preview)'));
  assert.match(source, /payload\.type === 'OUTBOUND'/);
});
