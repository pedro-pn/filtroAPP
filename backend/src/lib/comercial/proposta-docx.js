import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import {
  categoriaCanonicaResponsabilidade,
  ordenarLinhasDeResponsabilidade,
  tabelasDePrecoDoModelo,
  textoJornada
} from '../../../../shared/comercial/dist/modelo-documento.js';
import { scopeDescriptionParagraphs } from '../../../../shared/comercial/dist/scope-descriptions.js';
import {
  REPORTS_NOTICE,
  TECHNICAL_REPORT_SENTENCES,
  normalizeTechnicalServiceSelections,
  technicalReportCodesFor
} from '../../../../shared/comercial/dist/technical-services.js';
import { convertDocxToPdf } from '../report-pdf-from-docx.js';
import { EMU_POR_MM, registrarImagem, xmlDeImagem } from '../docx/imagem.js';
import { lerDinheiro, moeda } from './dinheiro.js';
import {
  cloneBefore,
  elementText,
  findFirstByText,
  preserveWordTextLineBreaks,
  removeNode,
  repetirLinha,
  replacePlaceholders,
  replaceTokenInElement
} from '../docx/template.js';

/**
 * Preenche o modelo `.docx` da proposta.
 *
 * **Por que este caminho e não o gerador em `pdf-lib`.** O documento passou a
 * ser editável por quem o escreve: trocar um parágrafo, mudar a matriz padrão ou
 * corrigir uma cláusula é abrir o `.docx` em `Modelos/definitivos/Comercial/
 * modelos/` e salvar. Sem programador, sem deploy. O gerador programático
 * exigia código a cada vírgula.
 *
 * O que este módulo faz é só substituição: cada `{{marcador}}` vira valor, e
 * cada linha-modelo de tabela vira uma linha por registro. O layout, as fontes,
 * as imagens e o timbrado são do `.docx` — nada disso é redesenhado aqui.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MODELOS = process.env.COMERCIAL_MODELOS_DIR
  ? path.resolve(process.env.COMERCIAL_MODELOS_DIR)
  : path.resolve(AQUI, '../../../../Modelos/definitivos/Comercial/modelos');

const ARQUIVOS = {
  'commercial:padrao': 'Proposta Comercial.docx',
  'commercial:hidrojateamento': 'Proposta comercial hidrojateamento.docx',
  'technical:padrao': 'Proposta técnica.docx',
  'technical:hidrojateamento': 'Proposta técnica hidrojateamento.docx'
};

/**
 * As partes do pacote que podem conter marcador.
 *
 * **Descobertas do pacote, nunca listadas à mão.** Havia aqui uma lista fixa
 * — `document.xml`, `header1.xml`, `footer1.xml` — e ela quebrou no dia em que
 * alguém abriu o modelo no LibreOffice e salvou: o programa reescreveu o
 * pacote e dividiu o cabeçalho em `header1/2/3` (primeira página, pares,
 * ímpares). O `{{data_texto}}` foi parar no `header2`, fora do alcance, e saiu
 * **impresso** no documento — que abre normalmente.
 *
 * Editar o `.docx` é o caminho previsto para mudar o documento (é o desvio 12
 * inteiro). Então o código tem de aguentar o pacote ser reescrito, porque isso
 * vai acontecer de novo.
 */
function partesComMarcador(zip) {
  return (
    zip
      .getEntries()
      .map(entrada => entrada.entryName)
      .filter(nome => /^word\/(document|header\d*|footer\d*)\.xml$/.test(nome))
      // `document.xml` primeiro: é onde estão as tabelas que clonam linhas, e
      // manter a ordem estável torna o resultado reproduzível.
      .sort((a, b) =>
        a.startsWith('word/document') ? -1 : b.startsWith('word/document') ? 1 : a.localeCompare(b)
      )
  );
}

/**
 * Faz a capa usar o cabeçalho de primeira página, que é vazio.
 *
 * Sem `w:titlePg`, o Word aplica o cabeçalho padrão (com `{{data_texto}}`) já
 * na capa. Alguns modelos têm uma relação `first` pronta e outros não; nos dois
 * casos o sinalizador é necessário. Quando a parte `first` existe, devolvemos
 * o nome dela para impedir que a substituição escreva a data ali.
 */
function configurarCapaSemData(zip) {
  const entradaDocumento = zip.getEntry('word/document.xml');
  if (!entradaDocumento) return new Set();

  const doc = new DOMParser().parseFromString(
    entradaDocumento.getData().toString('utf8'),
    'text/xml'
  );
  const primeiraSecao = doc.getElementsByTagName('w:sectPr').item(0);
  if (!primeiraSecao) return new Set();

  if (!primeiraSecao.getElementsByTagName('w:titlePg').length) {
    const titlePg = doc.createElement('w:titlePg');
    const docGrid = Array.from(primeiraSecao.childNodes).find(
      no => no.nodeType === 1 && no.nodeName === 'w:docGrid'
    );
    primeiraSecao.insertBefore(titlePg, docGrid || null);
    zip.updateFile(
      'word/document.xml',
      Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8')
    );
  }

  const idsPrimeiraPagina = new Set(
    Array.from(primeiraSecao.getElementsByTagName('w:headerReference'))
      .filter(referencia => referencia.getAttribute('w:type') === 'first')
      .map(referencia => referencia.getAttribute('r:id'))
      .filter(Boolean)
  );
  if (!idsPrimeiraPagina.size) return new Set();

  const entradaRelacoes = zip.getEntry('word/_rels/document.xml.rels');
  if (!entradaRelacoes) return new Set();
  const relacoes = new DOMParser().parseFromString(
    entradaRelacoes.getData().toString('utf8'),
    'text/xml'
  );

  return new Set(
    Array.from(relacoes.getElementsByTagName('Relationship')).flatMap(relacao => {
      if (!idsPrimeiraPagina.has(relacao.getAttribute('Id'))) return [];
      const alvo = relacao.getAttribute('Target').replace(/^\/?word\//, '');
      return alvo ? [`word/${alvo.replace(/^\.\.\//, '')}`] : [];
    })
  );
}

export function arquivoDoModelo(tipo, modelo) {
  return ARQUIVOS[`${tipo}:${modelo}`] || ARQUIVOS[`${tipo}:padrao`];
}

function formatarData(iso) {
  const bruto = String(iso || '').trim();
  if (!bruto) return '';
  const quando = new Date(`${bruto}T12:00:00Z`);
  if (Number.isNaN(quando.getTime())) return bruto;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeZone: 'UTC'
  }).format(quando);
}

/** Os campos simples do cabeçalho e das condições. */
function camposSimples(dados) {
  return {
    nome_vendedor: dados.seller || '',
    elaborador_proposta: dados.estimator || '',
    cod_prop: dados.proposalCode || '',
    n_rev: dados.revision || '',
    nome_cliente: dados.client || '',
    contato_cliente: dados.contact || '',
    email_cliente: dados.email || '',
    dpto_solicitante: dados.department || '-',
    local_obra: dados.site || '',
    cnpj_texto: dados.cnpj || '',
    prev_atende: dados.attendance || '',
    n_dias: dados.permanence || '',
    dias_treinamento: dados.integration || '',
    n_dias_trabalhados: dados.execution || '',
    dias_mob: dados.mobilization || '',
    adto: dados.advancePercent || '',
    prazo_pgto: dados.paymentTerm || '',
    forma_pgto: dados.paymentMethod || '',
    valor_he: moeda(lerDinheiro(dados.overtimeRate)),
    valor_standby: moeda(lerDinheiro(dados.standbyTeam)),
    diaria_equipamento: moeda(lerDinheiro(dados.standbyEquipment)),
    valor_desmob_extra: moeda(lerDinheiro(dados.extraMobilization)),
    validadeProp: dados.validity || '',
    // `data_texto` é o nome do marcador NO CABEÇALHO do modelo. Eu enviava
    // `data_documento`, que não existe em lugar nenhum: o cabeçalho saía com
    // "{{data_texto}}" impresso. Passou despercebido porque o teste de
    // marcadores só olhava `word/document.xml`.
    data_texto: formatarData(dados.date)
  };
}

/**
 * Desdobra a matriz em registros de linha, intercalando o subtítulo da categoria.
 *
 * A categoria é emitida **quando muda**, não a cada linha — é o que faz o
 * documento ter um subtítulo por grupo em vez de um por obrigação. Foi por isso
 * que a categoria virou lista suspensa no formulário: duas grafias da mesma
 * categoria quebrariam o agrupamento aqui, e o documento sairia com "LOGÍSTICA"
 * duas vezes.
 */
function registrosDaMatriz(linhas, sufixo) {
  const categorias = [];
  const itens = [];
  let aberta = null;
  const responsavel = sufixo === 'filtrovali' ? 'Filtrovali' : 'Contratante';

  for (const linha of ordenarLinhasDeResponsabilidade(linhas, responsavel)) {
    const categoria = categoriaCanonicaResponsabilidade(
      String(linha.categoria || ''),
      responsavel
    );
    if (categoria && categoria !== aberta) {
      categorias.push({
        [`categoria_${sufixo}`]: categoria,
        apos: itens.length
      });
      aberta = categoria;
    }
    const subitens = Array.isArray(linha.subitens)
      ? linha.subitens.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    itens.push({
      [`escopo_${sufixo}`]: [linha.item || '', ...subitens.map(item => `• ${item}`)]
        .filter(Boolean)
        .join('\n'),
      [`nota_${sufixo}`]: linha.note || ''
    });
  }

  return { categorias, itens };
}

/**
 * Preenche uma matriz.
 *
 * As duas linhas-modelo — categoria e item — são clonadas alternadamente na
 * ordem certa, e as duas somem no fim. O `repetirLinha` genérico não serve
 * porque ele repete UMA modelo; aqui são duas, entrelaçadas.
 */
function preencherMatriz(doc, linhas, sufixo) {
  const modeloCategoria = findFirstByText(doc, 'w:tr', `{{categoria_${sufixo}}}`);
  const modeloItem = findFirstByText(doc, 'w:tr', `{{escopo_${sufixo}}}`);
  if (!modeloCategoria || !modeloItem) return;

  const { categorias, itens } = registrosDaMatriz(linhas, sufixo);
  const clones = [];
  let proximaCategoria = 0;

  itens.forEach((item, indice) => {
    while (proximaCategoria < categorias.length && categorias[proximaCategoria].apos === indice) {
      const clone = modeloCategoria.cloneNode(true);
      replacePlaceholders(clone, categorias[proximaCategoria]);
      clones.push(clone);
      proximaCategoria += 1;
    }
    const clone = modeloItem.cloneNode(true);
    replacePlaceholders(clone, item);
    clones.push(clone);
  });

  cloneBefore(modeloCategoria, clones);
  removeNode(modeloCategoria);
  removeNode(modeloItem);
}

/** Preenche uma tabela de preços e devolve o total somado. */
function preencherPrecos(doc, itens, sufixo) {
  const registros = itens.map(item => ({
    [`descricao_${sufixo}`]: item.description || '',
    [`unitario_${sufixo}`]: item.unitValue || '',
    [`quantidade_${sufixo}`]: item.quantity || '1',
    [`valor_${sufixo}`]: item.value || ''
  }));

  repetirLinha(doc, `{{descricao_${sufixo}}}`, registros);
  return itens.reduce((soma, item) => soma + lerDinheiro(item.value), 0);
}

/** Largura útil da folha A4 com as margens do documento, em milímetros. */
const LARGURA_UTIL_MM = 160;

const escapar = valor =>
  String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Uma tabela do escopo, montada com a largura da folha. */
function xmlDeTabela(bloco) {
  const colunas = bloco.columns.length || 1;
  const largura = Math.floor(9000 / colunas);
  const celula = (texto, cabecalho) => `
    <w:tc>
      <w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/>${
        cabecalho ? '<w:shd w:val="clear" w:fill="E8F0EB"/>' : ''
      }</w:tcPr>
      <w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:rPr>
        <w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/>${cabecalho ? '<w:b/>' : ''}
      </w:rPr></w:pPr>
      <w:r><w:rPr>
        <w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/>${cabecalho ? '<w:b/>' : ''}
      </w:rPr><w:t xml:space="preserve">${escapar(texto)}</w:t></w:r></w:p>
    </w:tc>`;

  const linha = (celulas, cabecalho) =>
    `<w:tr>${celulas.map(t => celula(t, cabecalho)).join('')}</w:tr>`;

  return `<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:tblPr>
      <w:tblW w:w="9000" w:type="dxa"/>
      <w:tblBorders>
        ${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
          .map(l => `<w:${l} w:val="single" w:sz="4" w:color="999999"/>`)
          .join('')}
      </w:tblBorders>
    </w:tblPr>
    ${linha(bloco.columns, true)}
    ${bloco.rows
      .map(r =>
        linha(
          bloco.columns.map((_, i) => r[i] || ''),
          false
        )
      )
      .join('')}
  </w:tbl>`;
}

/**
 * Item 8: deixa só os relatórios dos serviços contratados.
 *
 * **Decidido pelo mantenedor em 13/08.** O modelo traz os parágrafos de todos os
 * relatórios, e até aqui saíam todos, sempre — uma proposta só de limpeza
 * química prometia contagem de partículas, teste de pressão e limpeza de
 * reservatório que ninguém contratou. A prévia da tela já mostrava só os certos,
 * então tela e PDF discordavam, e quem vai ao cliente é o PDF.
 *
 * **Remove em vez de escrever.** Poderia trocar o bloco por um marcador e
 * escrever os parágrafos, como o escopo faz — mas aí a formatação sai do modelo
 * e passa a ser nossa, e o texto teria de ser copiado para o código, onde
 * envelheceria em silêncio. Removendo, o que sobra é o parágrafo do documento,
 * com a fonte, o recuo e o espaçamento que o comercial escolheu.
 *
 * O RDO **não é tocado**: ele aparece sempre, contratado o que for.
 */
function ajustarRelatorios(doc, servicos) {
  const selecoes = normalizeTechnicalServiceSelections(servicos);
  const contratados = new Set(technicalReportCodesFor(selecoes));

  let sobrou = 0;
  for (const [codigo, frase] of Object.entries(TECHNICAL_REPORT_SENTENCES)) {
    // A frase pode estar partida entre vários `w:t` — a armadilha de sempre —,
    // então a busca é pelo texto do parágrafo, não pelo XML.
    const marca = frase.slice(0, 60);
    for (const paragrafo of Array.from(doc.getElementsByTagName('w:p'))) {
      if (!elementText(paragrafo).includes(marca)) continue;
      if (contratados.has(codigo)) sobrou += 1;
      else removeNode(paragrafo);
    }
  }

  // "os relatórios abaixo" sem nada abaixo é frase solta. É o estado em que o
  // modelo de hidrojateamento ficou quando o RH saiu, em 13/08.
  if (sobrou) return;
  for (const paragrafo of Array.from(doc.getElementsByTagName('w:p'))) {
    if (elementText(paragrafo).includes(REPORTS_NOTICE.slice(0, 40))) removeNode(paragrafo);
  }
}

function paragrafoDeTexto(doc, texto, { negrito = false, tamanho = 20 } = {}) {
  const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="${tamanho}"/>${
      negrito ? '<w:b/>' : ''
    }</w:rPr><w:t xml:space="preserve">${escapar(texto)}</w:t></w:r>
  </w:p>`;
  return new DOMParser().parseFromString(xml, 'text/xml').documentElement;
}

function tituloDoCorpo(doc, trecho) {
  const corpo = doc.getElementsByTagName('w:body').item(0);
  if (!corpo) return null;
  return (
    Array.from(corpo.childNodes)
      .filter(no => no.nodeType === 1 && no.nodeName === 'w:p')
      .filter(no => elementText(no).includes(trecho))
      .at(-1) || null
  );
}

/** Remove o conteúdo entre dois títulos do corpo e devolve a âncora final. */
function limparEntreTitulos(doc, tituloInicial, tituloFinal) {
  const inicio = tituloDoCorpo(doc, tituloInicial);
  if (!inicio) return null;

  const remover = [];
  let atual = inicio.nextSibling;
  while (atual) {
    const proximo = atual.nextSibling;
    if (
      atual.nodeType === 1 &&
      atual.nodeName === 'w:p' &&
      elementText(atual).includes(tituloFinal)
    ) {
      remover.forEach(removeNode);
      return atual;
    }
    if (atual.nodeType === 1) remover.push(atual);
    atual = proximo;
  }
  return null;
}

/**
 * O prazo pode ser só a quantidade ("20") ou já trazer a unidade/condição
 * ("10 dias", "de imediato"). O "dias" fixo do modelo só é retirado no
 * segundo caso; quando o usuário informa apenas o número, ele deve sobreviver.
 */
function ajustarPrevisaoDeAtendimento(doc, valor) {
  const apenasNumero = /^\d+(?:[.,]\d+)?$/u.test(String(valor || '').trim());
  if (apenasNumero) return;

  for (const paragrafo of Array.from(doc.getElementsByTagName('w:p'))) {
    if (!elementText(paragrafo).includes('{{prev_atende}}')) continue;
    replaceTokenInElement(paragrafo, ' dias após', ' após');
  }
}

/** Remove a coluna de valor unitário quando a opção foi desmarcada na prévia. */
function ajustarColunaDeValorUnitario(doc, incluir) {
  if (incluir !== false) return;
  for (const tabela of Array.from(doc.getElementsByTagName('w:tbl'))) {
    if (!/\{\{unitario_[ab]\}\}/.test(elementText(tabela))) continue;

    const grade = tabela.getElementsByTagName('w:tblGrid').item(0);
    const colunas = grade
      ? Array.from(grade.childNodes).filter(no => no.nodeType === 1 && no.nodeName === 'w:gridCol')
      : [];
    if (colunas[2]) removeNode(colunas[2]);

    for (const linha of Array.from(tabela.getElementsByTagName('w:tr'))) {
      const celulas = Array.from(linha.childNodes).filter(
        no => no.nodeType === 1 && no.nodeName === 'w:tc'
      );
      // A linha de total tem duas células mescladas e não representa colunas
      // individuais; nela nada deve ser removido.
      if (celulas.length >= 5) removeNode(celulas[2]);
    }
  }
}

/** A data do cabeçalho é posicionada por alinhamento, nunca por espaços. */
function alinharDataDoCabecalho(doc) {
  for (const paragrafo of Array.from(doc.getElementsByTagName('w:p'))) {
    if (!elementText(paragrafo).includes('{{data_texto}}')) continue;
    let propriedades = Array.from(paragrafo.childNodes).find(
      no => no.nodeType === 1 && no.nodeName === 'w:pPr'
    );
    if (!propriedades) {
      propriedades = doc.createElement('w:pPr');
      paragrafo.insertBefore(propriedades, paragrafo.firstChild);
    }
    let alinhamento = Array.from(propriedades.childNodes).find(
      no => no.nodeType === 1 && no.nodeName === 'w:jc'
    );
    if (!alinhamento) {
      alinhamento = doc.createElement('w:jc');
      propriedades.appendChild(alinhamento);
    }
    alinhamento.setAttribute('w:val', 'right');
  }
}

/** Substitui a jornada fixa do modelo pelo texto editável desta proposta. */
function ajustarJornada(doc, jornada, modelo) {
  const proximoTitulo = tituloDoCorpo(doc, '- Descrição dos valores:')
    ? '- Descrição dos valores:'
    : '- Escopo Técnico:';
  const ancora = limparEntreTitulos(doc, '- Jornada de trabalho:', proximoTitulo);
  if (!ancora) return;

  const paragrafo = paragrafoDeTexto(doc, jornada || textoJornada(modelo));
  preserveWordTextLineBreaks(paragrafo);
  ancora.parentNode.insertBefore(paragrafo, ancora);
}

/**
 * O capítulo 7 da proposta técnica é montado apenas com os serviços escolhidos.
 *
 * Os modelos antigos trazem o catálogo inteiro entre "Escopo Técnico" e
 * "Relatórios". Limpamos esse intervalo sempre; assim uma proposta vazia não
 * promete serviço algum e a inclusão passa a depender exclusivamente dos
 * textos versionados/editaráveis guardados na própria proposta.
 */
function ajustarEscopoTecnico(doc, servicos) {
  const ancora = limparEntreTitulos(doc, '- Escopo Técnico:', '- Relatórios:');
  if (!ancora) return;

  normalizeTechnicalServiceSelections(servicos).forEach((servico, indice) => {
    const titulo = paragrafoDeTexto(
      doc,
      `7.${indice + 1} ${servico.title || `Serviço ${indice + 1}`}`,
      { negrito: true }
    );
    const texto = paragrafoDeTexto(doc, servico.text || '');
    preserveWordTextLineBreaks(texto);
    ancora.parentNode.insertBefore(titulo, ancora);
    ancora.parentNode.insertBefore(texto, ancora);
  });
}

function paragrafoComQuebras(doc, texto) {
  const paragrafo = paragrafoDeTexto(doc, texto);
  preserveWordTextLineBreaks(paragrafo);
  return paragrafo;
}

function substituirEntreTitulos(doc, inicio, fim, texto) {
  const valor = String(texto || '').trim();
  if (!valor) return;
  const ancora = limparEntreTitulos(doc, inicio, fim);
  if (ancora) ancora.parentNode.insertBefore(paragrafoComQuebras(doc, valor), ancora);
}

/** Substitui o trecho final de uma seção sem apagar o conteúdo que vem antes. */
function substituirCaudaAteTitulo(doc, inicioDaCauda, fim, texto) {
  const valor = String(texto || '').trim();
  const inicio = tituloDoCorpo(doc, inicioDaCauda);
  const fimDaSecao = tituloDoCorpo(doc, fim);
  if (!valor || !inicio || !fimDaSecao || inicio.parentNode !== fimDaSecao.parentNode) return;

  let atual = inicio;
  while (atual && atual !== fimDaSecao) {
    const proximo = atual.nextSibling;
    if (atual.nodeType === 1) removeNode(atual);
    atual = proximo;
  }
  fimDaSecao.parentNode.insertBefore(paragrafoComQuebras(doc, valor), fimDaSecao);
}

/**
 * Os campos livres mostrados na prévia também precisam vencer o texto fixo do
 * Word. Sem isto, editar pagamento, impostos ou observações mudava apenas a
 * tela e o PDF continuava com o texto antigo do modelo.
 */
function ajustarTextosEditaveis(doc, dados, tipo) {
  if (tipo === 'commercial') {
    substituirEntreTitulos(doc, '- Condições de pagamento:', '- Observações:', dados.payment);
    substituirCaudaAteTitulo(
      doc,
      'No caso de prorrogação da data de início',
      '- Impostos:',
      dados.observations
    );
    substituirEntreTitulos(doc, '- Impostos:', '- Validade da proposta:', dados.taxes);
    return;
  }

  const relatoriosComplementares = String(dados.technicalReports || '').trim();
  const validade = tituloDoCorpo(doc, '- Validade da proposta:');
  if (relatoriosComplementares && validade) {
    validade.parentNode.insertBefore(paragrafoComQuebras(doc, relatoriosComplementares), validade);
  }

  const observacoesComplementares = String(dados.technicalObservations || '').trim();
  if (!observacoesComplementares) return;
  const corpo = doc.getElementsByTagName('w:body').item(0);
  const propriedadesDaSecao =
    corpo &&
    Array.from(corpo.childNodes).find(no => no.nodeType === 1 && no.nodeName === 'w:sectPr');
  if (propriedadesDaSecao) {
    corpo.insertBefore(paragrafoComQuebras(doc, observacoesComplementares), propriedadesDaSecao);
  }
}

/**
 * As tabelas e fotos do escopo, no lugar do marcador `{{escopo_blocos}}`.
 *
 * **A prévia já desenhava os dois e o documento não** — quem montasse a proposta
 * com uma tabela de medições ou uma foto do antes/depois veria tudo na tela e
 * receberia um PDF sem nada disso.
 *
 * A foto entra com a largura da folha e a altura derivada da proporção que veio
 * do próprio bloco. Usar a proporção real do arquivo daria outro enquadramento
 * do que a prévia mostrou.
 */
async function preencherBlocosDoEscopo(zip, doc, blocos, lerFoto) {
  const ancora = findFirstByText(doc, 'w:p', '{{escopo_blocos}}');
  if (!ancora) return;

  const relsEntrada = zip.getEntry('word/_rels/document.xml.rels');
  const relsDoc = relsEntrada
    ? new DOMParser().parseFromString(zip.readAsText(relsEntrada), 'text/xml')
    : null;
  let mexeuNasRelacoes = false;

  const inserir = no => ancora.parentNode.insertBefore(no, ancora);

  for (const bloco of blocos) {
    if (bloco.type === 'table') {
      if (bloco.title) inserir(paragrafoDeTexto(doc, bloco.title, { negrito: true }));
      inserir(new DOMParser().parseFromString(xmlDeTabela(bloco), 'text/xml').documentElement);
      inserir(paragrafoDeTexto(doc, ''));
      continue;
    }

    if (bloco.type !== 'photo' || !relsDoc || typeof lerFoto !== 'function') continue;

    const foto = await lerFoto(bloco).catch(() => null);
    // Foto que não carrega não pode derrubar a proposta inteira: o documento
    // sai sem ela, e quem confere na prévia percebe a falta.
    if (!foto) continue;

    const relId = registrarImagem(zip, relsDoc, foto, 'escopo');
    mexeuNasRelacoes = true;

    const larguraEmu = Math.round(LARGURA_UTIL_MM * EMU_POR_MM);
    const proporcao = Number(bloco.aspectRatio) > 0 ? Number(bloco.aspectRatio) : 4 / 3;
    const alturaEmu = Math.round(larguraEmu / proporcao);

    const paragrafo = doc.createElement('w:p');
    const jc = new DOMParser().parseFromString(
      '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:jc w:val="center"/></w:pPr>',
      'text/xml'
    ).documentElement;
    paragrafo.appendChild(jc);
    paragrafo.appendChild(
      new DOMParser().parseFromString(
        xmlDeImagem(relId, larguraEmu, alturaEmu, bloco.fileName || 'Foto do escopo'),
        'text/xml'
      ).documentElement
    );
    inserir(paragrafo);

    if (bloco.caption) inserir(paragrafoDeTexto(doc, bloco.caption, { tamanho: 16 }));
  }

  if (mexeuNasRelacoes) {
    zip.updateFile(
      'word/_rels/document.xml.rels',
      Buffer.from(new XMLSerializer().serializeToString(relsDoc), 'utf8')
    );
  }

  removeNode(ancora);
}

function preencherDescricoesDoEscopo(doc, itens, tipo) {
  const modelo = findFirstByText(doc, 'w:p', '{{servico}}');
  if (!modelo) return;
  const clones = scopeDescriptionParagraphs(itens, tipo === 'commercial').map(item => {
    const clone = modelo.cloneNode(true);
    // Mantém a lista multinível do modelo: 2.1, 2.2 e 2.2.1, 2.2.2...
    // Cada texto é um w:p, nunca uma quebra de linha dentro do mesmo item.
    const nivel = clone.getElementsByTagName('w:ilvl').item(0);
    if (nivel) nivel.setAttribute('w:val', String(item.level));
    replacePlaceholders(clone, { servico: nivel ? item.text : `${item.number} ${item.text}` });
    return clone;
  });
  cloneBefore(modelo, clones);
  removeNode(modelo);
}

export async function preencherProposta(dados, tipo) {
  const modelo = dados.modelo === 'hidrojateamento' ? 'hidrojateamento' : 'padrao';
  const arquivo = arquivoDoModelo(tipo, modelo);
  const zip = new AdmZip(await readFile(path.join(MODELOS, arquivo)));
  const cabecalhosDaCapa = configurarCapaSemData(zip);

  const linhas = Array.isArray(dados.rows) ? dados.rows : [];
  const precos = Array.isArray(dados.prices) ? dados.prices : [];
  const locais = tabelasDePrecoDoModelo(modelo);

  for (const parte of partesComMarcador(zip)) {
    const item = zip.getEntry(parte);
    if (!item) continue;

    const doc = new DOMParser().parseFromString(item.getData().toString('utf8'), 'text/xml');

    if (parte === 'word/document.xml') {
      ajustarPrevisaoDeAtendimento(doc, dados.attendance);
      ajustarColunaDeValorUnitario(doc, dados.includeUnitValue);
      ajustarJornada(doc, String(dados.workday || '').trim(), modelo);
      if (tipo === 'technical') ajustarEscopoTecnico(doc, dados.technicalServices);
      ajustarTextosEditaveis(doc, dados, tipo);
    }
    if (/^word\/header\d*\.xml$/.test(parte)) alinharDataDoCabecalho(doc);

    // Tabelas primeiro: elas clonam linhas que ainda têm marcador dentro, e o
    // preenchimento de campo simples depois alcança o que sobrou.
    preencherMatriz(
      doc,
      linhas.filter(l => l.owner === 'Filtrovali'),
      'filtrovali'
    );
    preencherMatriz(
      doc,
      linhas.filter(l => l.owner === 'Contratante'),
      'contratante'
    );

    const totais = {};
    if (locais) {
      locais.forEach((local, indice) => {
        const sufixo = indice === 0 ? 'a' : 'b';
        totais[`total_${sufixo}`] = moeda(
          preencherPrecos(
            doc,
            precos.filter(p => p.local === local),
            sufixo
          )
        );
      });
    } else {
      totais.total_a = moeda(preencherPrecos(doc, precos, 'a'));
    }

    preencherDescricoesDoEscopo(doc, dados.scopeItems, tipo);
    ajustarRelatorios(doc, dados.technicalServices);
    await preencherBlocosDoEscopo(
      zip,
      doc,
      Array.isArray(dados.scopeBlocks) ? dados.scopeBlocks : [],
      dados.lerFoto
    );

    const campos = { ...camposSimples(dados), ...totais };
    if (cabecalhosDaCapa.has(parte)) campos.data_texto = '';
    replacePlaceholders(doc.documentElement, campos);

    zip.updateFile(parte, Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'));
  }

  return zip.toBuffer();
}

/**
 * A proposta em PDF.
 *
 * Preenche o modelo e converte com o **mesmo LibreOffice dos relatórios** —
 * `convertDocxToPdf` já traz fila de concorrência, tempo limite, sinal de aborto
 * e o caminho do Word no Windows. Reimplementar isso aqui seria repetir a parte
 * que já custou caro uma vez.
 *
 * O diretório temporário é apagado no `finally`, inclusive quando a conversão
 * falha: o LibreOffice deixa o `.docx` e um perfil para trás, e num servidor que
 * emite proposta o dia inteiro isso vira disco cheio.
 */
export async function gerarPropostaEmPdf(dados, tipo) {
  const docx = await preencherProposta(dados, tipo);
  const pasta = await mkdtemp(path.join(os.tmpdir(), 'filtrovali-proposta-'));

  try {
    const caminhoDocx = path.join(pasta, 'proposta.docx');
    const caminhoPdf = path.join(pasta, 'proposta.pdf');
    await writeFile(caminhoDocx, docx);
    await convertDocxToPdf(caminhoDocx, caminhoPdf);
    return await readFile(caminhoPdf);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}
