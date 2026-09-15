import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createServer } from 'vite';

/**
 * Materiais e insumos.
 *
 * O que precisa ser provado aqui é o efeito no CUSTO, e uma regra de fluxo que
 * é fácil deixar passar: acrescentar insumo tem de desfazer a confirmação de
 * "sem insumos", senão o levantamento afirma duas coisas contraditórias ao
 * mesmo tempo.
 */

let server;
let motor;
let faltaInsumos;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom'
  });
  motor = await server.ssrLoadModule('/../shared/comercial/dist/cost-model.js');
  ({ faltaInsumos } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/pendencias.ts'
  ));
});

test.after(async () => {
  await server?.close();
});

function material(extras = {}) {
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    category: 'material',
    description: 'Tubo',
    unit: 'un.',
    quantity: 10,
    unitCost: 25,
    wastePercent: 0,
    freightValue: 0,
    included: true,
    ...extras
  };
}

function comServicos(payload, serviceId, ids = payload.volumeSystems.map(item => item.id)) {
  return {
    ...payload,
    circuitServices: ids.map((systemId, indice) => ({
      id: `servico-${serviceId}-${indice + 1}`,
      systemId,
      serviceId
    }))
  };
}

function comMateriais(itens) {
  const base = motor.createDefaultCostEstimatePayload();
  return comServicos({ ...base, materials: itens }, 'teste_hidrostatico');
}

test('material incluído entra no custo', () => {
  const vazio = motor.calculateEstimate(comMateriais([]));
  const comUm = motor.calculateEstimate(comMateriais([material()]));

  assert.equal(Number(vazio.materialCost), 0);
  assert.ok(Number(comUm.materialCost) > 0, 'material tem de somar ao custo');
});

test('desmarcar "incluir" tira o item do custo sem apagá-lo', () => {
  // É diferente de remover: o item continua na lista, visível, para o
  // orçamentista lembrar que considerou e descartou.
  const incluido = motor.calculateEstimate(comMateriais([material({ included: true })]));
  const excluido = motor.calculateEstimate(comMateriais([material({ included: false })]));

  assert.ok(Number(incluido.materialCost) > 0);
  assert.equal(Number(excluido.materialCost), 0, 'item excluído não pode custar');
});

test('perda percentual aumenta o custo', () => {
  const semPerda = motor.calculateEstimate(comMateriais([material({ wastePercent: 0 })]));
  const comPerda = motor.calculateEstimate(comMateriais([material({ wastePercent: 10 })]));

  assert.ok(
    Number(comPerda.materialCost) > Number(semPerda.materialCost),
    'perda de 10% tem de encarecer'
  );
});

test('frete entra no custo do item', () => {
  const semFrete = motor.calculateEstimate(comMateriais([material({ freightValue: 0 })]));
  const comFrete = motor.calculateEstimate(comMateriais([material({ freightValue: 300 })]));

  assert.ok(Number(comFrete.materialCost) > Number(semFrete.materialCost));
});

test('quantidade e custo unitário multiplicam', () => {
  const um = motor.calculateEstimate(
    comMateriais([material({ quantity: 1, unitCost: 100 })])
  );
  const dez = motor.calculateEstimate(
    comMateriais([material({ quantity: 10, unitCost: 100 })])
  );

  assert.equal(
    Number(dez.materialCost),
    Number(um.materialCost) * 10,
    'dez unidades custam dez vezes uma'
  );
});

test('material incluído desliga a pendência de insumos', () => {
  const semNada = motor.createDefaultCostEstimatePayload();
  assert.equal(faltaInsumos(semNada), true);

  const comMaterial = comMateriais([material()]);
  assert.equal(
    faltaInsumos(comMaterial),
    false,
    'com composição real a pendência tem de sumir sozinha'
  );
});

test('material APENAS excluído não conta como composição', () => {
  // Um item marcado para não entrar não é uma decisão sobre insumos — é um
  // rascunho. A pendência continua, e é isso que evita salvar por engano.
  const soExcluido = comMateriais([material({ included: false })]);
  assert.equal(faltaInsumos(soExcluido), true);
});

test('a confirmação "sem insumos" desliga a pendência mesmo sem itens', () => {
  const base = motor.createDefaultCostEstimatePayload();
  const confirmado = comServicos({
    ...base,
    scopeConfirmations: { ...base.scopeConfirmations, noInputs: true }
  }, 'teste_hidrostatico');
  assert.equal(faltaInsumos(confirmado), false);
});

test('confirmar sem insumos não dispensa definir o serviço de cada circuito', () => {
  const base = motor.createDefaultCostEstimatePayload();
  assert.equal(faltaInsumos({
    ...base,
    scopeConfirmations: { ...base.scopeConfirmations, noInputs: true }
  }), true);
});

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

test('o catálogo LEC traz nome, micragem e preço nos 8 filtros', () => {
  const catalogo = motor.LEC_FILTER_CATALOG;
  assert.equal(catalogo.length, 8);
  for (const filtro of catalogo) {
    assert.ok(filtro.filterName, 'filtro sem nome');
    assert.ok(filtro.unitCost > 0, `${filtro.filterName} sem preço`);
  }
});

test('filtro incluído entra no custo; desmarcado, não', () => {
  const base = motor.createDefaultCostEstimatePayload();
  const doCatalogo = motor.LEC_FILTER_CATALOG[0];

  const filtro = incluido => ({
    id: 'f1',
    filterName: doCatalogo.filterName,
    micronRating: doCatalogo.micronRating,
    unit: 'un.',
    quantity: 2,
    unitCost: doCatalogo.unitCost,
    included: incluido
  });

  const dentro = motor.calculateEstimate(
    comServicos({ ...base, filters: [filtro(true)] }, 'flushing_primario')
  );
  const fora = motor.calculateEstimate(
    comServicos({ ...base, filters: [filtro(false)] }, 'flushing_primario')
  );

  assert.ok(Number(dentro.filterCost ?? dentro.inputCost) > 0);
  assert.ok(
    Number(dentro.inputCost) > Number(fora.inputCost),
    'filtro desmarcado não pode custar'
  );
});

test('filtro nasce DESMARCADO — não conta como composição sozinho', () => {
  // Acrescentar um filtro em branco que já entra no custo somaria zero e daria
  // a impressão de estar considerado.
  const base = motor.createDefaultCostEstimatePayload();
  const emBranco = {
    ...base,
    filters: [
      {
        id: 'f1',
        filterName: 'Filtro personalizado',
        micronRating: '',
        unit: 'un.',
        quantity: 0,
        unitCost: 0,
        included: false
      }
    ]
  };
  assert.equal(faltaInsumos(emBranco), true);
});

test('filtro só entra quando há flushing ou filtragem em ao menos um circuito', () => {
  const base = motor.createDefaultCostEstimatePayload();
  const filtro = {
    id: 'f1',
    filterName: 'Elemento filtrante',
    micronRating: '3 µm',
    unit: 'un.',
    quantity: 2,
    unitCost: 100,
    included: true
  };
  const semServicoAplicavel = motor.calculateEstimate(
    comServicos({ ...base, filters: [filtro] }, 'teste_hidrostatico')
  );
  const comFlushing = motor.calculateEstimate(
    comServicos({ ...base, filters: [filtro] }, 'flushing_primario')
  );

  assert.equal(Number(semServicoAplicavel.filterCost), 0);
  assert.equal(Number(comFlushing.filterCost), 200);
});

// ---------------------------------------------------------------------------
// Circuitos — o volume que doseia os químicos
// ---------------------------------------------------------------------------

function circuito(extras = {}) {
  return {
    id: 'c1',
    name: 'Circuito de teste',
    material: 'carbon_steel',
    pipeSegments: [],
    hoseSegments: [],
    equipmentVolumes: [],
    manualVolumes: [],
    cycles: 1,
    enabled: true,
    ...extras
  };
}

function comCircuito(c) {
  const base = motor.createDefaultCostEstimatePayload();
  return comServicos({ ...base, volumeSystems: [c] }, 'teste_hidrostatico');
}

test('trecho de tubo gera volume pela geometria', () => {
  // Tubo de 100 mm de diâmetro interno e 10 m: π × 0,05² × 10 = ~78,5 L.
  const comTubo = motor.calculateEstimate(
    comCircuito(
      circuito({
        pipeSegments: [
          {
            id: 't1',
            description: 'Linha',
            quantity: 1,
            lengthM: 10,
            internalDiameterMm: 100,
            fillPercent: 100
          }
        ]
      })
    )
  );

  const volume = Number(comTubo.totalVolumeLiters);
  assert.ok(volume > 70 && volume < 90, `volume inesperado: ${volume}`);
});

test('preenchimento parcial reduz o volume proporcionalmente', () => {
  const tubo = fill => ({
    id: 't1',
    description: 'Linha',
    quantity: 1,
    lengthM: 10,
    internalDiameterMm: 100,
    fillPercent: fill
  });

  const cheio = motor.calculateEstimate(comCircuito(circuito({ pipeSegments: [tubo(100)] })));
  const meio = motor.calculateEstimate(comCircuito(circuito({ pipeSegments: [tubo(50)] })));

  assert.ok(
    Math.abs(Number(meio.totalVolumeLiters) * 2 - Number(cheio.totalVolumeLiters)) < 0.01,
    '50% de preenchimento tem de dar metade do volume'
  );
});

test('o diâmetro entra ao QUADRADO — dobrar o diâmetro quadruplica o volume', () => {
  // É o erro mais caro de digitação nesta tela: trocar 50 por 100 no diâmetro
  // não dobra o produto químico, quadruplica.
  const tubo = diametro => ({
    id: 't1',
    description: 'Linha',
    quantity: 1,
    lengthM: 10,
    internalDiameterMm: diametro,
    fillPercent: 100
  });

  const fino = motor.calculateEstimate(comCircuito(circuito({ pipeSegments: [tubo(50)] })));
  const grosso = motor.calculateEstimate(comCircuito(circuito({ pipeSegments: [tubo(100)] })));

  const razao = Number(grosso.totalVolumeLiters) / Number(fino.totalVolumeLiters);
  assert.ok(Math.abs(razao - 4) < 0.01, `esperava 4x, veio ${razao}`);
});

test('ciclos multiplicam o volume', () => {
  const base = circuito({
    pipeSegments: [
      {
        id: 't1',
        description: 'Linha',
        quantity: 1,
        lengthM: 10,
        internalDiameterMm: 100,
        fillPercent: 100
      }
    ]
  });

  const umCiclo = motor.calculateEstimate(comCircuito({ ...base, cycles: 1 }));
  const doisCiclos = motor.calculateEstimate(comCircuito({ ...base, cycles: 2 }));

  assert.ok(
    Number(doisCiclos.totalVolumeLiters) > Number(umCiclo.totalVolumeLiters),
    'duas passagens consomem mais que uma'
  );
});

test('equipamento desmarcado não soma volume', () => {
  const equipamento = incluido => ({
    id: 'e1',
    description: 'Reservatório',
    quantity: 1,
    volumeLiters: 500,
    included: incluido
  });

  const dentro = motor.calculateEstimate(
    comCircuito(circuito({ equipmentVolumes: [equipamento(true)] }))
  );
  const fora = motor.calculateEstimate(
    comCircuito(circuito({ equipmentVolumes: [equipamento(false)] }))
  );

  assert.ok(Number(dentro.totalVolumeLiters) > Number(fora.totalVolumeLiters));
});

test('as quatro coleções somam no mesmo volume', () => {
  const completo = circuito({
    pipeSegments: [
      { id: 't1', description: 'T', quantity: 1, lengthM: 5, internalDiameterMm: 50, fillPercent: 100 }
    ],
    hoseSegments: [
      { id: 'm1', description: 'M', quantity: 1, lengthM: 5, internalDiameterMm: 25, fillPercent: 100 }
    ],
    equipmentVolumes: [
      { id: 'e1', description: 'E', quantity: 1, volumeLiters: 100, included: true }
    ],
    manualVolumes: [{ id: 'v1', description: 'V', quantity: 1, volumeLiters: 50 }]
  });

  const soTubo = motor.calculateEstimate(
    comCircuito(circuito({ pipeSegments: completo.pipeSegments }))
  );
  const tudo = motor.calculateEstimate(comCircuito(completo));

  assert.ok(
    Number(tudo.totalVolumeLiters) > Number(soTubo.totalVolumeLiters),
    'mangueira, equipamento e volume manual têm de somar'
  );
});

// ---------------------------------------------------------------------------
// Produtos dosados sobre o volume
// ---------------------------------------------------------------------------

function circuitoDe1000L() {
  // Tubo de 200 mm e ~31,8 m ≈ 1000 L. Usar um volume redondo torna as
  // asserções de dosagem legíveis.
  return circuito({
    id: 'c1',
    pipeSegments: [
      {
        id: 't1',
        description: 'Linha',
        quantity: 1,
        lengthM: 31.831,
        internalDiameterMm: 200,
        fillPercent: 100
      }
    ]
  });
}

function produto(extras = {}) {
  return {
    id: 'p1',
    systemId: 'c1',
    productName: 'Detergente',
    unit: 'kg',
    doseMode: 'percent_volume',
    dose: 2,
    densityKgPerL: 1,
    wastePercent: 0,
    packageSize: 1,
    priceBasis: 'unit',
    unitCost: 10,
    manualQuantity: 0,
    included: true,
    ...extras
  };
}

function comProduto(p, c = circuitoDe1000L()) {
  const base = motor.createDefaultCostEstimatePayload();
  return comServicos(
    { ...base, volumeSystems: [c], products: [p] },
    'limpeza_quimica'
  );
}

test('produto dosado por % do volume gera necessidade proporcional', () => {
  const dois = motor.calculateEstimate(comProduto(produto({ dose: 2 })));
  const quatro = motor.calculateEstimate(comProduto(produto({ dose: 4 })));

  const um = Number(dois.productResults[0].requiredQuantity);
  const outro = Number(quatro.productResults[0].requiredQuantity);

  assert.ok(um > 0, 'dosagem de 2% tem de gerar necessidade');
  assert.ok(Math.abs(outro / um - 2) < 0.01, 'dobrar a dosagem dobra a necessidade');
});

test('um produto pode ser dimensionado para todos os circuitos de uma vez', () => {
  const circuitos = [
    circuito({
      id: 'c1',
      manualVolumes: [{ id: 'v1', description: 'Volume 1', quantity: 1, volumeLiters: 100 }]
    }),
    circuito({
      id: 'c2',
      manualVolumes: [{ id: 'v2', description: 'Volume 2', quantity: 1, volumeLiters: 200 }]
    }),
    circuito({
      id: 'c3',
      manualVolumes: [{ id: 'v3', description: 'Volume 3', quantity: 1, volumeLiters: 300 }]
    })
  ];
  const base = motor.createDefaultCostEstimatePayload();

  const todos = motor.calculateEstimate(comServicos({
    ...base,
    volumeSystems: circuitos,
    products: [produto({ systemId: '*', dose: 1 })]
  }, 'limpeza_quimica'));
  const apenasPrimeiro = motor.calculateEstimate(comServicos({
    ...base,
    volumeSystems: circuitos,
    products: [produto({ systemId: 'c1', dose: 1 })]
  }, 'limpeza_quimica'));

  assert.equal(Number(todos.productResults[0].sourceVolumeLiters), 600);
  assert.equal(
    Number(todos.productResults[0].requiredQuantity),
    Number(apenasPrimeiro.productResults[0].requiredQuantity) * 6,
    'a dosagem única deve considerar a soma dos três circuitos'
  );
});

test('a EMBALAGEM arredonda a compra para cima', () => {
  // É a diferença entre o que o cálculo pede e o que se compra de verdade.
  const emBaldes = motor.calculateEstimate(comProduto(produto({ packageSize: 20 })));
  const linha = emBaldes.productResults[0];

  const necessidade = Number(linha.requiredQuantity);
  const compra = Number(linha.purchaseQuantity);

  assert.ok(compra >= necessidade, 'nunca se compra menos que o necessário');
  assert.equal(
    compra % 20,
    0,
    'a compra tem de ser múltiplo da embalagem — não dá para comprar meio balde'
  );
});

test('produto sem circuito usa quantidade manual', () => {
  const manual = motor.calculateEstimate(
    comProduto(produto({ systemId: '', doseMode: 'manual', manualQuantity: 50 }))
  );
  assert.ok(
    Number(manual.productResults[0].requiredQuantity) > 0,
    'quantidade manual tem de valer quando não há circuito'
  );
});

test('perda percentual aumenta a necessidade', () => {
  const semPerda = motor.calculateEstimate(comProduto(produto({ wastePercent: 0 })));
  const comPerda = motor.calculateEstimate(comProduto(produto({ wastePercent: 10 })));

  assert.ok(
    Number(comPerda.productResults[0].requiredQuantity) >
      Number(semPerda.productResults[0].requiredQuantity)
  );
});

test('circuito maior consome mais produto — é a ligação entre os dois blocos', () => {
  const pequeno = circuitoDe1000L();
  const grande = circuito({
    id: 'c1',
    pipeSegments: [
      {
        id: 't1',
        description: 'Linha',
        quantity: 2,
        lengthM: 31.831,
        internalDiameterMm: 200,
        fillPercent: 100
      }
    ]
  });

  const menor = motor.calculateEstimate(comProduto(produto(), pequeno));
  const maior = motor.calculateEstimate(comProduto(produto(), grande));

  assert.ok(
    Number(maior.productResults[0].requiredQuantity) >
      Number(menor.productResults[0].requiredQuantity),
    'dimensionar o circuito errado erra a compra de produto'
  );
});

test('produto desmarcado não custa', () => {
  const dentro = motor.calculateEstimate(comProduto(produto({ included: true })));
  const fora = motor.calculateEstimate(comProduto(produto({ included: false })));

  assert.ok(Number(dentro.inputCost) > Number(fora.inputCost));
});

test('produto incluído desliga a pendência de insumos', () => {
  assert.equal(faltaInsumos(comProduto(produto())), false);
});

test('produto químico considera somente os circuitos com limpeza química', () => {
  const base = motor.createDefaultCostEstimatePayload();
  const circuitos = [
    circuito({
      id: 'c1',
      manualVolumes: [{ id: 'v1', description: 'Volume 1', quantity: 1, volumeLiters: 100 }]
    }),
    circuito({
      id: 'c2',
      manualVolumes: [{ id: 'v2', description: 'Volume 2', quantity: 1, volumeLiters: 200 }]
    })
  ];
  const resultado = motor.calculateEstimate({
    ...base,
    volumeSystems: circuitos,
    circuitServices: [
      { id: 's1', systemId: 'c1', serviceId: 'flushing_primario' },
      { id: 's2', systemId: 'c2', serviceId: 'limpeza_quimica' }
    ],
    products: [produto({ systemId: '*', dose: 1 })]
  });

  assert.equal(Number(resultado.productResults[0].sourceVolumeLiters), 200);
});

test('todo circuito novo precisa ter ao menos um serviço válido', () => {
  const base = motor.createDefaultCostEstimatePayload();
  const validacao = motor.validateCostEstimate({
    ...base,
    volumeSystems: [circuito({ id: 'c1' })],
    circuitServices: []
  });

  assert.ok(validacao.errors.some(item => item.path === 'circuitServices'));
  assert.equal(motor.hasCompleteCircuitServices({
    ...base,
    volumeSystems: [circuito({ id: 'c1' })],
    circuitServices: [{ id: 's1', systemId: 'c1', serviceId: 'teste_hidrostatico' }]
  }), true);
});

test('levantamento antigo sem associações preserva o cálculo anterior', () => {
  const base = motor.createDefaultCostEstimatePayload();
  const { circuitServices: _ignorado, ...legado } = base;
  const resultado = motor.calculateEstimate({
    ...legado,
    filters: [{
      id: 'f-legado',
      filterName: 'Filtro legado',
      micronRating: '10 µm',
      unit: 'un.',
      quantity: 1,
      unitCost: 75,
      included: true
    }]
  });

  assert.equal(Number(resultado.filterCost), 75);
});

test('a tela renderiza químicos e filtros somente quando o serviço exige', () => {
  const secao = readFileSync(
    new URL(
      '../src/pages/comercial/custos/sections/InsumosSection.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(secao, /exibirProdutosQuimicos && <ProdutosBloco/);
  assert.match(secao, /exibirFiltros && <FiltrosTabela/);
  assert.match(secao, /<ServicosDosCircuitosBloco levantamento=\{levantamento\}/);
});
