// Camada de dados da geração do documento técnico (Etapa D):
// transforma o technicalData do equipamento + o technicalSchema da categoria num
// modelo achatado e formatado, pronto para alimentar o template DOCX (Datasheet.docx).
//
// O preenchimento do .docx e a conversão para PDF (em equipment-technical-docx.js)
// consomem este modelo — mantidos separados para que esta camada seja testável
// sem depender do arquivo de template.

function formatDatePt(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatMeasure(value) {
  if (!value || typeof value !== 'object') return '';
  const raw = value;
  const num = raw.value == null ? '' : String(raw.value).trim();
  const unit = raw.unit == null ? '' : String(raw.unit).trim();
  if (!num) return '';
  return unit ? `${num} ${unit}` : num;
}

// Formata um valor escalar de acordo com o tipo do campo.
export function formatScalar(field, value) {
  if (value === undefined || value === null) return '';
  switch (field.type) {
    case 'measure':
      return formatMeasure(value);
    case 'boolean':
      return value === true ? 'Sim' : value === false ? 'Não' : '';
    case 'date':
      return formatDatePt(value);
    case 'multiselect':
      return Array.isArray(value) ? value.filter(Boolean).join(', ') : '';
    default:
      return String(value).trim();
  }
}

// Chaves dos campos físicos exibidos no cabeçalho do datasheet (Tabela 1).
// Quando presentes no technicalSchema/technicalData, preenchem os tokens da Tabela 1,
// mas NÃO são listados de novo na Tabela 2 (evita duplicar peso/dimensões).
const BASE_PHYSICAL_KEYS = new Set(['peso', 'altura', 'largura', 'comprimento']);

// Campos-base do equipamento (campos_base_equipamento) ficam em `attributes` e
// vão para o bloco de identificação fixo da Tabela 1. Podem ser string simples
// ("6kg") ou objeto de medida ({ value, unit }).
function formatAttr(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return formatMeasure(value);
  return String(value).trim();
}

// Um campo opcional-por-equipamento está incluído? (default: incluído)
function isIncluded(field, overrides) {
  if (!field.optionalPerEquipment) return true;
  const flag = overrides?.[field.key];
  return flag === undefined ? true : Boolean(flag);
}

function buildGroupItems(field, value) {
  const subFields = [...(field.itemSchema || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const items = Array.isArray(value) ? value : [];
  return items.map((item, index) => ({
    index: index + 1,
    label: `${field.itemLabel || field.label} #${index + 1}`,
    rows: subFields
      .map(sub => ({ key: sub.key, label: sub.label, value: formatScalar(sub, item?.[sub.key]) }))
      .filter(row => row.value !== '')
  })).filter(item => item.rows.length > 0);
}

// Achata um grupo repetível em linhas rótulo/valor para a Tabela 2.
// - 1 subcampo (caso do seed, ex.: Potência repetível) → "Potência #1", "Potência #2"…
// - vários subcampos (grupo montado pelo gestor) → "Potência #1", "Tensão #1", "Potência #2"…
function groupBlockRows(field, items) {
  const singleSub = (field?.itemSchema || []).length === 1;
  const rows = [];
  for (const item of items) {
    if (singleSub) {
      rows.push({ label: `${field?.itemLabel || field?.label || 'Item'} #${item.index}`, value: item.rows[0].value });
    } else {
      for (const row of item.rows) rows.push({ label: `${row.label} #${item.index}`, value: row.value });
    }
  }
  return rows;
}

// Modelo achatado e formatado para o template do datasheet.
// Campos vazios e campos opcionais desligados não entram (o documento não os mostra).
export function buildTechnicalDocModel(equipment, category) {
  const schema = [...(category?.technicalSchema || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const data = equipment?.technicalData || {};
  const overrides = equipment?.technicalFieldOverrides || {};
  const attrs = equipment?.attributes && typeof equipment.attributes === 'object' ? equipment.attributes : {};

  const tokens = {
    equip_codigo: equipment?.code || '',
    equip_nome: equipment?.name || '',
    categoria: category?.name || '',
    revisao: equipment?.technicalRevision != null ? String(equipment.technicalRevision) : '',
    data_geracao: formatDatePt(new Date()),
    // Campos-base físicos (Tabela 1 fixa), lidos de attributes.
    peso: formatAttr(attrs.peso),
    altura: formatAttr(attrs.altura),
    largura: formatAttr(attrs.largura),
    comprimento: formatAttr(attrs.comprimento),
    // Patrimônio: reservado para implementação futura — sai sempre vazio.
    patrimony: '',
    patrimonio: ''
  };

  const rows = []; // campos escalares simples (label/value)
  const groups = []; // campos repetíveis (estrutura crua)

  for (const field of schema) {
    if (field.showInDoc === false) continue;
    if (!isIncluded(field, overrides)) continue;

    if (field.type === 'group') {
      const items = buildGroupItems(field, data[field.key]);
      if (items.length > 0) {
        groups.push({ key: field.key, label: field.label, itemLabel: field.itemLabel || field.label, items });
      }
      continue;
    }

    const value = formatScalar(field, data[field.key]);
    if (value === '') continue;
    tokens[field.key] = value;
    // Físicos (peso/altura/largura/comprimento) saem no cabeçalho (Tabela 1) via token;
    // não devem reaparecer na listagem de campos (Tabela 2).
    if (BASE_PHYSICAL_KEYS.has(field.key)) continue;
    rows.push({ key: field.key, label: field.label, value, group: field.group || '' });
  }

  // Agrupa as linhas em seções por `group`, preservando a ordem de aparição.
  const sectionOrder = [];
  const sectionMap = new Map();
  for (const row of rows) {
    const title = row.group || '';
    if (!sectionMap.has(title)) { sectionMap.set(title, []); sectionOrder.push(title); }
    sectionMap.get(title).push(row);
  }
  const sections = sectionOrder.map(title => ({ title, rows: sectionMap.get(title) }));

  // Blocos prontos para a Tabela 2 do template: cada bloco vira uma faixa
  // {{secao_titulo}} (fallback "Dados") seguida das linhas {{campo_rotulo}}/{{campo_valor}}.
  const schemaIndex = new Map(schema.map(f => [f.key, f]));
  const blocks = [];
  for (const section of sections) {
    blocks.push({
      title: section.title || 'Dados',
      rows: section.rows.map(r => ({ label: r.label, value: r.value }))
    });
  }
  for (const group of groups) {
    const field = schemaIndex.get(group.key);
    const groupRows = groupBlockRows(field || { itemLabel: group.itemLabel }, group.items);
    if (groupRows.length) blocks.push({ title: group.label || 'Dados', rows: groupRows });
  }

  return { tokens, rows, sections, groups, blocks, isEmpty: rows.length === 0 && groups.length === 0 };
}
