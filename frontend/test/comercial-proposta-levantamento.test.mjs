import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

let server;
let mod;

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
});

test.after(async () => {
  await server?.close();
});

test('o Decimal da API vira moeda brasileira sem ganhar ou perder centavos', () => {
  assert.equal(mod.formatarValorDoLevantamento('38139.33'), 'R$ 38.139,33');
  assert.equal(mod.formatarValorDoLevantamento(100), 'R$ 100,00');
  assert.equal(mod.formatarValorDoLevantamento(null), '');
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

test('a escolha manual pede apenas levantamentos concluídos ao servidor', () => {
  const dialogo = readFileSync(
    new URL(
      '../src/pages/comercial/proposta/PropostaModeDialog.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(dialogo, /status: 'SALVO'/);
  assert.match(
    dialogo,
    /resposta\.items\.filter\(\(?item\)? => item\.status === 'SALVO'\)/
  );
  assert.doesNotMatch(dialogo, /Rascunho salvo/);
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
        value: 'R$ 12.345,67',
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
