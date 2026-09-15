import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

let server;
let mod;
let motor;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });
  mod = await server.ssrLoadModule(
    '/src/pages/comercial/proposta/levantamentoVinculado.ts'
  );
  motor = await server.ssrLoadModule(
    '/../shared/comercial/dist/cost-model.js'
  );
});

test.after(async () => {
  await server?.close();
});

test('o Decimal da API vira moeda brasileira sem ganhar ou perder centavos', () => {
  assert.equal(mod.formatarValorDoLevantamento('38139.33'), 'R$ 38.139,33');
  assert.equal(mod.formatarValorDoLevantamento(100), 'R$ 100,00');
  assert.equal(mod.formatarValorDoLevantamento(null), '');
});

test('a mobilização adicional importa só a ida da equipe', () => {
  const payload = motor.createDefaultCostEstimatePayload();
  payload.logistics = payload.logistics.map(item => ({
    ...item,
    calculationMode: 'legacy',
    calculationModeConfirmed: true,
    basis: 'fixed',
    quantity: 1,
    contingencyPercent: 0,
    unitCost:
      item.direction === 'mobilization' && item.slotType === 'crew'
        ? 1250
        : item.slotType === 'equipment'
          ? 9000
          : 7000
  }));

  const valor = mod.valorDaMobilizacaoDeEquipeDoLevantamento({ payload });
  assert.equal(valor, 'R$ 1.250,00');
});

test('finalização e escolha manual usam o mesmo endereço de importação', () => {
  const parametros = mod.parametrosDaPropostaComLevantamento({
    id: 'levantamento-1',
    proposalCode: '4418',
    revisionNumber: 2
  });

  assert.deepEqual(Object.fromEntries(parametros), {
    levantamento: 'levantamento-1',
    proposta: '4418',
    modo: 'revision',
    revisao: '2',
    etapa: 'cliente',
    usarLevantamento: '1'
  });
});

test('a escolha manual mostra rascunhos e pede sua conclusão antes de criar proposta', () => {
  const dialogo = readFileSync(
    new URL(
      '../src/pages/comercial/proposta/PropostaModeDialog.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.doesNotMatch(dialogo, /status: 'SALVO'/);
  assert.match(dialogo, /setLevantamentos\(resposta\.items\)/);
  assert.match(dialogo, /Rascunho salvo/);
  assert.match(dialogo, /if \(!proposta && rascunho\) return onConcluirLevantamento\(item\)/);
  assert.match(dialogo, /Continuar proposta/);
  assert.match(dialogo, /Tentar integrações novamente/);
});

test('uma validação pendente salva o rascunho e não segue para a proposta', () => {
  const paginaDeCustos = readFileSync(
    new URL('../src/pages/comercial/custos/CustosPage.tsx', import.meta.url),
    'utf8'
  );

  assert.match(paginaDeCustos, /gravado = await persistir\('SALVO'\)/);
  assert.match(paginaDeCustos, /error instanceof ComercialValidationError/);
  assert.match(
    paginaDeCustos,
    /rascunhoGravado = await persistir\('RASCUNHO'\)/
  );
  assert.match(paginaDeCustos, /setFocarPendencia\(true\)/);

  const inicioDaContingencia = paginaDeCustos.indexOf(
    "const rascunhoGravado = await persistir('RASCUNHO')"
  );
  const devolucaoParaValidacao = paginaDeCustos.indexOf(
    'throw error;',
    inicioDaContingencia
  );
  const trechoDaContingencia = paginaDeCustos.slice(
    inicioDaContingencia,
    devolucaoParaValidacao
  );
  assert.doesNotMatch(
    trechoDaContingencia,
    /parametrosDaPropostaComLevantamento/
  );
  assert.match(
    paginaDeCustos,
    /parametrosDaPropostaComLevantamento\(gravado\)/
  );
});

test('o preço do levantamento entra na proposta como verba global editável', () => {
  assert.deepEqual(
    mod.itemDePrecoDoLevantamento({
      title: 'Limpeza química do circuito A',
      salePrice: '38139.33'
    }),
    {
      description: 'Limpeza química do circuito A',
      unit: 'VB',
      quantity: '1',
      unitValue: 'R$ 38.139,33',
      value: 'R$ 38.139,33'
    }
  );
});

test('o preço importado pode nascer no cenário ONSHORE do hidrojateamento', () => {
  assert.deepEqual(
    mod.itemDePrecoDoLevantamento(
      {
        title: 'Teste de pressão e limpeza química',
        salePrice: '38139.33'
      },
      { local: 'ONSHORE' }
    ),
    {
      description: 'Teste de pressão e limpeza química',
      unit: 'VB',
      quantity: '1',
      unitValue: 'R$ 38.139,33',
      value: 'R$ 38.139,33',
      local: 'ONSHORE'
    }
  );
});

test('proposta salva só recebe o levantamento quando ainda está sem preço', () => {
  assert.equal(
    mod.precosPrecisamDoLevantamento([
      {
        description: 'Serviço especializado conforme escopo',
        unit: 'VB',
        quantity: '1',
        unitValue: 'R$ 0,00',
        value: 'R$ 0,00'
      }
    ]),
    true
  );
  assert.equal(
    mod.precosPrecisamDoLevantamento([
      {
        description: 'Descrição ajustada pelo comercial',
        unit: 'VB',
        quantity: '1',
        unitValue: 'R$ 12.345,67',
        value: 'R$ 12.345,67'
      }
    ]),
    false
  );
});

test('a descrição genérica recebe os serviços sem sobrescrever preço já negociado', () => {
  assert.deepEqual(
    mod.preencherPrecosAusentesDoLevantamento(
      [
        {
          description: 'Serviço especializado conforme escopo',
          unit: 'VB',
          quantity: '1',
          unitValue: 'R$ 12.345,67',
          value: 'R$ 12.345,67'
        }
      ],
      {
        description: 'Teste de pressão e limpeza química',
        unit: 'VB',
        quantity: '1',
        unitValue: 'R$ 38.139,33',
        value: 'R$ 38.139,33',
        local: 'ONSHORE'
      }
    ),
    [
      {
        description: 'Teste de pressão e limpeza química',
        unit: 'VB',
        quantity: '1',
        unitValue: 'R$ 12.345,67',
        value: mod.formatarValorDoLevantamento('12345.67'),
        local: 'ONSHORE'
      }
    ]
  );
});

test('continuar proposta vinculada solicita o preenchimento dos campos ausentes', () => {
  const pagina = readFileSync(
    new URL('../src/pages/comercial/proposta/PropostaPage.tsx', import.meta.url),
    'utf8'
  );

  assert.match(
    pagina,
    /continuarPropostaDoLevantamento[\s\S]*?usarLevantamento: '1'/
  );
  assert.match(
    pagina,
    /preencherPrecosAusentesDoLevantamento\(atuais, importado\)/
  );
  assert.match(pagina, /servicosImportadosDoLevantamento\(levantamento\)/);
  assert.match(pagina, /preencherEscopoAusenteDoLevantamento/);
  assert.match(pagina, /preencherServicosTecnicosAusentesDoLevantamento/);
  assert.match(pagina, /valorDaMobilizacaoDeEquipeDoLevantamento\(levantamento\)/);
  assert.match(pagina, /extraMobilization: mobilizacaoDaEquipe/);
});

test('o local da obra vem do destino principal orçado no levantamento', () => {
  assert.equal(
    mod.localDaObraDoLevantamento({
      payload: {
        logisticsDestinations: [
          { id: 'apoio', address: 'Rua do Almoxarifado, 10' },
          {
            id: 'obra-principal',
            address: 'Rodovia BR-040, km 620 — Congonhas/MG'
          }
        ]
      }
    }),
    'Rodovia BR-040, km 620 — Congonhas/MG'
  );
});

test('levantamento antigo usa o primeiro destino com endereço', () => {
  assert.equal(
    mod.localDaObraDoLevantamento({
      payload: {
        logisticsDestinations: [
          { id: 'sem-endereco', address: '   ' },
          { id: 'destino-legado', address: 'Usina Industrial — Betim/MG' }
        ]
      }
    }),
    'Usina Industrial — Betim/MG'
  );
  assert.equal(mod.localDaObraDoLevantamento({ payload: {} }), '');
});

test('serviços por circuito viram escopo e modelos técnicos da proposta', () => {
  const importados = mod.servicosImportadosDoLevantamento({
    payload: {
      volumeSystems: [
        { id: 'c1', name: 'Circuito 1', material: 'carbon_steel', enabled: true },
        { id: 'c2', name: 'Circuito 2', material: 'stainless_steel', enabled: true },
        { id: 'c3', name: 'Circuito 3', material: 'other', enabled: true }
      ],
      circuitServices: [
        { id: 's1', systemId: 'c1', serviceId: 'filtragem_hidraulico_lubrificante' },
        { id: 's2', systemId: 'c2', serviceId: 'limpeza_quimica' },
        { id: 's3', systemId: 'c2', serviceId: 'flushing_primario' },
        { id: 's4', systemId: 'c3', serviceId: 'flushing_primario' }
      ]
    }
  });

  assert.deepEqual(importados.escopo.map(item => item.title), [
    'Filtragem de óleo hidráulico/lubrificante',
    'Limpeza química',
    'Flushing primário'
  ]);
  assert.match(importados.escopo[0].description, /Sistema contemplado: Circuito 1\./);
  assert.match(importados.escopo[1].description, /Aço inoxidável/);
  assert.match(importados.escopo[2].description, /Sistemas contemplados: Circuito 2, Circuito 3\./);
  assert.deepEqual(importados.tecnicos.map(item => item.serviceId), [
    'filtragem_hidraulico_lubrificante',
    'limpeza_quimica',
    'flushing_primario'
  ]);
  assert.equal(importados.tecnicos[1].parameters.material, 'Aço inoxidável');
});

test('escopo importado substitui apenas o cartão inicial ainda vazio', () => {
  const importado = [{ id: 'e1', title: 'Limpeza química', description: 'Texto técnico' }];
  assert.deepEqual(
    mod.preencherEscopoAusenteDoLevantamento(
      [{ id: 'escopo-inicial', title: 'Serviço 1', description: '' }],
      importado
    ),
    importado
  );

  const editado = [{ id: 'e2', title: 'Escopo negociado', description: 'Não sobrescrever' }];
  assert.deepEqual(
    mod.preencherEscopoAusenteDoLevantamento(editado, importado),
    editado
  );
});
