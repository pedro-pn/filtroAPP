import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultCostEstimatePayload, normalizeCostEstimatePayload, calculateEstimate, validateCostEstimate, hasCompleteCircuitServices } from '../../shared/comercial/dist/cost-model.js';
import { servicesForDimensioning, OIL_TYPES } from '../../shared/comercial/dist/dimensioning.js';
import { TECHNICAL_SERVICE_CATALOG } from '../../shared/comercial/dist/technical-services.js';
import { linhasDaPlanilha } from '../src/lib/comercial/cost-csv.js';

function fixture() {
  const draft = createDefaultCostEstimatePayload();
  draft.volumeSystems[0].name = 'Prensa';
  draft.volumeSystems[0].equipmentVolumes = [{ id: 'e1', description: 'Trocador', material: 'stainless_steel', quantity: 2, volumeLiters: 100, included: true, serviceIds: ['limpeza_quimica', 'boroscopia'] }];
  draft.volumeSystems[0].reservoirVolumes = [{ id: 'r1', description: 'Tanque', material: 'carbon_steel', quantity: 3, volumeLiters: 50, included: true, serviceIds: ['limpeza_reservatorio'] }];
  draft.volumeSystems[0].manualVolumes = [{ id: 'o1', description: 'Carga de óleo', quantity: 1, volumeLiters: 1000, oilType: 'Óleo lubrificante', oilBrandViscosity: 'Marca ISO VG 46', serviceIds: ['filtragem_hidraulico_lubrificante', 'desidratacao_oleo'] }];
  draft.products = [{ ...draft.products[0], systemId: '*', dose: 10, unitCost: 1 }];
  draft.filters = [{ ...draft.filters[0], quantity: 2, unitCost: 10, included: true }];
  return draft;
}

test('um único circuito inicial sem nome ou itens predefinidos', () => {
  const draft = createDefaultCostEstimatePayload();
  assert.equal(draft.volumeSystems.length, 1);
  assert.equal(draft.volumeSystems[0].name, '');
  for (const key of ['pipeSegments', 'hoseSegments', 'equipmentVolumes', 'reservoirVolumes', 'manualVolumes']) assert.deepEqual(draft.volumeSystems[0][key], []);
});

test('catálogos correspondem exatamente aos tipos solicitados', () => {
  const ids = type => servicesForDimensioning(type).map(item => item.id).sort();
  assert.deepEqual(ids('pipes'), ['limpeza_quimica', 'teste_hidrostatico', 'flushing_primario', 'flushing_secundario', 'flushing_agua', 'hidrojateamento', 'boroscopia', 'passagem_pig'].sort());
  assert.deepEqual(ids('reservoirs'), ['limpeza_quimica', 'teste_hidrostatico', 'hidrojateamento', 'boroscopia', 'limpeza_reservatorio'].sort());
  assert.deepEqual(ids('equipment'), TECHNICAL_SERVICE_CATALOG.map(item => item.id).sort());
  assert.deepEqual(ids('oil'), TECHNICAL_SERVICE_CATALOG.filter(item => /^(filtragem|desidratacao)_/.test(item.id)).map(item => item.id).sort());
  assert.equal(OIL_TYPES.length, 5);
});

test('normalização preserva sistemas, materiais, óleo e serviços e é idempotente', () => {
  const normal = normalizeCostEstimatePayload(fixture());
  assert.equal(normal.volumeSystems[0].equipmentVolumes[0].material, 'stainless_steel');
  assert.equal(normal.volumeSystems[0].manualVolumes[0].oilBrandViscosity, 'Marca ISO VG 46');
  assert.equal(normal.circuitServices.length, 5);
  assert.equal(normal.circuitServices[0].itemId, 'r1');
  assert.deepEqual(normalizeCostEstimatePayload(normal), normal);
});

test('reservatórios e equipamentos somam quantidade × volume, óleo soma seu volume', () => {
  const draft = fixture();
  draft.volumeSystems[0].cycles = 2;
  const result = calculateEstimate(draft);
  assert.equal(result.volumeResults[0].reservoirVolumeLiters, 150);
  assert.equal(result.volumeResults[0].physicalVolumeLiters, 1350);
  assert.equal(result.totalVolumeLiters, 2700);
});

test('planilha exporta reservatórios, equipamentos e óleo com materiais e serviços por sistema', () => {
  const rows = linhasDaPlanilha({ payload: fixture() });
  const header = rows.find(row => row[0] === 'CIRCUITO');
  const reservoir = rows.find(row => row[1] === 'Reservatório');
  const equipment = rows.find(row => row[1] === 'Equipamento avulso');
  const oil = rows.find(row => row[1] === 'Volume de óleo');
  for (const row of [reservoir, equipment, oil]) assert.equal(row.length, header.length);
  assert.equal(reservoir[2], 'Tanque');
  assert.equal(reservoir[header.indexOf('VOLUME (L)')], 150);
  assert.equal(equipment[header.indexOf('MATERIAL')], 'Aço inox');
  assert.match(equipment[header.indexOf('SERVIÇOS')], /Limpeza química, Boroscopia/);
  assert.equal(oil[header.indexOf('TIPO DE ÓLEO')], 'Óleo lubrificante');
  assert.equal(oil[header.indexOf('MARCA / VISCOSIDADE')], 'Marca ISO VG 46');
});

test('produto químico usa somente sistemas com limpeza, sem dosar óleo ou tanque com outro serviço', () => {
  const draft = fixture();
  draft.volumeSystems[0].cycles = 2;
  const result = calculateEstimate(draft);
  assert.equal(result.productResults[0].sourceVolumeLiters, 400);
  assert.equal(result.productResults[0].requiredQuantity, 40);
  assert.equal(result.filterCost, 20);
});

test('retirar serviço ou sistema remove insumos e associações derivadas sem dados fantasma', () => {
  const draft = fixture();
  draft.circuitServices = normalizeCostEstimatePayload(draft).circuitServices;
  draft.volumeSystems[0].equipmentVolumes = [];
  draft.volumeSystems[0].manualVolumes[0].serviceIds = ['desidratacao_oleo'];
  const normal = normalizeCostEstimatePayload(draft);
  const result = calculateEstimate(normal);
  assert.equal(normal.circuitServices.length, 2);
  assert.equal(result.productResults.length, 0);
  assert.equal(result.filterCost, 0);
});

test('limpeza em dois sistemas do mesmo circuito é permitida sem duplicar volumes', () => {
  const draft = fixture();
  draft.volumeSystems[0].reservoirVolumes[0].serviceIds = ['limpeza_quimica'];
  assert.equal(calculateEstimate(draft).productResults[0].sourceVolumeLiters, 350);
  assert.equal(validateCostEstimate(draft).errors.some(item => item.path.startsWith('circuitServices')), false);
});

test('cada sistema exige nome e serviços próprios, com caminhos de campo', () => {
  const draft = fixture();
  draft.volumeSystems[0].reservoirVolumes[0].description = '';
  draft.volumeSystems[0].reservoirVolumes[0].serviceIds = [];
  const paths = validateCostEstimate(draft).errors.map(item => item.path);
  assert.ok(paths.includes('volumeSystems[0].reservoirVolumes[0].description'));
  assert.ok(paths.includes('volumeSystems[0].reservoirVolumes[0].serviceIds'));
  assert.equal(hasCompleteCircuitServices(draft), false);
  assert.equal(normalizeCostEstimatePayload(draft).volumeSystems[0].reservoirVolumes[0].description, '');
});

test('API recusa serviço incompatível e não cobra químicos para óleo', () => {
  const draft = fixture();
  draft.volumeSystems[0].equipmentVolumes = [];
  draft.volumeSystems[0].manualVolumes[0].serviceIds = ['limpeza_quimica'];
  assert.ok(validateCostEstimate(draft).errors.some(item => item.path === 'volumeSystems[0].manualVolumes[0].serviceIds'));
  assert.equal(calculateEstimate(draft).productResults.length, 0);
  assert.equal(hasCompleteCircuitServices(draft), false);
});

test('óleo exige tipo válido, múltiplos serviços não podem ser repetidos', () => {
  const draft = fixture();
  draft.volumeSystems[0].manualVolumes[0].oilType = '';
  draft.volumeSystems[0].equipmentVolumes[0].serviceIds = ['limpeza_quimica', 'limpeza_quimica'];
  const paths = validateCostEstimate(draft).errors.map(item => item.path);
  assert.ok(paths.includes('volumeSystems[0].manualVolumes[0].oilType'));
  assert.ok(paths.includes('volumeSystems[0].equipmentVolumes[0].serviceIds'));
});

test('circuito desativado não libera nem cobra insumos; sem insumos dispensa circuito vazio', () => {
  const draft = fixture();
  draft.volumeSystems[0].enabled = false;
  assert.equal(calculateEstimate(draft).productResults.length, 0);
  assert.equal(calculateEstimate(draft).filterCost, 0);
  const empty = createDefaultCostEstimatePayload();
  empty.scopeConfirmations.noInputs = true;
  assert.equal(hasCompleteCircuitServices(empty), true);
});
