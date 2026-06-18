// Converte os campos rastreados no schema_categorias_dados_tecnicos.json para o
// technicalSchema do datasheet. Usado pelo backfill (seed inicial das categorias).

import { normalizeTechnicalSchema } from './equipment-categories.js';
import { dimensionFromUnitHint, defaultUnitFor } from './equipment-units.js';

// Tipos do JSON de rastreamento -> vocabulário do datasheet.
function mapTrackingType(type) {
  switch (type) {
    case 'short_text': return 'text';
    case 'long_text': return 'textarea';
    case 'integer_or_text': return 'number';
    case 'measurement_text': return 'measure';
    default: return type || 'text';
  }
}

// Heurística: a nota "Não aparece em todos os exemplos…" marca o campo como
// opcional por equipamento.
function isOptionalPerEquipment(raw) {
  return /n[ãa]o aparece/i.test(String(raw?.notes || ''));
}

function baseFieldFromTracking(raw) {
  const type = mapTrackingType(raw?.type);
  const field = {
    key: raw?.key || '',
    label: raw?.label || raw?.key || '',
    type,
    optionalPerEquipment: isOptionalPerEquipment(raw),
    showInDoc: true
  };
  if (type === 'measure') {
    const dimension = dimensionFromUnitHint(raw?.unit_hint);
    field.unit = { dimension, default: dimension ? defaultUnitFor(dimension) : null };
  }
  return field;
}

// Campo `allow_multiple` vira um grupo repetível com o próprio campo como subcampo.
// Sem informação de agrupamento entre campos, a leitura fiel é "este campo se repete".
// O gestor pode depois mesclar grupos relacionados pela tela (Etapa B).
function wrapRepeatable(raw) {
  const inner = baseFieldFromTracking(raw);
  return {
    key: inner.key,
    label: inner.label,
    type: 'group',
    repeatable: true,
    itemLabel: inner.label,
    optionalPerEquipment: inner.optionalPerEquipment,
    showInDoc: true,
    itemSchema: [{ ...inner, key: 'valor', label: inner.label, optionalPerEquipment: false }]
  };
}

export function buildTechnicalSchemaFromTracking(campos) {
  if (!Array.isArray(campos)) return [];
  const raw = campos.map(field => (field?.allow_multiple ? wrapRepeatable(field) : baseFieldFromTracking(field)));
  // Passa pela normalização oficial: gera/sanitiza keys, valida tipos/grandezas, dedup.
  return normalizeTechnicalSchema(raw);
}

// Conta campos do schema (incluindo subcampos de grupos) — usado no log do backfill.
export function countTechnicalFields(schema) {
  if (!Array.isArray(schema)) return 0;
  return schema.reduce((acc, field) => acc + 1 + (Array.isArray(field?.itemSchema) ? field.itemSchema.length : 0), 0);
}
