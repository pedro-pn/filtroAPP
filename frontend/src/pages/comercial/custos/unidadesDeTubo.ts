export type UnidadeDeComprimento = 'm' | 'cm' | 'mm';
export type UnidadeDeDiametro = 'in' | 'mm';

const MILIMETROS_POR_POLEGADA = 25.4;

function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function comprimentoParaExibicao(
  comprimentoM: number,
  unidade: UnidadeDeComprimento
): number {
  if (unidade === 'cm') return arredondar(comprimentoM * 100);
  if (unidade === 'mm') return arredondar(comprimentoM * 1000);
  return arredondar(comprimentoM);
}

export function comprimentoEmMetros(
  valor: number,
  unidade: UnidadeDeComprimento
): number {
  if (unidade === 'cm') return arredondar(valor / 100);
  if (unidade === 'mm') return arredondar(valor / 1000);
  return arredondar(valor);
}

export function diametroParaExibicao(
  diametroMm: number,
  unidade: UnidadeDeDiametro
): number {
  return unidade === 'in'
    ? arredondar(diametroMm / MILIMETROS_POR_POLEGADA)
    : arredondar(diametroMm);
}

export function diametroEmMilimetros(
  valor: number,
  unidade: UnidadeDeDiametro
): number {
  return unidade === 'in'
    ? arredondar(valor * MILIMETROS_POR_POLEGADA)
    : arredondar(valor);
}
