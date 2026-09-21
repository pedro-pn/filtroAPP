import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyProjectWorkflowResourcePlanning,
  loadProjectWorkflowResourcePlanning,
  resourceReferenceDate
} from '../src/lib/efetivo/project-workflow/resource-planning.js';

function fakeDatabase() {
  return {
    jobRole: {
      findMany: async () => [{ id: 'role-1', name: 'Operador', calendarColor: '#123456', order: 1, isActive: true, isOperational: true }]
    },
    collaborator: {
      findMany: async () => [{ id: 'collab-1', name: 'Ana', jobRoleId: 'role-1', admissionDate: null, terminationDate: null, isActive: true }]
    },
    equipmentCategory: {
      findMany: async () => [{
        id: 'category-1',
        name: 'Bombas',
        order: 1,
        supportsCalibration: false,
        showInMaintenance: false,
        maintenanceIntervalDays: null,
        maintenanceProfile: null,
        equipment: [{ id: 'equipment-1', code: 'BOM-01', name: 'Bomba 1', hasCalibration: false, expiresAt: null, maintenanceProfileOverride: null, maintenanceProfile: null, maintenanceRecords: [] }]
      }]
    },
    stockItem: {
      findMany: async () => [{ id: 'stock-1', type: 'FILTRO', code: 'FIL-1', name: 'Filtro', unitLabel: 'un', category: { name: 'Filtros' } }]
    }
  };
}

test('data de referência usa a mobilização prevista, depois a previsão comercial e por fim hoje', () => {
  assert.deepEqual(resourceReferenceDate({ plannedMobilizationDate: new Date('2026-10-05T00:00:00Z'), commercialExpectedStartDate: '2026-11-01' }, '2026-09-21'), { date: '2026-10-05', source: 'PLANNED' });
  assert.deepEqual(resourceReferenceDate({ commercialExpectedMobilizationDate: '2026-10-20', commercialExpectedStartDate: '2026-11-01' }, '2026-09-21'), { date: '2026-10-20', source: 'COMMERCIAL' });
  assert.deepEqual(resourceReferenceDate({ commercialExpectedStartDate: '2026-11-01' }, '2026-09-21'), { date: '2026-11-01', source: 'COMMERCIAL' });
  assert.deepEqual(resourceReferenceDate({}, '2026-09-21'), { date: '2026-09-21', source: 'TODAY' });
});

test('projeto sem mobilização prevista ainda recebe cargos, equipamentos e insumos para planejar', async () => {
  const workflow = { projectId: 'project-1', stage: 'MOBILIZATION_PLANNING', plannedMobilizationDate: null, teamDemands: [], equipmentCategoryPlans: [], supplyPlan: [] };
  const planning = await loadProjectWorkflowResourcePlanning(fakeDatabase(), workflow, { today: '2026-09-21' });

  assert.equal(planning.targetDate, null);
  assert.equal(planning.referenceDate, '2026-09-21');
  assert.equal(planning.referenceDateSource, 'TODAY');
  assert.deepEqual(planning.team.catalog.map(role => role.id), ['role-1']);
  assert.deepEqual(planning.equipment.catalog.map(category => category.id), ['category-1']);
  assert.equal(planning.equipment.catalog[0].equipment.length, 1);
  assert.deepEqual(planning.supplies.catalog.map(item => item.id), ['stock-1']);
  // a logística não recebe data prevista inventada
  assert.equal(planning.logistics.lodgingExpectedDate, null);
});

test('previsão comercial vira a referência quando não há mobilização operacional prevista', async () => {
  const workflow = { projectId: 'project-1', stage: 'MOBILIZATION_PLANNING', plannedMobilizationDate: null, commercialExpectedStartDate: '2026-11-03', teamDemands: [], equipmentCategoryPlans: [], supplyPlan: [] };
  const planning = await loadProjectWorkflowResourcePlanning(fakeDatabase(), workflow, { today: '2026-09-21' });
  assert.equal(planning.referenceDate, '2026-11-03');
  assert.equal(planning.referenceDateSource, 'COMMERCIAL');
  assert.equal(planning.team.catalog.length, 1);
});

test('com mobilização prevista o comportamento continua o mesmo', async () => {
  const workflow = { projectId: 'project-1', stage: 'MOBILIZATION_PLANNING', plannedMobilizationDate: new Date('2026-10-05T00:00:00Z'), teamDemands: [], equipmentCategoryPlans: [], supplyPlan: [] };
  const planning = await loadProjectWorkflowResourcePlanning(fakeDatabase(), workflow, { today: '2026-09-21' });
  assert.equal(planning.targetDate, '2026-10-05');
  assert.equal(planning.referenceDate, '2026-10-05');
  assert.equal(planning.referenceDateSource, 'PLANNED');
  assert.equal(planning.team.catalog.length, 1);
  assert.equal(emptyProjectWorkflowResourcePlanning(workflow).team.catalog.length, 0);
});
