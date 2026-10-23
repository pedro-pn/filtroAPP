// Tipos distintos impedem somar metros, massa, volume e unidades no avanço.
export const MECHANICAL_MEASURES = {
  MECANICA_M: { unit: 'M', label: 'Comprimento (m)', metric: 'mecanicaM' },
  MECANICA_UN: { unit: 'UN', label: 'Quantidade (un)', metric: 'mecanicaUn' },
  MECANICA_KG: { unit: 'KG', label: 'Massa (kg)', metric: 'mecanicaKg' },
  MECANICA_T: { unit: 'T', label: 'Massa (t)', metric: 'mecanicaT' },
  MECANICA_L: { unit: 'L', label: 'Volume (L)', metric: 'mecanicaL' }
};

export function mechanicalMeasureType(unit) {
  return Object.keys(MECHANICAL_MEASURES).find(type => MECHANICAL_MEASURES[type].unit === unit) ?? null;
}

export function mechanicalMeasurement(data = {}) {
  const unit = data.unidadeMecanica ?? data['Unidade da limpeza mecânica'];
  const raw = data.quantidadeMecanica ?? data['Quantidade da limpeza mecânica'];
  const systemType = mechanicalMeasureType(unit);
  const quantity = typeof raw === 'number' ? raw
    : typeof raw === 'string' && raw.trim() ? Number(raw.trim().replace(',', '.')) : NaN;
  if (!systemType || !Number.isFinite(quantity) || quantity <= 0 || quantity > 999999999999.99
    || (unit === 'UN' && !Number.isSafeInteger(quantity))) return null;
  return { systemType, unit, quantity };
}
