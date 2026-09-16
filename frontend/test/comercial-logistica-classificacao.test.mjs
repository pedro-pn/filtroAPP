import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createDefaultCostEstimatePayload, normalizeCostEstimatePayload, validateCostEstimate, calculateEstimate } from '../../shared/comercial/dist/cost-model.js';

let server, corrigirClassificacaoLogistica, faltaLogistica, LogisticaSection, LogisticaItem, valorDaMobilizacaoDeEquipeDoLevantamento;
test.before(async () => {
  server = await createServer({configFile:false, root:new URL('..', import.meta.url).pathname,
    optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false},appType:'custom'});
  ({corrigirClassificacaoLogistica,faltaLogistica} = await server.ssrLoadModule('/src/pages/comercial/custos/logistica.ts'));
  ({LogisticaSection} = await server.ssrLoadModule('/src/pages/comercial/custos/sections/LogisticaSection.tsx'));
  ({LogisticaItem} = await server.ssrLoadModule('/src/pages/comercial/custos/sections/LogisticaItem.tsx'));
  ({valorDaMobilizacaoDeEquipeDoLevantamento} = await server.ssrLoadModule('/src/pages/comercial/proposta/levantamentoVinculado.ts'));
});
test.after(async () => { await server?.close(); });

/** Reprodução anonimizada: equipe aérea, outra equipe de carro e fretes separados. */
function cenario() {
  const draft = createDefaultCostEstimatePayload();
  draft.volumeSystems.forEach(system=>{system.enabled=false;});
  Object.assign(draft.scopeConfirmations, {noInputs:true,noLabor:false,noLogistics:false,combinedCrewAndEquipmentTransport:false});
  const fase = draft.laborContexts[0];
  Object.assign(fase, {name:'Planejamento',workCondition:'headquarters',workConditionConfirmed:true,vehicleType:'none'});
  const segunda = structuredClone(fase);
  Object.assign(segunda, {id:'execucao',name:'Execução'});
  Object.assign(segunda.assignments[0], {id:'equipe-execucao',quantity:4});
  draft.laborContexts.push(segunda);
  draft.logisticsDestinations[0].oneWayDistanceKm = 1105;
  for (const item of draft.logistics) Object.assign(item, {
    description:`${item.direction === 'mobilization' ? 'Ida' : 'Volta'} da equipe`,
    calculationMode:item.slotType === 'crew' ? 'air_crew_transport' : 'company_crew_vehicle',
    calculationModeConfirmed:true, contextId:item.slotType === 'crew' ? fase.id : segunda.id,
    ticketPerPersonPerTrip:1500, distanceKmPerVehicle:1105,
    returnSetup:item.direction === 'demobilization' ? 'mirrored' : 'custom'
  });
  for (const direction of ['mobilization','demobilization']) draft.logistics.push({
    ...structuredClone(draft.logistics[2]), id:`frete-${direction}`,direction,
    slotType:'additional',requiredSlot:false,category:'freight',
    description:`Frete ${direction}`,calculationMode:'external_freight',
    contextId:undefined,unitCost:12000,quantity:1,trips:1,
    returnSetup:'custom',autoSyncedFromMobilization:false
  });
  return draft;
}
const logisticsErrors = draft => validateCostEstimate(draft).errors.filter(e=>e.path.startsWith('logistics'));
function levantamento(draft) {
  const errosPorCampo = new Map(validateCostEstimate(draft).errors.map(e=>[e.path,e.message]));
  return {draft,result:calculateEstimate(draft),errosPorCampo,errosVisiveis:true,
    erroDe:path=>errosPorCampo.get(path),setDraft:()=>{},updateCollection:()=>{},removeCollection:()=>{}};
}

test('corrige a classificação sem remover deslocamentos, trocar IDs ou modificar a entrada', () => {
  const draft = cenario(), snapshot=structuredClone(draft);
  const corrected = normalizeCostEstimatePayload(draft);
  assert.deepEqual(draft,snapshot);
  assert.deepEqual(corrected.logistics.map(i=>i.id),draft.logistics.map(i=>i.id));
  assert.deepEqual(corrected.logistics.map(i=>i.slotType),['crew','crew','crew','crew','equipment','equipment']);
  assert.deepEqual(corrected.logistics.map(i=>i.requiredSlot),[true,true,false,false,true,true]);
  assert.deepEqual(logisticsErrors(draft),[]);
  assert.equal(validateCostEstimate(draft).valid,true,JSON.stringify(validateCostEstimate(draft).errors));
  assert.equal(faltaLogistica(draft,calculateEstimate(draft)),false);
  assert.equal(corrected.scopeConfirmations.combinedCrewAndEquipmentTransport,false);
});

test('custos de cada deslocamento, preço global e fretes permanecem iguais', () => {
  const draft=cenario();
  const baseline=structuredClone(draft);
  // Equivalente numérico dos transportes preenchidos, sem a restrição dos slots.
  baseline.logisticsStructureVersion=0;
  baseline.logistics.forEach(i=>{i.requiredSlot=false;i.slotType='additional';});
  const before=calculateEstimate(baseline), after=calculateEstimate(draft);
  assert.deepEqual(after.logisticsResults.map(i=>i.total),before.logisticsResults.map(i=>i.total));
  assert.equal(after.totalCost,before.totalCost);
  assert.equal(after.salePrice,before.salePrice);
  assert.deepEqual(after.logisticsResults.slice(-2).map(i=>i.total),[12000,12000]);
  const corrected=normalizeCostEstimatePayload(draft);
  for(const key of ['fuelEfficiencyKmPerLiter','fuelPricePerLiter','tollPerVehicleKm','contextId','description']) {
    assert.equal(corrected.logistics[2][key],draft.logistics[2][key]);
  }
});

test('normalizar, salvar e reabrir não reclassifica novamente nem perde o vínculo do retorno', () => {
  const corrected=normalizeCostEstimatePayload(cenario());
  assert.equal(corrected.logistics[3].mobilizationSourceId,corrected.logistics[2].id);
  assert.deepEqual(normalizeCostEstimatePayload(JSON.parse(JSON.stringify(corrected))),corrected);
  assert.deepEqual(logisticsErrors(corrected),[]);
});

test('alterar a ida rodoviária atualiza somente sua volta, não o avião ou os fretes', () => {
  const corrected=normalizeCostEstimatePayload(cenario());
  corrected.logistics[2].trips=3;
  const updated=normalizeCostEstimatePayload(corrected);
  assert.equal(updated.logistics[3].trips,3);
  assert.equal(updated.logistics[3].calculationMode,'company_crew_vehicle');
  assert.deepEqual([updated.logistics[0].trips,updated.logistics[1].trips,...updated.logistics.slice(-2).map(i=>i.trips)],[1,1,1,1]);
});

test('retorno separado mantém valores próprios e origem excluída aponta a composição de retorno', () => {
  const corrected=normalizeCostEstimatePayload(cenario());
  Object.assign(corrected.logistics[3],{returnSetup:'custom',autoSyncedFromMobilization:false,trips:2});
  corrected.logistics[2].trips=4;
  assert.equal(normalizeCostEstimatePayload(corrected).logistics[3].trips,2);
  corrected.logistics[3].returnSetup='mirrored';
  corrected.logistics=corrected.logistics.filter(i=>i.id!=='mobilizacao-equipamento');
  assert.ok(logisticsErrors(corrected).some(e=>e.path.endsWith('.returnSetup')&&e.message.includes('mobilização vinculada')));
});

test('não adivinha a classificação quando falta frete, há múltiplos candidatos ou destino diferente', () => {
  for(const alterar of [
    d=>d.logistics.pop(),
    d=>d.logistics.push({...d.logistics[4],id:'outro-frete'}),
    d=>{d.logisticsDestinations.push({...d.logisticsDestinations[0],id:'outra-obra'});d.logistics[4].destinationId='outra-obra';},
    d=>{d.logistics[4].included=false;}
  ]) {
    const draft=cenario();alterar(draft);
    const corrected=normalizeCostEstimatePayload(draft);
    assert.equal(corrected.logistics[2].slotType,'equipment');
    assert.equal(corrected.logistics[3].slotType,'equipment');
    assert.ok(logisticsErrors(draft).some(e=>e.path==='logistics[2].calculationMode'));
  }
});

test('não altera o custo de orçamentos explicitamente sem logística ou com transporte conjunto', () => {
  for(const flag of ['noLogistics','combinedCrewAndEquipmentTransport']) {
    const draft=cenario();draft.scopeConfirmations[flag]=true;
    const corrected=normalizeCostEstimatePayload(draft);
    assert.equal(corrected.logistics[2].slotType,'equipment');
    assert.equal(corrected.logistics[4].slotType,'additional');
  }
});

test('hidratação corrige só a logística e a tela identifica os blocos sem pendências falsas', () => {
  const draft=cenario();draft.campoEmEdicao='preservado';
  const corrected=corrigirClassificacaoLogistica(draft);
  assert.equal(corrected.campoEmEdicao,'preservado');
  assert.equal(corrected.laborContexts,draft.laborContexts);
  assert.equal(corrigirClassificacaoLogistica(corrected),corrected);
  const html=renderToStaticMarkup(createElement(LogisticaSection,{levantamento:levantamento(corrected)}));
  assert.equal((html.match(/>Transporte de equipe</g)||[]).length,4);
  assert.equal((html.match(/>Transporte de equipamentos</g)||[]).length,2);
  assert.doesNotMatch(html,/escolha incompatível|aria-invalid="true"/);
  assert.equal((html.match(/Composição do retorno/g)||[]).length,3);
});

test('selecionar repetir a ida usa o vínculo correto da equipe adicional, não o primeiro slot de equipe', () => {
  const draft=normalizeCostEstimatePayload(cenario());
  const state=levantamento(draft);let patch;
  state.updateCollection=(_collection,_id,value)=>{patch=value;};
  const tree=LogisticaItem({levantamento:state,item:draft.logistics[3]});
  function find(element) {
    if(!element||typeof element!=='object')return null;
    if(element.props?.label==='Composição do retorno')return element;
    return [element.props?.children].flat(Infinity).map(find).find(Boolean);
  }
  find(tree).props.onChange('mirrored');
  assert.equal(patch.calculationMode,'company_crew_vehicle');
  assert.equal(patch.contextId,'execucao');
});

test('proposta recebe mobilização das duas equipes, sem frete de equipamentos nem volta', () => {
  const draft=cenario();const result=calculateEstimate(draft);
  const expected=result.logisticsResults[0].total+result.logisticsResults[2].total;
  assert.equal(valorDaMobilizacaoDeEquipeDoLevantamento({payload:draft}),new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(expected));
});
