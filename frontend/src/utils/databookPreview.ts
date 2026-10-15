const ROTULOS: Record<string, string> = {
  servico: 'Título do serviço', escopo: 'Escopo', resumoExecutivo: 'Resumo executivo',
  destaques: 'Destaques de SMS', consideracoes: 'Considerações finais', ocorrenciasSms: 'Ocorrências de SMS',
  descricao: 'Descrição da revisão', elaborado: 'Elaborado por', verificado: 'Verificado por',
  aprovadoNome: 'Nome do aprovador', aprovadoCargo: 'Cargo do aprovador',
  limiteIso: 'Classe ISO 4406', limiteNas: 'Classe NAS 1638', limiteUmidade: 'Umidade máxima',
  'textosAdicionais.base_calculo': 'Base de cálculo', 'textosAdicionais.intro_procedimento': 'Introdução ao procedimento',
  'textosAdicionais.intro_rcpu': 'Introdução às contagens (RCPU)', 'textosAdicionais.intro_rtp': 'Introdução aos testes de pressão (RTP)',
  'textosAdicionais.nota_controle': 'Nota de controle'
};

export function rotuloCampoDatabook(campo: string): string | null {
  if (/^documento\.[a-zA-Z0-9_.-]{1,190}$/.test(campo)) return 'campo do documento';
  if (Object.hasOwn(ROTULOS, campo)) return ROTULOS[campo];
  const dia = campo.match(/^dias\.(\d+)\.(resumo|comentario)$/);
  if (dia) return `${dia[2] === 'resumo' ? 'Resumo' : 'Comentário'} do dia ${Number(dia[1]) + 1}`;
  const item = campo.match(/^dias\.(\d+)\.(atividades|servicos|fotos)\.(\d+)\.(texto|titulo|obs|laudo_observacao|legenda)$/);
  if (!item) return null;
  const [, d, grupo, indice, chave] = item;
  const nome = grupo === 'atividades' && chave === 'texto' ? 'Atividade'
    : grupo === 'fotos' && chave === 'legenda' ? 'Legenda da foto'
    : grupo === 'servicos' ? ({ titulo: 'Título do serviço', obs: 'Observações do serviço', laudo_observacao: 'Observação do laudo' } as Record<string, string>)[chave] : null;
  return nome ? `${nome} ${Number(indice) + 1} do dia ${Number(d) + 1}` : null;
}

/** Só os vínculos internos da prévia viram ações; links dos anexos nunca são seguidos. */
export function campoDaAnotacaoDatabook(endereco: unknown): string | null {
  if (typeof endereco !== 'string') return null;
  try {
    const url = new URL(endereco);
    if (url.origin !== 'https://databook.invalid' || !url.pathname.startsWith('/editar/')) return null;
    const campo = decodeURIComponent(url.pathname.slice('/editar/'.length));
    return rotuloCampoDatabook(campo) ? campo : null;
  } catch {
    return null;
  }
}
