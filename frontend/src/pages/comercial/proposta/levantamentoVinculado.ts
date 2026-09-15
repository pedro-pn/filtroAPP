import type { LevantamentoSalvo } from '../../../api/comercial';
import { calculateEstimate } from '../../../../../shared/comercial/dist/cost-model.js';
import type { ScopeServiceItem } from '../../../../../shared/comercial/dist/scope-content.js';
import {
  createTechnicalServiceSelection,
  getTechnicalServiceDefinition,
  updateTechnicalServiceParameter,
  type ChemicalMaterial,
  type TechnicalServiceId,
  type TechnicalServiceSelection
} from '../../../../../shared/comercial/dist/technical-services.js';

import {
  recalcularItensDePreco,
  type ItemDePreco
} from './etapas';

type LevantamentoComPayload = Pick<LevantamentoSalvo, 'title' | 'salePrice'> & {
  payload?: Record<string, unknown>;
};

type OpcoesDoItemDePreco = {
  local?: ItemDePreco['local'];
};

type CircuitoDoLevantamento = {
  id: string;
  name: string;
  material: string;
};

type GrupoDeServico = {
  serviceId: TechnicalServiceId;
  circuitos: CircuitoDoLevantamento[];
};

export type ServicosImportadosDoLevantamento = {
  escopo: ScopeServiceItem[];
  tecnicos: TechnicalServiceSelection[];
};

function gruposDeServicosDoLevantamento(
  levantamento: Pick<LevantamentoComPayload, 'payload'>
): GrupoDeServico[] {
  const circuitosBrutos = levantamento.payload?.volumeSystems;
  const associacoes = levantamento.payload?.circuitServices;
  if (!Array.isArray(circuitosBrutos) || !Array.isArray(associacoes)) return [];

  const circuitos = new Map<string, CircuitoDoLevantamento>();
  circuitosBrutos.forEach((candidato, indice) => {
    if (!candidato || typeof candidato !== 'object') return;
    const registro = candidato as Record<string, unknown>;
    if (registro.enabled === false) return;
    const id = String(registro.id || '').trim();
    if (!id) return;
    circuitos.set(id, {
      id,
      name: String(registro.name || `Circuito ${indice + 1}`).trim(),
      material: String(registro.material || 'other')
    });
  });

  const grupos = new Map<TechnicalServiceId, GrupoDeServico>();
  associacoes.forEach(candidato => {
    if (!candidato || typeof candidato !== 'object') return;
    const registro = candidato as Record<string, unknown>;
    const serviceId = String(registro.serviceId || '') as TechnicalServiceId;
    const circuito = circuitos.get(String(registro.systemId || ''));
    if (!circuito || !getTechnicalServiceDefinition(serviceId)) return;

    const grupo = grupos.get(serviceId) ?? { serviceId, circuitos: [] };
    if (!grupo.circuitos.some(item => item.id === circuito.id)) grupo.circuitos.push(circuito);
    grupos.set(serviceId, grupo);
  });

  return [...grupos.values()];
}

function materialQuimicoDosCircuitos(circuitos: CircuitoDoLevantamento[]): {
  material: ChemicalMaterial;
  otherMaterial?: string;
} {
  const rotulos = [...new Set(circuitos.map(circuito => ({
    carbon_steel: 'Aço carbono',
    stainless_steel: 'Aço inoxidável',
    other: 'Outro metal'
  })[circuito.material] ?? 'Outro metal'))];

  if (rotulos.length === 1 && rotulos[0] !== 'Outro metal') {
    return { material: rotulos[0] as ChemicalMaterial };
  }
  return {
    material: 'Outro metal',
    otherMaterial: rotulos.join(', ') || 'material informado no levantamento'
  };
}

/**
 * Converte a seleção feita no orçamento em escopo e modelos técnicos já
 * preenchidos, mantendo ambos editáveis na proposta.
 */
export function servicosImportadosDoLevantamento(
  levantamento: Pick<LevantamentoComPayload, 'payload'>
): ServicosImportadosDoLevantamento {
  const grupos = gruposDeServicosDoLevantamento(levantamento);
  const tecnicos = grupos.map(grupo => {
    let selecao: TechnicalServiceSelection = createTechnicalServiceSelection(
      grupo.serviceId,
      `levantamento-${grupo.serviceId}`
    );
    if (grupo.serviceId === 'limpeza_quimica') {
      const material = materialQuimicoDosCircuitos(grupo.circuitos);
      selecao = updateTechnicalServiceParameter(selecao, 'material', material.material);
      if (material.otherMaterial) {
        selecao = updateTechnicalServiceParameter(
          selecao,
          'otherMaterial',
          material.otherMaterial
        );
      }
    }
    return selecao;
  });

  return {
    tecnicos,
    escopo: grupos.map((grupo, indice) => {
      const selecao = tecnicos[indice];
      const nomes = grupo.circuitos.map(circuito => circuito.name);
      const aplicacao = nomes.length === 1
        ? `Sistema contemplado: ${nomes[0]}.`
        : `Sistemas contemplados: ${nomes.join(', ')}.`;
      return {
        id: `escopo-levantamento-${grupo.serviceId}`,
        title: selecao.title,
        description: `${aplicacao}\n\n${selecao.text}`
      };
    })
  };
}

/** Só substitui o cartão vazio criado automaticamente para uma proposta nova. */
export function preencherEscopoAusenteDoLevantamento(
  atual: ScopeServiceItem[],
  importado: ScopeServiceItem[]
): ScopeServiceItem[] {
  if (!importado.length) return atual;
  const itemInicial = atual.length === 1 ? atual[0] : undefined;
  const tituloGenerico = /^serviço\s+\d+$/iu.test(itemInicial?.title.trim() || '');
  const podePreencher = !atual.length
    || Boolean(itemInicial && !itemInicial.description.trim() && tituloGenerico);
  return podePreencher
    ? importado
    : atual;
}

/** Preserva ajustes já feitos na aba Técnica de uma proposta existente. */
export function preencherServicosTecnicosAusentesDoLevantamento(
  atuais: TechnicalServiceSelection[],
  importados: TechnicalServiceSelection[]
): TechnicalServiceSelection[] {
  return atuais.length || !importados.length ? atuais : importados;
}

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
 * Valor da ida da equipe lançado na Logística do levantamento.
 *
 * Equipamentos e desmobilização são intencionalmente excluídos: o campo da
 * proposta pede apenas uma nova mobilização da equipe, não todo o custo
 * logístico de um evento completo.
 */
export function valorDaMobilizacaoDeEquipeDoLevantamento(
  levantamento: Pick<LevantamentoComPayload, 'payload'>
): string {
  if (!levantamento.payload) return '';
  const calculado = calculateEstimate(levantamento.payload);
  const total = calculado.logisticsResults
    .filter(item => item.direction === 'mobilization' && item.slotType === 'crew')
    .reduce((soma, item) => soma + item.total, 0);
  return formatarValorDoLevantamento(total);
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

  return recalcularItensDePreco(precos.map((item, indice) => {
    const descricaoAtual = item.description.trim().toLocaleLowerCase('pt-BR');
    return {
      ...item,
      ...(indice === 0 && DESCRICOES_GENERICAS_DE_PRECO.has(descricaoAtual)
        ? { description: importado.description }
        : {}),
      ...(importado.local && !item.local ? { local: importado.local } : {})
    };
  }));
}
