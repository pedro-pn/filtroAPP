import type { RomaneioMeasureType } from '../api/romaneio';

export function romaneioMeasureLabel(measureType: RomaneioMeasureType) {
  if (measureType === 'LENGTH') return 'Comprimento';
  if (measureType === 'WEIGHT') return 'Peso';
  return 'Unidade';
}

export function defaultRomaneioUnit(measureType: RomaneioMeasureType) {
  if (measureType === 'WEIGHT') return 'kg';
  if (measureType === 'LENGTH') return 'm';
  return 'unidade';
}

export function romaneioUsesVariableQuantity(measureType: RomaneioMeasureType) {
  return measureType === 'LENGTH' || measureType === 'WEIGHT';
}
