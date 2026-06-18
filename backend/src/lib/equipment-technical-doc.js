// Camada de dados da geração do documento técnico (Etapa D, sem template ainda):
// transforma o technicalData do equipamento + o technicalSchema da categoria num
// modelo achatado e formatado, pronto para alimentar um template DOCX.
//
// O preenchimento do .docx e a conversão para PDF (via report-pdf-from-docx.js)
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

// Modelo achatado e formatado para o template do datasheet.
// Campos vazios e campos opcionais desligados não entram (o documento não os mostra).
export function buildTechnicalDocModel(equipment, category) {
  const schema = [...(category?.technicalSchema || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const data = equipment?.technicalData || {};
  const overrides = equipment?.technicalFieldOverrides || {};

  const tokens = {
    equip_codigo: equipment?.code || '',
    equip_nome: equipment?.name || '',
    categoria: category?.name || '',
    revisao: equipment?.technicalRevision != null ? String(equipment.technicalRevision) : '',
    data_geracao: formatDatePt(new Date())
  };

  const rows = []; // campos escalares simples (label/value)
  const groups = []; // campos repetíveis

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
    rows.push({ key: field.key, label: field.label, value, group: field.group || '' });
    tokens[field.key] = value;
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

  return { tokens, rows, sections, groups, isEmpty: rows.length === 0 && groups.length === 0 };
}
