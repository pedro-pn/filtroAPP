export const VALOR_OUTRO_SERVICO = '__outro_servico__';

export const SERVICOS_DA_PROPOSTA = [
  'Teste de pressão',
  'Limpeza química',
  'Flushing',
  'Filtragem',
  'Limpeza mecânica'
] as const;

export function tituloDoNovoServico(selecao: string, indice: number): string {
  return selecao === VALOR_OUTRO_SERVICO ? `Serviço ${indice + 1}` : selecao;
}
