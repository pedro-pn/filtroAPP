export const STANDARD_MATERIALS = ['Aço carbono', 'Inox', 'CuNiFe'];
export const CLEANING_STAGES = [
  'Montagem do sistema', 'Teste de estanqueidade', 'Desengraxe',
  'Fase ácida', 'Fase sequestrante', 'Fase neutralizante', 'Fase passivante',
  'Secagem', 'Desmontagem do sistema', 'Inspeção por boroscopia'
];
export const CARBON_STEEL_ACIDS = ['Ácido cítrico', 'Ácido fosfórico', 'Ácido clorídrico'];

const PRODUCTS_BY_STAGE = {
  desengraxe: ['Hidróxido de sódio', 'Metassilicato de sódio', 'Tripolifosfato de sódio'],
  acida: ['Ácido fluorídrico', 'Ácido nítrico', 'Ácido fosfórico', 'Ácido cítrico', 'Ácido clorídrico'],
  sequestrante: ['Ácido cítrico', 'Ácido fosfórico'],
  neutralizacao: ['Carbonato de sódio'],
  passivacao: ['Nitrito de sódio', 'Ácido nítrico']
};

export const CLEANING_CHEMICAL_PRODUCTS = [...new Set(Object.values(PRODUCTS_BY_STAGE).flat())];
export const CLEANING_CHEMICAL_LABELS = {
  'Carbonato de sódio': 'Carbonato de sódio (Barrilha leve)',
  'Hidróxido de sódio': 'Hidróxido de sódio (Soda)',
  'Ácido clorídrico': 'Ácido clorídrico (muriático)'
};

function normalizedText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function materialSelection(data = {}) {
  if (data.materialSelection === 'Outro') return 'Outro';
  const material = data.material ?? data['Material da tubulação'] ?? data['Material da tubulacao'] ?? data['Material do equipamento'];
  const key = normalizedText(material);
  if (['inox', 'aco inox', 'aco inoxidavel'].includes(key)) return 'Inox';
  return STANDARD_MATERIALS.find(option => normalizedText(option) === key) || (key ? 'Outro' : '');
}

export function selectedChemicalProducts(data = {}) {
  const products = data.chemicalProducts ?? data['Produtos químicos utilizados'];
  if (!Array.isArray(products)) return [];
  const names = new Set(products.filter(product => typeof product === 'string').map(normalizedText));
  return CLEANING_CHEMICAL_PRODUCTS.filter(product => names.has(normalizedText(product))
    || names.has(normalizedText(CLEANING_CHEMICAL_LABELS[product] || product)));
}

export function cleaningChemicalOptions(data = {}) {
  const material = materialSelection(data);
  return material === 'Aço carbono' ? CARBON_STEEL_ACIDS : material === 'Outro' ? CLEANING_CHEMICAL_PRODUCTS : [];
}

export function cleaningChemicalSelectionLabel(data = {}) {
  const material = materialSelection(data);
  return material === 'Aço carbono' ? 'Ácidos utilizados' : material === 'Outro' ? 'Produtos químicos utilizados' : '';
}

export function hasRequiredCleaningChemicalProducts(data = {}) {
  const options = cleaningChemicalOptions(data);
  return !options.length || selectedChemicalProducts(data).some(product => options.includes(product));
}

export function orderedCleaningStages(value, data = {}) {
  const stages = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const known = new Map(CLEANING_STAGES.map((stage, index) => [normalizedText(stage), { stage, index }]));
  const unique = new Map();
  for (const stage of stages) {
    if (typeof stage !== 'string' || !stage.trim()) continue;
    const key = normalizedText(stage);
    if (materialSelection(data) === 'Inox' && key === 'fase sequestrante') continue;
    if (!unique.has(key)) unique.set(key, known.get(key)?.stage || stage.trim());
  }
  return [...unique.values()].sort((a, b) => (known.get(normalizedText(a))?.index ?? CLEANING_STAGES.length)
    - (known.get(normalizedText(b))?.index ?? CLEANING_STAGES.length));
}

// As mesmas etapas e produtos são usados pelo formulário, RLQ e Data Book.
export function cleaningProductsForStep(stepName, material, data = {}) {
  const step = normalizedText(stepName);
  const selection = materialSelection({ ...data, material });
  let stage;
  if (step.includes('desengraxe')) stage = 'desengraxe';
  else if (step.includes('fase acida')) stage = 'acida';
  else if (step.includes('fase sequestrant')) stage = 'sequestrante';
  else if (step.includes('fase neutralizant')) stage = 'neutralizacao';
  else if (step.includes('fase passivant')) stage = 'passivacao';
  if (!stage) return '';

  let products;
  if (selection === 'Outro') {
    const selected = selectedChemicalProducts(data);
    products = PRODUCTS_BY_STAGE[stage].filter(product => selected.includes(product));
  } else if (selection === 'Inox') {
    products = stage === 'acida' ? ['Ácido fluorídrico', 'Ácido nítrico']
      : stage === 'sequestrante' ? []
      : stage === 'passivacao' ? ['Ácido nítrico'] : PRODUCTS_BY_STAGE[stage];
  } else if (stage === 'acida' || stage === 'sequestrante') {
    // Relatórios antigos sem seleção explícita conservam o ácido cítrico.
    const explicit = data.chemicalProducts ?? data['Produtos químicos utilizados'];
    const acids = selection === 'Aço carbono' && Array.isArray(explicit)
      ? selectedChemicalProducts(data).filter(product => CARBON_STEEL_ACIDS.includes(product)) : ['Ácido cítrico'];
    products = PRODUCTS_BY_STAGE[stage].filter(product => acids.includes(product));
  } else {
    products = stage === 'passivacao' ? ['Nitrito de sódio'] : PRODUCTS_BY_STAGE[stage];
  }

  return products.length < 2 ? products[0] || '' : `${products.slice(0, -1).join(', ')} e ${products.at(-1)}`;
}
