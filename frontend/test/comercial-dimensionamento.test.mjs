import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server, model, helpers, importacao, CircuitosBloco, InsumosSection;
test.before(async () => {
  server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  model = await server.ssrLoadModule('/../shared/comercial/dist/cost-model.js');
  helpers = await server.ssrLoadModule('/src/pages/comercial/custos/dimensionamento.ts');
  importacao = await server.ssrLoadModule('/src/pages/comercial/proposta/levantamentoVinculado.ts');
  ({ CircuitosBloco } = await server.ssrLoadModule('/src/pages/comercial/custos/sections/CircuitosBloco.tsx'));
  ({ InsumosSection } = await server.ssrLoadModule('/src/pages/comercial/custos/sections/InsumosSection.tsx'));
});
test.after(async () => server?.close());

function state(draft = model.createDefaultCostEstimatePayload()) {
  return { draft, result: model.calculateEstimate(draft), erroDe: () => undefined,
    setDraft: () => {}, updateCollection: () => {}, removeCollection: () => {}, updateNested: () => {}, removeNested: () => {} };
}
const htmlFor = draft => renderToStaticMarkup(createElement(CircuitosBloco, { levantamento: state(draft) }));

test('início exibe um circuito vazio e convite para escolher tipo, sem tabelas pré-criadas', () => {
  const html = htmlFor(model.createDefaultCostEstimatePayload());
  assert.equal((html.match(/aria-label="Nome do circuito"/g) || []).length, 1);
  assert.match(html, /placeholder="Digite o nome do equipamento do cliente" value=""/);
  assert.match(html, /Adicionar serviços/);
  assert.doesNotMatch(html, /role="tab"|aria-label="Material"|Mangueiras|Equipamentos e reservatórios|Volumes manuais/);
});

test('novos sistemas têm nomes vazios, metadados próprios e nenhuma seleção de serviço automática', () => {
  for (const type of ['pipes', 'reservoirs', 'oil', 'equipment']) {
    const item = helpers.novoSistemaDimensionado(type);
    assert.equal(item.description, '');
    assert.deepEqual(item.serviceIds, []);
    assert.equal(item.quantity, 1);
    if (type === 'oil') { assert.equal(item.oilType, ''); assert.equal(item.oilBrandViscosity, ''); assert.equal(item.material, undefined); }
    else assert.equal(item.material, 'carbon_steel');
  }
});

test('os quatro tipos usam uma grade compacta própria, separada dos serviços', () => {
  for (const [type, collection] of Object.entries({
    pipes: 'pipeSegments', reservoirs: 'reservoirVolumes',
    oil: 'manualVolumes', equipment: 'equipmentVolumes'
  })) {
    const draft = model.createDefaultCostEstimatePayload();
    draft.volumeSystems[0][collection] = [helpers.novoSistemaDimensionado(type)];
    const html = htmlFor(draft);
    assert.ok(html.includes(`class="com-dimension-fields com-dimension-fields--${type}"`));
    assert.match(html, /Serviços deste sistema/);
  }
});

test('adicionar circuito fica depois da lista e remover tem espaçamento próprio', () => {
  const html = htmlFor(model.createDefaultCostEstimatePayload());
  assert.match(html, /class="com-btn com-btn-perigo com-circuito-remover"/);
  assert.match(html, /<\/article><\/div><button[^>]*class="com-btn-add com-circuito-adicionar"/);
  assert.equal((html.match(/\+ Adicionar circuito/g) || []).length, 1);
});

test('reservatório exibe material, nome, quantidade, volume e múltiplos serviços, sem checkbox Incluir', () => {
  const draft = model.createDefaultCostEstimatePayload();
  draft.volumeSystems[0].reservoirVolumes = [{ ...helpers.novoSistemaDimensionado('reservoirs'), serviceIds: ['', 'limpeza_quimica'] }];
  const html = htmlFor(draft);
  assert.match(html, /Reservatórios \(1\)/);
  for (const label of ['Nome do sistema', 'Material', 'Quantidade', 'Volume em litros', 'Serviço 1 do sistema', 'Serviço 2 do sistema']) assert.ok(html.includes(`aria-label="${label}"`));
  assert.match(html, /limpeza_reservatorio/);
  assert.doesNotMatch(html, /Incluir no volume|type="checkbox"|flushing_primario|filtragem_hidraulico_lubrificante/);
});

test('óleo exibe lista existente de fluidos e marca livre, apenas filtragens/desidratações', () => {
  const draft = model.createDefaultCostEstimatePayload();
  draft.volumeSystems[0].manualVolumes = [{ ...helpers.novoSistemaDimensionado('oil'), serviceIds: [''] }];
  const html = htmlFor(draft);
  for (const label of ['Nome do sistema', 'Tipo de óleo', 'Marca/viscosidade', 'Volume em litros']) assert.ok(html.includes(`aria-label="${label}"`));
  assert.match(html, /Óleo lubrificante/);
  assert.match(html, /Óleo hidráulico/);
  assert.match(html, /filtragem_oleo_termico/);
  assert.match(html, /desidratacao_oleo_diesel/);
  assert.doesNotMatch(html, /aria-label="Material"|aria-label="Quantidade"|limpeza_quimica|flushing_primario/);
});

test('químicos e filtros respondem às linhas, sem depender de associações antigas no rascunho', () => {
  const draft = model.createDefaultCostEstimatePayload();
  draft.volumeSystems[0].pipeSegments = [{ ...helpers.novoSistemaDimensionado('pipes'), description: 'Linha', serviceIds: ['limpeza_quimica', 'flushing_agua'] }];
  const html = renderToStaticMarkup(createElement(InsumosSection, { levantamento: state(draft) }));
  assert.match(html, /Produtos químicos/);
  assert.match(html, /Filtros/);
  assert.doesNotMatch(html, /Serviços por circuito/);
});

test('produtos mostram memória LEC com bomba, mangueiras e total para dosagem', () => {
  const draft = model.createDefaultCostEstimatePayload();
  draft.volumeSystems[0].name = 'Prensa';
  draft.volumeSystems[0].pipeSegments = [{ ...helpers.novoSistemaDimensionado('pipes'),
    description: 'Linha', lengthM: 50, internalDiameterMm: 50.8, serviceIds: ['limpeza_quimica'] }];
  const html = renderToStaticMarkup(createElement(InsumosSection, { levantamento: state(draft) }));
  assert.match(html, /Volume para dosagem química: 271,29 L/);
  assert.match(html, /memória de cálculo LEC/);
  assert.match(html, /Reservatórios das bombas \(L\)/);
  assert.match(html, /<td>120 L<\/td>/);
  assert.match(html, /<td>50 m<\/td><td><input[^>]*aria-label="Sistemas de Prensa — Aço carbono, bomba 120 L"[^>]*value="1"\/><\/td>/);
  assert.doesNotMatch(html, /automático: /);
  assert.match(html, /Mangueiras \(L\)/);
});

test('memória LEC deixa editar o nº de sistemas e mostra o automático quando há ajuste manual', () => {
  const draft = model.createDefaultCostEstimatePayload();
  draft.volumeSystems[0].name = 'Prensa';
  draft.volumeSystems[0].pipeSegments = [{ ...helpers.novoSistemaDimensionado('pipes'),
    description: 'Linha', lengthM: 100, internalDiameterMm: 127, serviceIds: ['limpeza_quimica'] }];
  draft.volumeSystems[0].chemicalSystemCounts = { 'carbon_steel:240': 3 };
  const html = renderToStaticMarkup(createElement(InsumosSection, { levantamento: state(draft) }));
  assert.match(html, /aria-label="Sistemas de Prensa — Aço carbono, bomba 240 L"[^>]*value="3"/);
  assert.match(html, /automático: 2/);
  assert.match(html, />Restaurar<\/button>/);
});

test('material incompatível destaca a seleção do tubo para limpeza química', () => {
  const draft = model.createDefaultCostEstimatePayload();
  draft.volumeSystems[0].pipeSegments = [{ ...helpers.novoSistemaDimensionado('pipes'), material: 'other',
    description: 'Linha', lengthM: 50, internalDiameterMm: 50.8, serviceIds: ['limpeza_quimica'] }];
  const levantamento = state(draft);
  levantamento.erroDe = path => path.endsWith('.material') ? 'Defina o material da bomba.' : undefined;
  const html = renderToStaticMarkup(createElement(CircuitosBloco, { levantamento }));
  assert.match(html, /aria-label="Material" aria-invalid="true"/);
  assert.match(html, /Defina o material da bomba/);
});

test('importação na proposta usa nome/material de cada linha e os detalhes do óleo', () => {
  const draft = model.createDefaultCostEstimatePayload();
  const system = draft.volumeSystems[0]; system.name = 'Prensa';
  system.reservoirVolumes = [{ ...helpers.novoSistemaDimensionado('reservoirs'), description: 'Tanque inox', material: 'stainless_steel', serviceIds: ['limpeza_quimica'] }];
  system.equipmentVolumes = [{ ...helpers.novoSistemaDimensionado('equipment'), description: 'Trocador', material: 'carbon_steel', serviceIds: ['boroscopia'] }];
  system.manualVolumes = [{ ...helpers.novoSistemaDimensionado('oil'), description: 'Unidade hidráulica', oilType: 'Óleo hidráulico', oilBrandViscosity: 'Marca VG 46', volumeLiters: 500, serviceIds: ['filtragem_hidraulico_lubrificante', 'desidratacao_oleo'] }];
  const services = importacao.servicosImportadosDoLevantamento({ payload: JSON.parse(JSON.stringify(draft)) });
  assert.equal(services.escopo.length, 4);
  const chemical = services.tecnicos.find(item => item.serviceId === 'limpeza_quimica');
  assert.equal(chemical.parameters.material, 'Aço inoxidável');
  const chemicalScope = services.escopo.find(item => item.id.endsWith('limpeza_quimica'));
  assert.match(chemicalScope.description, /Prensa — Tanque inox/);
  assert.doesNotMatch(chemicalScope.description, /Trocador|Unidade hidráulica/);
  assert.match(services.escopo.find(item => item.id.endsWith('filtragem_hidraulico_lubrificante')).description, /Marca VG 46/);
  system.manualVolumes[0].oilType = 'Óleo lubrificante';
  const lubricant = importacao.servicosImportadosDoLevantamento({ payload: draft });
  assert.equal(lubricant.tecnicos.find(item => item.serviceId === 'filtragem_hidraulico_lubrificante').parameters.oilType, 'Óleo lubrificante');
});

test('rascunhos anteriores conservam mangueiras como tubos e volume total de óleo com quantidade', () => {
  const draft = model.createDefaultCostEstimatePayload();
  const system = draft.volumeSystems[0]; delete system.servicesByItem;
  system.hoseSegments = [{ id: 'h1', description: 'Interligação', lengthM: 5, internalDiameterMm: 25, quantity: 2, fillPercent: 100 }];
  system.manualVolumes = [{ id: 'v1', description: 'Carga', quantity: 3, volumeLiters: 100 }];
  const upgraded = helpers.atualizarDimensionamento(draft);
  assert.equal(upgraded.volumeSystems[0].hoseSegments.length, 0);
  assert.equal(upgraded.volumeSystems[0].pipeSegments[0].diameterUnit, 'mm');
  assert.equal(upgraded.volumeSystems[0].manualVolumes[0].quantity, 1);
  assert.equal(upgraded.volumeSystems[0].manualVolumes[0].volumeLiters, 300);
  assert.equal(model.calculateEstimate(upgraded).totalVolumeLiters, model.calculateEstimate(draft).totalVolumeLiters);
  assert.deepEqual(helpers.atualizarDimensionamento(upgraded), upgraded);
});

test('validação destaca os campos de sistema e serviço na aba correta', () => {
  const draft = model.createDefaultCostEstimatePayload();
  draft.volumeSystems[0].reservoirVolumes = [helpers.novoSistemaDimensionado('reservoirs')];
  const levantamento = state(draft);
  levantamento.erroDe = path => path.endsWith('.serviceIds') ? 'Selecione um serviço.' : path.endsWith('.description') ? 'Informe o nome.' : undefined;
  const html = renderToStaticMarkup(createElement(CircuitosBloco, { levantamento }));
  assert.match(html, /aria-label="Nome do sistema"[^>]*aria-invalid="true"/);
  assert.match(html, /Selecione um serviço/);
});

test('necessidade / compra mostra a quantidade uma vez, com unidade, e o valor em linha própria', () => {
  const montar = packageSize => {
    const draft = model.createDefaultCostEstimatePayload();
    draft.volumeSystems[0].pipeSegments = [{ ...helpers.novoSistemaDimensionado('pipes'),
      description: 'Linha', lengthM: 100, internalDiameterMm: 127, serviceIds: ['limpeza_quimica'] }];
    draft.products = [{ ...draft.products[0], systemId: '*', doseMode: 'percent_volume', dose: 5, unit: 'kg',
      densityKgPerL: 1, wastePercent: 0, packageSize, unitCost: 10, priceBasis: 'unit' }];
    return renderToStaticMarkup(createElement(InsumosSection, { levantamento: state(draft) }));
  };
  const celula = html => html.match(/<td class="com-calculado">(.*?)<\/td>/)[1];

  // Sem embalagem que arredonde: 5% de 1.946,13 L = 97,31 kg, uma única vez.
  const semEmbalagem = celula(montar(0));
  assert.equal((semEmbalagem.match(/97,31/g) || []).length, 1);
  assert.match(semEmbalagem, /<strong>97,31<\/strong> kg<\/div>/);
  assert.match(semEmbalagem, /<div class="com-nota">R\$\s?973,06<\/div>/);
  assert.doesNotMatch(semEmbalagem, / \/ /);

  // Embalagem de 20 kg arredonda para 100 kg (5 emb.): aí sim as duas quantidades.
  const comEmbalagem = celula(montar(20));
  assert.match(comEmbalagem, /necessário <span>97,31<\/span> kg/);
  assert.match(comEmbalagem, /compra <strong>100<\/strong> kg \(5 emb\.\)/);
});
