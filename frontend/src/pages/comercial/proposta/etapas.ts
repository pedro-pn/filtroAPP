/**
 * As 7 etapas da proposta, a navegação e as validações de preenchimento.
 *
 * Porte de `app/page.tsx:857-863` (o stepper) e do rodapé com o contador de
 * pendências. Módulo puro, sem React, pelo mesmo motivo da cadeia do rodapé de
 * custos: a regra é testável sozinha, e a tela não é.
 *
 * As abas do rascunho são livres. O rodapé valida ao salvar e avançar, e a
 * conclusão confere todas as etapas, inclusive as que o usuário pulou.
 */

import {
  categoriaCanonicaResponsabilidade,
  EQUIPAMENTOS_E_FERRAMENTAS_PADRAO,
  matrizDoModelo,
  type LocalOperacao,
  type ModeloProposta
} from '../../../../../shared/comercial/dist/modelo-documento.js';
import {
  lerDinheiro,
  moeda
} from '../../../../../shared/comercial/dist/dinheiro.js';

export type EtapaProposta =
  | 'cliente'
  | 'escopo'
  | 'responsabilidades'
  | 'prazos'
  | 'tecnica'
  | 'comercial'
  | 'revisao';

export const ETAPAS: Array<{ value: EtapaProposta; label: string }> = [
  { value: 'cliente', label: 'Cliente' },
  { value: 'escopo', label: 'Escopo' },
  { value: 'responsabilidades', label: 'Responsabilidades' },
  { value: 'prazos', label: 'Prazos' },
  { value: 'tecnica', label: 'Técnica' },
  { value: 'comercial', label: 'Comercial' },
  { value: 'revisao', label: 'Revisão' }
];

export function indiceDaEtapa(etapa: EtapaProposta): number {
  const indice = ETAPAS.findIndex(item => item.value === etapa);
  return indice < 0 ? 0 : indice;
}

/** Documentos emitidos só permitem acessar a revisão/integração. */
export function podeAcessarEtapa(status: string, etapa: EtapaProposta): boolean {
  return status === 'RASCUNHO' || etapa === 'revisao';
}

/** Uma pendência da etapa: o campo e o que falta nele. */
export type PendenciaEtapa = { campo: string; mensagem: string };

/**
 * Validadores de formato, portados da referência.
 *
 * Os dois seguem a mesma regra que o `Field` da referência já aplicava: **erro só
 * quando há valor e ele está errado**. Campo vazio é "obrigatório", não "inválido" —
 * são dois estados, e trocá-los faz o usuário procurar um erro de digitação num
 * campo que ele simplesmente não preencheu.
 */
export function emailValido(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim());
}

/**
 * CNPJ: 14 dígitos **e** dígitos verificadores corretos.
 *
 * A referência conferia só a quantidade (`cnpjDigits.length === 14`). Conferir os
 * verificadores é mais estrito — e o CNPJ vai impresso no documento fiscal do
 * cliente, onde um dígito trocado inutiliza a proposta inteira.
 */
export function cnpjValido(valor: string): boolean {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (digitos.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digitos)) return false;

  const verificador = (base: string, pesos: number[]) => {
    const soma = base
      .split('')
      .reduce((total, digito, i) => total + Number(digito) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const primeiro = verificador(digitos.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = verificador(digitos.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return primeiro === Number(digitos[12]) && segundo === Number(digitos[13]);
}

export function formatarCnpj(valor: string): string {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

type Formulario = Record<string, unknown>;

function texto(form: Formulario, campo: string): string {
  return String(form[campo] ?? '').trim();
}

/**
 * As pendências da etapa **Cliente e responsáveis** (`PROP-CTL-011..025`).
 *
 * A trava da referência: proposta, cliente, contato, e-mail válido, CNPJ válido,
 * local da obra, consultor de vendas e orçamentista.
 */
export function pendenciasDoCliente(form: Formulario): PendenciaEtapa[] {
  const faltando: PendenciaEtapa[] = [];

  const obrigatorios: Array<[string, string]> = [
    ['seller', 'Selecione o consultor de vendas.'],
    ['date', 'Informe a data de emissão.'],
    ['client', 'Informe o cliente.'],
    ['contact', 'Informe o contato.'],
    ['site', 'Informe o local da obra.']
  ];

  for (const [campo, mensagem] of obrigatorios) {
    if (!texto(form, campo)) faltando.push({ campo, mensagem });
  }

  const cnpj = texto(form, 'cnpj');
  if (!cnpj) faltando.push({ campo: 'cnpj', mensagem: 'Informe o CNPJ.' });
  else if (!cnpjValido(cnpj)) {
    faltando.push({ campo: 'cnpj', mensagem: 'Informe um CNPJ válido com 14 dígitos.' });
  }

  const email = texto(form, 'email');
  if (!email) faltando.push({ campo: 'email', mensagem: 'Informe o e-mail.' });
  else if (!emailValido(email)) {
    faltando.push({ campo: 'email', mensagem: 'Digite um e-mail válido.' });
  }

  return faltando;
}

/**
 * As pendências da etapa **Escopo comum** (`PROP-CTL-026..033`).
 *
 * O título identifica o serviço no documento. A descrição é complementar e
 * pode ficar vazia quando o próprio título já define o escopo contratado.
 */
export function pendenciasDoEscopo(
  titulo: string,
  itens: Array<{ title?: string; description?: string }>
): PendenciaEtapa[] {
  const faltando: PendenciaEtapa[] = [];

  if (!String(titulo || '').trim()) {
    faltando.push({ campo: 'title', mensagem: 'Informe o título da proposta.' });
  }

  itens.forEach((item, i) => {
    if (!String(item.title || '').trim()) {
      faltando.push({ campo: `escopo[${i}].title`, mensagem: 'Informe o título do serviço.' });
    }
  });

  return faltando;
}

export type LinhaResponsabilidade = {
  item: string;
  owner: string;
  note: string;
  /**
   * O subtítulo que ocupa a largura da tabela no documento (MÃO DE OBRA E
   * EQUIPE TÉCNICA, LOGÍSTICA, UTILIDADES…). A referência não tem este campo e
   * desenha uma tabela plana — é o desvio 12, tarefa T071b.
   */
  categoria: string;
  /** Lista aninhada dentro da célula ESCOPO: equipamentos, EPI, efetivo. */
  subitens?: string[];
};

/** A linha cujo conteúdo variável alimenta os equipamentos do capítulo 3. */
export function ehLinhaDeEquipamentosDaFiltrovali(linha: {
  categoria?: string;
  owner?: string;
}): boolean {
  if (linha.owner !== 'Filtrovali') return false;
  return categoriaCanonicaResponsabilidade(
    linha.categoria || '',
    'Filtrovali'
  ) === 'EQUIPAMENTOS E MATERIAIS';
}

/** "N/A" é resposta legítima: há obrigação que não cabe a ninguém no contrato e
 *  precisa constar assim mesmo, para não parecer esquecimento. */
export const RESPONSAVEIS = ['Filtrovali', 'Contratante', 'N/A'];

/** As categorias que os documentos usam, na ordem em que costumam aparecer. */
export const CATEGORIAS_RESPONSABILIDADE = [
  'MÃO DE OBRA E EQUIPE TÉCNICA',
  'EQUIPAMENTOS E MATERIAIS',
  'CONSUMÍVEIS E UTILIDADES',
  'LOGÍSTICA',
  'SEGURANÇA, DOCUMENTAÇÃO E FORMALIDADE',
  'SEGURANÇA, DOCUMENTAÇÃO E CONFORMIDADE',
  'ACESSIBILIDADE E APOIO DE CAMPO',
  'MEIO AMBIENTE'
];

export function linhaVazia(): LinhaResponsabilidade {
  return { item: '', owner: 'Filtrovali', note: '', categoria: CATEGORIAS_RESPONSABILIDADE[0] };
}

/**
 * Normaliza a categoria digitada.
 *
 * Maiúsculas e espaço colapsado porque a categoria é **chave de agrupamento**, e
 * no documento ela vira um subtítulo. "Logística", "LOGISTICA " e "LOGÍSTICA"
 * digitadas em propostas diferentes produziriam três subtítulos onde deveria
 * haver um — que foi exatamente o motivo de trocar o campo livre por lista.
 */
export function normalizarCategoria(valor: string): string {
  return String(valor || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('pt-BR');
}

/** Chave de comparação: ignora acento, além do que `normalizarCategoria` já faz. */
function chaveDaCategoria(valor: string): string {
  return normalizarCategoria(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Acrescenta uma categoria à lista, recusando vazio e repetição.
 *
 * A repetição é detectada **sem acento**: "LOGISTICA" e "LOGÍSTICA" são a mesma
 * categoria para quem lê o documento, e deixar as duas entrarem devolveria o
 * problema que a lista veio resolver.
 */
export function acrescentarCategoria(
  lista: string[],
  valor: string
): { lista: string[]; erro?: string } {
  const nova = normalizarCategoria(valor);
  if (!nova) return { lista, erro: 'Informe o nome da categoria.' };

  const chave = chaveDaCategoria(nova);
  const existente = lista.find(item => chaveDaCategoria(item) === chave);
  if (existente) {
    return { lista, erro: `"${existente}" já está na lista.` };
  }

  return { lista: [...lista, nova] };
}

/**
 * Remove uma categoria — a não ser que alguma linha ainda a use.
 *
 * Remover em uso deixaria a linha apontando para uma categoria que não existe
 * mais na lista, e o `select` a mostraria vazia. Recusar e dizer quantas linhas
 * dependem dela é o que permite ao usuário decidir.
 */
export function removerCategoria(
  lista: string[],
  categoria: string,
  linhas: Array<{ categoria?: string }>
): { lista: string[]; erro?: string } {
  const emUso = linhas.filter(
    linha => chaveDaCategoria(linha.categoria || '') === chaveDaCategoria(categoria)
  ).length;

  if (emUso > 0) {
    return {
      lista,
      erro: `"${categoria}" está em ${emUso} ${emUso === 1 ? 'linha' : 'linhas'}. Troque a categoria dessas linhas antes de removê-la.`
    };
  }

  return { lista: lista.filter(item => item !== categoria) };
}

/**
 * A matriz com que a proposta nasce, vinda do modelo escolhido.
 *
 * A referência nascia com 17 linhas de **caldeiraria e solda** que não aparecem
 * em nenhum dos quatro documentos — matriz de outro negócio. Estas vêm dos
 * `.docx`, e são editáveis como qualquer outra: o vendedor apaga o que não se
 * aplica à obra dele.
 */
export function matrizInicial(modelo: ModeloProposta): LinhaResponsabilidade[] {
  return matrizDoModelo(modelo).map(linha => {
    const inicial: LinhaResponsabilidade = {
      item: linha.item,
      owner: linha.responsavel,
      note: linha.nota,
      categoria: linha.categoria,
      ...(linha.subitens ? { subitens: [...linha.subitens] } : {})
    };

    // O catálogo do modelo é uma lista de OPÇÕES, não uma promessa de que todos
    // os equipamentos irão para toda obra. Novas propostas começam sem seleção.
    if (modelo === 'padrao' && ehLinhaDeEquipamentosDaFiltrovali(inicial)) {
      return { ...inicial, subitens: [] };
    }
    return inicial;
  });
}

/**
 * As pendências da **matriz de responsabilidades** (`PROP-CTL-034..042`).
 *
 * Mais estrito que a referência, que exigia só a existência da linha. Linha em
 * branco atravessa para o documento como obrigação sem texto — pior do que a
 * ausência dela, porque parece que alguém quis dizer algo e não disse.
 */
export function pendenciasDasResponsabilidades(
  linhas: Array<{
    item?: string;
    owner?: string;
    categoria?: string;
    subitens?: string[];
  }>
): PendenciaEtapa[] {
  const pendencias: PendenciaEtapa[] = [];
  const preenchidas = linhas.filter(linha => String(linha.item || '').trim()).length;
  if (preenchidas === 0) {
    pendencias.push({
      campo: 'responsabilidades',
      mensagem: 'Informe ao menos uma responsabilidade com o item preenchido.'
    });
  }

  const linhaDeEquipamentos = linhas.find(ehLinhaDeEquipamentosDaFiltrovali);
  const equipamentos = (linhaDeEquipamentos?.subitens || []).filter(item => item.trim());
  if (linhaDeEquipamentos && equipamentos.length === 0) {
    pendencias.push({
      campo: 'equipamentos',
      mensagem: `Selecione ao menos um dos ${EQUIPAMENTOS_E_FERRAMENTAS_PADRAO.length} equipamentos ou informe outro.`
    });
  }

  return pendencias;
}

/** As pendências de **Prazos e jornada** (`PROP-CTL-043..048`). */
export function pendenciasDosPrazos(form: Formulario): PendenciaEtapa[] {
  const obrigatorios: Array<[string, string]> = [
    ['attendance', 'Informe a previsão de atendimento.'],
    ['mobilization', 'Informe a mobilização após o pedido.'],
    ['permanence', 'Informe a permanência prevista em obra.'],
    // `dias_treinamento` no documento. Saía impresso sem ter de onde vir — T071c.
    ['integration', 'Informe o prazo previsto para integração.'],
    ['execution', 'Informe o prazo efetivo de execução.'],
    ['workday', 'Descreva a jornada de trabalho.']
  ];

  return obrigatorios
    .filter(([campo]) => !texto(form, campo))
    .map(([campo, mensagem]) => ({ campo, mensagem }));
}

/**
 * As pendências da etapa ativa.
 *
 * As etapas ainda não portadas devolvem lista vazia **de propósito**: uma trava que
 * bloqueia sem ter o que validar prenderia o usuário numa etapa em branco. Quando a
 * etapa for portada, a validação dela entra aqui junto.
 */
export function pendenciasDaEtapa(
  etapa: EtapaProposta,
  form: Formulario,
  escopo: {
    itens?: Array<{ title?: string; description?: string }>;
    responsabilidades?: Array<{ item?: string }>;
    errosTecnicos?: string[];
    precos?: ItemDePreco[];
  } = {}
): PendenciaEtapa[] {
  if (etapa === 'cliente') return pendenciasDoCliente(form);
  if (etapa === 'escopo') {
    return pendenciasDoEscopo(String(form.title ?? ''), escopo.itens || []);
  }
  if (etapa === 'responsabilidades') {
    return pendenciasDasResponsabilidades(escopo.responsabilidades || []);
  }
  if (etapa === 'prazos') return pendenciasDosPrazos(form);
  if (etapa === 'tecnica') return pendenciasDaTecnica(escopo.errosTecnicos || []);
  if (etapa === 'comercial') return pendenciasDaComercial(form, escopo.precos || []);
  return [];
}

/** Pendências de todo o documento, na ordem das abas e com o campo de destino. */
export function pendenciasDaProposta(
  form: Formulario,
  escopo: Parameters<typeof pendenciasDaEtapa>[2] = {}
): Array<PendenciaEtapa & { etapa: EtapaProposta }> {
  return ETAPAS.flatMap(({ value: etapa }) =>
    pendenciasDaEtapa(etapa, form, escopo).map(pendencia => ({ ...pendencia, etapa }))
  );
}

export type ItemDePreco = {
  description: string;
  unit: string;
  quantity: string;
  unitValue: string;
  value: string;
  /**
   * A qual tabela o item pertence, no modelo de hidrojateamento: ONSHORE ou
   * OFFSHORE. Ausente no modelo padrão, que tem uma tabela só (T071f).
   *
   * Cada tabela fecha o **seu** TOTAL GERAL. Somar as duas juntas apresentaria
   * ao cliente um total que ele não vai pagar: são cenários alternativos de
   * execução, não parcelas do mesmo serviço.
   */
  local?: LocalOperacao;
};

export const CAMPOS_STANDBY = [
  { campo: 'overtimeRate', label: 'Homem/hora fora do horário previsto' },
  { campo: 'standbyTeam', label: 'Stand-by de equipe (diária)' },
  { campo: 'standbyEquipment', label: 'Stand-by de equipamentos (diária)' },
  { campo: 'extraMobilization', label: 'Mobilização extra (por evento ida e volta)' }
] as const;

export const VALORES_PADRAO_STANDBY = {
  overtimeRate: 'R$ 2.250,00',
  standbyTeam: 'R$ 250,00'
} as const;

export function quantidadeDoItemDePreco(valor: unknown): number {
  const numero = Number(String(valor ?? '').trim().replace(',', '.'));
  return Number.isFinite(numero) ? numero : 0;
}

/** O total impresso é sempre quantidade × valor unitário, arredondado em centavos. */
export function valorTotalDoItemDePreco(
  quantidade: unknown,
  valorUnitario: unknown
): string {
  if (!String(valorUnitario ?? '').trim()) return '';
  const quantidadeNumerica = quantidadeDoItemDePreco(quantidade);
  if (quantidadeNumerica <= 0) return '';
  return moeda(
    Math.round(quantidadeNumerica * lerDinheiro(valorUnitario) * 100) / 100
  );
}

export function recalcularItemDePreco(item: ItemDePreco): ItemDePreco {
  return {
    ...item,
    value: valorTotalDoItemDePreco(item.quantity, item.unitValue)
  };
}

export function recalcularItensDePreco(itens: ItemDePreco[]): ItemDePreco[] {
  return itens.map(item =>
    String(item.unitValue || '').trim() && quantidadeDoItemDePreco(item.quantity) > 0
      ? recalcularItemDePreco(item)
      : item
  );
}

export function itemDePrecoCompleto(item: ItemDePreco): boolean {
  return Boolean(
    String(item.description || '').trim()
      && quantidadeDoItemDePreco(item.quantity) > 0
      && String(item.unitValue || '').trim()
      && valorTotalDoItemDePreco(item.quantity, item.unitValue)
  );
}

/**
 * Máscara de moeda, portada de `formatMoneyInput` (`app/page.tsx:1747`).
 *
 * Os dígitos são lidos como **centavos**: digitar `12345` dá `R$ 123,45`. É o
 * comportamento da referência, e o que evita a ambiguidade de quem digita `1.500`
 * querendo dizer mil e quinhentos ou um e meio.
 */
export function formatarDinheiro(valor: string): string {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (!digitos) return '';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(digitos) / 100);
}

/**
 * As pendências de **Serviços da proposta técnica** (`PROP-CTL-049..057`).
 *
 * A validação inteira vem de `validateTechnicalServiceSelections`, em
 * `shared/comercial` — é regra de engenharia, não de tela, e reescrevê-la aqui
 * criaria a segunda verdade que o módulo compartilhado existe para evitar.
 *
 * Ela devolve frases prontas, sem endereço de campo. Elas vão para o aviso da
 * seção; os campos condicionais já se marcam sozinhos por serem obrigatórios.
 */
export function pendenciasDaTecnica(erros: string[]): PendenciaEtapa[] {
  return erros.map(mensagem => ({ campo: 'tecnica', mensagem }));
}

/**
 * As pendências de **Conteúdo da proposta comercial** (`PROP-CTL-058..071`).
 *
 * Ao menos um preço precisa de descrição, quantidade e valor unitário; o total
 * é derivado desses dois últimos. Os quatro adicionais comerciais também são
 * obrigatórios porque seguem para a tabela do item 9.
 */
export function pendenciasDaComercial(
  form: Formulario,
  precos: ItemDePreco[]
): PendenciaEtapa[] {
  const faltando: PendenciaEtapa[] = [];

  const completos = precos.filter(itemDePrecoCompleto).length;

  if (completos === 0) {
    faltando.push({
      campo: 'precos',
      mensagem: 'Informe ao menos um item de preço com descrição, quantidade e valor unitário.'
    });
  }

  const obrigatorios: Array<[string, string]> = [
    ['payment', 'Informe as condições de pagamento.'],
    ['taxes', 'Informe os impostos.']
  ];

  for (const [campo, mensagem] of obrigatorios) {
    if (!texto(form, campo)) faltando.push({ campo, mensagem });
  }

  for (const { campo, label } of CAMPOS_STANDBY) {
    if (!texto(form, campo)) {
      faltando.push({ campo, mensagem: `Informe ${label.toLocaleLowerCase('pt-BR')}.` });
    }
  }

  const validade = Number(texto(form, 'validity'));
  if (!texto(form, 'validity')) {
    faltando.push({ campo: 'validity', mensagem: 'Informe a validade das propostas.' });
  } else if (!Number.isFinite(validade) || validade <= 0) {
    // Validade zero ou negativa produz uma proposta vencida na emissão.
    faltando.push({
      campo: 'validity',
      mensagem: 'A validade precisa ser de pelo menos 1 dia.'
    });
  }

  return faltando;
}

/**
 * O rótulo do botão primário, no texto da referência.
 *
 * **A contagem de pendências vai num aviso próprio ao lado**, não no botão — é
 * assim na referência (`<span className="missing">`), e é assim aqui.
 *
 * O que diverge da referência, e é deliberado: lá o botão fica **desabilitado**
 * enquanto há pendência. Aqui ele continua clicável, e o clique é o que revela a
 * marcação em cada campo (L1). Desabilitar esconderia a resposta de quem está
 * perdido, e o aviso com a contagem já diz que falta alguma coisa.
 */
export function rotuloDoAvanco(
  _pendencias: PendenciaEtapa[],
  ultima: boolean,
  proximaEtapa = ''
): string {
  if (ultima) return 'Gerar e salvar técnica + comercial';
  return proximaEtapa ? `Salvar e ir para ${proximaEtapa} →` : 'Salvar e continuar →';
}

/** "Preencha N campo(s) obrigatório(s)" — o aviso ao lado do botão. */
export function avisoDePendencias(pendencias: PendenciaEtapa[]): string {
  if (pendencias.length === 0) return '';
  return pendencias.length === 1
    ? 'Preencha 1 campo obrigatório'
    : `Preencha ${pendencias.length} campos obrigatórios`;
}

/** Índice campo → mensagem, para a etapa consultar sem varrer a lista a cada campo. */
export function indiceDePendencias(pendencias: PendenciaEtapa[]) {
  const mapa = new Map<string, string>();
  for (const item of pendencias) if (!mapa.has(item.campo)) mapa.set(item.campo, item.mensagem);
  return mapa;
}
