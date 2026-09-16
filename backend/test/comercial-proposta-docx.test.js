import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { arquivoDoModelo, preencherProposta } from '../src/lib/comercial/proposta-docx.js';
import { createScopeDescriptionItem, createScopeTopic, SCOPE_DESCRIPTION_TEMPLATES, scopeDescriptionParagraphs } from '../../shared/comercial/dist/scope-descriptions.js';

const MODELOS = process.env.COMERCIAL_MODELOS_DIR
  ? process.env.COMERCIAL_MODELOS_DIR
  : join(dirname(fileURLToPath(import.meta.url)), '../../Modelos/definitivos/Comercial/modelos');

/**
 * Quantas imagens o MODELO tem.
 *
 * A contagem era um número fixo no teste (13), e ela caiu para 12 quando alguém
 * abriu o modelo no LibreOffice e salvou: o programa descartou um
 * `hdphoto1.wdp`, que é a representação alternativa que o Word guarda ao lado da
 * imagem normal. Nenhuma figura visível se perdeu.
 *
 * O invariante que interessa não é "o documento tem 13 imagens" — isso é
 * conteúdo do modelo, e o modelo é editável de propósito. É **o preenchimento
 * não perde nem inventa imagem**. Por isso a conta agora é relativa.
 */
function imagensDoModelo(tipo, modelo = 'padrao') {
  const zip = new AdmZip(readFileSync(join(MODELOS, arquivoDoModelo(tipo, modelo))));
  return zip.getEntries().filter(e => e.entryName.startsWith('word/media/')).length;
}

/**
 * O preenchimento do modelo `.docx`.
 *
 * **O que dá para verificar sem abrir o Word.** Um `.docx` mal preenchido abre
 * normalmente: o defeito é marcador impresso, campo em branco ou linha
 * duplicada. Então o teste extrai o texto de volta e pergunta.
 *
 * O que ele NÃO cobre: como a página quebra e como a tabela se ajusta. Isso é o
 * Word decidindo, e só olho no papel resolve.
 */

const DADOS = {
  proposalCode: '4068',
  revision: '1',
  date: '2026-01-07',
  seller: 'Lucas Silva',
  estimator: 'Ruan Casas',
  client: 'MIP ENGENHARIA LTDA.',
  contact: 'Luciano Salazar',
  email: 'luciano.salazar@mip.com.br',
  department: 'Manutenção',
  site: 'CSN CASA DE PEDRA - CONGONHAS/MG',
  cnpj: '33.193.996/0001-58',
  attendance: '15 dias',
  mobilization: '4 dias',
  permanence: '35 dias',
  integration: '1 dia',
  execution: '24 dias',
  validity: '10',
  modelo: 'padrao',
  advancePercent: '35%',
  paymentTerm: '21',
  paymentMethod: 'Depósito em conta',
  overtimeRate: 'R$ 250,00',
  standbyTeam: 'R$ 11.250,00',
  standbyEquipment: 'R$ 5.000,00',
  extraMobilization: 'R$ 21.900,00',
  scopeItems: [
    {
      id: 'a',
      title: 'Limpeza química',
      description: 'Circulação pressurizada.'
    },
    { id: 'b', title: 'Flushing primário', description: 'Regime turbulento.' }
  ],
  rows: [
    {
      categoria: 'MÃO DE OBRA E EQUIPE TÉCNICA',
      owner: 'Filtrovali',
      item: 'Equipe técnica especializada.',
      note: ''
    },
    {
      categoria: 'LOGÍSTICA',
      owner: 'Filtrovali',
      item: 'Um veículo com combustível.',
      note: 'Nota de débito'
    },
    {
      categoria: 'LOGÍSTICA',
      owner: 'Filtrovali',
      item: 'Hospedagem da equipe.',
      note: 'Nota de débito'
    },
    {
      categoria: 'CONSUMÍVEIS E UTILIDADES',
      owner: 'Contratante',
      item: 'Fornecimento de água limpa.',
      note: ''
    }
  ],
  prices: [
    {
      description: 'Serviço especializado conforme escopo',
      quantity: '1',
      unitValue: 'R$ 38.000,00',
      value: 'R$ 38.000,00'
    },
    {
      description: 'Mobilização e desmobilização',
      quantity: '1',
      unitValue: 'R$ 12.000,00',
      value: 'R$ 12.000,00'
    }
  ]
};

function textoDoDocx(bytes) {
  const zip = new AdmZip(bytes);
  const xml = zip.getEntry('word/document.xml').getData().toString('utf8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const partes = [];
  const nos = doc.getElementsByTagName('w:t');
  for (let i = 0; i < nos.length; i += 1) partes.push(nos[i].textContent || '');
  return { xml, texto: partes.join(' ') };
}

/**
 * Aproxima a concatenação que o Word faz entre runs. Sem `xml:space=preserve`,
 * espaços nas bordas de um `w:t` são descartados — justamente o defeito que
 * `textoDoDocx`, ao inserir um espaço artificial entre todos os nós, esconderia.
 */
function textoVisualDoDocx(bytes) {
  const zip = new AdmZip(bytes);
  const doc = new DOMParser().parseFromString(
    zip.getEntry('word/document.xml').getData().toString('utf8'),
    'text/xml'
  );
  return Array.from(doc.getElementsByTagName('w:p'))
    .map(paragrafo =>
      Array.from(paragrafo.getElementsByTagName('w:t'))
        .map(texto => {
          const conteudo = texto.textContent || '';
          return texto.getAttribute('xml:space') === 'preserve'
            ? conteudo
            : conteudo.trim();
        })
        .join('')
    )
    .join('\n');
}

function textoEntreTitulos(bytes, inicio, fim) {
  const zip = new AdmZip(bytes);
  const doc = new DOMParser().parseFromString(
    zip.getEntry('word/document.xml').getData().toString('utf8'),
    'text/xml'
  );
  const corpo = doc.getElementsByTagName('w:body').item(0);
  const textoDe = no =>
    Array.from(no.getElementsByTagName?.('w:t') || [])
      .map(texto => texto.textContent || '')
      .join(' ')
      .trim();
  const filhos = Array.from(corpo.childNodes).filter(no => no.nodeType === 1);
  const indiceInicial = filhos.findLastIndex(no => textoDe(no).includes(inicio));
  const indiceFinal = filhos.findIndex(
    (no, indice) => indice > indiceInicial && textoDe(no).includes(fim)
  );
  return filhos
    .slice(indiceInicial + 1, indiceFinal)
    .map(textoDe)
    .filter(Boolean)
    .join('\n');
}

/** Conta as linhas de uma tabela que contém determinado texto. */
function linhasDaTabelaCom(xml, agulha) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const tabelas = Array.from(doc.getElementsByTagName('w:tbl'));
  const textoDe = no =>
    Array.from(no.getElementsByTagName('w:t'))
      .map(t => t.textContent || '')
      .join(' ');
  const tabela = tabelas.find(t => textoDe(t).includes(agulha));
  if (!tabela) return 0;
  return Array.from(tabela.getElementsByTagName('w:tr')).length;
}

test('escolhe o modelo pelo tipo e pelo modelo da proposta', () => {
  assert.equal(arquivoDoModelo('commercial', 'padrao'), 'Proposta Comercial.docx');
  assert.equal(
    arquivoDoModelo('commercial', 'hidrojateamento'),
    'Proposta comercial hidrojateamento.docx'
  );
  assert.equal(arquivoDoModelo('technical', 'padrao'), 'Proposta técnica.docx');
  // Modelo desconhecido não pode estourar: cai no padrão.
  assert.equal(arquivoDoModelo('commercial', 'inventado'), 'Proposta Comercial.docx');
});

test('nenhum marcador sobra em NENHUMA parte do pacote', async () => {
  // Marcador que sobra vai IMPRESSO ao cliente, e o `.docx` abre sem reclamar.
  //
  // A primeira versão deste teste olhava só `word/document.xml`, e foi por isso
  // que `{{data_texto}}` — que mora no CABEÇALHO — passou meses sem ser
  // preenchido. Agora varre o pacote inteiro.
  for (const modelo of ['padrao', 'hidrojateamento']) {
    for (const tipo of ['commercial', 'technical']) {
      const zip = new AdmZip(await preencherProposta({ ...DADOS, modelo }, tipo));
      for (const entrada of zip.getEntries()) {
        if (!entrada.entryName.endsWith('.xml')) continue;
        const xml = entrada.getData().toString('utf8');
        const sobrou = [...xml.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
        assert.deepEqual(
          sobrou,
          [],
          `${modelo}/${tipo} em ${entrada.entryName}: sobraram marcadores`
        );
      }
    }
  }
});

/**
 * Os cabeçalhos, TODOS eles.
 *
 * Estes testes olhavam `word/header1.xml` fixo, e quebraram no dia em que
 * alguém abriu o modelo no LibreOffice e salvou: o programa dividiu o cabeçalho
 * em `header1/2/3` e a data foi para o `header2`. Um teste que aponta para uma
 * parte fixa mede o pacote, não o comportamento — e o pacote é editável por
 * quem escreve o documento, de propósito.
 */
function cabecalhos(zip) {
  return zip
    .getEntries()
    .filter(entrada => /^word\/header\d*\.xml$/.test(entrada.entryName))
    .map(entrada => entrada.getData().toString('utf8'));
}

test('a data do cabeçalho sai por extenso, no dia certo', async () => {
  const zip = new AdmZip(await preencherProposta(DADOS, 'commercial'));
  const partes = cabecalhos(zip);

  assert.ok(
    partes.some(xml => /7 de janeiro de 2026/.test(xml)),
    'a data não saiu em nenhum cabeçalho'
  );
  // "2026-01-07" lido como meia-noite UTC seria 6 de janeiro em Brasília.
  assert.ok(!partes.some(xml => /6 de janeiro de 2026/.test(xml)), 'a data voltou um dia');
});

test('a capa não recebe data e o cabeçalho começa na página 2', async () => {
  for (const modelo of ['padrao', 'hidrojateamento']) {
    for (const tipo of ['commercial', 'technical']) {
      const zip = new AdmZip(await preencherProposta({ ...DADOS, modelo }, tipo));
      const doc = new DOMParser().parseFromString(
        zip.getEntry('word/document.xml').getData().toString('utf8'),
        'text/xml'
      );
      const primeiraSecao = doc.getElementsByTagName('w:sectPr').item(0);
      assert.ok(
        primeiraSecao.getElementsByTagName('w:titlePg').length,
        `${modelo}/${tipo}: a primeira página não foi diferenciada`
      );

      const rels = new DOMParser().parseFromString(
        zip.getEntry('word/_rels/document.xml.rels').getData().toString('utf8'),
        'text/xml'
      );
      const alvos = new Map(
        Array.from(rels.getElementsByTagName('Relationship')).map(relacao => [
          relacao.getAttribute('Id'),
          relacao.getAttribute('Target')
        ])
      );
      const primeiros = Array.from(primeiraSecao.getElementsByTagName('w:headerReference')).filter(
        referencia => referencia.getAttribute('w:type') === 'first'
      );

      for (const referencia of primeiros) {
        const alvo = alvos.get(referencia.getAttribute('r:id'));
        const entrada = alvo && zip.getEntry(`word/${alvo.replace(/^\.\.\//, '')}`);
        assert.ok(entrada, `${modelo}/${tipo}: cabeçalho first não encontrado`);
        assert.doesNotMatch(
          entrada.getData().toString('utf8'),
          /7 de janeiro de 2026/,
          `${modelo}/${tipo}: a data apareceu na capa`
        );
      }

      assert.ok(
        cabecalhos(zip).some(xml => /7 de janeiro de 2026/.test(xml)),
        `${modelo}/${tipo}: a data também sumiu das páginas internas`
      );
    }
  }
});

test('a jornada editada na proposta substitui a jornada fixa do modelo', async () => {
  const personalizada = 'Jornada exclusiva desta proposta\nSegunda a sábado — turno combinado';
  const bytes = await preencherProposta({ ...DADOS, workday: personalizada }, 'commercial');
  const jornada = textoEntreTitulos(bytes, '- Jornada de trabalho:', '- Descrição dos valores:');

  assert.match(jornada, /Jornada exclusiva desta proposta/);
  assert.match(jornada, /Segunda a sábado — turno combinado/);
  assert.doesNotMatch(jornada, /44 horas semanais/);
});

test('a previsão de atendimento leva a unidade no valor, não no modelo', async () => {
  const texto = textoVisualDoDocx(
    await preencherProposta({ ...DADOS, attendance: 'De imediato' }, 'commercial')
  );

  assert.match(texto, /De imediato\s+após\s+o recebimento/);
  assert.doesNotMatch(texto, /De imediato dias/);
});

test('os prazos numéricos mantêm "dias" e os espaços dos itens 4.1, 5.1 e 5.2', async () => {
  for (const modelo of ['padrao', 'hidrojateamento']) {
    for (const tipo of ['commercial', 'technical']) {
      const texto = textoVisualDoDocx(
        await preencherProposta(
          {
            ...DADOS,
            modelo,
            attendance: '20',
            permanence: '35',
            integration: '2'
          },
          tipo
        )
      );

      assert.match(
        texto,
        /20 dias após o recebimento/,
        `${modelo}/${tipo}: item 4.1 perdeu "dias" ou algum espaço`
      );
      assert.match(
        texto,
        /permanência em obra \(dias corridos\) – 35 dia\(s\);/,
        `${modelo}/${tipo}: item 5.1 ficou sem espaço`
      );
      assert.match(
        texto,
        /Prazo previsto para integração – 2 dia\(s\);/,
        `${modelo}/${tipo}: item 5.2 ficou sem espaço`
      );
    }
  }
});

test('o capítulo 7 técnico contém somente os escopos selecionados', async () => {
  const technicalServices = [
    {
      instanceId: 'boroscopia-1',
      serviceId: 'boroscopia',
      templateVersion: 1,
      title: 'Boroscopia selecionada',
      text: 'Texto técnico exclusivo da boroscopia desta proposta.',
      usesTemplate: false,
      parameters: {},
      reportCode: null
    }
  ];
  const bytes = await preencherProposta({ ...DADOS, technicalServices }, 'technical');
  const escopo = textoEntreTitulos(bytes, '- Escopo Técnico:', '- Relatórios:');

  assert.match(escopo, /7\.1 Boroscopia selecionada/);
  assert.match(escopo, /Texto técnico exclusivo da boroscopia desta proposta/);
  assert.doesNotMatch(escopo, /Limpeza química|Flushing primário|Desidratação de óleo/);
});

test('sem serviço selecionado, o cardápio fixo do capítulo 7 é removido', async () => {
  const bytes = await preencherProposta({ ...DADOS, technicalServices: [] }, 'technical');
  assert.equal(textoEntreTitulos(bytes, '- Escopo Técnico:', '- Relatórios:'), '');
});

test('pagamento, observações e impostos editados na prévia chegam ao DOCX', async () => {
  const { texto } = textoDoDocx(
    await preencherProposta(
      {
        ...DADOS,
        payment: 'Pagamento personalizado em parcela única.',
        observations: 'Observação comercial exclusiva desta proposta.',
        taxes: 'Tributação definida especificamente para esta proposta.'
      },
      'commercial'
    )
  );

  assert.match(texto, /Pagamento personalizado em parcela única/);
  assert.match(texto, /Observação comercial exclusiva desta proposta/);
  assert.match(texto, /Tributação definida especificamente para esta proposta/);
  assert.doesNotMatch(texto, /Medição quinzenal/);
  assert.doesNotMatch(texto, /regime tributário do lucro presumido/);
});

test('complementos técnicos da prévia chegam às seções do DOCX', async () => {
  const { texto } = textoDoDocx(
    await preencherProposta(
      {
        ...DADOS,
        technicalReports: 'Relatório complementar acordado com o cliente.',
        technicalObservations: 'Observação técnica exclusiva desta proposta.'
      },
      'technical'
    )
  );

  assert.match(texto, /Relatório complementar acordado com o cliente/);
  assert.match(texto, /Observação técnica exclusiva desta proposta/);
});

test('a data é alinhada à direita por regra, não por espaços', async () => {
  // No documento entregue ela era empurrada por 109 espaços literais. A largura
  // do espaço difere entre Word e LibreOffice: na conversão a linha estourava a
  // margem, quebrava, e a data reaparecia no começo da linha seguinte.
  const zip = new AdmZip(await preencherProposta(DADOS, 'commercial'));
  const comData = cabecalhos(zip).filter(xml => /de janeiro de 2026/.test(xml));

  assert.ok(comData.length, 'nenhum cabeçalho trouxe a data');
  for (const xml of comData) {
    // `right` e `end` são o MESMO alinhamento: o primeiro é o valor do OOXML
    // transicional, que o Word grava, e o segundo é o do estrito, que o
    // LibreOffice prefere ao salvar. Para texto da esquerda para a direita não
    // há diferença — e exigir só um dos dois faria o teste reprovar o documento
    // pelo programa que o salvou, não pelo que ele contém.
    assert.match(xml, /<w:jc w:val="(right|end)"\/>/);
    assert.ok(
      !/<w:t[^>]*>\s{20,}<\/w:t>/.test(xml),
      'sobrou preenchimento por espaços no cabeçalho'
    );
  }
});

test('todo run criado do zero herda a formatação do parágrafo', async () => {
  // Célula vazia não tinha run nenhum, então o marcador nasceu num run SEM
  // `rPr` — fonte padrão do documento em vez da Arial 10 da tabela. A linha
  // muda de altura e a tabela sai torta no papel, certinha no XML.
  const zip = new AdmZip(await preencherProposta(DADOS, 'commercial'));
  const doc = new DOMParser().parseFromString(
    zip.getEntry('word/document.xml').getData().toString('utf8'),
    'text/xml'
  );

  const textoDe = no =>
    Array.from(no.getElementsByTagName('w:t'))
      .map(t => t.textContent || '')
      .join(' ');

  const linhas = Array.from(doc.getElementsByTagName('w:tr'));
  const daTabela = linhas.filter(tr =>
    textoDe(tr).includes('Serviço especializado conforme escopo')
  );
  assert.ok(daTabela.length, 'a linha de preço não foi encontrada');

  for (const celula of Array.from(daTabela[0].getElementsByTagName('w:tc'))) {
    for (const run of Array.from(celula.getElementsByTagName('w:r'))) {
      if (!textoDe(run).trim()) continue;
      const rPr = Array.from(run.childNodes).find(n => n.nodeName === 'w:rPr');
      assert.ok(rPr, `run sem rPr na célula "${textoDe(celula)}"`);
      assert.match(
        new XMLSerializer().serializeToString(rPr),
        /Arial/,
        'o run não herdou a fonte da tabela'
      );
    }
  }
});

test('a identificação do cliente é preenchida', async () => {
  const { texto } = textoDoDocx(await preencherProposta(DADOS, 'commercial'));
  assert.match(texto, /Lucas Silva/);
  assert.match(texto, /Ruan Casas/);
  assert.match(texto, /MIP ENGENHARIA LTDA\./);
  assert.match(texto, /Luciano Salazar/);
  assert.match(texto, /33\.193\.996\/0001-58/);
  assert.match(texto, /4068/);
});

test('as quatro linhas de prazo recebem os valores, inclusive a integração', async () => {
  const { texto } = textoDoDocx(await preencherProposta(DADOS, 'commercial'));
  assert.match(texto, /35\s*dia/);
  assert.match(texto, /1\s*dia/); // integração
  assert.match(texto, /24\s*dia/);
});

test('a matriz sai agrupada, com um subtítulo por categoria', async () => {
  const { xml, texto } = textoDoDocx(await preencherProposta(DADOS, 'commercial'));

  assert.match(texto, /MÃO DE OBRA E EQUIPE TÉCNICA/);
  assert.match(texto, /LOGÍSTICA/);
  assert.match(texto, /Equipe técnica especializada\./);
  assert.match(texto, /Hospedagem da equipe\./);
  assert.match(texto, /Nota de débito/);

  // LOGÍSTICA tem DUAS obrigações e tem de aparecer UMA vez como subtítulo.
  // É a razão de a categoria ter virado lista suspensa: duas grafias quebrariam
  // o agrupamento e o documento sairia com o subtítulo repetido.
  const ocorrencias = (texto.match(/LOGÍSTICA/g) || []).length;
  assert.equal(ocorrencias, 1, `LOGÍSTICA apareceu ${ocorrencias} vezes`);

  // Cabeçalho + 2 categorias + 3 itens da Filtrovali.
  assert.equal(linhasDaTabelaCom(xml, 'Equipe técnica especializada.'), 6);
});

test('a matriz do contratante é independente da da Filtrovali', async () => {
  const { xml, texto } = textoDoDocx(await preencherProposta(DADOS, 'commercial'));
  assert.match(texto, /Fornecimento de água limpa\./);
  // Cabeçalho + 1 categoria + 1 item.
  assert.equal(linhasDaTabelaCom(xml, 'Fornecimento de água limpa.'), 3);
});

test('o DOCX ordena as categorias por responsável, mesmo com linhas embaralhadas', async () => {
  const categorias = {
    Filtrovali: [
      'MÃO DE OBRA E EQUIPE TÉCNICA',
      'EQUIPAMENTOS E MATERIAIS',
      'CONSUMÍVEIS E UTILIDADES',
      'LOGÍSTICA',
      'SEGURANÇA, DOCUMENTAÇÃO E FORMALIDADE',
      'MEIO AMBIENTE'
    ],
    Contratante: [
      'MÃO DE OBRA E EQUIPE TÉCNICA',
      'EQUIPAMENTOS E MATERIAIS',
      'CONSUMÍVEIS E UTILIDADES',
      'LOGÍSTICA',
      'SEGURANÇA, DOCUMENTAÇÃO E CONFORMIDADE',
      'ACESSIBILIDADE E APOIO DE CAMPO',
      'MEIO AMBIENTE'
    ]
  };
  const rows = Object.entries(categorias).flatMap(([owner, lista]) =>
    [...lista].reverse().map((categoria, indice) => ({
      categoria,
      owner,
      item: `${owner}-${indice}`,
      note: ''
    }))
  );
  const { xml } = textoDoDocx(await preencherProposta({ ...DADOS, rows }, 'commercial'));
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const tabelas = Array.from(doc.getElementsByTagName('w:tbl'));
  const textoDe = no => Array.from(no.getElementsByTagName('w:t'))
    .map(item => item.textContent || '')
    .join(' ');

  for (const [owner, lista] of Object.entries(categorias)) {
    const tabela = tabelas.find(item => textoDe(item).includes(`${owner}-0`));
    assert.ok(tabela, `tabela de ${owner} não encontrada`);
    const texto = textoDe(tabela);
    const posicoes = lista.map(categoria => texto.indexOf(categoria));
    assert.ok(posicoes.every(posicao => posicao >= 0), `${owner}: faltou categoria`);
    assert.deepEqual(posicoes, [...posicoes].sort((a, b) => a - b), `${owner}: ordem divergente`);
  }
});

test('a tabela de preços recebe uma linha por item e o total somado', async () => {
  const { xml, texto } = textoDoDocx(await preencherProposta(DADOS, 'commercial'));

  assert.match(texto, /Serviço especializado conforme escopo/);
  assert.match(texto, /Mobilização e desmobilização/);
  // 38.000 + 12.000, somados a partir da máscara — Number() daria NaN.
  assert.match(texto, /50\.000,00/);
  assert.ok(!/NaN/.test(texto), 'a máscara de moeda virou NaN');

  // Cabeçalho + 2 itens + total.
  assert.equal(linhasDaTabelaCom(xml, 'Serviço especializado conforme escopo'), 4);
});

test('desmarcar valor unitário remove a coluna da prévia e do DOCX', async () => {
  const { texto } = textoDoDocx(
    await preencherProposta({ ...DADOS, includeUnitValue: false }, 'commercial')
  );

  assert.doesNotMatch(texto, /Valor Unit/);
  assert.match(texto, /Qtd/);
  assert.match(texto, /Valor total/);
});

test('os itens de escopo substituem o cardápio do documento', async () => {
  // O documento entregue traz dez frases prontas — um cardápio dos serviços que
  // a empresa presta. A proposta usa duas ou três, escolhidas na etapa Escopo.
  const { texto } = textoDoDocx(await preencherProposta(DADOS, 'commercial'));

  assert.match(
    texto,
    /Circulação pressurizada\./
  );
  assert.match(
    texto,
    /Regime turbulento\./
  );
  assert.ok(!/visita técnica/i.test(texto), 'sobrou frase do cardápio que a proposta não escolheu');
  assert.doesNotMatch(texto, /Serviço especializado em mão de obra e execução técnica —/);

  // A ressalva fixa do escopo não é item de lista e tem de sobreviver.
  assert.match(texto, /tubulações embarcadas/);
});

test('modelos de descrição geram parágrafos e subitens numerados nos quatro documentos', async () => {
  const scopeItems = SCOPE_DESCRIPTION_TEMPLATES.map(t => createScopeDescriptionItem(t.id, t.id));
  for (const modelo of ['padrao', 'hidrojateamento']) {
    for (const tipo of ['commercial', 'technical']) {
      const { xml } = textoDoDocx(await preencherProposta({ ...DADOS, modelo, scopeItems }, tipo));
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const paragrafos = Array.from(doc.getElementsByTagName('w:p'));
      let anterior = -1;
      for (const item of scopeDescriptionParagraphs(scopeItems)) {
        const encontrados = paragrafos.filter(p => p.textContent === item.text);
        assert.equal(encontrados.length, 1, `${modelo}/${tipo}: ${item.number}`);
        const p = encontrados[0];
        assert.equal(p.getElementsByTagName('w:ilvl')[0].getAttribute('w:val'), String(item.level));
        assert.equal(p.getElementsByTagName('w:numId')[0].getAttribute('w:val'), '2');
        assert.ok(paragrafos.indexOf(p) > anterior);
        anterior = paragrafos.indexOf(p);
      }
    }
  }
});

test('editar, excluir, reordenar e colar parágrafos não cria itens fantasmas no DOCX', async () => {
  const engenharia = createScopeDescriptionItem('eng', 'pre-engenharia');
  engenharia.subitems.splice(1, 1);
  engenharia.subitems[0] = 'Detalhe personalizado do cliente.';
  const livre = { ...createScopeDescriptionItem('livre'), description: 'Primeiro texto livre.\n\nSegundo texto livre.' };
  const scopeItems = [engenharia, createScopeDescriptionItem('vazio'), livre];
  const { xml, texto } = textoDoDocx(await preencherProposta({ ...DADOS, scopeItems }, 'commercial'));
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const esperados = scopeDescriptionParagraphs(scopeItems);
  const impressos = Array.from(doc.getElementsByTagName('w:p')).filter(p => esperados.some(e => e.text === p.textContent));
  assert.deepEqual(impressos.map(p => p.textContent), esperados.map(e => e.text));
  assert.deepEqual(impressos.map(p => p.getElementsByTagName('w:ilvl')[0].getAttribute('w:val')), ['1', '2', '2', '2', '2', '1', '1']);
  assert.doesNotMatch(texto, /Levantamento de desenhos e elaboração de fluxogramas/);
  assert.doesNotMatch(texto, /Serviço especializado em mão de obra e execução técnica — Primeiro texto livre/);
  assert.ok(!impressos.some(p => p.getElementsByTagName('w:br').length));
});

test('cada serviço exporta vários tópicos e subníveis, sem prefixos automáticos', async () => {
  const scopeItems = [{
    id: 's1', title: 'Serviço 1', description: 'Descrição antiga que não deve voltar', topics: [
      { id: 'a', text: 'Texto livre do cliente.' },
      { id: 'b', text: 'Segundo texto do mesmo serviço.', children: [
        { id: 'b1', text: 'Detalhe editado.', children: [{ id: 'b11', text: 'Detalhe de terceiro nível.' }] }
      ] }
    ]
  }, { id: 's2', title: 'Serviço 2', description: '', topics: [createScopeTopic('c', 'filtragem')] }];
  const esperados = scopeDescriptionParagraphs(scopeItems);
  assert.deepEqual(esperados.map(p => p.number), ['2.1', '2.2', '2.2.1', '2.2.1.1', '2.3']);
  for (const modelo of ['padrao', 'hidrojateamento']) {
    for (const tipo of ['commercial', 'technical']) {
      const { xml, texto } = textoDoDocx(await preencherProposta({ ...DADOS, scopeItems, modelo }, tipo));
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const paragrafos = Array.from(doc.getElementsByTagName('w:p')).filter(p => esperados.some(e => e.text === p.textContent));
      assert.deepEqual(paragrafos.map(p => p.textContent), esperados.map(e => e.text));
      assert.deepEqual(paragrafos.map(p => p.getElementsByTagName('w:ilvl')[0].getAttribute('w:val')), ['1', '1', '2', '3', '1']);
      assert.doesNotMatch(texto, /Descrição antiga que não deve voltar|Serviço especializado em mão de obra e execução técnica —/);
    }
  }
});

test('o capítulo 3 imprime somente os equipamentos escolhidos na proposta', async () => {
  const dados = {
    ...DADOS,
    rows: [
      ...DADOS.rows,
      {
        categoria: 'EQUIPAMENTOS E MATERIAIS',
        owner: 'Filtrovali',
        item: 'Fornecimento de equipamentos necessários à execução, incluindo:',
        note: '',
        subitens: ['1 unidade de flushing primário', 'Equipamento especial do cliente']
      }
    ]
  };
  const { texto } = textoDoDocx(await preencherProposta(dados, 'commercial'));

  assert.match(texto, /1 unidade de flushing primário/);
  assert.match(texto, /Equipamento especial do cliente/);
  assert.ok(
    !texto.includes('1 unidade de limpeza química'),
    'um equipamento não selecionado foi impresso'
  );
});

test('hidrojateamento preenche as DUAS tabelas, cada uma com seu total', async () => {
  const hidro = {
    ...DADOS,
    modelo: 'hidrojateamento',
    prices: [
      {
        description: 'Diária de equipamento hidrojato',
        quantity: '1',
        unitValue: 'R$ 4.500,00',
        value: 'R$ 4.500,00',
        local: 'ONSHORE'
      },
      {
        description: 'Diária de equipamento hidrojato',
        quantity: '15',
        unitValue: 'R$ 2.900,00',
        value: 'R$ 43.500,00',
        local: 'OFFSHORE'
      }
    ]
  };

  const { texto } = textoDoDocx(await preencherProposta(hidro, 'commercial'));
  assert.match(texto, /4\.500,00/);
  assert.match(texto, /43\.500,00/);
  // Cada tabela fecha o SEU total. Somar as duas mostraria R$ 48.000,00 — um
  // número que o cliente não vai pagar, porque são cenários alternativos.
  assert.ok(!/48\.000,00/.test(texto), 'os dois cenários foram somados');
});

test('proposta vazia gera documento sem marcador e sem linha fantasma', async () => {
  // O documento precisa sair mesmo incompleto: é assim que se confere o que
  // falta. E a linha-modelo tem de sumir, senão "{{escopo_filtrovali}}" vai
  // impresso — o caso que ninguém testa, porque em desenvolvimento sempre há dado.
  const vazio = { ...DADOS, rows: [], prices: [], scopeItems: [] };
  const { xml, texto } = textoDoDocx(await preencherProposta(vazio, 'commercial'));

  assert.deepEqual(
    [...xml.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]),
    []
  );
  assert.ok(!texto.includes('escopo_filtrovali'));
  assert.ok(!texto.includes('descricao_a'));
});

test('o pacote continua um .docx válido, com as imagens', async () => {
  const zip = new AdmZip(await preencherProposta(DADOS, 'commercial'));
  const nomes = zip.getEntries().map(e => e.entryName);

  assert.ok(nomes.includes('word/document.xml'));
  assert.ok(nomes.includes('[Content_Types].xml'));
  // Sem foto de escopo, o preenchimento não pode perder nem inventar imagem:
  // sai com as mesmas do modelo — timbrado, capa e institucionais.
  assert.equal(
    nomes.filter(n => n.startsWith('word/media/')).length,
    imagensDoModelo('commercial')
  );
});

/* --------------------------------------------------------------------------
 * Blocos do escopo — tabelas e fotos
 *
 * A prévia já desenhava os dois e o documento não: quem montasse a proposta com
 * uma tabela de medições ou uma foto do antes/depois via tudo na tela e recebia
 * um PDF sem nada disso.
 * ----------------------------------------------------------------------- */

/** Um PNG 2x2 de verdade, para o pacote sair com bytes de imagem validos. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+' +
  'FABJADveWkH6oAAAAAElFTkSuQmCC';

const COM_BLOCOS = {
  ...DADOS,
  scopeBlocks: [
    {
      id: 't1',
      type: 'table',
      title: 'Medições previstas',
      columns: ['Sistema', 'Volume'],
      rows: [
        ['Hidráulico', '1200 L'],
        ['Lubrificante', '800 L']
      ]
    },
    {
      id: 'f1',
      type: 'photo',
      assetKey: 'k1',
      src: '',
      fileName: 'antes.png',
      caption: 'Tubulação antes da limpeza',
      aspectRatio: 1.5
    }
  ],
  lerFoto: async () => ({
    bytes: Buffer.from(PNG, 'base64'),
    extensao: 'png',
    mime: 'image/png'
  })
};

test('a tabela do escopo entra no documento com cabeçalho e linhas', async () => {
  const { texto } = textoDoDocx(await preencherProposta(COM_BLOCOS, 'commercial'));
  assert.match(texto, /Medições previstas/);
  assert.match(texto, /Sistema/);
  assert.match(texto, /Hidráulico/);
  assert.match(texto, /1200 L/);
  assert.match(texto, /Lubrificante/);
});

test('a foto do escopo entra como imagem, com legenda', async () => {
  const bytes = await preencherProposta(COM_BLOCOS, 'commercial');
  const zip = new AdmZip(bytes);

  // Os três lugares: bytes, relação e tipo de conteúdo. Esquecer qualquer um
  // produz um pacote que o Word RECUSA a abrir — não um documento feio.
  const midia = zip.getEntries().filter(e => e.entryName.startsWith('word/media/'));
  assert.equal(
    midia.length,
    imagensDoModelo('commercial') + 1,
    'a foto não foi gravada em word/media'
  );

  const rels = zip.getEntry('word/_rels/document.xml.rels').getData().toString('utf8');
  const idDaFoto = /Id="(rId\d+)"[^>]*Target="media\/escopo-/.exec(rels)?.[1];
  assert.ok(idDaFoto, 'a relação da foto não foi criada');

  const tipos = zip.getEntry('[Content_Types].xml').getData().toString('utf8');
  assert.match(tipos, /Extension="png"/, 'faltou o tipo de conteúdo do PNG');

  const documento = zip.getEntry('word/document.xml').getData().toString('utf8');
  assert.ok(
    documento.includes(`r:embed="${idDaFoto}"`),
    'o desenho não referencia a relação criada'
  );

  const { texto } = textoDoDocx(bytes);
  assert.match(texto, /Tubulação antes da limpeza/);
});

test('foto que não carrega não derruba a proposta', async () => {
  // O documento sai sem ela, e quem confere na prévia percebe a falta. Estourar
  // aqui impediria de emitir a proposta inteira por causa de um anexo.
  const semFoto = {
    ...COM_BLOCOS,
    lerFoto: async () => {
      throw new Error('sumiu');
    }
  };
  const { texto } = textoDoDocx(await preencherProposta(semFoto, 'commercial'));
  assert.match(texto, /Medições previstas/, 'a tabela também se perdeu');
  assert.ok(!texto.includes('{{escopo_blocos}}'), 'a âncora ficou impressa');
});

test('sem bloco nenhum, a âncora some do documento', async () => {
  const { texto, xml } = textoDoDocx(await preencherProposta(DADOS, 'commercial'));
  assert.ok(!texto.includes('escopo_blocos'));
  assert.ok(!xml.includes('{{escopo_blocos}}'));
});
