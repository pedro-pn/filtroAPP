import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server, motor, LogisticaItem, LogisticaSection, PendenciasDaSecao, itemPrecisaAtencao, faltaLogistica;
test.before(async () => {
  server = await createServer({
    configFile: false, root: new URL('..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false }, appType: 'custom'
  });
  motor = await server.ssrLoadModule('/../shared/comercial/dist/cost-model.js');
  ({ LogisticaItem } = await server.ssrLoadModule('/src/pages/comercial/custos/sections/LogisticaItem.tsx'));
  ({ LogisticaSection } = await server.ssrLoadModule('/src/pages/comercial/custos/sections/LogisticaSection.tsx'));
  ({ PendenciasDaSecao } = await server.ssrLoadModule('/src/pages/comercial/custos/PendenciasDaSecao.tsx'));
  ({ itemPrecisaAtencao, faltaLogistica } = await server.ssrLoadModule('/src/pages/comercial/custos/logistica.ts'));
});
test.after(async () => { await server?.close(); });

function estado(editar, visivel = true) {
  const draft = motor.createDefaultCostEstimatePayload();
  draft.scopeConfirmations.noLogistics = false;
  draft.scopeConfirmations.noLabor = true;
  draft.logisticsDestinations.forEach(destino => { destino.oneWayDistanceKm = 100; });
  draft.logistics.forEach(item => Object.assign(item, {
    calculationMode: item.slotType === 'equipment' ? 'external_freight' : '',
    calculationModeConfirmed: item.slotType === 'equipment',
    quantity: 1, trips: 1, unitCost: 1500,
    returnSetup: 'custom', autoSyncedFromMobilization: false
  }));
  editar?.(draft);
  const result = motor.calculateEstimate(draft);
  const errosPorCampo = new Map(motor.validateCostEstimate(draft).errors.map(e => [e.path, e.message]));
  return {
    draft, result, errosPorCampo, errosVisiveis: visivel,
    erroDe: caminho => visivel ? errosPorCampo.get(caminho) : undefined,
    setDraft: () => {}, updateCollection: () => {}, removeCollection: () => {}
  };
}
const equipamento = levantamento => levantamento.draft.logistics.find(i => i.slotType === 'equipment');
const htmlItem = (levantamento, item = equipamento(levantamento)) => renderToStaticMarkup(createElement(LogisticaItem, { levantamento, item }));
const errosLogistica = levantamento => [...levantamento.errosPorCampo].filter(([path]) => /^logistics/.test(path));

test('frete preenchido na ida e na volta não gera a recusa de modo obrigatório', () => {
  const levantamento = estado();
  assert.deepEqual(errosLogistica(levantamento), []);
  assert.equal(faltaLogistica(levantamento.draft, levantamento.result), false);
  assert.doesNotMatch(htmlItem(levantamento), /aria-invalid="true"/);
});

test('caminhão próprio com motorista definido é aceito para equipamentos nos dois sentidos', () => {
  const levantamento = estado(draft => {
    const fase = draft.laborContexts[0];
    draft.logistics.filter(i => i.slotType === 'equipment').forEach(item => Object.assign(item, {
      calculationMode: 'company_truck_driver', contextId: fase.id,
      travelerCountMode: 'manual', travelerAssignmentsConfirmed: true,
      travelerAssignments: [{ assignmentId: fase.assignments[0].id, quantity: 1 }],
      distanceKmPerVehicle: 100
    }));
  });
  assert.deepEqual(errosLogistica(levantamento), []);
  assert.doesNotMatch(htmlItem(levantamento), /aria-invalid="true"/);
});

test('seleção antiga incompatível fica preservada, identificada e inválida no campo real', () => {
  const levantamento = estado(draft => {
    draft.logistics.filter(i => i.slotType === 'equipment').forEach(i => { i.calculationMode = 'company_crew_vehicle'; });
  });
  const html = htmlItem(levantamento);
  assert.match(html, /Modo de cálculo[\s\S]*?<select[^>]*aria-invalid="true"/);
  assert.match(html, /value="company_crew_vehicle"[^>]*disabled=""[^>]*selected=""/);
  assert.match(html, /escolha incompatível com este item/);
  assert.match(html, /O item obrigatório do equipamento deve usar frete/);
  assert.equal(itemPrecisaAtencao(equipamento(levantamento)), true);
  assert.equal(faltaLogistica(levantamento.draft, levantamento.result), true);
  const resumo = renderToStaticMarkup(createElement(PendenciasDaSecao, { levantamento, secao: 'logistics' }));
  assert.match(resumo, /Mobilização ·/);
  assert.match(resumo, /Desmobilização ·/);
});

test('opções oferecidas respeitam o tipo obrigatório e mantêm itens adicionais livres', () => {
  const levantamento = estado();
  const html = htmlItem(levantamento);
  assert.match(html, /value="external_freight"/);
  assert.match(html, /value="company_truck_driver"/);
  assert.doesNotMatch(html, /value="(?:company_crew_vehicle|rental_crew_vehicle|bus_crew_transport|air_crew_transport)"/);
  const equipe = htmlItem(levantamento, levantamento.draft.logistics[0]);
  assert.match(equipe, /value="company_crew_vehicle"/);
  assert.doesNotMatch(equipe, /value="external_freight"|value="company_truck_driver"/);
  const adicional = htmlItem(levantamento, { ...equipamento(levantamento), requiredSlot: false, slotType: 'additional' });
  assert.match(adicional, /value="company_crew_vehicle"/);
  assert.match(adicional, /value="external_freight"/);
});

test('modo manual legado continua visível sem modificar dados salvos', () => {
  const levantamento = estado(draft => { draft.logistics.find(i => i.slotType === 'equipment').calculationMode = 'legacy'; });
  assert.match(htmlItem(levantamento), /value="legacy" selected="">Cálculo manual/);
  assert.deepEqual(errosLogistica(levantamento), []);
});

test('campos dispensados, excluídos e não revelados não recebem falsos destaques', () => {
  const levantamento = estado(draft => { draft.scopeConfirmations.combinedCrewAndEquipmentTransport = true; });
  levantamento.errosPorCampo.set('logistics[2].calculationMode', 'Erro antigo');
  assert.doesNotMatch(htmlItem(levantamento), /aria-invalid="true"/);
  const oculto = estado(draft => { draft.logistics[2].calculationMode = ''; }, false);
  assert.doesNotMatch(htmlItem(oculto), /aria-invalid="true"/);
  const excluido = estado(draft => { draft.logistics[2].included = false; });
  assert.match(htmlItem(excluido), /type="checkbox"[^>]*aria-invalid="true"/);
  assert.doesNotMatch(htmlItem(excluido), /<select[^>]*aria-invalid="true"/);
});

test('resposta do servidor usa índice original, mesmo exibindo itens agrupados por direção', () => {
  const levantamento = estado();
  levantamento.errosPorCampo.set('logistics[3].unitCost', 'Valor recusado pelo servidor');
  const html = htmlItem(levantamento, levantamento.draft.logistics[3]);
  assert.match(html, /Custo unitário[\s\S]*?<input[^>]*aria-invalid="true"/);
  assert.match(html, /Valor recusado pelo servidor/);
  assert.doesNotMatch(htmlItem(levantamento), /Valor recusado pelo servidor/);
});

test('retorno espelhado exibe o mesmo modo e custo da ida que o motor valida', () => {
  const levantamento = estado(draft => {
    const retorno = draft.logistics.find(i => i.slotType === 'equipment' && i.direction === 'demobilization');
    Object.assign(retorno, { calculationMode: 'company_crew_vehicle', unitCost: 0, returnSetup: 'mirrored', autoSyncedFromMobilization: true });
  });
  assert.deepEqual(errosLogistica(levantamento), []);
  const html = renderToStaticMarkup(createElement(LogisticaSection, { levantamento }));
  const volta = html.slice(html.indexOf('id="desmobilizacao-conteudo"'));
  assert.match(volta, /value="external_freight" selected=""/);
  assert.doesNotMatch(volta, /escolha incompatível/);
  assert.match(volta, /R\$\s*1\.500,00/);
});

test('editar retorno espelhado preserva os valores herdados e o transforma em composição separada', () => {
  const levantamento = estado();
  const item = { ...levantamento.draft.logistics[3], returnSetup: 'mirrored', autoSyncedFromMobilization: true, unitCost: 2700 };
  let patch;
  levantamento.updateCollection = (_collection, _id, value) => { patch = value; };
  const tree = LogisticaItem({ levantamento, item });
  function buscar(element, label) {
    if (!element || typeof element !== 'object') return null;
    if (element.props?.label === label) return element;
    return [element.props?.children].flat(Infinity).map(child => buscar(child, label)).find(Boolean);
  }
  buscar(tree, 'Viagens').props.onChange(2);
  assert.equal(patch.returnSetup, 'custom');
  assert.equal(patch.autoSyncedFromMobilization, false);
  assert.equal(patch.unitCost, 2700);
  assert.equal(patch.trips, 2);
});

test('equipamento oculto pela mobilização conjunta não cria dupla contagem de viajantes', () => {
  const levantamento = estado(draft => {
    draft.scopeConfirmations.noLabor = false;
    draft.scopeConfirmations.combinedCrewAndEquipmentTransport = true;
    draft.logistics.forEach(i => Object.assign(i, {
      calculationMode: 'company_crew_vehicle', calculationModeConfirmed: true,
      contextId: draft.laborContexts[0].id, distanceKmPerVehicle: 100,
      travelerCountMode: 'automatic', travelerAssignmentsConfirmed: true
    }));
  });
  assert.deepEqual(errosLogistica(levantamento), []);
  assert.equal(faltaLogistica(levantamento.draft, levantamento.result), false);
});
