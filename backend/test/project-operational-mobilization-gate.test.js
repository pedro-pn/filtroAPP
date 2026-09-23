import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_CLIENT_RELEASES,
  PROJECT_WORKFLOW_COMMERCIAL_FACTS,
  PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS,
  PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS
} from '../../shared/schemas/project-workflow.js';
import {
  assertProjectMobilizationAuthorized,
  projectOperationalMobilizationDecision,
  PROJECT_OPERATIONAL_GATE_INCLUDE
} from '../src/lib/efetivo/project-workflow/operational-gate.js';

export function managedWorkflow(overrides = {}) {
  return {
    projectId: 'project-1',
    // Sem "Pronto para mobilizar": a autorização não é mais um flag fixo, é o gate reavaliado a cada consulta.
    stage: 'MOBILIZATION',
    version: 7,
    preJobScheduledDate: new Date('2026-09-09T00:00:00.000Z'),
    preJobCompletedDate: new Date('2026-09-10T00:00:00.000Z'),
    qsmsVerified: true,
    qsmsVerificationNote: 'APR e requisitos específicos do cliente verificados.',
    logisticsPlan: { lodgingRequired: true },
    travelPlan: {
      lodgingRequestedDate: '2026-09-09',
      lodgingConfirmedDate: '2026-09-10',
      teamTransportDefined: true,
      teamTransportMode: 'OWN',
      teamTransportVehicleType: 'PICKUP',
      teamTransportQuantity: 1,
      freightDefined: true,
      freightMode: 'THIRD_PARTY',
      freightVehicleType: 'TRUCK',
      freightQuantity: 1,
      freightDepartureDate: '2026-09-14',
      freightDepartureTime: '08:00'
    },
    checklists: PROJECT_WORKFLOW_CHECKLISTS.map(item => ({ key: item.key, status: 'DONE' })),
    commercialFacts: PROJECT_WORKFLOW_COMMERCIAL_FACTS.map(item => ({
      key: item.key,
      status: 'CONFIRMED',
      source: 'MANUAL',
      occurredOn: new Date('2026-09-08T00:00:00.000Z'),
      reference: item.evidence === 'reference' ? 'DOC-1' : null,
      note: item.evidence === 'note' ? 'Condição definida' : null
    })),
    documentationCategories: ['DOCUMENT', 'EXAM', 'TRAINING', 'QUALITY', 'CERTIFICATION'].map(type => ({ type, required: false, requirements: [] })),
    teamPreparation: {
      defined: true,
      members: [{ collaboratorId: 'collaborator-1', name: 'João', checks: PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS.map(item => ({ ...item, status: 'DONE' })) }]
    },
    clientReleases: {
      attendance: { date: '2026-09-15', confirmed: true },
      items: PROJECT_WORKFLOW_CLIENT_RELEASES.map(item => ({ ...item, requested: true, requestedAt: '2026-09-09', requestedTo: 'Portaria', completed: true, completedAt: '2026-09-10' }))
    },
    preparationResources: {
      equipment: {
        defined: true,
        items: [{ id: 'equipment-1', name: 'Bomba 1', checks: PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS.EQUIPMENT.map(item => ({ ...item, status: 'DONE' })) }]
      },
      materials: {
        defined: true,
        items: [{ id: 'material-1', name: 'Filtro 10 µm', checks: PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS.MATERIAL.map(item => ({ ...item, status: 'DONE' })) }]
      }
    },
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

test('consulta operacional reconstrói as conferências individuais persistidas', async () => {
  const workflow = managedWorkflow();
  delete workflow.preparationResources;
  workflow.equipmentCategoryPlans = [{ equipmentIds: ['equipment-1'] }];
  workflow.supplyPlan = [{ id: 'material-1', name: 'Filtro 10 µm' }];
  workflow.preparationItemChecks = [
    ...PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS.EQUIPMENT.map(item => ({ itemType: 'EQUIPMENT', itemId: 'equipment-1', key: item.key, status: 'DONE' })),
    ...PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS.MATERIAL.map(item => ({ itemType: 'MATERIAL', itemId: 'material-1', key: item.key, status: 'DONE' }))
  ];
  const decision = await assertProjectMobilizationAuthorized(database(workflow), 'project-1');
  assert.equal(decision.allowed, true);
  assert.ok(PROJECT_OPERATIONAL_GATE_INCLUDE.preparationItemChecks);
  assert.ok(PROJECT_OPERATIONAL_GATE_INCLUDE.equipmentCategoryPlans);
});

test('desmobilização encerra a autorização para novas saídas operacionais', async () => {
  const decision = await projectOperationalMobilizationDecision(database(managedWorkflow({ stage: 'DEMOBILIZATION' })), 'project-1');
  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.allowed, false);
  assert.equal(decision.authorizationStatus, 'NOT_AUTHORIZED');
});

test('projeto ainda em preparação bloqueia com contrato uniforme e explicável', async () => {
  await assert.rejects(
    assertProjectMobilizationAuthorized(database(managedWorkflow({ stage: 'PREPARATION' })), 'project-1'),
    error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'PROJECT_MOBILIZATION_NOT_AUTHORIZED');
      assert.match(error.message, /Gestão de Projetos/);
      assert.ok(error.issues.some(issue => /Gestão de Projetos/i.test(issue.message)));
      assert.equal(error.mobilizationControl.authorizationStatus, 'NOT_AUTHORIZED');
      return true;
    }
  );
});

test('gate incompleto informa os bloqueios sem aceitar data histórica', async () => {
  const workflow = managedWorkflow({
    stage: 'PREPARATION',
    version: 9,
    // marcado como verificado não basta mais registrar o que foi verificado: só reabrir a verificação bloqueia
    qsmsVerified: false
  });
  const decision = await projectOperationalMobilizationDecision(database(workflow), 'project-1');
  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.allowed, false);
  assert.equal(decision.authorizationStatus, 'NOT_AUTHORIZED');
  assert.ok(decision.blockers.some(item => item.key === 'QSMS_VERIFIED'));
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
