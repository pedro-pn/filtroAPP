import { numberValue } from './formato';

type AnyRecord = Record<string, unknown>;

function registros(valor: unknown): AnyRecord[] {
  return Array.isArray(valor) ? (valor as AnyRecord[]) : [];
}

/** Tudo que é preenchido na aba Mão de obra: folha mais despesas das fases. */
export function custoTotalMaoDeObra(resultado: AnyRecord): number {
  const despesasDasFases = registros(resultado.contextResults).reduce(
    (total, fase) => total + numberValue(fase.expenseCost),
    0
  );
  return numberValue(resultado.laborCost) + despesasDasFases;
}

/** Materiais manuais e todos os insumos dimensionados na mesma aba. */
export function custoTotalMateriaisEInsumos(resultado: AnyRecord): number {
  return numberValue(resultado.materialCost) + numberValue(resultado.inputCost);
}

/** Mobilização e desmobilização já calculadas separadamente pelo motor. */
export function custoTotalLogistica(resultado: AnyRecord): number {
  return numberValue(resultado.mobilizationCost) + numberValue(resultado.demobilizationCost);
}
