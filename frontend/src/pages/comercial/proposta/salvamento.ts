import type { ScopeBlock, ScopeServiceItem } from '../../../../../shared/comercial/dist/scope-content.js';
import type { TechnicalServiceSelection } from '../../../../../shared/comercial/dist/technical-services.js';
import type { PropostaEntrada } from '../../../api/comercial';

import {
  recalcularItensDePreco,
  type ItemDePreco,
  type LinhaResponsabilidade
} from './etapas';

/**
 * O que a tela manda ao servidor (tarefa da ligação da proposta).
 *
 * Mora fora do componente porque é a parte que **erra em silêncio**: o
 * formulário chama o cliente de `client` e a API chama de `clientName`; o
 * consultor é `seller` de um lado e `sellerUserId` do outro. Um par trocado não
 * quebra nada — grava o campo errado, e a proposta sai com o nome no lugar do
 * departamento. Aqui isso é testável sem montar a tela.
 */

type AnyRecord = Record<string, unknown>;

export type ConteudoDaProposta = {
  form: AnyRecord;
  codigo: string;
  revisionNumber?: number;
  orcamentista: string;
  modelo: string;
  itensEscopo: ScopeServiceItem[];
  blocos: ScopeBlock[];
  categorias: string[];
  responsabilidades: LinhaResponsabilidade[];
  precos: ItemDePreco[];
  incluirUnitario: boolean;
  servicosTecnicos: TechnicalServiceSelection[];
  complementoRelatorios: string;
};

type PropostaPersistidaParaFormulario = {
  payload?: unknown;
  clientName?: string | null;
  cnpj?: string | null;
  contact?: string | null;
  email?: string | null;
  site?: string | null;
  department?: string | null;
  sellerUserId?: string | null;
};

/**
 * Recompõe o formulário a partir de uma proposta salva.
 *
 * Os campos de identificação existem também em colunas próprias do banco para
 * busca e histórico. Registros antigos podem não tê-los duplicados dentro de
 * `payload`; aplicar apenas o JSON fazia a proposta aparecer vazia no F5 mesmo
 * com Cliente, CNPJ e contato corretamente persistidos nas colunas canônicas.
 */
export function snapshotDaPropostaSalva(
  proposta: PropostaPersistidaParaFormulario
): AnyRecord {
  const payload = proposta.payload && typeof proposta.payload === 'object'
    ? (proposta.payload as AnyRecord)
    : {};

  return {
    ...payload,
    client: proposta.clientName ?? payload.client ?? '',
    cnpj: proposta.cnpj ?? payload.cnpj ?? '',
    contact: proposta.contact ?? payload.contact ?? '',
    email: proposta.email ?? payload.email ?? '',
    site: proposta.site ?? payload.site ?? '',
    department: proposta.department ?? payload.department ?? '',
    seller: proposta.sellerUserId ?? payload.seller ?? ''
  };
}

/**
 * O conteúdo da proposta, num lugar só.
 *
 * A prévia, o salvamento e a emissão usam **este mesmo objeto**. Montá-lo em
 * três lugares faria o documento conferido na tela divergir do documento
 * gravado — e a divergência apareceria no PDF que já foi ao cliente.
 */
export function dadosDaProposta(conteudo: ConteudoDaProposta): AnyRecord {
  const cenarioInformado = String(conteudo.form.priceScenario ?? '')
    .trim()
    .toUpperCase();

  return {
    ...conteudo.form,
    // O rádio nasce visualmente em ONSHORE. A escolha precisa nascer também no
    // payload: sem isso, não clicar no rádio faria a tela mostrar ONSHORE e o
    // servidor continuar escolhendo a maior tabela — justamente o defeito da
    // T130. Valores antigos ou inválidos também voltam ao padrão conhecido.
    ...(conteudo.modelo === 'hidrojateamento'
      ? { priceScenario: cenarioInformado === 'OFFSHORE' ? 'OFFSHORE' : 'ONSHORE' }
      : {}),
    proposalCode: conteudo.codigo,
    revision: conteudo.revisionNumber ? String(conteudo.revisionNumber) : '',
    estimator: conteudo.orcamentista,
    modelo: conteudo.modelo,
    scopeItems: conteudo.itensEscopo,
    scopeBlocks: conteudo.blocos,
    // `categorias` não vai ao gerador, mas vai ao banco: sem ela, reabrir a
    // proposta salva traria a matriz sem os subtítulos que o vendedor criou.
    categorias: conteudo.categorias,
    rows: conteudo.responsabilidades,
    prices: recalcularItensDePreco(conteudo.precos).map(item => ({
      ...item,
      // A unidade não é mais pedida na tela, mas permanece no payload por
      // compatibilidade com propostas e modelos anteriores.
      unit: String(item.unit || '').trim() || 'VB'
    })),
    includeUnitValue: conteudo.incluirUnitario,
    technicalServices: conteudo.servicosTecnicos,
    technicalReports: conteudo.complementoRelatorios
  };
}

/**
 * O corpo de `POST`/`PUT /propostas`.
 *
 * `totalValue` **não** entra: o servidor soma os itens de preço com a mesma
 * leitura de moeda do gerador do documento. Mandá-lo daqui permitiria que o
 * histórico e o CRM dissessem um número que o PDF não confirma.
 */
export function entradaDaProposta(
  conteudo: ConteudoDaProposta,
  levantamentoId: string,
  revisionNumber = conteudo.revisionNumber ?? 0
): PropostaEntrada {
  const texto = (campo: string) => String(conteudo.form[campo] ?? '').trim();

  return {
    proposalCode: conteudo.codigo,
    revisionNumber,
    // Proposta avulsa não tem levantamento, e `''` não é um id — seria uma
    // busca por registro inexistente, que o servidor recusa com 422.
    costEstimateId: levantamentoId || null,
    clientName: texto('client'),
    cnpj: texto('cnpj'),
    contact: texto('contact'),
    email: texto('email'),
    site: texto('site'),
    department: texto('department') || null,
    sellerUserId: texto('seller'),
    payload: dadosDaProposta(conteudo)
  };
}

/** O código ainda não foi reservado? A tela mostra "—" enquanto não há número. */
export function precisaDeNumero(codigo: string): boolean {
  return !codigo || codigo === '—';
}

/** O banco guarda base e revisão separados; a tela recompõe o rótulo. */
export function rotuloDaProposta(codigo: string, revisionNumber = 0): string {
  return revisionNumber > 0 ? `${codigo} Rev ${revisionNumber}` : codigo;
}
