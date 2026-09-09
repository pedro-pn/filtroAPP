// Metadados do catálogo: não importar dependências de execução do backend.
const nullableText = { type: ['string', 'null'] };
const nullableBoolean = { type: ['boolean', 'null'] };
const textList = { type: 'array', items: { type: 'string' } };
const closedObject = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const equipmentSchema = closedObject({ id: nullableText, code: nullableText, name: nullableText });
const equipmentList = { type: 'array', items: equipmentSchema };
const measurementSchema = { ...closedObject({ value: nullableText, unit: nullableText }), type: ['object', 'null'] };

// Aliases do formulário atual e dos relatórios antigos. Nunca publicar extraData inteiro.
export const textFields = {
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
export const booleanFields = {
  clientApproved: ['Aprovado pelo cliente?', 'aprovadoCliente'],
  cleaningPiping: ['Limpeza de tubulação?', 'limpezaTubulacao'],
  flushingPiping: ['Flushing em tubulação?', 'flushingTubulacao'],
  particleCounting: ['Houve contagem de partículas?', 'houveParticulas'],
  dehydration: ['Houve desidratação?', 'houveDesidratacao'],
  moistureAnalysis: ['Houve análise de umidade?', 'houveUmidade']
};
export const listFields = {
  stages: ['Etapas realizadas no dia', 'etapas'],
  cleaningMethods: ['Método de limpeza', 'metodos'],
  cleaningLocations: ['Local de limpeza', 'local'],
  inspectionTypes: ['Tipo de inspeção', 'tipoInspecao'],
  reportTypes: ['Tipo de relatório', 'tipoRelatorio']
};
export const equipmentFields = {
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
