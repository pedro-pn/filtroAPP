import axios from 'axios';

import { ApiClientError, apiClient } from './client';

export interface ComercialStatus {
  module: string;
  status: string;
}

export async function getComercialStatus() {
  const { data } = await apiClient.get<ComercialStatus>('/comercial/status');
  return data;
}

/** Uma pendência endereçada a um campo, como o servidor devolve no `422`. */
export interface ComercialIssue {
  path: string | null;
  message: string;
  severity?: string;
}

/**
 * Erro de validação do levantamento.
 *
 * Existe como classe própria porque o `422` deste módulo **não é uma mensagem** — é
 * uma lista de pendências com o endereço de cada campo. Achatar isso numa string
 * (que é o que a referência fazia) joga fora exatamente a informação que permite
 * pintar o campo certo.
 */
export class ComercialValidationError extends Error {
  issues: ComercialIssue[];

  constructor(issues: ComercialIssue[]) {
    super('O levantamento tem pendências.');
    this.name = 'ComercialValidationError';
    this.issues = issues;
  }
}

export const CONCURRENT_WRITE_CODE = 'COMERCIAL_CONCURRENT_WRITE';

export interface ConflitoDeEdicao {
  updatedAt: string | null;
  updatedByUserId: string | null;
  updatedByLabel: string;
}

/** 409 que a tela resolve recarregando ou reenviando com confirmação. */
export class ComercialConcurrentWriteError extends Error {
  conflict: ConflitoDeEdicao;

  constructor(message: string, conflict: ConflitoDeEdicao) {
    super(message);
    this.name = 'ComercialConcurrentWriteError';
    this.conflict = conflict;
  }
}

export interface OpcoesDeConcorrencia {
  expectedUpdatedAt: string;
  forceOverwrite?: boolean;
}

export interface LevantamentoSalvo {
  id: string;
  proposalCode: string;
  revisionNumber: number;
  title: string;
  mode?: 'NOVA' | 'REVISAO';
  totalCost?: string | number | null;
  salePrice?: string | number | null;
  marginPercent?: string | number | null;
  status?: 'RASCUNHO' | 'SALVO';
  createdAt?: string;
  updatedAt: string;
  propostaVinculada?: {
    id: string;
    status: 'RASCUNHO' | 'FINALIZANDO' | 'FINALIZADA' | 'FALHA_INTEGRACAO';
    proposalCode: string;
    revisionNumber: number;
    updatedAt?: string;
  } | null;
}

export interface LevantamentoEntrada {
  proposalCode: string;
  revisionNumber?: number;
  title: string;
  mode: 'NOVA' | 'REVISAO';
  status?: 'RASCUNHO' | 'SALVO';
  payload: Record<string, unknown>;
}

/**
 * Os totais **não** são enviados: o servidor recalcula com `calculateEstimate` e grava
 * os seus. Mandar `salePrice` daqui seria oferecer ao cliente a chance de forjar
 * margem, e o contrato rejeita o campo.
 */
export async function criarLevantamento(entrada: LevantamentoEntrada) {
  try {
    const { data } = await apiClient.post<LevantamentoSalvo>(
      '/comercial/levantamentos',
      entrada
    );
    return data;
  } catch (error) {
    throw traduzirErro(error);
  }
}

export async function atualizarLevantamento(
  id: string,
  entrada: LevantamentoEntrada,
  concorrencia: OpcoesDeConcorrencia
) {
  try {
    const { data } = await apiClient.put<LevantamentoSalvo>(
      `/comercial/levantamentos/${id}`,
      { ...entrada, ...concorrencia }
    );
    return data;
  } catch (error) {
    throw traduzirErro(error);
  }
}

export async function obterLevantamento(id: string) {
  const { data } = await apiClient.get<
    LevantamentoSalvo & { payload: Record<string, unknown> }
  >(`/comercial/levantamentos/${id}`);
  return data;
}

/**
 * Levantamentos disponíveis para iniciar uma proposta.
 *
 * A rota já aplica autoria e permissão no servidor. O cliente não tenta
 * reconstruir essa regra: ele apenas oferece os registros que recebeu.
 */
export async function listarLevantamentos(
  filtros: {
    arquivados?: boolean;
    busca?: string;
    status?: 'RASCUNHO' | 'SALVO';
    page?: number;
    pageSize?: number;
  } = {}
) {
  const { data } = await apiClient.get<{
    items: LevantamentoSalvo[];
    total: number;
  }>('/comercial/levantamentos', {
    params: {
      arquivados: filtros.arquivados ? 1 : 0,
      busca: filtros.busca || '',
      status: filtros.status,
      page: filtros.page || 1,
      pageSize: filtros.pageSize || 25
    }
  });
  return data;
}

function traduzirErro(error: unknown): unknown {
  const conflito = interpretarConflitoDeEdicao(error);
  if (conflito) return conflito;
  const resposta = respostaDoErro(error);
  if (resposta?.status !== 422) return error;

  const corpo = resposta.data as {
    issues?: ComercialIssue[];
    message?: string;
  };
  const issues = Array.isArray(corpo?.issues) ? corpo.issues : [];

  // Sem `issues` não há o que endereçar — deixa o erro original subir em vez de
  // fabricar uma lista vazia, que a tela leria como "nenhuma pendência".
  return issues.length ? new ComercialValidationError(issues) : error;
}

/** O interceptor mantém a mensagem legível e os detalhes de validação da API. */
function respostaDoErro(error: unknown) {
  if (error instanceof ApiClientError) return { status: error.status, data: error.data };
  return axios.isAxiosError(error) ? error.response : undefined;
}

/** Mantida pura e exportada para provar o contrato HTTP no teste do frontend. */
export function interpretarConflitoDeEdicao(
  error: unknown
): ComercialConcurrentWriteError | null {
  const resposta = respostaDoErro(error);
  if (resposta?.status !== 409) return null;
  const corpo = resposta.data as {
    error?: string;
    code?: string;
    conflict?: Partial<ConflitoDeEdicao>;
  };
  if (corpo?.code !== CONCURRENT_WRITE_CODE || !corpo.conflict) return null;
  return new ComercialConcurrentWriteError(
    corpo.error || 'Este registro foi alterado enquanto você editava.',
    {
      updatedAt: corpo.conflict.updatedAt || null,
      updatedByUserId: corpo.conflict.updatedByUserId || null,
      updatedByLabel: corpo.conflict.updatedByLabel || 'outro usuário'
    }
  );
}

/**
 * Reserva o próximo número de proposta. **Consome** — pedir duas vezes gasta dois
 * números, e um número consumido não volta.
 *
 * `503` significa que a numeração ainda não foi semeada no ambiente. É recusa
 * deliberada do servidor, não indisponibilidade: emitir sem saber o maior número já
 * usado produziria código repetido no documento que chega ao cliente.
 */
export async function reservarProximoNumero() {
  const { data } = await apiClient.get<{ numero: number }>(
    '/comercial/propostas/proximo-numero'
  );
  return data.numero;
}

export interface Consultor {
  id: string;
  nome: string;
  username: string;
}

/**
 * Consultores de vendas.
 *
 * `podeEscolher` vem do servidor, não é deduzido aqui: gestor recebe a lista
 * completa, vendedor recebe só a si mesmo. A restrição acontece na origem — o cliente
 * apenas reflete o que chegou.
 */
export async function listarConsultores() {
  const { data } = await apiClient.get<{
    items: Consultor[];
    podeEscolher: boolean;
  }>('/comercial/consultores');
  return data;
}

export interface FotoDoEscopo {
  id: string;
  assetKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
}

/**
 * Envia uma foto de escopo, já otimizada pelo cliente.
 *
 * Binário cru com o tipo no `Content-Type` e o nome em `x-file-name`, no padrão que
 * este repositório já usa para upload. O servidor **revalida tudo** — inclusive a
 * assinatura de bytes, porque a otimização daqui pode ser contornada.
 */
export async function enviarFotoDoEscopo(blob: Blob, fileName: string) {
  const { data } = await apiClient.post<FotoDoEscopo>(
    '/comercial/escopo/fotos',
    blob,
    {
      headers: {
        'Content-Type': blob.type,
        'x-file-name': encodeURIComponent(fileName)
      }
    }
  );
  return data;
}

/**
 * A mensagem que o servidor mandou, quando mandou uma.
 *
 * O módulo escreve mensagem por caso — "Este registro pertence a outro
 * orçamentista", "Já existe a revisão 1 da proposta 4418" —, e trocá-las por um
 * texto genérico da tela joga fora justamente o que diz o que fazer a seguir.
 */
export function mensagemDeErro(error: unknown, padrao: string): string {
  const resposta = (
    error as { response?: { status?: number; data?: { error?: string } } }
  )?.response;
  if (resposta?.data?.error) return resposta.data.error;
  if (error instanceof Error && error.message) return error.message;
  return padrao;
}

export interface PropostaEntrada {
  proposalCode: string;
  revisionNumber?: number;
  costEstimateId?: string | null;
  clientName: string;
  cnpj: string;
  contact: string;
  email: string;
  site: string;
  department?: string | null;
  sellerUserId: string;
  payload: Record<string, unknown>;
}

export interface PropostaSalva {
  id: string;
  proposalCode: string;
  revisionNumber: number;
  status: string;
  /** Ausente para o papel de consulta — omitido na origem, não escondido aqui. */
  totalValue?: string | number | null;
  costEstimateId?: string | null;
  sellerUserId?: string;
  nectarOpportunityId?: string | null;
  nectarPipelineId?: string | null;
  nectarPipelineName?: string | null;
  nectarStatus?: 'PENDENTE' | 'SUCESSO' | 'ERRO';
  sharepointStatus?: 'PENDENTE' | 'SUCESSO' | 'ERRO';
  sharepointFolder?: string | null;
  integrationError?: string | null;
  clientName?: string;
  contact?: string;
  email?: string;
  site?: string;
  sellerName?: string;
  estimatorName?: string;
  title?: string;
  finalizedAt?: string | null;
  createdAt?: string;
  /** Ausentes para o papel de consulta, como `totalValue`. */
  totalCost?: string | number | null;
  marginPercent?: string | number | null;
  documents?: DocumentoEmitido[];
  payload?: Record<string, unknown>;
  updatedAt?: string;
}

export interface VinculoCrmDaProposta {
  opportunityId: string;
  pipelineId: string;
  pipelineName: string;
}

export interface ProximaRevisaoDaProposta {
  /** Nome mantido do contrato congelado. */
  base_number: number;
  /** Alias da camada de domínio do backend. */
  baseNumber: number;
  proposalCode: string;
  nextRevision: number;
  snapshot: Record<string, unknown>;
  snapshotAvailable: boolean;
  message: string;
  costEstimateId?: string | null;
  sellerUserId?: string;
  sellerName?: string;
  crm: VinculoCrmDaProposta | null;
}

/**
 * Salva a proposta.
 *
 * O `totalValue` **não** é enviado: o servidor soma os itens de preço com a
 * mesma leitura de moeda que o gerador do documento usa. Mandá-lo daqui
 * permitiria que o histórico e o CRM dissessem um número que o PDF não confirma.
 */
export async function criarProposta(entrada: PropostaEntrada) {
  const { data } = await apiClient.post<PropostaSalva>(
    '/comercial/propostas',
    entrada
  );
  return data;
}

export async function atualizarProposta(
  id: string,
  entrada: Partial<PropostaEntrada>,
  concorrencia: OpcoesDeConcorrencia
) {
  try {
    const { data } = await apiClient.put<PropostaSalva>(
      `/comercial/propostas/${id}`,
      {
        ...entrada,
        ...concorrencia
      }
    );
    return data;
  } catch (error) {
    throw interpretarConflitoDeEdicao(error) || error;
  }
}

export async function obterProposta(id: string) {
  const { data } = await apiClient.get<PropostaSalva>(
    `/comercial/propostas/${id}`
  );
  return data;
}

/**
 * Carrega o ponto de partida de uma revisão sem criar registro nem consumir
 * numeração. Ausência de snapshot completo é uma resposta normal: o backend
 * devolve nesse caso os campos que ainda existem no histórico.
 */
export async function prepararRevisaoDaProposta(codigo: string) {
  const { data } = await apiClient.get<ProximaRevisaoDaProposta>(
    `/comercial/propostas/${encodeURIComponent(codigo)}/revisao`
  );
  return data;
}

export async function listarPropostas(
  filtros: {
    busca?: string;
    arquivados?: boolean;
    page?: number;
    pageSize?: number;
  } = {}
) {
  const { data } = await apiClient.get<{
    items: PropostaSalva[];
    total: number;
  }>('/comercial/propostas', {
    params: {
      busca: filtros.busca || '',
      arquivados: filtros.arquivados ? 1 : 0,
      page: filtros.page || 1,
      pageSize: filtros.pageSize || 25
    }
  });
  return data;
}

export interface DocumentoEmitido {
  id: string;
  kind: 'COMERCIAL' | 'TECNICA';
  fileName: string;
  byteSize: number;
}

export interface FunilNectar {
  id: string;
  nome: string;
  primeiraEtapa: number;
}

export interface AnexoDaProposta {
  id: string;
  originalName: string;
  byteSize: number;
  createdAt: string;
}

export interface EstadoDaIntegracao {
  status: 'SUCESSO' | 'ERRO';
  mensagem: string;
  opportunityId?: string;
  pipelineId?: string;
  pipelineName?: string;
  pasta?: string;
}

export interface ResultadoDaFinalizacao {
  ok: boolean;
  documentos: DocumentoEmitido[];
  integracao: EstadoDaIntegracao;
  sharepoint: EstadoDaIntegracao;
  error?: string;
  documentosDisponiveis?: boolean;
}

/** Funis já filtrados pela lista branca do servidor. */
export async function listarFunisNectar() {
  const { data } = await apiClient.get<{
    items: FunilNectar[];
    motivoIndisponivel: string;
  }>('/comercial/nectar/funis');
  return data;
}

/**
 * Conclui documentos, histórico e integrações.
 *
 * O `502` desta rota é uma resposta útil: os PDFs já foram gravados e vêm no
 * corpo. Ele não pode virar uma exceção genérica do Axios, senão a tela perde
 * justamente os links que o FR-034 manda preservar.
 */
export async function finalizarProposta(
  proposalId: string,
  pipelineId: string,
  pastaExistente: string
): Promise<ResultadoDaFinalizacao> {
  // O interceptor global achata erros HTTP numa `ApiClientError` e, com isso,
  // descarta o corpo. Aceitar somente o 502 aqui preserva o corpo útil sem
  // afrouxar 401, 403, 409 ou qualquer outro erro da rota.
  const resposta = await apiClient.post<Partial<ResultadoDaFinalizacao>>(
    '/comercial/propostas/finalizar',
    { proposalId, pipelineId, pastaExistente },
    {
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 502
    }
  );
  return interpretarRespostaDaFinalizacao(resposta.status, resposta.data);
}

export function interpretarRespostaDaFinalizacao(
  status: number,
  data: Partial<ResultadoDaFinalizacao>
): ResultadoDaFinalizacao {
  const completa =
    typeof data?.ok === 'boolean' &&
    Array.isArray(data.documentos) &&
    Boolean(data.integracao) &&
    Boolean(data.sharepoint);
  if (status !== 502) {
    if (completa) return data as ResultadoDaFinalizacao;
    throw new Error(
      'O servidor devolveu uma resposta inválida ao finalizar a proposta.'
    );
  }
  if (
    !Array.isArray(data?.documentos) ||
    !data.integracao ||
    !data.sharepoint
  ) {
    throw new Error(data?.error || 'Não foi possível concluir as integrações.');
  }
  return {
    ok: false,
    documentos: data.documentos,
    integracao: data.integracao,
    sharepoint: data.sharepoint,
    error: data.error,
    documentosDisponiveis: true
  };
}

export async function enviarAnexoDaProposta(proposalId: string, arquivo: File) {
  const { data } = await apiClient.post<AnexoDaProposta>(
    `/comercial/propostas/${proposalId}/anexos`,
    arquivo,
    {
      headers: {
        'Content-Type': arquivo.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(arquivo.name)
      }
    }
  );
  return data;
}

export async function listarAnexosDaProposta(proposalId: string) {
  const { data } = await apiClient.get<{
    items: AnexoDaProposta[];
    total: number;
    bytesUsados: number;
    bytesDisponiveis: number;
  }>(`/comercial/propostas/${proposalId}/anexos`);
  return data;
}

export async function removerAnexoDaProposta(
  proposalId: string,
  anexoId: string
) {
  const { data } = await apiClient.delete<{ id: string; originalName: string }>(
    `/comercial/propostas/${proposalId}/anexos/${anexoId}`
  );
  return data;
}

/**
 * Emite os dois documentos: gera os PDFs e **grava no servidor**.
 *
 * Diferente da prévia, que não guarda nada. O corpo leva só o id — o que se
 * emite é o que está salvo, e é por isso que a tela salva antes de chamar aqui.
 */
export async function emitirDocumentos(proposalId: string) {
  const { data } = await apiClient.post<{
    proposalId: string;
    proposalCode: string;
    documentos: DocumentoEmitido[];
  }>('/comercial/propostas/documentos', { proposalId });
  return data;
}

/**
 * Baixa um documento já emitido.
 *
 * `responseType: 'blob'` não é detalhe: sem ele o axios interpreta os bytes do
 * PDF como texto e o arquivo chega corrompido, com erro só na hora de abrir.
 */
export async function baixarDocumento(id: string): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(`/comercial/documentos/${id}`, {
    responseType: 'blob'
  });
  return data;
}

/**
 * Configuração do módulo (T131).
 *
 * O endereço da sede é a origem de toda distância calculada. Era variável de
 * ambiente; virou dado de banco editável por gestor, porque muda quando a empresa
 * muda de prédio e quem sabe o endereço novo não é quem tem acesso ao servidor.
 */
export interface ComercialConfiguracao {
  /** O que o gestor digitou. */
  sedeEndereco: string;
  /** O endereço oficial que o Google devolveu, quando devolveu. */
  sedeEnderecoEncontrado: string;
  /** Vazio quando o Maps está desligado ou não achou — a rota cai no texto. */
  sedePlaceId: string;
  atualizadoEm: string | null;
  atualizadoPor: string;
}

/** O que a localização devolve: sempre exibível, mesmo quando não achou. */
export interface EnderecoLocalizado {
  enderecoEncontrado: string;
  placeId: string;
  confianca: 'exata' | 'parcial' | 'regiao' | 'nenhuma';
  aviso: string;
}

/**
 * Distância da sede até o endereço da obra (T126a/T126b).
 *
 * **Nunca rejeita por endereço ruim.** Endereço não encontrado, Maps desligado,
 * cota do dia estourada e rota inexistente chegam como `200` com `km: null` e o
 * motivo — porque o campo continua editável e digitar é o caminho de sempre. Um
 * erro aqui faria a tela parecer quebrada com o trabalho podendo seguir.
 */
export async function calcularDistancia(
  endereco: string,
  signal?: AbortSignal
) {
  const { data } = await apiClient.get<{
    km: number | null;
    enderecoEncontrado: string;
    confianca: 'exata' | 'parcial' | 'regiao' | 'nenhuma';
    aviso: string;
  }>('/comercial/distancia', { params: { endereco }, signal });
  return data;
}

/** Uma linha da lista de sugestões do Google. */
export interface SugestaoDeEndereco {
  placeId: string;
  /** O endereço inteiro, como o Google escreve. É o que vai para o campo. */
  texto: string;
  /** Rua e número — a linha forte da lista. */
  principal: string;
  /** Bairro, cidade, estado — a linha fraca. */
  secundario: string;
}

/**
 * Sugestões de endereço enquanto se digita (T134).
 *
 * Passa pelo servidor, e não direto do navegador para o Google: a chave é
 * restrita por IP do servidor, e uma chave de navegador seria pública por
 * natureza. O servidor também é quem segura a cota diária.
 *
 * Nunca rejeita por endereço ruim — vem `items: []` e o motivo em `aviso`.
 */
export async function sugerirEnderecos(termo: string, signal?: AbortSignal) {
  const { data } = await apiClient.get<{
    items: SugestaoDeEndereco[];
    aviso: string;
  }>('/comercial/enderecos/sugestoes', { params: { termo }, signal });
  return data;
}

/** Uma pessoa dentro da empresa do CRM. */
export type ContatoCrm = {
  id: string;
  nome: string;
  email: string;
  departamento: string;
};

/** Uma empresa do CRM, como a busca a devolve. */
export type EmpresaCrm = {
  id: string;
  nome: string;
  cnpj: string;
  site: string;
  contatos: ContatoCrm[];
};

export type BuscaDeEmpresas = {
  items: EmpresaCrm[];
  /**
   * `false` quando o índice do espelho ainda não existe — e aí a busca só casa
   * pelo **começo** do nome, porque é só isso que a API do Nectar faz (T123).
   * A tela precisa dizer isso: sem o aviso, quem procura "brasileiro" e não acha
   * a Petrobras conclui que a empresa não está no CRM.
   */
  porTrechoDisponivel: boolean;
  /** O índice está sendo construído agora; a próxima busca já pega por trecho. */
  indiceEmPreparo: boolean;
};

/**
 * Busca empresa no CRM pelo nome (T121a).
 *
 * **Nunca cai em cima da digitação**: o `signal` cancela a busca anterior. Sem
 * isso, respostas fora de ordem pintam a lista com o resultado de um termo que
 * o usuário já apagou.
 */
export async function buscarEmpresasCrm(busca: string, signal?: AbortSignal) {
  const { data } = await apiClient.get<BuscaDeEmpresas>(
    '/comercial/crm/empresas',
    {
      params: { busca },
      signal
    }
  );
  return data;
}

/**
 * A empresa com seus contatos.
 *
 * A busca já devolve contatos, mas nem sempre completos — este é o registro
 * cheio, pedido só quando o vendedor escolhe uma empresa.
 */
export async function obterEmpresaCrm(id: string) {
  const { data } = await apiClient.get<EmpresaCrm>(
    `/comercial/crm/empresas/${encodeURIComponent(id)}`
  );
  return data;
}

/**
 * O tutorial já foi visto por **esta conta**? (FR-025a)
 *
 * Vem do servidor, e não do `localStorage`, porque o marcador é da pessoa: no
 * navegador, dois usuários da mesma máquina o compartilhariam — o segundo nunca
 * veria o tutorial — e o mesmo usuário o veria de novo em outro computador.
 */
export async function tutorialComercialVisto() {
  const { data } = await apiClient.get<{ visto: boolean }>(
    '/comercial/tutorial'
  );
  return data.visto;
}

/** Dispensa. Idempotente: fechar em duas abas abertas juntas não é erro. */
export async function marcarTutorialComercialVisto() {
  await apiClient.post('/comercial/tutorial/visto');
}

export async function obterConfiguracaoComercial() {
  const { data } = await apiClient.get<ComercialConfiguracao>(
    '/comercial/configuracao'
  );
  return data;
}

/**
 * Grava a sede. Só gestor passa.
 *
 * O `aviso` vem junto da configuração gravada: gravar e não ter conseguido
 * localizar é caminho normal — com o Maps desligado, que é o padrão, é o único
 * caminho — e a tela precisa mostrar as duas coisas ao mesmo tempo.
 */
export async function salvarSedeComercial(
  sedeEndereco: string,
  sedePlaceId = ''
) {
  const { data } = await apiClient.put<
    ComercialConfiguracao & { aviso: string; confianca: string }
  >('/comercial/configuracao/sede', { sedeEndereco, sedePlaceId });
  return data;
}

/** Confere o endereço sem gravar — o botão "localizar" da tela. */
export async function localizarSedeComercial(sedeEndereco: string) {
  const { data } = await apiClient.post<EnderecoLocalizado>(
    '/comercial/configuracao/sede/localizar',
    { sedeEndereco }
  );
  return data;
}

/** Endereço de leitura da foto. O `<img>` aponta para cá; o arquivo é imutável. */
export function urlDaFotoDoEscopo(id: string) {
  const base = apiClient.defaults.baseURL || '/api';
  return `${base}/comercial/escopo/fotos/${id}`;
}

/**
 * Gera a prévia do documento em PDF no servidor (T072).
 *
 * **Não é a emissão.** Nada é gravado, a proposta não é numerada e nenhuma
 * integração é acionada — isto existe para conferir o documento antes de ele
 * existir. Por isso o corpo vai inteiro do formulário: nesta etapa não há
 * proposta salva de onde ler.
 *
 * `responseType: 'blob'` não é detalhe: sem ele o axios interpreta os bytes do
 * PDF como texto e o arquivo chega corrompido, com erro só na hora de abrir.
 */
export async function baixarPreviaEmPdf(
  tipo: 'commercial' | 'technical',
  dados: Record<string, unknown>
): Promise<Blob> {
  const { data } = await apiClient.post<Blob>(
    '/comercial/propostas/previa.pdf',
    { ...dados, tipo },
    { responseType: 'blob' }
  );
  return data;
}
