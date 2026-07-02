// Catálogo central de grandezas (dimensões) e suas unidades para os campos
// técnicos do tipo `measure`. Config estática: o gestor escolhe a grandeza ao
// criar o campo e o sistema oferece as unidades adequadas — nada hard-coded por
// categoria. Vira tabela só se um dia for preciso gerenciar unidades pela UI.

// grandeza -> { label, units: [...], default }
export const MEASUREMENT_DIMENSIONS = {
  pressao: { label: 'Pressão', units: ['bar', 'kgf/cm²', 'psi', 'kPa', 'MPa'], default: 'bar' },
  vazao: { label: 'Vazão', units: ['L/min', 'm³/h', 'L/h', 'GPM'], default: 'L/min' },
  potencia: { label: 'Potência', units: ['kW', 'kVA', 'CV', 'hp', 'W'], default: 'kW' },
  tensao: { label: 'Tensão', units: ['V', 'kV', 'VCA', 'VCC'], default: 'V' },
  corrente: { label: 'Corrente', units: ['A', 'mA'], default: 'A' },
  temperatura: { label: 'Temperatura', units: ['°C', '°F', 'K'], default: '°C' },
  dimensao: { label: 'Dimensão', units: ['mm', 'cm', 'm', 'pol'], default: 'mm' },
  peso: { label: 'Peso', units: ['kg', 'g', 't'], default: 'kg' },
  rotacao: { label: 'Rotação', units: ['rpm'], default: 'rpm' },
  volume: { label: 'Volume', units: ['L', 'm³', 'mL'], default: 'L' },
  viscosidade: { label: 'Viscosidade', units: ['cSt', 'cP'], default: 'cSt' },
  tempo: { label: 'Tempo', units: ['s', 'min', 'h'], default: 'min' },
  frequencia: { label: 'Frequência', units: ['Hz'], default: 'Hz' }
};

export const MEASUREMENT_DIMENSION_KEYS = Object.keys(MEASUREMENT_DIMENSIONS);

export function isMeasurementDimension(dimension) {
  return Object.prototype.hasOwnProperty.call(MEASUREMENT_DIMENSIONS, dimension);
}

export function defaultUnitFor(dimension) {
  return MEASUREMENT_DIMENSIONS[dimension]?.default ?? null;
}

export function unitsFor(dimension) {
  return MEASUREMENT_DIMENSIONS[dimension]?.units ?? [];
}

// Aceita uma unidade contra a grandeza; cai no default quando inválida/ausente.
export function normalizeUnit(dimension, unit) {
  const allowed = unitsFor(dimension);
  if (unit && allowed.includes(unit)) return unit;
  return defaultUnitFor(dimension);
}

// Mapeia os unit_hint do JSON de rastreamento (schema_categorias_dados_tecnicos.json)
// para a grandeza correspondente — usado no backfill/seed.
const UNIT_HINT_TO_DIMENSION = {
  'bar / kgf/cm² / psi': 'pressao',
  'L/min ou m³/h': 'vazao',
  'CV / kW / hp / W': 'potencia',
  'CV / kW / kVA / hp / W': 'potencia',
  'V / VCA': 'tensao',
  'A ou kW': 'corrente',
  '°C': 'temperatura',
  rpm: 'rotacao',
  L: 'volume',
  'L / m³': 'volume',
  cSt: 'viscosidade',
  'cm/m': 'dimensao',
  kg: 'peso',
  tempo: 'tempo'
};

export function dimensionFromUnitHint(unitHint) {
  if (!unitHint) return null;
  return UNIT_HINT_TO_DIMENSION[unitHint] ?? null;
}

// Catálogo exposto ao frontend (para popular os dropdowns de unidade).
export function measurementCatalog() {
  return MEASUREMENT_DIMENSION_KEYS.map(key => ({
    key,
    label: MEASUREMENT_DIMENSIONS[key].label,
    units: MEASUREMENT_DIMENSIONS[key].units,
    default: MEASUREMENT_DIMENSIONS[key].default
  }));
}
