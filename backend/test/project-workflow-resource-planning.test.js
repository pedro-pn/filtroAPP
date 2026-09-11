import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEquipmentPlanningCatalog,
  buildLogisticsPlanning,
  buildSupplyPlanning,
  emptyProjectWorkflowResourcePlanning,
  equipmentAssignmentsAt
} from '../src/lib/efetivo/project-workflow/resource-planning.js';

function movement({ equipmentId, projectId, type = 'OUTBOUND', date, demobilizationDate = null }) {
  return {
    projectId,
    type,
    romaneioDate: new Date(`${date}T00:00:00Z`),
    createdAt: new Date(`${date}T10:00:00Z`),
    project: { code: projectId.toUpperCase(), name: `Projeto ${projectId}`, demobilizationDate },
    items: [{ quantity: 1, catalogItem: { sourceId: equipmentId } }]
  };
}

test('saldo de romaneios considera saídas e entradas até a data da mobilização', () => {
  const assignments = equipmentAssignmentsAt([
    movement({ equipmentId: 'equipment-1', projectId: 'project-a', date: '2026-09-01' }),
    movement({ equipmentId: 'equipment-1', projectId: 'project-a', type: 'INBOUND', date: '2026-09-10' }),
    movement({ equipmentId: 'equipment-2', projectId: 'project-b', date: '2026-09-05' }),
    movement({ equipmentId: 'equipment-2', projectId: 'project-b', type: 'INBOUND', date: '2026-09-25' })
  ], '2026-09-20');
  assert.equal(assignments.has('equipment-1'), false);
  assert.equal(assignments.get('equipment-2')[0].projectId, 'project-b');
});

test('catálogo antecipa disponibilidade, calibração e manutenção na mobilização', () => {
  const categories = [{
    id: 'category-1',
    name: 'Bombas',
    order: 1,
    supportsCalibration: true,
    maintenanceIntervalDays: 30,
    equipment: [
      {
        id: 'equipment-1', code: 'B-01', name: 'Bomba 1', hasCalibration: true,
        expiresAt: new Date('2026-10-20T00:00:00Z'),
        maintenanceRecords: [{ id: 'maintenance-1', maintenanceDate: new Date('2026-09-01T00:00:00Z') }]
      },
      {
        id: 'equipment-2', code: 'B-02', name: 'Bomba 2', hasCalibration: true,
        expiresAt: new Date('2026-09-10T00:00:00Z'),
        maintenanceRecords: [{ id: 'maintenance-2', maintenanceDate: new Date('2026-07-01T00:00:00Z') }]
      },
      {
        id: 'equipment-3', code: 'B-03', name: 'Bomba 3', hasCalibration: false,
        expiresAt: null, maintenanceRecords: []
      }
    ]
  }];
  const catalog = buildEquipmentPlanningCatalog(categories, [
    movement({ equipmentId: 'equipment-2', projectId: 'project-b', date: '2026-09-01', demobilizationDate: new Date('2026-09-18T00:00:00Z') }),
    movement({ equipmentId: 'equipment-3', projectId: 'project-c', date: '2026-09-01' })
  ], '2026-09-20');
  assert.equal(catalog[0].availableCount, 2);
  assert.equal(catalog[0].equipment[0].availabilityStatus, 'AVAILABLE');
  assert.equal(catalog[0].equipment[0].calibration.status, 'VALID');
  assert.equal(catalog[0].equipment[0].maintenance.status, 'UPCOMING');
  assert.equal(catalog[0].equipment[1].availabilityStatus, 'EXPECTED_RETURN');
  assert.equal(catalog[0].equipment[1].calibration.status, 'EXPIRED');
  assert.equal(catalog[0].equipment[1].maintenance.status, 'OVERDUE');
  assert.equal(catalog[0].equipment[2].availabilityStatus, 'ALLOCATED');
  assert.equal(catalog[0].equipment[2].calibration.status, 'MISSING');
  assert.equal(catalog[0].equipment[2].maintenance.status, 'NO_HISTORY');
  const ownProjectCatalog = buildEquipmentPlanningCatalog(categories, [
    movement({ equipmentId: 'equipment-3', projectId: 'project-c', date: '2026-09-01' })
  ], '2026-09-20', 'project-c');
  assert.equal(ownProjectCatalog[0].equipment[2].availabilityStatus, 'AVAILABLE');
});

test('planejamento vazio mantém decisões de Sim e Não sem assumir resposta', () => {
  const planning = emptyProjectWorkflowResourcePlanning({
    teamPlanDefined: null,
    equipmentPlanDefined: false,
    supplyPlanDefined: null,
    teamDemands: [],
    equipmentCategoryPlans: [],
    supplyPlan: [],
    logisticsPlan: {}
  });
  assert.equal(planning.team.defined, null);
  assert.equal(planning.equipment.defined, false);
  assert.deepEqual(planning.team.demands, []);
  assert.deepEqual(planning.equipment.categoryIds, []);
  assert.deepEqual(planning.equipment.equipmentIds, []);
  assert.deepEqual(planning.equipment.selections, []);
  assert.equal(planning.supplies.defined, null);
  assert.deepEqual(planning.supplies.items, []);
  assert.equal(planning.logistics.vehicleRequired, null);
  assert.equal(planning.logistics.freightRequired, null);
  assert.equal(planning.logistics.lodgingRequired, null);
  assert.equal(planning.logistics.complete, false);
  assert.deepEqual(planning.logistics.warnings, []);
});

test('insumos calculam falta de estoque sem transformar compra em bloqueio', () => {
  const planning = buildSupplyPlanning({
    supplyPlanDefined: true,
    supplyPlan: [
      { id: 'stock-item-1', stockItemId: 'item-1', type: 'FILTRO', name: 'Nome antigo', unitLabel: 'kg', requiredQuantity: 6, requestedAt: '2026-09-10', purchasedAt: null },
      { id: 'custom-1', stockItemId: null, type: 'PRODUTO_QUIMICO', name: 'Produto especial', unitLabel: 'L', requiredQuantity: 2, requestedAt: null, purchasedAt: null }
    ]
  }, [{ id: 'item-1', type: 'FILTRO', code: 'F-001', name: 'Filtro 10 µm', unitLabel: 'un', balance: 4 }]);
  assert.equal(planning.defined, true);
  assert.equal(planning.items[0].name, 'Filtro 10 µm');
  assert.equal(planning.items[0].shortageQuantity, 2);
  assert.equal(planning.items[0].purchaseRequired, true);
  assert.equal(planning.items[1].purchaseRequired, true);
  assert.equal(planning.purchasePendingCount, 2);
});

test('logística separa pendências de planejamento dos avisos de acompanhamento', () => {
  let planning = buildLogisticsPlanning({}, '2026-09-29');
  assert.equal(planning.complete, false);
  assert.equal(planning.issues.length, 3);
  planning = buildLogisticsPlanning({
    logisticsPlan: {
      vehicleRequired: true,
      vehicleQuantity: 1,
      vehicleType: 'CAMINHAO',
      freightRequired: false,
      lodgingRequired: true,
      lodgingPeopleCount: 4,
      lodgingExpectedDate: null,
      lodgingRequested: false
    }
  }, '2026-09-29');
  assert.equal(planning.complete, true);
  assert.equal(planning.lodgingExpectedDate, '2026-09-29');
  assert.deepEqual(planning.issues, []);
  assert.deepEqual(planning.warnings, ['Hospedagem ainda não solicitada']);
});
