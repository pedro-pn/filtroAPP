import { Prisma } from '@prisma/client';

const nullableText = { type: ['string', 'null'] };
const nullableBoolean = { type: ['boolean', 'null'] };
const textList = { type: 'array', items: { type: 'string' } };
const closedObject = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const equipmentSchema = closedObject({ id: nullableText, code: nullableText, name: nullableText });
const equipmentList = { type: 'array', items: equipmentSchema };
const measurementSchema = { ...closedObject({ value: nullableText, unit: nullableText }), type: ['object', 'null'] };

// Aliases do formulário atual e dos relatórios antigos. Nunca publicar extraData inteiro.
const textFields = {
  drawingsTags: ['Desenhos / TAGs', 'drawingsTags'],
  notes: ['Observações', 'notes'],
  testedEquipment: ['Equipamento testado', 'equipamentoTestado'],
  testedEquipmentOther: ['Outro equipamento testado', 'equipamentoTestadoOutro'],
  testFluid: ['Fluido de teste', 'fluidoTeste'],
  testOil: ['Qual óleo?', 'qualOleo'],
  flushingType: ['Tipo de flushing', 'tipoFlushing'],
  oilType: ['Tipo de óleo', 'tipoOleo'],
  initialNas: ['Contagem inicial NAS', 'NAS inicial', 'Valor NAS inicial', 'contagemInicialNas'],
  finalNas: ['Contagem final NAS', 'NAS final', 'Valor NAS final', 'contagemFinalNas'],
  initialIso: ['Contagem inicial ISO', 'ISO inicial', 'Classe ISO inicial', 'Valor ISO inicial', 'contagemInicialIso'],
  finalIso: ['Contagem final ISO', 'ISO final', 'Classe ISO final', 'Valor ISO final', 'contagemFinalIso'],
  initialMoisturePpm: ['Umidade inicial (ppm)', 'umidadeInicial'],
  finalMoisturePpm: ['Umidade final (ppm)', 'umidadeFinal'],
  vessel: ['Embarcação', 'ID da embarcação', 'embarcacaoId'],
  lines: ['Linhas', 'linhas'],
  steps: ['Steps', 'Step', 'steps']
};
const booleanFields = {
  clientApproved: ['Aprovado pelo cliente?', 'aprovadoCliente'],
  cleaningPiping: ['Limpeza de tubulação?', 'limpezaTubulacao'],
  flushingPiping: ['Flushing em tubulação?', 'flushingTubulacao'],
  particleCounting: ['Houve contagem de partículas?', 'houveParticulas'],
  dehydration: ['Houve desidratação?', 'houveDesidratacao'],
  moistureAnalysis: ['Houve análise de umidade?', 'houveUmidade']
};
const listFields = {
  stages: ['Etapas realizadas no dia', 'etapas'],
  cleaningMethods: ['Método de limpeza', 'metodos'],
  cleaningLocations: ['Local de limpeza', 'local'],
  inspectionTypes: ['Tipo de inspeção', 'tipoInspecao'],
  reportTypes: ['Tipo de relatório', 'tipoRelatorio']
};
const equipmentFields = {
  cleaningUnits: ['Unidade de Limpeza Química', 'ulq'],
  hydrostaticUnits: ['Unidade de Teste Hidrostático (UTH)', 'uth'],
  manometers: ['Manômetros utilizados', 'manometroIds'],
  flushingUnits: ['Unidade de Flushing', 'uf'],
  filtrationUnits: ['Unidade de filtragem', 'ufg'],
  particleCounters: ['Contador utilizado', 'contadorUtilizado'],
  dehydrationUnits: ['Equipamento de desidratação', 'desidratacaoUnit']
};

export const RDO_SERVICE_DATA_SCHEMA = closedObject({
  ...Object.fromEntries(Object.keys(textFields).map(field => [field, nullableText])),
  ...Object.fromEntries(Object.keys(booleanFields).map(field => [field, nullableBoolean])),
  ...Object.fromEntries(Object.keys(listFields).map(field => [field, textList])),
  tubes: { type: 'array', items: closedObject({ diameter: nullableText, diameterUnit: nullableText, length: nullableText, lengthUnit: nullableText }) },
  workingPressure: measurementSchema,
  testPressure: measurementSchema,
  oilVolume: measurementSchema,
  ...Object.fromEntries(Object.keys(equipmentFields).map(field => [field, equipmentList])),
  collaborators: { type: ['array', 'null'], items: closedObject({ id: nullableText, name: nullableText }), description: 'Preenchido somente com a permissão rdo.equipe.read; identificação registrada no serviço.' }
});

export const RDO_REPORT_DERIVED_FIELDS = Object.freeze({ reportNumber: 'string?', projectCode: 'string', projectName: 'string' });
export const RDO_SERVICE_DERIVED_FIELDS = Object.freeze({
  reportNumber: 'string?', reportSequenceNumber: 'integer?', reportType: 'string', reportDate: 'datetime',
  projectId: 'string', projectCode: 'string', projectName: 'string',
  equipmentName: 'string?', equipmentCode: 'string?', totalLengthMeters: 'decimal?', serviceData: 'object'
});
export const RDO_PROJECT_SELECT = { select: { code: true, name: true } };
export const RDO_SERVICE_SELECT = {
  extraData: true,
  equipment: { select: { id: true, code: true, name: true } },
  report: { select: { projectId: true, reportType: true, sequenceNumber: true, reportDate: true, project: RDO_PROJECT_SELECT } }
};

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function text(value) {
  if (typeof value === 'string') return value.trim() || null;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}
function key(value) {
  return String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
function field(data, aliases) {
  for (const alias of aliases) {
    const match = Object.keys(data).find(name => key(name) === key(alias));
    if (match !== undefined && data[match] != null && data[match] !== '') return data[match];
  }
  return null;
}
function strings(value) {
  return (Array.isArray(value) ? value : value == null ? [] : [value]).map(text).filter(value => value !== null);
}
function displayText(value) {
  return Array.isArray(value) ? strings(value).join(', ') || null : text(value);
}
function yesNo(value) {
  if (typeof value === 'boolean') return value;
  const normalized = key(Array.isArray(value) ? value[0] : value);
  return ['sim', 'true'].includes(normalized) ? true : ['nao', 'false'].includes(normalized) ? false : null;
}
function reportNumber(report) {
  return Number.isInteger(report?.sequenceNumber) ? `${report.reportType} ${report.sequenceNumber}` : null;
}

export function projectRdoReport(row) {
  return { ...row, reportNumber: reportNumber(row), projectCode: text(row.project?.code), projectName: text(row.project?.name) };
}

function tubes(data) {
  let raw = field(data, ['Diâmetros e comprimentos', 'tubes', '__tubeRows']);
  if (!Array.isArray(raw)) {
    const diameter = measurement(data, 'Diâmetro', 'diametro', 'diametroUnit');
    const length = measurement(data, 'Comprimento', 'comprimento', 'comprimentoUnit');
    raw = diameter || length ? [{ d: diameter?.value, unit: diameter?.unit, c: length?.value, lengthUnit: length?.unit }] : [];
  }
  return (Array.isArray(raw) ? raw : []).map(record).map(item => ({
    diameter: text(item.d ?? item.diameter ?? item.diametro),
    diameterUnit: text(item.unit ?? item.diameterUnit ?? item.dUnit) || 'pol',
    length: text(item.c ?? item.length ?? item.comprimento),
    lengthUnit: text(item.lengthUnit ?? item.cUnit ?? item.comprimentoUnit) || 'm'
  }));
}
function totalLengthMeters(rows) {
  if (!rows.length) return null;
  let total = new Prisma.Decimal(0);
  for (const row of rows) {
    // Não inventar um total parcial quando um comprimento ou unidade é inválido.
    if (!row.length || !/^\d+(?:[.,]\d+)?$/.test(row.length)) return null;
    const factor = { m: '1', cm: '0.01', mm: '0.001' }[row.lengthUnit];
    if (!factor) return null;
    total = total.plus(new Prisma.Decimal(row.length.replace(',', '.')).times(factor));
  }
  return total.toString();
}
function measurement(data, label, valueKey, unitKey) {
  const raw = text(field(data, [label, valueKey]));
  if (raw === null) return null;
  const match = raw.match(/^((?:\d+\s+)?\d+\/\d+|[\d.,]+)\s*(.*)$/);
  return { value: match ? match[1] : raw, unit: (match && match[2]) || text(data[unitKey]) };
}

function equipmentReferences(raw, labelsAs = 'code') {
  if (raw == null) return [];
  if (typeof raw === 'string' || typeof raw === 'number') return text(raw) ? [{ id: text(raw), code: null, name: null }] : [];
  if (Array.isArray(raw)) return raw.flatMap(item => equipmentReferences(item, labelsAs));
  const data = record(raw);
  if (Array.isArray(data.ids) || Array.isArray(data.codes) || Array.isArray(data.names) || Array.isArray(data.labels)) {
    const ids = Array.isArray(data.ids) ? data.ids : [];
    const labels = Array.isArray(data.labels) ? data.labels : [];
    const codes = Array.isArray(data.codes) ? data.codes : labelsAs === 'code' ? labels : [];
    const names = Array.isArray(data.names) ? data.names : labelsAs === 'name' ? labels : [];
    return Array.from({ length: Math.max(ids.length, codes.length, names.length) }, (_, index) => ({ id: text(ids[index]), code: text(codes[index]), name: text(names[index]) })).filter(item => item.id || item.code || item.name);
  }
  const item = { id: text(data.id), code: text(data.code), name: text(data.name) };
  return item.id || item.code || item.name ? [item] : [];
}

// Uma busca adicional para a página autorizada inteira, sem N+1 nem seleção de anexos.
export async function enrichRdoServices(client, rows) {
  const ids = [...new Set(rows.flatMap(row => Object.values(equipmentFields).flatMap(aliases =>
    equipmentReferences(field(record(row.extraData), aliases)).map(item => item.id).filter(Boolean)
  )))];
  if (!ids.length) return rows;
  const equipment = await client.companyEquipment.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } });
  const resolved = new Map(equipment.map(item => [item.id, item]));
  return rows.map(row => ({ ...row, integrationEquipment: resolved }));
}

export function projectRdoService(row, context = {}) {
  const data = record(row.extraData);
  const serviceData = {
    ...Object.fromEntries(Object.entries(textFields).map(([name, aliases]) => [name, displayText(field(data, aliases))])),
    ...Object.fromEntries(Object.entries(booleanFields).map(([name, aliases]) => [name, yesNo(field(data, aliases))])),
    ...Object.fromEntries(Object.entries(listFields).map(([name, aliases]) => [name, strings(field(data, aliases))])),
    tubes: tubes(data),
    workingPressure: measurement(data, 'Pressão de trabalho', 'pressaoTrabalho', 'pressaoTrabalhoUnit'),
    testPressure: measurement(data, 'Pressão de teste', 'pressaoTeste', 'pressaoTesteUnit'),
    oilVolume: measurement(data, 'Volume de óleo', 'volumeOleo', 'volumeOleoUnit'),
    ...Object.fromEntries(Object.entries(equipmentFields).map(([name, aliases]) => [name,
      equipmentReferences(field(data, aliases)).map(item => {
        const resolved = row.integrationEquipment?.get(item.id);
        return { id: item.id, code: item.code || text(resolved?.code), name: item.name || text(resolved?.name) };
      })
    ])),
    collaborators: context.scopes?.has('rdo.equipe.read')
      ? equipmentReferences(field(data, ['Colaboradores do serviço', 'serviceCollaboratorIds']), 'name').map(item => ({ id: item.id, name: item.name })) : null
  };
  if (key(row.serviceType) === 'inibicao') serviceData.vessel ||= text(data.equipmentId);
  const equipmentLabel = displayText(field(data, ['Equipamento(s)', 'Equipamento', 'Embarcação', 'ID da embarcação']));
  return {
    ...row,
    system: text(row.system) || displayText(field(data, ['Sistema', 'system'])),
    material: text(row.material) || displayText(field(data, ['Material da tubulação', 'Material do equipamento', 'material'])),
    startTime: text(row.startTime) || text(field(data, ['Hora de início', 'startTime'])),
    endTime: text(row.endTime) || text(field(data, ['Hora de término/pausa', 'endTime'])),
    finalized: typeof row.finalized === 'boolean' ? row.finalized : yesNo(field(data, ['Serviço finalizado?', 'finalized'])),
    reportNumber: reportNumber(row.report), reportSequenceNumber: row.report?.sequenceNumber ?? null,
    reportType: text(row.report?.reportType), reportDate: row.report?.reportDate ?? null,
    projectId: text(row.report?.projectId), projectCode: text(row.report?.project?.code), projectName: text(row.report?.project?.name),
    equipmentName: equipmentLabel || text(row.equipment?.name) || text(data.equipmentId), equipmentCode: text(row.equipment?.code),
    totalLengthMeters: totalLengthMeters(serviceData.tubes), serviceData
  };
}
