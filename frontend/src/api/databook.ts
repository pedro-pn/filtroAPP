import { apiClient, rdoApiPath } from './client';

export type DatabookStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface DatabookIntervalo {
  inicio: string;
  fim: string;
}

export interface DatabookResumo extends DatabookIntervalo {
  dias: number;
  rdos: number;
  rlq: number;
  rcpu: number;
  rtp: number;
  rlm: number;
  fds?: number;
  certificados?: number;
}

export interface DatabookDialogo {
  padrao: DatabookIntervalo | null;
  resumo: DatabookResumo | null;
}

export interface DatabookFds {
  produto: string;
  nome_comercial: string;
  codigo?: string;
  revisao?: string;
  data?: string;
  etapa?: string;
  fabricante?: string;
  arquivo: string;
}

export interface DatabookCertificado {
  equipamento: string;
  codigo?: string;
  serie?: string;
  escala?: string;
  certificado?: string;
  calibracao?: string;
  validade?: string;
  aplicacao?: 'RTP' | 'RCPU';
  arquivo: string;
}

export type DatabookVinculoFds = 'exato' | 'aproximado' | 'duvida' | 'nenhum' | 'manual';

export interface DatabookFdsCandidata {
  produto: string;
  stockItemId: string | null;
  documentoId?: string | null;
  nome_comercial?: string;
  vinculo?: DatabookVinculoFds;
  opcoes?: Array<{ stockItemId: string; nome: string; score: number }>;
  confirmadoRomaneio?: boolean;
  selecionado: boolean;
  motivo: string;
}

/** Produto químico do Estoque que pode ser vinculado a um nome do RLQ no diálogo. */
export interface DatabookItemEstoqueFds {
  stockItemId: string;
  nome: string;
  documentoId: string | null;
  confirmadoRomaneio: boolean;
}

export interface DatabookTextos {
  escopo?: string;
  resumo_executivo?: string;
  destaques_sms?: string[];
  consideracoes_finais?: string;
  kpi_rotulo_concluidos?: string;
  base_calculo?: string;
  intro_procedimento?: string;
  intro_rcpu?: string;
  intro_rtp?: string;
  nota_controle?: string;
}

export interface DatabookDiaEditavel {
  data: string;
  resumo?: string;
  comentario?: string;
  atividades?: Array<{ texto: string }>;
  servicos?: Array<{ titulo?: string; obs?: string; laudo_observacao?: string }>;
  fotos?: Array<{ legenda?: string }>;
}

export interface DatabookPalavraSuspeita {
  palavra: string;
  sugestoes: string[];
  ocorrencias: Array<{ data: string; campo: string; trecho: string }>;
}

export interface DatabookOrtografia {
  disponivel: boolean;
  palavras: DatabookPalavraSuspeita[];
}

export interface DatabookResponsavel {
  id: string;
  nome: string;
  cargo: string;
}

export interface DatabookRevisaoPreparada {
  dados: {
    projeto: { servico: string; doc: string; rev: string; periodo: string };
    unidade_escopo: string;
    ocorrencias_sms: number;
    textos: DatabookTextos;
    dias?: DatabookDiaEditavel[];
    aprovacoes?: { elaborado?: DatabookPessoa; verificado?: DatabookPessoa; aprovado?: DatabookPessoa };
    fds: DatabookFds[];
    certificados: DatabookCertificado[];
    limites_rcpu?: { iso?: string; nas?: number; umidade_ppm?: number };
    campos_documento?: Record<string, string>;
  };
  avisos: string[];
  resumo: DatabookResumo;
  sugestoes: { fds: DatabookFdsCandidata[]; estoqueFds?: DatabookItemEstoqueFds[]; certificados: DatabookCertificado[] };
  documento: { doc: string; rev: number };
  responsaveis: DatabookResponsavel[];
  ortografia?: DatabookOrtografia;
  origem?: { id: string; revisao: number };
}

export interface DatabookPessoa {
  userId?: string;
  nome?: string;
  cargo?: string;
}

export interface DatabookEdicoes {
  campos_documento?: Record<string, string>;
  servico?: string;
  unidade_escopo?: string;
  ocorrencias_sms?: number;
  textos?: DatabookTextos;
  limites_rcpu?: { iso?: string; nas?: string; umidade_ppm?: string };
  fds?: string[];
  /** Produto do RLQ → item do Estoque escolhido no diálogo ('' = não vincular). */
  vinculos_fds?: Record<string, string>;
  certificados?: string[];
  aprovacoes?: { elaborado?: DatabookPessoa; verificado?: DatabookPessoa; aprovado?: DatabookPessoa };
  correcoes?: Array<{ palavra: string; por: string }>;
  dias?: DatabookDiaEditavel[];
}

export interface DatabookCampoDocumento {
  id: string;
  rotulo: string;
  secao: string;
  original: string;
  valor: string;
  multilinha: boolean;
  aparencia?: { tamanho: number; entrelinha?: number; alinhamento?: number; negrito?: boolean; italico?: boolean };
}

export interface DatabookPrevia {
  id: string;
  documento: { doc: string; rev: number };
  paginas: number;
  avisos: string[];
  campos?: DatabookCampoDocumento[];
}

export interface DatabookRevisao {
  id: string;
  revisao: number;
  descricao: string;
  status: DatabookStatus;
  paginas: number | null;
  tamanho: number | null;
  avisos: string[];
  erro: string | null;
  criadoEm: string;
  concluidoEm: string | null;
  doc?: string;
  inicio?: string;
  fim?: string;
}

export interface DatabookDocumento extends DatabookIntervalo {
  id: string;
  doc: string;
  revisoes: DatabookRevisao[];
}

const base = (path: string) => rdoApiPath(`/databook${path}`);

export async function fetchDatabookDialogo(projectId: string, intervalo?: Partial<DatabookIntervalo>) {
  const { data } = await apiClient.get<DatabookDialogo>(base(`/projects/${projectId}/intervalo`), { params: intervalo });
  return data;
}

export async function prepararDatabook(projectId: string, intervalo: DatabookIntervalo) {
  const { data } = await apiClient.post<DatabookRevisaoPreparada>(base(`/projects/${projectId}/revisao`), intervalo);
  return data;
}

export async function gerarDatabook(projectId: string, payload: { previaId: string } | (DatabookIntervalo & { edicoes: DatabookEdicoes; descricao?: string })) {
  const { data } = await apiClient.post<DatabookRevisao>(base(`/projects/${projectId}/gerar`), payload);
  return data;
}

export async function prepararEdicaoDatabook(revisaoId: string) {
  const { data } = await apiClient.get<DatabookRevisaoPreparada>(base(`/revisoes/${revisaoId}/edicao`));
  return data;
}

export async function criarPreviaDatabook(projectId: string, payload: DatabookIntervalo & { edicoes: DatabookEdicoes; descricao: string; origemRevisaoId?: string }) {
  const { data } = await apiClient.post<DatabookPrevia>(base(`/projects/${projectId}/previa`), payload);
  return data;
}

export async function baixarPreviaDatabook(previaId: string) {
  const { data } = await apiClient.get<Blob>(base(`/previas/${previaId}/pdf`), { responseType: 'blob' });
  return data;
}

export async function fetchDatabooks(projectId: string) {
  const { data } = await apiClient.get<DatabookDocumento[]>(base(`/projects/${projectId}`));
  return data;
}

export async function fetchDatabookRevisao(revisaoId: string) {
  const { data } = await apiClient.get<DatabookRevisao>(base(`/revisoes/${revisaoId}`));
  return data;
}

export async function baixarDatabookPdf(revisaoId: string) {
  const { data } = await apiClient.get<Blob>(base(`/revisoes/${revisaoId}/pdf`), { responseType: 'blob' });
  return data;
}
