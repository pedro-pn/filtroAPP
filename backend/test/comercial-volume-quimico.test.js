import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateEstimate, createDefaultCostEstimatePayload, normalizeCostEstimatePayload, validateCostEstimate } from '../../shared/comercial/dist/cost-model.js';
import { chemicalPumpForDiameter } from '../../shared/comercial/dist/chemical-cleaning.js';
import { linhasDaPlanilha } from '../src/lib/comercial/cost-csv.js';

const pipe = (patch = {}) => ({ id: 'p1', description: 'Linha', material: 'carbon_steel',
  quantity: 1, lengthM: 50, lengthUnit: 'm', internalDiameterMm: 50.8, diameterUnit: 'in', fillPercent: 100,
  serviceIds: ['limpeza_quimica'], ...patch });
function fixture(pipes = [pipe()]) {
  const draft = createDefaultCostEstimatePayload();
  draft.volumeSystems[0].name = 'Prensa';
  draft.volumeSystems[0].pipeSegments = pipes;
  draft.products = [{ ...draft.products[0], systemId: '*', dose: 10, unitCost: 2 }];
  return draft;
}

test('limites das bombas: até 3", acima de 3" até 8", acima de 8", inclusive entrada em mm', () => {
  for (const [diameter, reservoir] of [[3 * 25.4,120],[76.2,120],[76.201,240],[8 * 25.4,240],[203.201,1000],[24 * 25.4,1000]]) {
    assert.equal(chemicalPumpForDiameter(diameter).reservoirLiters, reservoir);
  }
  for (const diameter of [0, -1, NaN, Infinity]) assert.equal(chemicalPumpForDiameter(diameter), undefined);
});

test('reproduz O43:R45/O47:R49 e L65/L68 da LEC nas seis combinações', () => {
  // Valores independentes, calculados com I43 = 3,14 × (mm/1000)² / 4 × 50 × 1000.
  const examples = [
    { diameter: 50.8, pipe: 101.29012, reservoir: 120, hose: 50, total: 271.29012 },
    { diameter: 203.2, pipe: 1620.64192, reservoir: 240, hose: 100, total: 1960.64192 },
    { diameter: 228.6, pipe: 2051.12493, reservoir: 1000, hose: 200, total: 3251.12493 },
  ];
  for (const material of ['carbon_steel', 'stainless_steel']) for (const example of examples) {
    const result = calculateEstimate(fixture([pipe({ material, internalDiameterMm: example.diameter })]));
    const volume = result.chemicalVolumeResults[0];
    assert.equal(volume.pipeVolumeLiters, example.pipe);
    assert.equal(volume.reservoirVolumeLiters, example.reservoir);
    assert.equal(volume.hoseVolumeLiters, example.hose);
    assert.equal(volume.totalVolumeLiters, example.total);
    assert.equal(volume.groups[0].material, material);
    assert.equal(result.productResults[0].sourceVolumeLiters, example.total);
    assert.ok(Math.abs(result.productResults[0].requiredQuantity - example.total * 0.1) < 1e-6);
    assert.equal(result.productResults[0].total, Math.round(example.total * 0.1 * 2 * 100) / 100);
    assert.equal(result.inputCost, result.productResults[0].total);
  }
});

test('arredonda sistemas para cima a cada 50 m sem criar um sistema vazio', () => {
  for (const [lengthM, count] of [[0,0],[0.1,1],[49.9,1],[50,1],[50.000001,2],[100,2],[101,3]]) {
    const volume = calculateEstimate(fixture([pipe({ lengthM })])).chemicalVolumeResults[0];
    assert.equal(volume.groups.reduce((sum, group) => sum + group.systemCount, 0), count);
    assert.equal(volume.reservoirVolumeLiters, 120 * count);
  }
});

test('soma quantidade × comprimento antes de arredondar, sem cobrar bomba por linha', () => {
  const result = calculateEstimate(fixture([
    pipe({ id: 'p1', lengthM: 15, quantity: 2 }),
    pipe({ id: 'p2', lengthM: 20, internalDiameterMm: 76.2 }),
  ]));
  assert.equal(result.chemicalVolumeResults[0].groups.length, 1);
  assert.equal(result.chemicalVolumeResults[0].groups[0].lengthM, 50);
  assert.equal(result.chemicalVolumeResults[0].groups[0].systemCount, 1);
});

test('não mistura materiais, faixas ou circuitos no arredondamento dos sistemas', () => {
  const draft = fixture([pipe({ lengthM: 20 }), pipe({ id: 'inox', lengthM: 20, material: 'stainless_steel' }),
    pipe({ id: 'maior', lengthM: 20, internalDiameterMm: 101.6 })]);
  draft.volumeSystems.push({ ...structuredClone(draft.volumeSystems[0]), id: 'c2', pipeSegments: [pipe({ lengthM: 20 })] });
  const result = calculateEstimate(draft);
  assert.deepEqual(result.chemicalVolumeResults.map(v => v.groups.length), [3,1]);
  assert.equal(result.chemicalVolumeResults[0].reservoirVolumeLiters, 480);
  assert.equal(result.chemicalVolumeResults[1].reservoirVolumeLiters, 120);
  assert.equal(result.productResults[0].sourceVolumeLiters,
    result.chemicalVolumeResults.reduce((sum, v) => sum + v.totalVolumeLiters, 0));
});

test('outros serviços não geram bomba nem entram no volume químico', () => {
  const draft = fixture([pipe(),pipe({ id:'flushing', lengthM: 300, serviceIds:['flushing_primario'] })]);
  const result = calculateEstimate(draft);
  assert.equal(result.productResults[0].sourceVolumeLiters, 271.29012);
  assert.equal(result.chemicalVolumeResults[0].groups[0].systemCount, 1);
  draft.volumeSystems[0].pipeSegments[0].serviceIds = ['teste_hidrostatico'];
  assert.equal(calculateEstimate(draft).productResults.length, 0);
  assert.equal(calculateEstimate(draft).chemicalVolumeResults, undefined);
});

test('quantidade zero, comprimento zero e preenchimento zero não acrescentam bombas', () => {
  for (const patch of [{quantity:0},{lengthM:0},{fillPercent:0},{internalDiameterMm:0}]) {
    const result = calculateEstimate(fixture([pipe(patch)]));
    assert.equal(result.chemicalVolumeResults[0].groups.length, 0);
    assert.equal(result.productResults[0].sourceVolumeLiters, 0);
  }
});

test('ciclos multiplicam tubo, bombas, mangueiras e outros sistemas uma única vez', () => {
  const draft = fixture();
  draft.volumeSystems[0].cycles = 2;
  draft.volumeSystems[0].reservoirVolumes = [{id:'r',description:'Tanque',quantity:2,volumeLiters:100,included:true,serviceIds:['limpeza_quimica']}];
  draft.volumeSystems[0].equipmentVolumes = [{id:'e',description:'Trocador',quantity:1,volumeLiters:30,included:true,serviceIds:['limpeza_quimica']}];
  const result = calculateEstimate(draft);
  assert.equal(result.chemicalVolumeResults[0].otherVolumeLiters, 230);
  assert.equal(result.productResults[0].sourceVolumeLiters, 1002.58024);
  assert.equal(result.chemicalVolumeResults[0].groups[0].systemCount, 1);
});

test('não muda geometria, efluente, serviços sem limpeza ou quantidades manuais de produto', () => {
  const draft = fixture();
  const before = calculateEstimate(draft);
  draft.volumeSystems[0].pipeSegments[0].serviceIds = ['flushing_primario'];
  const after = calculateEstimate(draft);
  assert.deepEqual(before.volumeResults, after.volumeResults.map(v => ({ ...v,
    pipeSegments:v.pipeSegments.map(p=>({...p,serviceIds:['limpeza_quimica']})) })));
  assert.equal(before.totalVolumeLiters, after.totalVolumeLiters);
  assert.equal(before.effluentVolumeLiters, after.effluentVolumeLiters);
  draft.volumeSystems[0].pipeSegments[0].serviceIds = ['limpeza_quimica'];
  draft.products[0].doseMode = 'manual'; draft.products[0].manualQuantity = 7;
  assert.equal(calculateEstimate(draft).productResults[0].requiredQuantity, 7);
});

test('seleção de circuito e salvamento normalizado conservam a nova base da dosagem', () => {
  const draft = fixture();
  draft.volumeSystems.push({ ...structuredClone(draft.volumeSystems[0]), id:'c2', cycles:2 });
  draft.products[0].systemId = 'c2';
  const restored = normalizeCostEstimatePayload(JSON.parse(JSON.stringify(draft)));
  assert.equal(calculateEstimate(restored).productResults[0].sourceVolumeLiters, 542.58024);
  restored.scopeConfirmations.noInputs = true;
  assert.equal(calculateEstimate(restored).chemicalVolumeResults, undefined);
  assert.equal(calculateEstimate(restored).productResults.length, 0);
});

test('material Outro em tubulação química é pendência do campo, sem presumir bomba', () => {
  const draft = fixture([pipe({material:'other'})]);
  assert.ok(validateCostEstimate(draft).errors.some(e=>e.path==='volumeSystems[0].pipeSegments[0].material'));
  draft.volumeSystems[0].pipeSegments[0].serviceIds = ['flushing_primario'];
  assert.equal(validateCostEstimate(draft).errors.some(e=>e.path.endsWith('.material')), false);
});

test('circuitos antigos com limpeza explícita usam LEC; arquivos sem serviços mantêm o cálculo anterior', () => {
  const draft = fixture(); delete draft.volumeSystems[0].servicesByItem;
  draft.circuitServices = [{id:'s1',systemId:'carbono',serviceId:'limpeza_quimica'}];
  assert.equal(calculateEstimate(draft).productResults[0].sourceVolumeLiters, 271.29012);
  delete draft.circuitServices;
  const result = calculateEstimate(draft);
  assert.equal(result.chemicalVolumeResults, undefined);
  assert.equal(result.productResults[0].sourceVolumeLiters, result.totalVolumeLiters);
});

test('exportação apresenta as parcelas e o mesmo total utilizado nos produtos', () => {
  const rows = linhasDaPlanilha({payload:fixture()});
  assert.ok(rows.some(row=>row[0]==='VOLUME PARA DOSAGEM QUÍMICA — LEC v1.3'));
  const total = rows.find(row=>row[1]==='TOTAL DO CIRCUITO');
  assert.equal(total.at(-1), 271.29012);
  const pump = rows.find(row=>row[1]==='Aço carbono' && row[2]===120);
  assert.equal(pump[4],1); assert.equal(pump[6],120); assert.equal(pump[7],50);
});
