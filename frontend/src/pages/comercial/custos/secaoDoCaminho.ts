import type { CostSection } from './footerChain';

/**
 * De qual seção é este campo.
 *
 * O `422` do servidor devolve pendências endereçadas — `laborContexts[0].vehicleType`
 * — e a tela tem cinco seções. Sem esta tradução o usuário recebe "há 8 pendências",
 * vê a seção em que está limpa, e não tem como saber para onde ir. É o mesmo problema
 * que o rodapé-guia resolve para as pendências que ele conhece: **o app sabe o
 * caminho, só não estava dizendo.**
 *
 * A chave é sempre a **raiz** do caminho. `logistics[2].calculationMode` e
 * `logistics[0].trips` são a mesma seção, e o índice não interessa aqui.
 */

const RAIZ_PARA_SECAO: Record<string, CostSection> = {
  title: 'premises',
  proposalCode: 'premises',
  assumptions: 'premises',
  indirectCosts: 'premises',

  laborContexts: 'labor',

  materials: 'inputs',
  volumeSystems: 'inputs',
  circuitServices: 'inputs',
  products: 'inputs',
  filters: 'inputs',
  effluent: 'inputs',

  logistics: 'logistics',
  logisticsDestinations: 'logistics',

  commercial: 'summary'
};

/**
 * `scopeConfirmations` é o único caso em que a raiz não basta: as quatro
 * confirmações de escopo moram no mesmo objeto e vivem em seções diferentes.
 */
const CONFIRMACAO_PARA_SECAO: Record<string, CostSection> = {
  noLabor: 'labor',
  noInputs: 'inputs',
  noLogistics: 'logistics'
};

export function secaoDoCaminho(caminho: string): CostSection | null {
  if (!caminho) return null;

  // `logisticsDestinations[0].oneWayDistanceKm` → `logisticsDestinations`
  const raiz = caminho.split(/[.[]/)[0];

  if (raiz === 'scopeConfirmations') {
    const campo = caminho.split('.')[1] || '';
    return CONFIRMACAO_PARA_SECAO[campo] ?? null;
  }

  return RAIZ_PARA_SECAO[raiz] ?? null;
}

/**
 * A primeira seção pendente, na **ordem da tela**.
 *
 * Não na ordem em que o servidor listou: ele valida na ordem do payload, que não é a
 * ordem que o usuário percorre. Mandar para "Resumo" porque a comissão foi validada
 * primeiro faria o usuário voltar.
 */
const ORDEM: CostSection[] = ['premises', 'labor', 'inputs', 'logistics', 'summary'];

export function primeiraSecaoPendente(caminhos: string[]): CostSection | null {
  const atingidas = new Set(
    caminhos.map(secaoDoCaminho).filter((s): s is CostSection => s !== null)
  );
  return ORDEM.find(secao => atingidas.has(secao)) ?? null;
}
