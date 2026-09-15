import {
  HOTEL_SITE_COMMUTE_EXPENSE_CODE,
  hasCompleteCircuitServices,
  hasMeaningfulInputs,
  hasMeaningfulLabor
} from '../../../../../shared/comercial/dist/cost-model.js';
import { numberValue } from './formato';
import { faltaLogistica } from './logistica';

/**
 * Predicados de pendência por seção — o que alimenta o rodapé-guia.
 *
 * Porte de `app/custos/page.tsx:89-140`. Ficam num módulo puro porque são
 * regra, não desenho: dá para testar cada condição isoladamente, sem montar
 * 465 controles na tela.
 *
 * O que estes predicados têm de especial: **a confirmação de escopo desliga
 * a pendência**. "Sem mão de obra" não é um estado vazio — é uma afirmação do
 * usuário de que aquele bloco não se aplica. Sem isso, um levantamento
 * legitimamente sem mão de obra ficaria travado para sempre, e a saída óbvia
 * (preencher qualquer coisa) produziria preço errado.
 */

type AnyRecord = Record<string, unknown>;

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

/**
 * Falta informação obrigatória de mão de obra?
 *
 * Quatro condições, em `app/custos/page.tsx:89-107`. As três últimas valem
 * **por fase**: basta uma fase habilitada incompleta para a seção pender.
 */
export function faltaMaoDeObra(draft: AnyRecord): boolean {
  const confirmacoes = (draft.scopeConfirmations as AnyRecord) || {};
  if (confirmacoes.noLabor === true) return false;

  if (!hasMeaningfulLabor(draft)) return true;

  return registros(draft.laborContexts).some(contexto => {
    if (contexto.enabled === false) return false;

    // Condição de trabalho precisa ser escolhida E confirmada — são duas
    // coisas. Escolher sem confirmar deixa a fase com base de cálculo por
    // definir, e o custo sai plausível e errado.
    if (!contexto.workCondition || !contexto.workConditionConfirmed) return true;
    if (!contexto.vehicleType) return true;

    if (contexto.workCondition !== 'travel' || contexto.vehicleType === 'none') return false;

    // Fase em viagem: distância hotel ↔ obra e o combustível do trajeto.
    if (numberValue(contexto.hotelSiteDistanceKmPerDay) <= 0) return true;

    const combustivel = registros(contexto.expenses).find(
      despesa => despesa.code === HOTEL_SITE_COMMUTE_EXPENSE_CODE
    );

    return (
      !combustivel ||
      combustivel.included === false ||
      numberValue(combustivel.quantity) <= 0 ||
      numberValue(combustivel.unitValue) <= 0
    );
  });
}

/**
 * Falta composição de materiais e insumos?
 * A mais simples das quatro (`page.tsx:108`).
 */
export function faltaInsumos(draft: AnyRecord): boolean {
  const confirmacoes = (draft.scopeConfirmations as AnyRecord) || {};
  if (!hasCompleteCircuitServices(draft)) return true;
  if (confirmacoes.noInputs === true) return false;
  return !hasMeaningfulInputs(draft);
}

/**
 * Falta informação de comissão ou indicação?
 *
 * Diferente das outras: não tem confirmação de escopo. A comissão de
 * representante só é cobrada quando **habilitada** — quem não usa, não vê
 * pendência (`page.tsx:135-140`).
 */
export function faltaComercial(draft: AnyRecord): boolean {
  const comercial = (draft.commercial as AnyRecord) || {};
  const representante = (comercial.representativeCommission as AnyRecord) || {};

  if (representante.enabled !== true) return false;

  return (
    !String(representante.representativeName || '').trim() ||
    numberValue(representante.percent) <= 0
  );
}

/**
 * As pendências no formato que o rodapé-guia consome.
 *
 * A cadeia está **completa**: as quatro seções sabem dizer se pendem, e o
 * botão do rodapé aponta para a primeira que faltar, na ordem da referência.
 *
 * `result` é opcional só para os testes que não precisam de cobertura de
 * equipe. Na tela ele sempre vem — sem ele, a logística deixa de checar se
 * sobrou gente sem transporte.
 */
export function pendenciasDe(draft: AnyRecord, result: AnyRecord = {}) {
  return {
    labor: faltaMaoDeObra(draft),
    inputs: faltaInsumos(draft),
    logistics: faltaLogistica(draft, result),
    commercial: faltaComercial(draft)
  };
}
