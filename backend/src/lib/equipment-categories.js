// Convenções de systemKey que ligam o modelo unificado de equipamentos
// ao consumo legado pelo RDO/Romaneio. O systemKey é imutável; o nome de
// exibição da categoria pode ser renomeado livremente.

export const MANOMETER_SYSTEMKEY = 'manometer';
export const PARTICLE_COUNTER_SYSTEMKEY = 'particle_counter';
export const UNIT_SYSTEMKEY_PREFIX = 'unit:';

export function unitSystemKey(legacyCategory) {
  return `${UNIT_SYSTEMKEY_PREFIX}${String(legacyCategory || '').trim()}`;
}

export function isUnitSystemKey(systemKey) {
  return String(systemKey || '').startsWith(UNIT_SYSTEMKEY_PREFIX);
}

export function legacyUnitCategory(systemKey) {
  return isUnitSystemKey(systemKey) ? systemKey.slice(UNIT_SYSTEMKEY_PREFIX.length) : null;
}

// Definição de campo dinâmico: { key, label, type, required, options?, order, showInDashboard? }
function field(key, label, type, extra = {}) {
  return { key, label, type, required: false, ...extra };
}

// fieldSchema equivalente ao que cada tipo legado tinha no RDO.
export const LEGACY_FIELD_SCHEMAS = {
  manometer: [
    field('scale', 'Escala', 'text', { required: true, order: 1, showInDashboard: true }),
    field('calibrationCertCode', 'Código do certificado', 'text', { required: true, order: 2 })
  ],
  particle_counter: [
    field('serialNumber', 'Número de série', 'text', { required: true, order: 1, showInDashboard: true })
  ],
  unit: [] // unidades só têm code + name
};

// Categorias novas, ainda sem dados, que o usuário pediu para já existirem como abas.
// O gestor pode editar campos, nome, ordem e flags na aba de configuração.
export const SEED_NEW_CATEGORIES = [
  {
    systemKey: 'turbidimeter',
    name: 'Turbidímetros',
    supportsCalibration: true,
    supportsTechnicalDoc: true,
    fieldSchema: [
      field('serialNumber', 'Número de série', 'text', { order: 1, showInDashboard: true }),
      field('model', 'Modelo', 'text', { order: 2 })
    ]
  },
  {
    systemKey: 'phmeter',
    name: 'pHmetros',
    supportsCalibration: true,
    supportsTechnicalDoc: true,
    fieldSchema: [
      field('serialNumber', 'Número de série', 'text', { order: 1, showInDashboard: true }),
      field('model', 'Modelo', 'text', { order: 2 })
    ]
  },
  {
    systemKey: 'transformer',
    name: 'Trafos',
    supportsCalibration: false,
    supportsTechnicalDoc: true,
    fieldSchema: [
      field('serialNumber', 'Número de série', 'text', { order: 1, showInDashboard: true }),
      field('power', 'Potência', 'text', { order: 2 })
    ]
  },
  {
    systemKey: 'generator',
    name: 'Geradores',
    supportsCalibration: false,
    supportsTechnicalDoc: true,
    fieldSchema: [
      field('serialNumber', 'Número de série', 'text', { order: 1, showInDashboard: true }),
      field('power', 'Potência', 'text', { order: 2 })
    ]
  },
  {
    systemKey: 'counter',
    name: 'Contadores',
    supportsCalibration: true,
    supportsTechnicalDoc: true,
    fieldSchema: [
      field('serialNumber', 'Número de série', 'text', { order: 1, showInDashboard: true }),
      field('model', 'Modelo', 'text', { order: 2 })
    ]
  }
];

const FIELD_TYPES = new Set(['text', 'number', 'date', 'select', 'textarea']);

// Gera um systemKey estável a partir do nome (categorias novas criadas pelo gestor).
export function slugifySystemKey(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'categoria';
}

// Valida e normaliza o fieldSchema vindo do cliente.
export function normalizeFieldSchema(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((raw, index) => {
      const key = slugifySystemKey(raw?.key || raw?.label || '');
      const type = FIELD_TYPES.has(raw?.type) ? raw.type : 'text';
      const label = String(raw?.label || '').trim() || key;
      const definition = {
        key,
        label,
        type,
        required: Boolean(raw?.required),
        order: Number.isFinite(raw?.order) ? raw.order : index,
        showInDashboard: Boolean(raw?.showInDashboard)
      };
      if (type === 'select' && Array.isArray(raw?.options)) {
        definition.options = raw.options.map(opt => String(opt)).filter(Boolean);
      }
      return definition;
    })
    .filter(item => item.key && !seen.has(item.key) && seen.add(item.key));
}
