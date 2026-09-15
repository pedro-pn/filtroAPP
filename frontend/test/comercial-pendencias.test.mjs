import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

/**
 * Predicados de pendência — o que faz o rodapé-guia dizer a verdade.
 *
 * Até aqui o rodapé sabia a CADEIA (qual seção vem antes de qual) mas recebia
 * pendências fixas em `false`. Com estes predicados ele passa a dizer
 * "Preencher itens obrigatórios da mão de obra →" quando realmente falta.
 *
 * O caso que mais importa e que é fácil errar: **a confirmação de escopo
 * desliga a pendência**. Um levantamento pode legitimamente não ter mão de
 * obra, e sem isso ele ficaria travado para sempre — com a saída óbvia sendo
 * preencher qualquer coisa, que produz preço errado.
 */

let server;
let faltaMaoDeObra;
let faltaInsumos;
let faltaComercial;
let pendenciasDe;
let motor;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });
  ({ faltaMaoDeObra, faltaInsumos, faltaComercial, pendenciasDe } =
    await server.ssrLoadModule('/src/pages/comercial/custos/pendencias.ts'));
  motor = await server.ssrLoadModule('/../shared/comercial/dist/cost-model.js');
});

test.after(async () => {
  await server?.close();
});

function padrao() {
  return motor.createDefaultCostEstimatePayload();
}

test('o levantamento padrão pende em mão de obra e em insumos', () => {
  // É o estado do cenário golden 01, que devolve 12 erros: o formulário abre
  // sem nada preenchido e sem nenhuma confirmação.
  const draft = padrao();
  assert.equal(faltaMaoDeObra(draft), true);
  assert.equal(faltaInsumos(draft), true);
});

test('confirmar "sem mão de obra" desliga a pendência', () => {
  const draft = padrao();
  assert.equal(faltaMaoDeObra(draft), true);

  const confirmado = {
    ...draft,
    scopeConfirmations: { ...draft.scopeConfirmations, noLabor: true }
  };
  assert.equal(
    faltaMaoDeObra(confirmado),
    false,
    'sem isto, levantamento sem mão de obra fica travado para sempre'
  );
});

test('confirmar "sem insumos" desliga a pendência de insumos', () => {
  const draft = padrao();
  const confirmado = {
    ...draft,
    circuitServices: draft.volumeSystems
      .filter(circuito => circuito.enabled !== false)
      .map((circuito, indice) => ({
        id: `servico-${indice + 1}`,
        systemId: circuito.id,
        serviceId: 'teste_hidrostatico'
      })),
    scopeConfirmations: { ...draft.scopeConfirmations, noInputs: true }
  };
  assert.equal(faltaInsumos(confirmado), false);
});

test('fase sem condição de trabalho mantém a pendência', () => {
  // O cenário 02 tem composição válida — serve de base para isolar a condição.
  const draft = padrao();
  const comFase = {
    ...draft,
    laborContexts: [
      {
        id: 'f1',
        enabled: true,
        workCondition: '',
        workConditionConfirmed: false,
        vehicleType: 'van',
        expenses: [],
        assignments: []
      }
    ]
  };
  assert.equal(faltaMaoDeObra(comFase), true);
});

test('escolher a condição sem CONFIRMAR não basta', () => {
  // São duas coisas, e é fácil tratar como uma. Escolher sem confirmar deixa a
  // fase com base de cálculo por definir, e o custo sai plausível e errado.
  const draft = padrao();
  const escolhidaSemConfirmar = {
    ...draft,
    laborContexts: [
      {
        id: 'f1',
        enabled: true,
        workCondition: 'headquarters',
        workConditionConfirmed: false,
        vehicleType: 'van',
        expenses: [],
        assignments: []
      }
    ]
  };
  assert.equal(faltaMaoDeObra(escolhidaSemConfirmar), true);
});

test('fase desabilitada não gera pendência', () => {
  const draft = padrao();
  const desabilitada = {
    ...draft,
    scopeConfirmations: { ...draft.scopeConfirmations, noLabor: true },
    laborContexts: [{ id: 'f1', enabled: false, workCondition: '', expenses: [] }]
  };
  assert.equal(faltaMaoDeObra(desabilitada), false);
});

test('fase em viagem exige distância hotel-obra', () => {
  const draft = padrao();
  const semDistancia = {
    ...draft,
    laborContexts: [
      {
        id: 'f1',
        enabled: true,
        workCondition: 'travel',
        workConditionConfirmed: true,
        vehicleType: 'van',
        hotelSiteDistanceKmPerDay: 0,
        expenses: [],
        assignments: []
      }
    ]
  };
  assert.equal(faltaMaoDeObra(semDistancia), true);
});

test('fase em viagem exige o combustível do trajeto, com quantidade E valor', () => {
  const draft = padrao();
  const base = {
    id: 'f1',
    enabled: true,
    workCondition: 'travel',
    workConditionConfirmed: true,
    vehicleType: 'van',
    hotelSiteDistanceKmPerDay: 50,
    assignments: []
  };
  const codigo = motor.HOTEL_SITE_COMMUTE_EXPENSE_CODE;

  const semDespesa = { ...draft, laborContexts: [{ ...base, expenses: [] }] };
  assert.equal(faltaMaoDeObra(semDespesa), true, 'sem a despesa');

  const excluida = {
    ...draft,
    laborContexts: [
      { ...base, expenses: [{ code: codigo, included: false, quantity: 1, unitValue: 50 }] }
    ]
  };
  assert.equal(faltaMaoDeObra(excluida), true, 'despesa marcada como não incluída');

  const semValor = {
    ...draft,
    laborContexts: [
      { ...base, expenses: [{ code: codigo, included: true, quantity: 1, unitValue: 0 }] }
    ]
  };
  assert.equal(faltaMaoDeObra(semValor), true, 'quantidade sem valor unitário');
});

test('fase em Sede NÃO exige distância nem combustível de viagem', () => {
  // A condição só vale para `travel`. Cobrar em Sede travaria o levantamento
  // mais comum do app.
  const draft = padrao();
  const sede = {
    ...draft,
    laborContexts: [
      {
        id: 'f1',
        enabled: true,
        workCondition: 'headquarters',
        workConditionConfirmed: true,
        vehicleType: 'van',
        hotelSiteDistanceKmPerDay: 0,
        expenses: [],
        assignments: []
      }
    ]
  };
  // Ainda pode pender por falta de composição, mas não pelas regras de viagem.
  const semComposicao = faltaMaoDeObra(sede);
  const comConfirmacao = faltaMaoDeObra({
    ...sede,
    scopeConfirmations: { ...draft.scopeConfirmations, noLabor: true }
  });
  assert.equal(comConfirmacao, false);
  assert.equal(typeof semComposicao, 'boolean');
});

test('"Sem veículo" é uma escolha obrigatória válida e não cobra custos rodoviários', () => {
  const draft = padrao();
  const semVeiculo = {
    ...draft,
    laborContexts: [{
      ...draft.laborContexts[0],
      enabled: true,
      workCondition: 'travel',
      workConditionConfirmed: true,
      vehicleType: 'none',
      hotelSiteDistanceKmPerDay: 0,
      expenses: [],
      assignments: [{
        id: 'sem-veiculo-a1',
        role: motor.LEC_LABOR_ROLES[0].role,
        quantity: 1,
        monthlySalary: motor.LEC_LABOR_ROLES[0].salary,
        adjustment: 0,
        allocationPercent: 100,
        shift: 'day'
      }]
    }]
  };

  assert.equal(faltaMaoDeObra(semVeiculo), false);
  assert.equal(
    motor.validateCostEstimate(semVeiculo).errors.some(
      issue => /vehicleType|hotelSiteDistanceKmPerDay|expenses/.test(issue.path)
    ),
    false
  );
});

test('comissão de representante só pende quando HABILITADA', () => {
  const draft = padrao();

  assert.equal(
    faltaComercial(draft),
    false,
    'quem não usa comissão de representante não pode ver pendência'
  );

  const habilitadaVazia = {
    ...draft,
    commercial: {
      ...(draft.commercial || {}),
      representativeCommission: { enabled: true, representativeName: '', percent: 0 }
    }
  };
  assert.equal(faltaComercial(habilitadaVazia), true);

  const completa = {
    ...draft,
    commercial: {
      ...(draft.commercial || {}),
      representativeCommission: { enabled: true, representativeName: 'ACME', percent: 3 }
    }
  };
  assert.equal(faltaComercial(completa), false);
});

test('pendenciasDe devolve o formato que o rodapé consome', () => {
  const p = pendenciasDe(padrao());
  assert.deepEqual(Object.keys(p).sort(), ['commercial', 'inputs', 'labor', 'logistics']);
  for (const chave of Object.keys(p)) {
    assert.equal(typeof p[chave], 'boolean', `${chave} tem de ser booleano`);
  }
});

test('a cadeia está completa: logística agora sabe dizer se pende', () => {
  // Este teste substituiu um que afirmava `logistics === false` fixo, com a
  // justificativa de que a seção não estava portada. A omissão acabou, e o
  // teste que a guardava acusou na hora — que é exatamente o que ele existia
  // para fazer.
  const p = pendenciasDe(padrao());
  assert.equal(
    p.logistics,
    true,
    'o levantamento padrão não tem logística definida, então tem de pender'
  );

  const confirmado = pendenciasDe({
    ...padrao(),
    scopeConfirmations: { ...padrao().scopeConfirmations, noLogistics: true }
  });
  assert.equal(confirmado.logistics, false, 'confirmar "sem logística" desliga');
});

// ---------------------------------------------------------------------------
// Resumo e QQP — a quarta pendência, e o preço global
// ---------------------------------------------------------------------------

test('preço global fechado impõe o valor em vez de derivá-lo do custo', () => {
  // Não é desconto: o motor recalcula margem e saldo por diferença. Quem digita
  // um preço achando que está dando desconto está mudando a conta inteira.
  const base = padrao();
  const calculado = motor.calculateEstimate(base);

  const imposto = motor.calculateEstimate({
    ...base,
    commercial: { ...base.commercial, pricingMode: 'global', globalValue: 50000 }
  });

  assert.notEqual(
    Number(imposto.salePrice),
    Number(calculado.salePrice),
    'o preço global tem de substituir o derivado do custo'
  );
});

test('comissão de representante entra na formação do preço', () => {
  const base = padrao();

  const sem = motor.calculateEstimate(base);
  const com = motor.calculateEstimate({
    ...base,
    commercial: {
      ...base.commercial,
      representativeCommission: {
        enabled: true,
        representativeName: 'ACME',
        percent: 5,
        basis: 'net_after_tax'
      }
    }
  });

  assert.ok(
    Number(com.commissionValue) >= Number(sem.commissionValue),
    'a comissão tem de aparecer no valor de comissão'
  );
});

test('a quarta pendência do rodapé é a de comissões', () => {
  const base = padrao();
  const incompleta = {
    ...base,
    commercial: {
      ...base.commercial,
      representativeCommission: { enabled: true, representativeName: '', percent: 0 }
    }
  };

  assert.equal(pendenciasDe(incompleta).commercial, true);
  assert.equal(
    pendenciasDe(base).commercial,
    false,
    'sem representante habilitado não há pendência comercial'
  );
});
