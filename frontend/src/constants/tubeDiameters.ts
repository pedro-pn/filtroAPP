/**
 * Diâmetros comerciais usados nos formulários de tubulação.
 *
 * Esta é a lista canônica que já era exibida nos relatórios de limpeza
 * química. Mantê-la compartilhada evita que levantamento, planejamento e RDO
 * ofereçam medidas diferentes para o mesmo tubo. Ampliada com todas as medidas
 * de CUSTO.Produtos!B57:B85/B115:B143 da LEC v1.3, preservando as já oferecidas.
 */
export const COMMON_INCH_DIAMETERS = [
  '1/8',
  '1/4',
  '3/8',
  '1/2',
  '3/4',
  '1',
  '1 1/4',
  '1 1/2',
  '2',
  '2 1/2',
  '3',
  '3 1/2',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24'
] as const;

export function inchDiameterToNumber(value: string): number {
  return value.trim().split(/\s+/).reduce((total, part) => {
    const [numerator, denominator] = part.split('/').map(Number);
    const parsed = denominator ? numerator / denominator : numerator;
    return Number.isFinite(parsed) ? total + parsed : total;
  }, 0);
}

export function commonInchDiameterLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return COMMON_INCH_DIAMETERS.find(
    label => Math.abs(inchDiameterToNumber(label) - value) < 0.000001
  ) || '';
}
