import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

/**
 * As 7 etapas da proposta: abas livres no rascunho, validação ao salvar/emitir
 * e bloqueio de edição depois da emissão.
 */

let server;
let mod;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });
  mod = await server.ssrLoadModule('/src/pages/comercial/proposta/etapas.ts');
});

test.after(async () => {
  await server?.close();
});

const completo = {
  seller: 'u1',
  date: '2026-08-03',
  client: 'Cliente S.A.',
  cnpj: '11.222.333/0001-81',
  contact: 'Ana',
  email: 'ana@cliente.com.br',
  site: 'Unidade industrial, Volta Redonda/RJ'
};

test('as 7 etapas estão na ordem da referência', () => {
  assert.deepEqual(
    mod.ETAPAS.map(e => e.value),
    ['cliente', 'escopo', 'responsabilidades', 'prazos', 'tecnica', 'comercial', 'revisao']
  );
});

test('rascunhos novos, reabertos e revisões permitem acessar qualquer aba', () => {
  for (const { value } of mod.ETAPAS) {
    assert.equal(mod.podeAcessarEtapa('RASCUNHO', value), true, value);
  }
});

test('propostas emitidas continuam restritas à revisão, inclusive após falha de integração', () => {
  for (const status of ['FINALIZADA', 'FALHA_INTEGRACAO']) {
    for (const { value } of mod.ETAPAS) {
      assert.equal(mod.podeAcessarEtapa(status, value), value === 'revisao', `${status}: ${value}`);
    }
  }
});

test('a conclusão verifica as etapas puladas e preserva o endereço de cada campo', () => {
  const dados = { itens: [{}], responsabilidades: [], errosTecnicos: ['x'], precos: [] };
  const pendencias = mod.pendenciasDaProposta({}, dados);
  assert.deepEqual(
    [...new Set(pendencias.map(p => p.etapa))],
    ['cliente', 'escopo', 'responsabilidades', 'prazos', 'tecnica', 'comercial']
  );
  for (const { value: etapa } of mod.ETAPAS) {
    assert.deepEqual(
      pendencias.filter(p => p.etapa === etapa).map(({ etapa: _, ...p }) => p),
      mod.pendenciasDaEtapa(etapa, {}, dados)
    );
  }
  assert.equal(mod.pendenciasDaProposta(completo, dados)[0].etapa, 'escopo');
});

test('a tela libera as abas sem validar o clique e confere todas antes de emitir', () => {
  const pagina = readFileSync(
    new URL('../src/pages/comercial/proposta/PropostaPage.tsx', import.meta.url), 'utf8'
  );
  assert.match(pagina, /const alcancavel = podeAcessarEtapa\(statusProposta, item.value\)/);
  assert.match(pagina, /onClick=\{\(\) => alcancavel && irPara\(item.value\)\}/);
  assert.doesNotMatch(pagina, /maiorVisitada|setMaiorVisitada/);
  const conclusao = pagina.slice(pagina.indexOf('if (ultima) {'), pagina.indexOf('const id = await salvar();'));
  assert.match(conclusao, /pendenciasDoFormulario\[0\]/);
  assert.match(conclusao, /irPara\(pendencia.etapa\)/);
  assert.match(conclusao, /setTentouAvancar\(true\)/);
  assert.match(conclusao, /setEtapaParaFocar\(pendencia.etapa\)/);
  assert.match(pagina, /if \(etapaParaFocar !== etapa\) return/);
  assert.ok(conclusao.indexOf('return;') < conclusao.indexOf('finalizacao.concluirFinalizacao()'));
});

test('formulário completo não tem pendência', () => {
  assert.deepEqual(mod.pendenciasDoCliente(completo), []);
});

test('cada obrigatório vazio produz UMA pendência endereçada', () => {
  for (const campo of ['seller', 'date', 'client', 'contact', 'site', 'cnpj', 'email']) {
    const pendencias = mod.pendenciasDoCliente({ ...completo, [campo]: '' });
    assert.equal(pendencias.length, 1, campo);
    assert.equal(pendencias[0].campo, campo);
  }
});

test('vazio e inválido são DOIS estados, com mensagens diferentes', () => {
  // Trocar os dois faz o usuário procurar erro de digitação num campo que ele
  // simplesmente não preencheu.
  const vazio = mod.pendenciasDoCliente({ ...completo, email: '' })[0];
  const invalido = mod.pendenciasDoCliente({ ...completo, email: 'ana@' })[0];

  assert.match(vazio.mensagem, /Informe/);
  assert.match(invalido.mensagem, /válido/);
  assert.notEqual(vazio.mensagem, invalido.mensagem);
});

test('CNPJ confere os dígitos verificadores, não só a contagem', () => {
  // A referência conferia só o comprimento. O CNPJ vai impresso no documento
  // fiscal: um dígito trocado inutiliza a proposta inteira.
  assert.equal(mod.cnpjValido('11.222.333/0001-81'), true);
  assert.equal(mod.cnpjValido('11.222.333/0001-82'), false, 'verificador errado');
  assert.equal(mod.cnpjValido('11222333000181'), true, 'sem máscara também vale');
  assert.equal(mod.cnpjValido('1122233300018'), false, '13 dígitos');
  assert.equal(mod.cnpjValido('11111111111111'), false, 'todos iguais');
});

test('a máscara do CNPJ vai se formando enquanto se digita', () => {
  assert.equal(mod.formatarCnpj('11'), '11');
  assert.equal(mod.formatarCnpj('11222'), '11.222');
  assert.equal(mod.formatarCnpj('11222333'), '11.222.333');
  assert.equal(mod.formatarCnpj('112223330001'), '11.222.333/0001');
  assert.equal(mod.formatarCnpj('11222333000181'), '11.222.333/0001-81');
  assert.equal(mod.formatarCnpj('112223330001819999'), '11.222.333/0001-81', 'não passa de 14');
});

test('e-mail exige arroba e domínio com ponto', () => {
  assert.equal(mod.emailValido('ana@cliente.com.br'), true);
  assert.equal(mod.emailValido('ana@cliente'), false);
  assert.equal(mod.emailValido('ana cliente@x.com'), false);
  assert.equal(mod.emailValido('  ana@cliente.com  '), true, 'espaço nas pontas não conta');
});

test('as SEIS primeiras etapas travam; a última não tem o que travar', () => {
  // Este teste começou guardando a omissão ("etapa não portada não trava") e foi
  // encolhendo a cada etapa portada — era exatamente para isso que existia.
  // Agora ele afirma o contrário: toda etapa com campo obrigatório recusa o
  // formulário vazio.
  const vazio = { itens: [{}], responsabilidades: [], errosTecnicos: ['x'], precos: [] };

  for (const etapa of ['cliente', 'escopo', 'responsabilidades', 'prazos', 'tecnica', 'comercial']) {
    assert.ok(mod.pendenciasDaEtapa(etapa, {}, vazio).length > 0, etapa);
  }

  // Revisão não tem campo obrigatório próprio: tudo que ela mostra veio das
  // anteriores, e o que falta lá é integração, não preenchimento.
  assert.deepEqual(mod.pendenciasDaEtapa('revisao', {}, vazio), []);
});

// ---------------------------------------------------------------------------
// Etapas 2, 3 e 4
// ---------------------------------------------------------------------------

test('escopo: a descrição do serviço é opcional', () => {
  const itens = [{ title: 'Flushing', description: '' }];
  assert.deepEqual(mod.pendenciasDoEscopo('Limpeza química', itens), []);
});

test('escopo: o endereço da pendência carrega o ÍNDICE do item', () => {
  // Sem o índice, três serviços incompletos produziriam três mensagens
  // idênticas e nenhuma diria qual deles.
  const itens = [
    { title: 'A', description: 'ok' },
    { title: '', description: '' }
  ];
  const campos = mod.pendenciasDoEscopo('Título', itens).map(p => p.campo);

  assert.deepEqual(campos, ['escopo[1].title']);
});

test('escopo: título da proposta é obrigatório junto com os itens', () => {
  const pendencias = mod.pendenciasDoEscopo('  ', [{ title: 'A', description: 'B' }]);
  assert.deepEqual(pendencias.map(p => p.campo), ['title']);
});

test('responsabilidades: linha em branco não conta como preenchida', () => {
  // Mais estrito que a referência, que exigia só a existência da linha. Linha
  // vazia vira obrigação sem texto no documento.
  assert.equal(mod.pendenciasDasResponsabilidades([{ item: '   ' }]).length, 1);
  assert.equal(mod.pendenciasDasResponsabilidades([]).length, 1);
  assert.equal(mod.pendenciasDasResponsabilidades([{ item: 'Andaimes' }]).length, 0);
});

test('responsabilidades: uma linha preenchida entre várias vazias basta', () => {
  const linhas = [{ item: '' }, { item: 'Energia elétrica' }, { item: '' }];
  assert.deepEqual(mod.pendenciasDasResponsabilidades(linhas), []);
});

test('prazos: os seis campos são obrigatórios', () => {
  const completo = {
    attendance: 'até 10 dias',
    mobilization: '7 dias',
    permanence: '12 dias corridos',
    // `dias_treinamento` no documento. A linha "Prazo previsto para integração"
    // já saía impressa e não tinha campo de origem nenhum (T071c).
    integration: '1 dia',
    execution: '10 dias trabalhados',
    workday: 'Segunda a sexta, 8h às 18h'
  };
  assert.deepEqual(mod.pendenciasDosPrazos(completo), []);

  for (const campo of Object.keys(completo)) {
    const pendencias = mod.pendenciasDosPrazos({ ...completo, [campo]: '' });
    assert.equal(pendencias.length, 1, campo);
    assert.equal(pendencias[0].campo, campo);
  }
});

test('pendenciasDaEtapa despacha para a etapa certa', () => {
  const form = { title: '', attendance: '' };
  const escopo = { itens: [{ title: '', description: '' }], responsabilidades: [] };

  assert.ok(mod.pendenciasDaEtapa('escopo', form, escopo).length > 0);
  assert.equal(mod.pendenciasDaEtapa('responsabilidades', form, escopo).length, 1);
  assert.equal(mod.pendenciasDaEtapa('prazos', form, escopo).length, 6);
  // As três ainda não portadas continuam sem travar.
  assert.deepEqual(mod.pendenciasDaEtapa('tecnica', form, escopo), []);
});

test('a matriz aceita "N/A" como responsável', () => {
  // Há obrigação que não cabe a ninguém no contrato e precisa constar assim
  // mesmo, para não parecer esquecimento.
  assert.ok(mod.RESPONSAVEIS.includes('N/A'));
  assert.deepEqual(mod.linhaVazia(), {
    item: '',
    owner: 'Filtrovali',
    note: '',
    categoria: 'MÃO DE OBRA E EQUIPE TÉCNICA'
  });
});

test('a proposta nasce com a matriz do modelo, não em branco', () => {
  // A referência nascia com 17 linhas de caldeiraria e solda que não aparecem
  // em documento nenhum. Estas vêm dos `.docx`, e são ~35 obrigações que se
  // repetem em toda obra — redigitá-las a cada proposta é como o erro entra.
  const matriz = mod.matrizInicial('padrao');
  assert.ok(matriz.length > 20);
  assert.ok(matriz.some(l => l.owner === 'Filtrovali'));
  assert.ok(matriz.some(l => l.owner === 'Contratante'));
  for (const linha of matriz) assert.ok(linha.categoria.trim(), linha.item);

  const tudo = matriz.map(l => l.item).join('\n');
  for (const intruso of ['soldador', 'esmerilhadeira', 'inspetor de solda']) {
    assert.ok(!new RegExp(intruso, 'i').test(tudo), intruso);
  }

  // Hidrojateamento traz outra matriz — é o desvio 13.
  assert.notDeepEqual(mod.matrizInicial('hidrojateamento'), matriz);
});

test('equipamentos do modelo são opções e a proposta exige uma seleção', () => {
  const matriz = mod.matrizInicial('padrao');
  const equipamentos = matriz.find(mod.ehLinhaDeEquipamentosDaFiltrovali);

  assert.ok(equipamentos, 'a matriz padrão não trouxe a linha de equipamentos');
  assert.equal(
    mod.ehLinhaDeEquipamentosDaFiltrovali({
      owner: 'Filtrovali',
      categoria: 'EQUIPAMENTOS E FERRAMENTAS'
    }),
    true,
    'rascunhos antigos devem continuar reconhecendo a linha de equipamentos'
  );
  assert.deepEqual(equipamentos.subitens, [], 'a proposta prometeu o catálogo inteiro');
  assert.ok(
    mod
      .pendenciasDasResponsabilidades(matriz)
      .some(pendencia => pendencia.campo === 'equipamentos')
  );

  equipamentos.subitens = ['1 unidade de flushing primário'];
  assert.ok(
    !mod
      .pendenciasDasResponsabilidades(matriz)
      .some(pendencia => pendencia.campo === 'equipamentos')
  );
});

// ---------------------------------------------------------------------------
// Etapas 5, 6 e 7
// ---------------------------------------------------------------------------

test('a máscara de moeda lê os dígitos como CENTAVOS', () => {
  // É o comportamento da referência, e o que resolve a ambiguidade de quem
  // digita "1.500" querendo dizer mil e quinhentos ou um e meio.
  assert.match(mod.formatarDinheiro('12345'), /123,45/);
  assert.match(mod.formatarDinheiro('5'), /0,05/);
  assert.equal(mod.formatarDinheiro(''), '');
  assert.equal(mod.formatarDinheiro('abc'), '');
  assert.match(mod.formatarDinheiro('R$ 1.234,56'), /1\.234,56/);
});

test('técnica: a validação vem do módulo compartilhado, não é reescrita', () => {
  // Se um dia isto virar regra local, o texto técnico da proposta e o do PDF
  // passam a ser validados por duas fontes diferentes.
  const pendencias = mod.pendenciasDaTecnica(['Flushing: informe a classe NAS desejada.']);
  assert.equal(pendencias.length, 1);
  assert.equal(pendencias[0].mensagem, 'Flushing: informe a classe NAS desejada.');
  assert.deepEqual(mod.pendenciasDaTecnica([]), []);
});

const precoCompleto = {
  description: 'Limpeza química',
  unit: 'serviço',
  quantity: '1',
  unitValue: 'R$ 38.000,00',
  value: 'R$ 38.000,00'
};

const formComercialCompleto = {
  payment: '30 dias',
  taxes: 'ISS incluso',
  validity: '30',
  overtimeRate: 'R$ 250,00',
  standbyTeam: 'R$ 2.250,00',
  standbyEquipment: 'R$ 1.000,00',
  extraMobilization: 'R$ 4.500,00'
};

test('a validação global libera o documento completo e detecta uma etapa que voltou a ficar incompleta', () => {
  const form = {
    ...completo,
    ...formComercialCompleto,
    title: 'Filtragem',
    attendance: '10 dias',
    mobilization: '2 dias',
    permanence: '5 dias',
    integration: '1 dia',
    execution: '4 dias',
    workday: '8h às 17h'
  };
  const dados = {
    itens: [{ title: 'Filtragem' }],
    responsabilidades: [{ item: 'Energia elétrica' }],
    errosTecnicos: [],
    precos: [precoCompleto]
  };
  assert.deepEqual(mod.pendenciasDaProposta(form, dados), []);
  const pendencias = mod.pendenciasDaProposta({ ...form, execution: '' }, dados);
  assert.equal(pendencias.length, 1);
  assert.equal(pendencias[0].etapa, 'prazos');
  assert.equal(pendencias[0].campo, 'execution');
});

test('comercial: item de preço pela metade não conta', () => {
  const form = formComercialCompleto;

  assert.deepEqual(mod.pendenciasDaComercial(form, [precoCompleto]), []);

  for (const campo of ['description', 'quantity', 'unitValue']) {
    const pendencias = mod.pendenciasDaComercial(form, [{ ...precoCompleto, [campo]: '' }]);
    assert.equal(pendencias.length, 1, campo);
    assert.equal(pendencias[0].campo, 'precos');
  }

  assert.deepEqual(
    mod.pendenciasDaComercial(form, [{ ...precoCompleto, unit: '' }]),
    [],
    'unidade não é mais informada nem exigida'
  );
});

test('comercial: valor total é quantidade × valor unitário', () => {
  assert.match(mod.valorTotalDoItemDePreco('3', 'R$ 250,00'), /750,00/);
  assert.match(mod.valorTotalDoItemDePreco('1,5', 'R$ 2.250,00'), /3\.375,00/);
  assert.equal(mod.valorTotalDoItemDePreco('0', 'R$ 250,00'), '');

  const recalculado = mod.recalcularItemDePreco({
    ...precoCompleto,
    quantity: '2',
    unitValue: 'R$ 125,50',
    value: 'R$ 999,00'
  });
  assert.match(recalculado.value, /251,00/);
});

test('comercial: os quatro adicionais são obrigatórios', () => {
  for (const campo of mod.CAMPOS_STANDBY.map(item => item.campo)) {
    const pendencias = mod.pendenciasDaComercial(
      { ...formComercialCompleto, [campo]: '' },
      [precoCompleto]
    );
    assert.equal(pendencias.length, 1, campo);
    assert.equal(pendencias[0].campo, campo);
  }
});

test('comercial: hora extra e stand-by de equipe têm os padrões solicitados', () => {
  assert.deepEqual(mod.VALORES_PADRAO_STANDBY, {
    overtimeRate: 'R$ 250,00',
    standbyTeam: 'R$ 2.250,00'
  });

  const pagina = readFileSync(
    new URL('../src/pages/comercial/proposta/PropostaPage.tsx', import.meta.url),
    'utf8'
  );
  assert.match(pagina, /overtimeRate: VALORES_PADRAO_STANDBY\.overtimeRate/);
  assert.match(pagina, /standbyTeam: VALORES_PADRAO_STANDBY\.standbyTeam/);
});

test('comercial: validade zero produz proposta vencida na emissão', () => {
  const form = formComercialCompleto;

  for (const validade of ['0', '-5']) {
    const pendencias = mod.pendenciasDaComercial({ ...form, validity: validade }, [
      precoCompleto
    ]);
    assert.equal(pendencias.length, 1, validade);
    assert.match(pendencias[0].mensagem, /pelo menos 1 dia/);
  }

  // Vazio é outro estado: "informe", não "precisa ser de pelo menos".
  const vazio = mod.pendenciasDaComercial({ ...form, validity: '' }, [precoCompleto]);
  assert.match(vazio[0].mensagem, /Informe a validade/);
});

test('comercial: pagamento e impostos são obrigatórios', () => {
  const pendencias = mod.pendenciasDaComercial(
    { ...formComercialCompleto, payment: '', taxes: '' },
    [precoCompleto]
  );
  assert.deepEqual(pendencias.map(p => p.campo).sort(), ['payment', 'taxes']);
});

test('a tabela comercial remove Unidade e calcula o total em campo somente leitura', () => {
  const fonte = readFileSync(
    new URL('../src/pages/comercial/proposta/steps/ComercialStep.tsx', import.meta.url),
    'utf8'
  );
  const cabecalho = fonte.slice(fonte.indexOf('<thead>'), fonte.indexOf('</thead>'));

  assert.doesNotMatch(cabecalho, /Unidade/);
  assert.match(cabecalho, /Qtd\./);
  assert.match(fonte, /recalcularItemDePreco/);
  const campoTotal = fonte.slice(
    fonte.indexOf('aria-label={`Valor total'),
    fonte.indexOf('aria-label={`Valor total') + 300
  );
  assert.match(campoTotal, /readOnly/);
});

test('o rótulo do botão é o da referência, e a contagem vai à parte', () => {
  // Na referência o botão diz "Salvar e continuar →" sempre; a contagem de
  // pendências fica num aviso ao lado. Trocar o texto do botão pela contagem
  // seria divergência de texto, que o aceite lado a lado compara.
  assert.equal(mod.rotuloDoAvanco([], false), 'Salvar e continuar →');
  assert.equal(
    mod.rotuloDoAvanco([], false, 'Escopo'),
    'Salvar e ir para Escopo →',
    'o texto deve vir da mesma etapa usada como destino'
  );
  assert.equal(
    mod.rotuloDoAvanco([{ campo: 'a', mensagem: 'x' }], false),
    'Salvar e continuar →'
  );
  assert.equal(mod.rotuloDoAvanco([], true), 'Gerar e salvar técnica + comercial');

  assert.equal(mod.avisoDePendencias([]), '');
  assert.equal(mod.avisoDePendencias([{ campo: 'a', mensagem: 'x' }]), 'Preencha 1 campo obrigatório');
  assert.equal(
    mod.avisoDePendencias([
      { campo: 'a', mensagem: 'x' },
      { campo: 'b', mensagem: 'y' }
    ]),
    'Preencha 2 campos obrigatórios'
  );
});

/* --------------------------------------------------------------------------
 * Modelo do documento (T071e) e duas tabelas de preço (T071f)
 * ----------------------------------------------------------------------- */

test('a jornada de hidrojateamento traz os dois turnos no texto semeado', async () => {
  const doc = await server.ssrLoadModule(
    '/../shared/comercial/dist/modelo-documento.js'
  );

  const padrao = doc.textoJornada('padrao');
  const hidro = doc.textoJornada('hidrojateamento');

  assert.match(padrao, /Turno diurno:/);
  assert.ok(!/OFFSHORE/.test(padrao));

  // Esquecer o turno OFFSHORE faz a proposta prometer uma jornada que a equipe
  // embarcada não cumpre — domingo e feriado, 11 horas.
  assert.match(hidro, /Turno diurno — ONSHORE:/);
  assert.match(hidro, /Turno diurno — OFFSHORE:/);
  assert.match(hidro, /Segunda a domingo e feriados – 11 horas/);

  // Os dois carregam a nota de hora extra e o limite de 44 horas da CLT.
  for (const texto of [padrao, hidro]) {
    assert.match(texto, /44 horas semanais/);
    assert.match(texto, /Horas Extras/);
  }
});

test('o item de preço carrega o local só no modelo de duas tabelas', async () => {
  const doc = await server.ssrLoadModule(
    '/../shared/comercial/dist/modelo-documento.js'
  );

  // Somar ONSHORE e OFFSHORE juntos apresentaria ao cliente um total que ele
  // não vai pagar: são cenários alternativos de execução, não parcelas do
  // mesmo serviço.
  assert.equal(doc.tabelasDePrecoDoModelo('padrao'), null);
  assert.deepEqual(doc.tabelasDePrecoDoModelo('hidrojateamento'), [
    'ONSHORE',
    'OFFSHORE'
  ]);
});

/* --------------------------------------------------------------------------
 * Lista de categorias da matriz
 *
 * A categoria vira SUBTÍTULO AGRUPADOR no documento. Campo livre produzia
 * "Logística", "LOGISTICA " e "LOGÍSTICA" como três grupos distintos — que foi
 * o motivo de trocar por lista.
 * ----------------------------------------------------------------------- */

test('a categoria normaliza para maiúscula e espaço colapsado', () => {
  assert.equal(mod.normalizarCategoria('  Logística  '), 'LOGÍSTICA');
  assert.equal(mod.normalizarCategoria('mão   de obra'), 'MÃO DE OBRA');
  assert.equal(mod.normalizarCategoria(''), '');
});

test('acrescentar recusa vazio e repetição — inclusive sem acento', () => {
  const lista = ['LOGÍSTICA', 'UTILIDADES'];

  assert.ok(mod.acrescentarCategoria(lista, '   ').erro);

  // "LOGISTICA" e "LOGÍSTICA" são o mesmo grupo para quem lê o documento.
  const semAcento = mod.acrescentarCategoria(lista, 'logistica');
  assert.match(semAcento.erro, /LOGÍSTICA.*já está/);
  assert.deepEqual(semAcento.lista, lista);

  const nova = mod.acrescentarCategoria(lista, ' treinamento ');
  assert.equal(nova.erro, undefined);
  assert.deepEqual(nova.lista, ['LOGÍSTICA', 'UTILIDADES', 'TREINAMENTO']);
});

test('remover categoria em uso é recusado, e o recado diz quantas linhas', () => {
  const lista = ['LOGÍSTICA', 'UTILIDADES'];
  const linhas = [
    { categoria: 'LOGÍSTICA' },
    { categoria: 'LOGÍSTICA' },
    { categoria: 'UTILIDADES' }
  ];

  // Remover em uso deixaria a linha apontando para categoria inexistente, e o
  // select a mostraria vazia sem ninguém pedir.
  const emUso = mod.removerCategoria(lista, 'LOGÍSTICA', linhas);
  assert.match(emUso.erro, /2 linhas/);
  assert.deepEqual(emUso.lista, lista);

  const livre = mod.removerCategoria(lista, 'LOGÍSTICA', [{ categoria: 'UTILIDADES' }]);
  assert.equal(livre.erro, undefined);
  assert.deepEqual(livre.lista, ['UTILIDADES']);
});

test('a lista padrão cobre todas as categorias que a matriz semeada usa', () => {
  // Se a matriz trouxesse uma categoria fora da lista, o select da linha
  // mostraria vazio na abertura da proposta.
  const lista = mod.CATEGORIAS_RESPONSABILIDADE;
  for (const modelo of ['padrao', 'hidrojateamento']) {
    for (const linha of mod.matrizInicial(modelo)) {
      assert.ok(
        lista.includes(linha.categoria),
        `${linha.categoria} não está na lista padrão`
      );
    }
  }
});

/**
 * O selo do Nectar responde sobre a INTEGRAÇÃO, não sobre a proposta.
 *
 * Defeito de porte achado em 14/08, e achado pelo mantenedor olhando a tela: com
 * o Nectar ligado, respondendo e com funil configurado, toda proposta nova
 * exibia "Nectar pendente" — porque a condição tinha virado `vinculoCrm`, que é
 * "esta proposta já tem card". A palavra "pendente" sugere configuração
 * faltando, e foi assim que ele leu.
 *
 * A referência pergunta `pipelines.length` (`app/page.tsx:835`): o CRM respondeu
 * com os funis. Os dois textos são `PROP-TXT-120` e `PROP-TXT-121`, e continuam
 * palavra por palavra — o que estava errado era a pergunta, não a resposta.
 */
test('o selo do Nectar segue os FUNIS, não o vínculo da proposta', () => {
  // Lê do disco, e não por `transformRequest`: transformar a `PropostaPage`
  // acorda o otimizador de dependências do Vite e o teste pendura. O que
  // interessa aqui é o texto do arquivo.
  const fonte = readFileSync(
    new URL('../src/pages/comercial/proposta/PropostaPage.tsx', import.meta.url),
    'utf8'
  );

  // O trecho do selo, isolado: `vinculoCrm` continua legítimo no hero, que fala
  // do card desta proposta — o que não pode é decidir o selo.
  const selo = fonte.slice(
    fonte.indexOf('Nectar conectado') - 400,
    fonte.indexOf('Nectar pendente') + 40
  );

  assert.match(selo, /funis\.length/);
  assert.doesNotMatch(selo, /vinculoCrm \?/);
});

/**
 * As duas saídas que faltavam — relatadas em 14/08, antes do uso em staging.
 *
 * Os quatro diálogos de escolha abriam **sem porta de saída**: quem clicava em
 * "Levantar custos" ou "Propostas" por engano tinha de escolher uma opção ou
 * recarregar a página no endereço da entrada. E o módulo tinha "Sair do módulo",
 * que leva ao hub, mas **nenhum jeito de sair do sistema** — deslogar exigia
 * voltar ao hub primeiro.
 */
test('todo diálogo de escolha tem como fechar', () => {
  const arquivos = [
    '../src/pages/comercial/custos/CustosPage.tsx',
    '../src/pages/comercial/proposta/PropostaModeDialog.tsx',
    '../src/pages/comercial/proposta/PropostaModeloDialog.tsx'
  ];

  for (const arquivo of arquivos) {
    const fonte = readFileSync(new URL(arquivo, import.meta.url), 'utf8');
    assert.match(fonte, /BotaoFecharDialogo/, `${arquivo} tem diálogo sem saída`);
  }

  // O `aria-modal` promete um diálogo, e de diálogo se espera poder sair pelo
  // Escape — que é o gesto que todo mundo tenta antes de procurar o ×.
  const fechar = readFileSync(
    new URL('../src/pages/comercial/components/FecharDialogo.tsx', import.meta.url),
    'utf8'
  );
  assert.match(fechar, /Escape/);
  assert.match(fechar, /aria-label/);
});

test('o módulo separa sair do MÓDULO de sair do SISTEMA', () => {
  const chrome = readFileSync(
    new URL('../src/pages/comercial/components/ComercialChrome.tsx', import.meta.url),
    'utf8'
  );

  assert.match(chrome, /Sair do módulo/);
  assert.match(chrome, /Sair do sistema/);
  // Os rótulos dizem o destino porque errar aqui custa o trabalho não salvo.
  assert.match(chrome, /logout\(\)/);
});

// O código sem comentários de bloco nem de linha — para asserção sobre o que a
// tela realmente mostra. (Escrito com `//` de propósito: um docblock aqui
// precisaria citar a sintaxe de comentário JSX, e o `*/` dela fecharia o bloco.)
function semComentarios(fonte) {
  return fonte.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('as telas internas têm caminho de volta que não depende do navegador', () => {
  const config = readFileSync(
    new URL('../src/pages/comercial/configuracoes/ConfiguracoesPage.tsx', import.meta.url),
    'utf8'
  );
  const historico = readFileSync(
    new URL('../src/pages/comercial/historico/HistoricoPage.tsx', import.meta.url),
    'utf8'
  );

  assert.match(config, /voltarPara=/, 'Configurações sem botão de voltar');
  // O mesmo rótulo nas duas telas: destino igual, nome igual. Nome diferente
  // para o mesmo destino faz parecer que são caminhos diferentes.
  assert.match(historico, /← Voltar\s*</, 'Histórico sem volta ao menu');

  // `HIST-CTL-002` ("← Voltar ao gerador") **saiu** — desvio nº 17, decidido em
  // 14/08. É a primeira remoção de controle da referência no porte, e por isso
  // está travada aqui: ela precisa continuar sendo uma decisão, não um
  // reaparecimento por engano de quem for mexer nesta barra.
  //
  // Sem os comentários: a primeira versão desta asserção falhou contra o
  // **comentário** que explica a remoção, e o comentário precisa poder nomear o
  // que foi removido. O que não pode voltar é o rótulo na tela.
  assert.doesNotMatch(
    semComentarios(historico),
    /Voltar ao gerador/,
    'HIST-CTL-002 voltou sem passar pela lista de desvios'
  );
});

test('o × do diálogo é desenhado, não é o caractere', () => {
  // O glifo `×` se alinha pelo eixo matemático da fonte, acima do centro da
  // caixa: com `place-items: center` ele assenta alto, e o quanto depende da
  // fonte de quem abre. Foi assim que apareceu torto em staging.
  const fonte = readFileSync(
    new URL('../src/pages/comercial/components/FecharDialogo.tsx', import.meta.url),
    'utf8'
  );

  assert.match(fonte, /<svg/);
  assert.doesNotMatch(fonte, />\s*×\s*</);
});

test('os cartões do diálogo alinham os títulos e não encostam no que vem depois', () => {
  // Relatado com captura em 14/08. Dois defeitos de CSS que não têm outro
  // guarda: não há teste de layout no repositório, e os dois só aparecem com
  // conteúdo real — descrições de tamanhos diferentes e um recado de erro logo
  // abaixo dos cartões.
  const css = readFileSync(
    new URL('../src/styles/comercial.css', import.meta.url),
    'utf8'
  );
  const bloco = css.slice(
    css.indexOf('.com-root .com-modo-opcoes {'),
    css.indexOf('.com-root .com-modo-opcoes b {')
  );

  // Sem `align-content: start`, a grade estica as linhas do cartão de descrição
  // curta e o título dele desce em relação ao do outro.
  assert.match(bloco, /align-content:\s*start/);
  // O recado de erro tem `margin: 0`; a separação precisa vir daqui.
  assert.match(bloco, /margin:\s*4px 0 18px/);
});

test('os emblemas dos cartões e o × são desenhados — glifo não centraliza', () => {
  // Terceiro caso da mesma causa em dois dias: `×`, `＋` e `↻` se alinham pelas
  // métricas da fonte, não pela caixa. O `＋` é o **fullwidth** U+FF0B, e o eixo
  // matemático dos três fica acima do centro — dentro de um círculo de 38px isso
  // salta aos olhos, e o desvio muda com a fonte da máquina.
  const marca = readFileSync(
    new URL('../src/pages/comercial/components/MarcaDeOpcao.tsx', import.meta.url),
    'utf8'
  );
  assert.match(marca, /<svg/);

  for (const arquivo of [
    '../src/pages/comercial/custos/CustosPage.tsx',
    '../src/pages/comercial/proposta/PropostaModeDialog.tsx'
  ]) {
    const fonte = semComentarios(readFileSync(new URL(arquivo, import.meta.url), 'utf8'));
    assert.doesNotMatch(fonte, /<b aria-hidden="true">[＋↻✓]<\/b>/, `${arquivo} voltou ao glifo`);
  }
});

test('o campo da revisão não empurra o botão ao lado para baixo', () => {
  // `.com-root .field-group` tem `margin-bottom: 17px`, para formulário
  // empilhado. A linha da revisão usa `align-items: flex-end`, que alinha a
  // borda da MARGEM — então o campo terminava 17px acima do botão, e o
  // "Carregar revisão" ficava torto em relação ao campo que ele preenche.
  const css = readFileSync(new URL('../src/styles/comercial.css', import.meta.url), 'utf8');
  const bloco = css.slice(
    css.indexOf('.com-root .com-revisao-entrada .field-group'),
    css.indexOf('.com-root .com-revisao-entrada .field-group') + 220
  );

  assert.match(bloco, /margin-bottom:\s*0/);
});
