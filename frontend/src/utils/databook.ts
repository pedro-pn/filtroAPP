import type {
  DatabookEdicoes,
  DatabookIntervalo,
  DatabookResumo,
  DatabookRevisaoPreparada,
  DatabookStatus
} from '../api/databook';

/** "23 dias · 23 RDOs · 19 RLQs · 2 RTPs · 6 FDS" (tipos sem relatório no intervalo são omitidos). */
export function formatarResumoDatabook(resumo: DatabookResumo | null | undefined) {
  if (!resumo) return '';
  const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n === 1 ? singular : pluralForm}`;
  const partes = [plural(resumo.dias, 'dia'), plural(resumo.rdos, 'RDO')];
  for (const [chave, rotulo] of [['rlq', 'RLQ'], ['rcpu', 'RCPU'], ['rtp', 'RTP'], ['rlm', 'RLM']] as const) {
    if (resumo[chave]) partes.push(plural(resumo[chave], rotulo));
  }
  if (resumo.fds) partes.push(`${resumo.fds} FDS`);
  if (resumo.certificados) partes.push(plural(resumo.certificados, 'certificado'));
  return partes.join(' · ');
}

/** Mesma regra do backend: início ≤ fim e as duas datas dentro do período com RDO. */
export function erroIntervaloDatabook(intervalo: Partial<DatabookIntervalo>, padrao: DatabookIntervalo | null | undefined) {
  if (!padrao) return 'O projeto ainda não tem RDO aprovado.';
  if (!intervalo.inicio || !intervalo.fim) return 'Informe as datas de início e fim.';
  if (intervalo.inicio > intervalo.fim) return 'A data de início deve ser anterior ou igual à data de fim.';
  if (intervalo.inicio < padrao.inicio || intervalo.fim > padrao.fim) {
    return `Escolha datas entre ${dataBr(padrao.inicio)} e ${dataBr(padrao.fim)} (primeiro e último RDO).`;
  }
  return null;
}

export function dataBr(iso: string | null | undefined) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export interface DatabookFormulario {
  servico: string;
  escopo: string;
  resumoExecutivo: string;
  destaques: string;
  consideracoes: string;
  ocorrenciasSms: string;
  elaborado: string;
  verificado: string;
  aprovadoNome: string;
  aprovadoCargo: string;
  limiteIso: string;
  limiteNas: string;
  limiteUmidade: string;
  fds: string[];
  certificados: string[];
  descricao: string;
  /** Correção escolhida por palavra suspeita ('' = manter como está). */
  correcoes: Record<string, string>;
}

export const formularioVazio: DatabookFormulario = {
  servico: '', escopo: '', resumoExecutivo: '', destaques: '', consideracoes: '', ocorrenciasSms: '0',
  elaborado: '', verificado: '', aprovadoNome: '', aprovadoCargo: '',
  limiteIso: '', limiteNas: '', limiteUmidade: '', fds: [], certificados: [], descricao: '', correcoes: {}
};

export function formularioInicialDatabook(preparada: DatabookRevisaoPreparada, usuarioId?: string): DatabookFormulario {
  const { dados } = preparada;
  const t = dados.textos || {};
  const elaborado = preparada.responsaveis.some(r => r.id === usuarioId) ? usuarioId || '' : '';
  return {
    servico: dados.projeto.servico || '',
    escopo: t.escopo || '',
    resumoExecutivo: t.resumo_executivo || '',
    destaques: (t.destaques_sms || []).join('\n'),
    consideracoes: t.consideracoes_finais || '',
    ocorrenciasSms: String(dados.ocorrencias_sms ?? 0),
    elaborado,
    verificado: '',
    aprovadoNome: '',
    aprovadoCargo: '',
    limiteIso: dados.limites_rcpu?.iso || '',
    limiteNas: dados.limites_rcpu?.nas != null ? String(dados.limites_rcpu.nas) : '',
    limiteUmidade: dados.limites_rcpu?.umidade_ppm != null ? String(dados.limites_rcpu.umidade_ppm) : '',
    fds: dados.fds.map(f => f.arquivo),
    certificados: dados.certificados.map(c => c.arquivo),
    descricao: preparada.documento.rev === 0 ? 'Emissão inicial' : `Revisão ${preparada.documento.rev}`,
    correcoes: {}
  };
}

export type ErrosFormularioDatabook = Partial<Record<keyof DatabookFormulario, string>>;

export function validarFormularioDatabook(form: DatabookFormulario): ErrosFormularioDatabook {
  const erros: ErrosFormularioDatabook = {};
  if (!form.servico.trim()) erros.servico = 'Informe o título do serviço.';
  if (!/^\d+$/.test(form.ocorrenciasSms.trim())) erros.ocorrenciasSms = 'Informe um número inteiro (0 ou mais).';
  if (form.limiteIso.trim() && !/^\d{1,2}\/\d{1,2}(\/\d{1,2})?$/.test(form.limiteIso.trim())) erros.limiteIso = 'Use o formato ISO 4406, ex.: 16/14/11.';
  for (const campo of ['limiteNas', 'limiteUmidade'] as const) {
    const v = form[campo].trim().replace(',', '.');
    if (v && (!Number.isFinite(Number(v)) || Number(v) < 0)) erros[campo] = 'Informe um número.';
  }
  if (!form.descricao.trim()) erros.descricao = 'Descreva a revisão.';
  return erros;
}

export function edicoesDoFormulario(form: DatabookFormulario): DatabookEdicoes {
  return {
    servico: form.servico.trim(),
    ocorrencias_sms: Number(form.ocorrenciasSms.trim() || 0),
    textos: {
      escopo: form.escopo,
      resumo_executivo: form.resumoExecutivo,
      destaques_sms: form.destaques.split('\n').map(l => l.trim()).filter(Boolean),
      consideracoes_finais: form.consideracoes
    },
    limites_rcpu: { iso: form.limiteIso.trim(), nas: form.limiteNas.trim(), umidade_ppm: form.limiteUmidade.trim() },
    fds: form.fds,
    certificados: form.certificados,
    correcoes: Object.entries(form.correcoes).filter(([, por]) => por.trim()).map(([palavra, por]) => ({ palavra, por: por.trim() })),
    aprovacoes: {
      ...(form.elaborado ? { elaborado: { userId: form.elaborado } } : {}),
      ...(form.verificado ? { verificado: { userId: form.verificado } } : {}),
      ...(form.aprovadoNome.trim() ? { aprovado: { nome: form.aprovadoNome.trim(), cargo: form.aprovadoCargo.trim() } } : {})
    }
  };
}

export function statusDatabookConcluido(status: DatabookStatus | undefined) {
  return status === 'COMPLETED' || status === 'FAILED';
}

export const ROTULO_STATUS_DATABOOK: Record<DatabookStatus, string> = {
  PENDING: 'Na fila',
  RUNNING: 'Gerando',
  COMPLETED: 'Pronto',
  FAILED: 'Falhou'
};

// Divulgação temporária: 10 dias corridos após a implementação (09/10/2026).
const NOVIDADE_DATABOOK_EXPIRA = new Date('2026-10-19T23:59:59-03:00');
const NOVIDADE_DATABOOK_CHAVE = 'filtrovali:databook-novelty:v1:';

export function deveMostrarNovidadeDatabook(userId: string | null | undefined, agora = Date.now(), storage: Pick<Storage, 'getItem'> | null = safeStorage()) {
  if (!userId || agora > NOVIDADE_DATABOOK_EXPIRA.getTime()) return false;
  try {
    return storage?.getItem(`${NOVIDADE_DATABOOK_CHAVE}${userId}`) !== '1';
  } catch {
    return false;
  }
}

export function marcarNovidadeDatabookVista(userId: string | null | undefined, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  if (!userId) return;
  try {
    storage?.setItem(`${NOVIDADE_DATABOOK_CHAVE}${userId}`, '1');
  } catch {
    // armazenamento indisponível: a novidade volta a aparecer, sem quebrar a tela
  }
}

function safeStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
