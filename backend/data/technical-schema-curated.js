// Schemas de Dados Técnicos CURADOS manualmente para as categorias cujos campos
// vieram bagunçados da extração de exemplos (componentes numerados, mesmo dado
// extraído várias vezes, unidades erradas). Ver ANALISE_CAMPOS_DADOS_TECNICOS.md.
//
// Chave = nome da categoria DESTINO normalizado (sem acento, minúsculo, espaços
// colapsados) — o backfill aplica isto no lugar dos campos do JSON quando existe.
// Os campos físicos (peso/altura/largura/comprimento) NÃO entram aqui: o backfill
// os injeta automaticamente. Os campos passam por normalizeTechnicalSchema (gera
// key/order, valida unidade), então basta { label, type, unit:{dimension}, ... }.

const m = (label, dimension, extra = {}) => ({ label, type: 'measure', unit: { dimension }, ...extra });
const t = (label, extra = {}) => ({ label, type: 'text', ...extra });
const ta = (label, extra = {}) => ({ label, type: 'textarea', ...extra });
const grp = (label, itemLabel, itemSchema, extra = {}) => ({
  label, type: 'group', repeatable: true, itemLabel, itemSchema, ...extra
});

// Subcampos de um conjunto "Motor" (reutilizado).
const motorItem = [
  m('Potência', 'potencia'),
  m('RPM', 'rotacao'),
  m('Tensão', 'tensao'),
  m('Consumo', 'corrente')
];

// Reservatórios (aço carbono e inox): mesmo conjunto, só muda o material. O 1º campo
// bagunçado ("Reservatorio de metal com pintura para óleo") vira Volume + Material.
const RESERVATORIO = [
  m('Volume', 'volume'),
  t('Material / Revestimento'),
  ta('Escada'),
  t('Conexão de sucção'),
  t('Conexão de retorno'),
  t('Diâmetro da boca de acesso (limpeza)'),
  t('Respiro'),
  t('Visor de nível'),
  t('Régua de nível'),
  t('Pontos de içamento'),
  t('Pés')
];

const CURATED = {
  'reservatorio de aco carbono': RESERVATORIO,
  'reservatorio de inox': RESERVATORIO,

  // Unidade de filtragem (13 → 11): motor vira grupo repetível.
  'unidades de filtragem': [
    m('Vazão nominal', 'vazao'),
    m('Pressão de trabalho', 'pressao'),
    grp('Motor', 'Motor', motorItem),
    t('Bomba'),
    t('Filtro'),
    m('Pressão máxima de operação do filtro', 'pressao'),
    t('Abertura bypass do filtro'),
    t('Modelo do elemento filtrante'),
    m('Capacidade de contenção', 'volume'),
    ta('Consumo operacional de óleo')
  ],

  // Unidade de flushing primário (41 → 16): duas bombas + ruído de contagem → grupo Bomba.
  'unidades de flushing': [
    grp('Bomba', 'Bomba', [
      t('Identificação'), // ex.: Principal / Trocador de calor
      t('Tipo'),          // engrenagem / centrífuga
      m('Vazão nominal', 'vazao'),
      m('Pressão de trabalho', 'pressao'),
      m('Motor', 'potencia'),
      m('RPM', 'rotacao'),
      m('Tensão', 'tensao'),
      m('Consumo', 'corrente')
    ]),
    t('Filtro'),
    m('Pressão máxima de operação do filtro', 'pressao'),
    t('Abertura bypass do filtro'),
    t('Modelo do elemento filtrante'),
    m('Capacidade de contenção', 'volume'),
    ta('Consumo operacional do equipamento'),
    m('Volume do reservatório', 'volume'),
    ta('Painel elétrico'),
    ta('Trocador de calor'),
    m('Medidor de vazão', 'vazao'),
    m('Resistência', 'potencia'),
    ta('Válvulas'),
    t('Manômetro'),
    ta('Skid'),
    t('Alarme de sequência de fase')
  ],

  // Unidade de teste hidrostático (28 → 17): bomba vira grupo; remove duplicatas de extração.
  'unidades de teste hidrostatico': [
    m('Pressão máxima de entrada', 'pressao'),
    m('Pressão máxima de saída', 'pressao'),
    m('Pressão máxima de operação', 'pressao'),
    m('Vazão nominal', 'vazao'),
    grp('Bomba', 'Bomba', [
      t('Tipo'), // hidropneumática
      m('Pressão máxima', 'pressao'),
      m('Vazão nominal', 'vazao'),
      m('Motor elétrico', 'potencia'),
      m('Rotação', 'rotacao')
    ]),
    m('Tensão de entrada', 'tensao'),
    m('Consumo (corrente)', 'corrente'),
    t('Filtro'),
    m('Reservatório', 'volume'),
    m('Volume da contenção', 'volume'),
    ta('Mangueira de trabalho'),
    t('Engate rápido'),
    t('Manômetro'),
    ta('Válvula'),
    ta('Painel'),
    ta('Acessórios')
  ],

  // Unidade de limpeza química (22 → 14): duas bombas sobrepostas → grupo Bomba.
  'unidades de limpeza quimica': [
    grp('Bomba', 'Bomba', [
      t('Tipo'), // centrífuga
      m('Pressão de trabalho', 'pressao'),
      m('Vazão nominal', 'vazao'),
      m('Motor elétrico', 'potencia'),
      t('Diâmetro do rotor'),
      t('Diâmetro de sucção/recalque')
    ]),
    ta('Painel elétrico'),
    t('Compressor eletrônico'),
    ta('Mangueira de trabalho'),
    t('Manômetro'),
    ta('Válvula'),
    ta('Skid'),
    m('Reservatório', 'volume'),
    t('Engate rápido'),
    m('Bacia de contenção', 'volume'),
    ta('Aquecedor (resistência)'),
    m('Consumo', 'corrente')
  ],

  // Unidade de termovácuo (~23 → 12): 3 bombas (Bomba 1/2/3 ↔ vácuo/engrenagem) → grupo Bomba.
  'unidades de termovacuo': [
    grp('Bomba', 'Bomba', [
      t('Identificação'), // ex.: vácuo / engrenagem da centrífuga / sistema de vácuo
      m('Pressão de trabalho', 'pressao'),
      m('Vazão nominal', 'vazao'),
      m('Motor elétrico', 'potencia')
    ]),
    t('Filtros'),
    ta('Painel elétrico'),
    m('Reservatório de óleo', 'volume'),
    m('Reservatório de resíduos', 'volume'),
    t('Minimess'),
    ta('Mangueira de trabalho'),
    t('Manômetro'),
    ta('Aquecedor (resistência)'),
    ta('Skid')
  ],

  // Unidade de centrífuga (19 → 14): bloco da centrífuga + grupo Motor; corrige unidades erradas.
  'unidades de centrifuga': [
    m('Velocidade máxima de rotação do tambor', 'rotacao'),
    m('Velocidade máxima de rotação do eixo', 'rotacao'),
    m('Capacidade hidráulica', 'vazao'),
    t('Densidade máxima de alimentação/sedimento'), // era measure<V/VCA> (errado) → texto (kg/m³)
    m('Temperatura de alimentação', 'temperatura'), // era measure<V/VCA> (errado)
    m('Volume do tambor', 'volume'),
    m('Volume de óleo lubrificante', 'volume'),
    m('Contenção para resíduo', 'volume'),
    m('Contenção do equipamento', 'volume'),
    grp('Motor', 'Motor', [
      m('Potência', 'potencia'),
      m('Tensão', 'tensao'),
      m('Corrente', 'corrente'),
      m('Rotação', 'rotacao')
    ]),
    m('Resistência', 'potencia'),
    t('Ligação'),
    t('Motor assíncrono'),
    t('Proteção')
  ]
};

export function curatedTechnicalSchema(normalizedDestName) {
  return CURATED[normalizedDestName] || null;
}

export const CURATED_KEYS = Object.keys(CURATED);
