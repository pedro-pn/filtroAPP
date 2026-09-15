import type { LevantamentoSalvo } from '../../../api/comercial';

import type { ItemDePreco } from './etapas';

type LevantamentoComPayload = Pick<LevantamentoSalvo, 'title' | 'salePrice'> & {
  payload?: Record<string, unknown>;
};

type OpcoesDoItemDePreco = {
  local?: ItemDePreco['local'];
};

/**
 * Parâmetros canônicos para abrir uma proposta a partir de um levantamento.
 *
 * A finalização da tela de custos e a escolha manual precisam produzir o mesmo
 * endereço. Se cada entrada montar a URL por conta própria, uma delas pode
 * vincular apenas o id sem aplicar título, local da obra e preço de venda.
 */
export function parametrosDaPropostaComLevantamento(
  levantamento: Pick<LevantamentoSalvo, 'id' | 'proposalCode' | 'revisionNumber'>
): URLSearchParams {
  const parametros = new URLSearchParams();
  parametros.set('levantamento', levantamento.id);
  parametros.set('proposta', levantamento.proposalCode);
  parametros.set('modo', levantamento.revisionNumber > 0 ? 'revision' : 'new');
  parametros.set('revisao', String(levantamento.revisionNumber || 0));
  parametros.set('etapa', 'cliente');
  parametros.set('usarLevantamento', '1');
  return parametros;
}

/**
 * O endereço de execução da proposta é o destino orçado no levantamento.
 *
 * `obra-principal` é a chave criada pela tela de logística. Levantamentos
 * antigos podem não tê-la; nesses casos usamos o primeiro destino que de fato
 * tenha endereço, sem confundir o local da obra com o endereço do CRM.
 */
export function localDaObraDoLevantamento(
  levantamento: Pick<LevantamentoComPayload, 'payload'>
): string {
  const destinos = levantamento.payload?.logisticsDestinations;
  if (!Array.isArray(destinos)) return '';

  const normalizados = destinos.flatMap(destino => {
    if (!destino || typeof destino !== 'object') return [];
    const registro = destino as Record<string, unknown>;
    const endereco = String(registro.address ?? '').trim();
    if (!endereco) return [];
    return [{ id: String(registro.id ?? ''), endereco }];
  });

  return (
    normalizados.find(destino => destino.id === 'obra-principal')?.endereco ??
    normalizados[0]?.endereco ??
    ''
  );
}

/** Formata o Decimal da API sem reaplicar a máscara de digitação por centavos. */
export function formatarValorDoLevantamento(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '';

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(numero);
}

/**
 * O levantamento fecha um preço global. Na proposta ele entra como uma verba
 * única, editável, para que o vendedor possa detalhá-la depois se necessário.
 */
export function itemDePrecoDoLevantamento(
  levantamento: Pick<LevantamentoSalvo, 'title' | 'salePrice'>,
  opcoes: OpcoesDoItemDePreco = {}
): ItemDePreco {
  const valor = formatarValorDoLevantamento(levantamento.salePrice);
  return {
    description: levantamento.title || 'Serviços conforme levantamento de custos',
    unit: 'VB',
    quantity: '1',
    unitValue: valor,
    value: valor,
    ...(opcoes.local ? { local: opcoes.local } : {})
  };
}

/**
 * Uma proposta já iniciada pode ter sido salva antes da importação do preço do
 * levantamento. Nesse caso a linha padrão existe, mas continua em R$ 0,00.
 *
 * A ausência é decidida pelo valor, não pela descrição: modelos antigos já
 * preenchiam um texto genérico ("Serviço especializado conforme escopo") e,
 * ainda assim, deixavam o preço zerado. Uma linha com valor positivo é edição
 * comercial válida e nunca deve ser sobrescrita silenciosamente.
 */
export function precosPrecisamDoLevantamento(precos: ItemDePreco[]): boolean {
  return !precos.some(item => {
    const centavos = String(item.value || '').replace(/\D/g, '');
    return Number(centavos) > 0;
  });
}

const DESCRICOES_GENERICAS_DE_PRECO = new Set([
  '',
  'serviço especializado conforme escopo',
  'serviços conforme levantamento de custos'
]);

/**
 * Completa uma proposta antiga sem destruir o que já foi negociado nela.
 *
 * - sem preço: recebe integralmente a linha do levantamento;
 * - com preço: preserva os valores e só troca a descrição genérica pelo nome
 *   dos serviços levantados;
 * - hidrojateamento legado: ganha ONSHORE para a linha não ficar fora das duas
 *   tabelas por não possuir cenário.
 */
export function preencherPrecosAusentesDoLevantamento(
  precos: ItemDePreco[],
  importado: ItemDePreco
): ItemDePreco[] {
  if (precosPrecisamDoLevantamento(precos)) return [importado];

  return precos.map((item, indice) => {
    const descricaoAtual = item.description.trim().toLocaleLowerCase('pt-BR');
    return {
      ...item,
      ...(indice === 0 && DESCRICOES_GENERICAS_DE_PRECO.has(descricaoAtual)
        ? { description: importado.description }
        : {}),
      ...(importado.local && !item.local ? { local: importado.local } : {})
    };
  });
}
