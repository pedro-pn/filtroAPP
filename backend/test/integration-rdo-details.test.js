import assert from 'node:assert/strict';
import test from 'node:test';
import { getOperationalResource } from '../src/lib/api-credentials/operational-resources.js';
import { serializeOperationalResource } from '../src/lib/api-credentials/operational-serialization.js';
import { listOperationalResources } from '../src/lib/api-credentials/operational-service.js';
import { RDO_SERVICE_DATA_SCHEMA } from '../src/lib/api-credentials/rdo-resource-definition.js';
import { API_SCOPES, publicApiOperations } from '../src/lib/api-credentials/catalog.js';
import { executePlaygroundOperation } from '../src/lib/api-credentials/playground.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';

const reportResource = getOperationalResource('operational.Report.list');
const serviceResource = getOperationalResource('operational.ReportService.list');
const date = new Date('2026-09-08T12:00:00Z');
const report = { id: 'r1', projectId: 'p1', reportType: 'RDO', sequenceNumber: 27, reportDate: date, createdAt: date, updatedAt: date,
  project: { code: '05776', name: 'Projeto demonstrativo', clientEmailPrimary: 'NEVER_EXPOSE' },
  status: 'APPROVED', arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 3,
  daytimeWorkedMinutes: 480, nighttimeWorkedMinutes: 0, daytimeOvertimeMinutes: 0, nighttimeOvertimeMinutes: 0, totalOvertimeMinutes: 0,
  approvedAt: date, dailyDescription: 'Lavagem e inspeção das linhas.', overtimeReason: null, reviewNotes: 'NEVER_EXPOSE', zapsignDocToken: 'NEVER_EXPOSE' };
const service = extraData => ({ id: 's1', reportId: 'r1', serviceType: 'pressao', createdAt: date, updatedAt: date,
  equipmentId: null, system: null, material: null, startTime: null, endTime: null, finalized: null,
  report, extraData });
const ctx = scopes => ({ scopes: new Set(scopes || ['rdo.relatorios.read', 'rdo.servicos.read']), projectAccessMode: 'SELECTED', projectIds: new Set(['p1']), maxPageSize: 100,
  snapshotAt: new Date('2026-09-09T12:00:00Z'), cursorKey: 'synthetic-rdo-details-cursor-key-at-least-32' });
const project = (data, context = ctx()) => serializeOperationalResource(serviceResource, service(data), context);

function assertShape(value, schema) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  assert.ok(types.includes(actualType), `${actualType} outside ${types}`);
  if (value === null) return;
  if (actualType === 'object') {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(Object.keys(value).sort(), Object.keys(schema.properties).sort());
    for (const [name, item] of Object.entries(value)) assertShape(item, schema.properties[name]);
  }
  if (actualType === 'array') value.forEach(item => assertShape(item, schema.items));
}

test('report and services carry the visible report number and preserve the project code including leading zeros', () => {
  const result = serializeOperationalResource(reportResource, report);
  assert.equal(result.sequenceNumber, 27);
  assert.equal(result.reportNumber, 'RDO 27');
  assert.equal(result.projectCode, '05776');
  assert.equal(result.projectName, 'Projeto demonstrativo');
  assert.equal(result.dailyDescription, 'Lavagem e inspeção das linhas.');
  assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPOSE/);
  const item = project({});
  assert.equal(item.reportNumber, result.reportNumber);
  assert.equal(item.reportSequenceNumber, 27);
  assert.equal(item.reportType, 'RDO');
  assert.equal(item.reportDate, date.toISOString());
  assert.equal(item.projectId, 'p1');
  assert.equal(item.projectCode, result.projectCode);
  assert.equal(serializeOperationalResource(reportResource, { ...report, reportType: 'RLQ', sequenceNumber: 3 }).reportNumber, 'RLQ 3');
  assert.equal(serializeOperationalResource(reportResource, { ...report, sequenceNumber: null }).reportNumber, null);
});

test('current pressure-service inputs expose equipment, dimensions, measurements, steps, approval and observations', () => {
  const result = project({ equipmentId: 'Bomba principal', system: 'Hidráulico', material: 'Aço inox', startTime: '08:15', endTime: '10:30', finalized: false,
    tubes: [{ d: '1 1/2', unit: 'pol', c: '1,5', lengthUnit: 'm' }, { d: '38', unit: 'mm', c: '150', lengthUnit: 'cm' }],
    aprovadoCliente: 'Não', etapas: ['Montagem do sistema', 'Execução do teste'], drawingsTags: 'TAG-B01', notes: 'Sem vazamentos.',
    equipamentoTestado: 'tubulacao', equipamentoTestadoOutro: '', pressaoTrabalho: '10', pressaoTrabalhoUnit: 'bar', pressaoTeste: '15', pressaoTesteUnit: 'bar', fluidoTeste: 'oleo', qualOleo: 'ISO VG 46' });
  assert.equal(result.equipmentName, 'Bomba principal');
  assert.equal(result.system, 'Hidráulico');
  assert.equal(result.material, 'Aço inox');
  assert.equal(result.startTime, '08:15');
  assert.equal(result.endTime, '10:30');
  assert.equal(result.finalized, false);
  assert.equal(result.totalLengthMeters, '3');
  assert.deepEqual(result.serviceData.tubes[0], { diameter: '1 1/2', diameterUnit: 'pol', length: '1,5', lengthUnit: 'm' });
  assert.deepEqual(result.serviceData.testPressure, { value: '15', unit: 'bar' });
  assert.deepEqual(result.serviceData.workingPressure, { value: '10', unit: 'bar' });
  assert.equal(result.serviceData.testFluid, 'oleo');
  assert.equal(result.serviceData.testOil, 'ISO VG 46');
  assert.equal(result.serviceData.clientApproved, false);
  assert.deepEqual(result.serviceData.stages, ['Montagem do sistema', 'Execução do teste']);
  assert.equal(result.serviceData.notes, 'Sem vazamentos.');
  assert.equal(result.serviceData.drawingsTags, 'TAG-B01');
  assertShape(result.serviceData, RDO_SERVICE_DATA_SCHEMA);
});

test('legacy labels, equipment lists, scalar tube dimensions and saved equipment codes remain meaningful', () => {
  const result = project({ 'Equipamento(s)': ['Bomba A', 'Bomba B'], Sistema: ['Linha A', 'Linha B'], 'Material da tubulacao': 'Inox',
    'Hora de inicio': '09:00', 'Hora de termino/pausa': '11:00', 'Servico finalizado?': ['Sim'], 'Aprovado pelo cliente?': ['Não'],
    'Diametro': '1 1/2 pol', Comprimento: '150 cm', 'Pressao de teste': '25,5 bar', 'Unidade de filtragem': { ids: ['old-unit'], labels: ['UFI 004'] },
    'Colaboradores do servico': { ids: ['c1'], labels: ['Pessoa demonstrativa'] } });
  assert.equal(result.equipmentName, 'Bomba A, Bomba B');
  assert.equal(result.system, 'Linha A, Linha B');
  assert.equal(result.startTime, '09:00');
  assert.equal(result.finalized, true);
  assert.equal(result.totalLengthMeters, '1.5');
  assert.deepEqual(result.serviceData.tubes, [{ diameter: '1 1/2', diameterUnit: 'pol', length: '150', lengthUnit: 'cm' }]);
  assert.deepEqual(result.serviceData.testPressure, { value: '25,5', unit: 'bar' });
  assert.deepEqual(result.serviceData.filtrationUnits, [{ id: 'old-unit', code: 'UFI 004', name: null }]);
  assert.equal(result.serviceData.collaborators, null);
});

test('cleaning, flushing, filtration, mechanical and inhibition forms retain their specific fields', () => {
  const cases = [
    ['limpeza', { 'Método de limpeza': ['Circulação', 'Imersão'], 'Local de limpeza': ['Interna'], 'Tipo de inspeção': ['Visual'], 'Limpeza de tubulação?': 'Sim' }, data => {
      assert.deepEqual(data.cleaningMethods, ['Circulação', 'Imersão']); assert.deepEqual(data.cleaningLocations, ['Interna']); assert.deepEqual(data.inspectionTypes, ['Visual']); assert.equal(data.cleaningPiping, true);
    }],
    ['flushing', { tipoFlushing: 'secundario', flushingTubulacao: 'Não', tipoOleo: 'ISO VG 32', volumeOleo: '1,5', volumeOleoUnit: 'L', houveParticulas: 'Sim', contagemInicialNas: '12', contagemFinalNas: '6', contagemInicialIso: '22/20/18', contagemFinalIso: '18/16/13', houveDesidratacao: 'Sim', houveUmidade: 'Sim', umidadeInicial: '350', umidadeFinal: '50' }, data => {
      assert.equal(data.flushingType, 'secundario'); assert.equal(data.flushingPiping, false); assert.equal(data.oilType, 'ISO VG 32'); assert.deepEqual(data.oilVolume, { value: '1,5', unit: 'L' }); assert.equal(data.particleCounting, true); assert.equal(data.initialNas, '12'); assert.equal(data.finalNas, '6'); assert.equal(data.initialIso, '22/20/18'); assert.equal(data.finalIso, '18/16/13'); assert.equal(data.dehydration, true); assert.equal(data.moistureAnalysis, true); assert.equal(data.initialMoisturePpm, '350'); assert.equal(data.finalMoisturePpm, '50');
    }],
    ['filtragem', { 'Volume de óleo': '100 L', 'Houve contagem de partículas?': 'Não', 'Houve desidratação?': 'Não', 'Unidade de filtragem': { codes: ['UFI 001'] } }, data => {
      assert.deepEqual(data.oilVolume, { value: '100', unit: 'L' }); assert.equal(data.particleCounting, false); assert.equal(data.dehydration, false); assert.equal(data.filtrationUnits[0].code, 'UFI 001');
    }],
    ['mecanica', { 'Etapas realizadas no dia': ['Raspagem mecânica'], Observações: 'Tanque limpo.' }, data => {
      assert.deepEqual(data.stages, ['Raspagem mecânica']); assert.equal(data.notes, 'Tanque limpo.');
    }],
    ['inibicao', { equipmentId: 'Embarcação 01', lines: 'ignored', linhas: 'Linha 01', steps: 'M001', tipoRelatorio: ['RLI', 'RLF'] }, data => {
      assert.equal(data.vessel, 'Embarcação 01'); assert.equal(data.lines, 'Linha 01'); assert.equal(data.steps, 'M001'); assert.deepEqual(data.reportTypes, ['RLI', 'RLF']);
    }]
  ];
  for (const [serviceType, data, check] of cases) {
    const item = serializeOperationalResource(serviceResource, { ...service(data), serviceType }, ctx());
    check(item.serviceData); assertShape(item.serviceData, RDO_SERVICE_DATA_SCHEMA);
  }
});

test('metric totals preserve decimal precision and never fabricate a partial or invalid total', () => {
  assert.equal(project({ tubes: [{ c: '0.1' }, { c: '0.2' }] }).totalLengthMeters, '0.3');
  assert.equal(project({ tubes: [{ c: '0' }] }).totalLengthMeters, '0');
  for (const tubes of [[], [{ c: '' }], [{ c: '10' }, { c: 'invalid' }], [{ c: '10' }, null], [{ c: '10', lengthUnit: 'unknown' }], [{ c: '-10' }]]) {
    assert.equal(project({ tubes }).totalLengthMeters, null);
  }
});

test('service projection restricts nested fields and gates the saved team separately', () => {
  const data = { 'Colaboradores do serviço': { ids: ['c1'], names: ['Pessoa demonstrativa'], cpf: 'NEVER_EXPOSE' },
    tubes: [{ d: '2', c: '3', url: 'NEVER_EXPOSE' }], uth: [{ id: 'e1', code: 'UTH 001', token: 'NEVER_EXPOSE' }],
    notes: { private: 'NEVER_EXPOSE' }, __uploads__: [{ url: 'NEVER_EXPOSE' }], __serviceLinkKey: 'NEVER_EXPOSE', futureField: 'NEVER_EXPOSE' };
  const item = project(data);
  assert.equal(item.serviceData.collaborators, null);
  assert.doesNotMatch(JSON.stringify(item), /NEVER_EXPOSE|Pessoa demonstrativa|extraData|integrationEquipment/);
  const allowed = project(data, ctx(['rdo.relatorios.read', 'rdo.servicos.read', 'rdo.equipe.read']));
  assert.deepEqual(allowed.serviceData.collaborators, [{ id: 'c1', name: 'Pessoa demonstrativa' }]);
  assert.doesNotMatch(JSON.stringify(allowed), /NEVER_EXPOSE/);
  assertShape(allowed.serviceData, RDO_SERVICE_DATA_SCHEMA);
});

test('equipment enrichment is batched only after authorized pagination and publishes minimal identity', async () => {
  const calls = [];
  const row = { ...service({ uth: ['uth1'], manometroIds: ['m1'], contadorUtilizado: 'counter1' }), id: 's1' };
  const db = { reportService: { async findMany(args) { calls.push(args); return [row, { ...service({ uth: ['next-page-only'] }), id: 's2' }]; } },
    companyEquipment: { async findMany(args) { calls.push(args); return args.where.id.in.map(id => ({ id, code: `CODE-${id}`, name: `Nome ${id}`, token: 'NEVER_EXPOSE' })); } } };
  const result = await listOperationalResources(db, serviceResource.operationId, { limit: 1 }, ctx());
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].where.id.in.sort(), ['counter1', 'm1', 'uth1']);
  assert.deepEqual(calls[1].select, { id: true, code: true, name: true });
  assert.deepEqual(result.items[0].serviceData.hydrostaticUnits, [{ id: 'uth1', code: 'CODE-uth1', name: 'Nome uth1' }]);
  assert.equal(result.items[0].serviceData.manometers[0].code, 'CODE-m1');
  assert.equal(result.items[0].serviceData.particleCounters[0].code, 'CODE-counter1');
  assert.equal(result.page.hasMore, true);
  assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPOSE|next-page-only/);
  await assert.rejects(() => listOperationalResources(db, serviceResource.operationId, {}, ctx([])), error => error.code === 'INSUFFICIENT_SCOPE');
  await assert.rejects(() => listOperationalResources(db, serviceResource.operationId, { projectId: 'p2' }, ctx()), error => error.code === 'PROJECT_NOT_ALLOWED');
  assert.equal(calls.length, 2);
});

test('API catalog describes report numbers and technical fields without claiming those fields are excluded', () => {
  const reports = API_SCOPES.find(scope => scope.code === 'rdo.relatorios.read');
  const services = API_SCOPES.find(scope => scope.code === 'rdo.servicos.read');
  assert.ok(reports.exposedFields.includes('sequenceNumber'));
  assert.ok(reports.exposedFields.includes('projectCode'));
  assert.ok(services.exposedFields.includes('serviceData.tubes'));
  assert.ok(services.exposedFields.includes('serviceData.notes'));
  assert.ok(!reports.excludedFields.includes('sequências'));
  assert.ok(!services.excludedFields.includes('observações livres'));
  assert.deepEqual(publicApiOperations().find(item => item.operationId === serviceResource.operationId).optionalScopes, ['rdo.equipe.read']);
});

function meteredDb() {
  const credential = { id: 'credential', projectAccessMode: 'ALL', maxPageSize: 3, requestsPerMinute: 10, requestsPerDay: 100, rowsPerDay: 1000,
    secretLastFour: 'demo', scopes: ['rdo.relatorios.read', 'rdo.servicos.read'].map(scopeCode => ({ scopeCode })), projects: [] };
  const db = { reportService: { async findMany() { return [service({ 'Equipamento(s)': ['Tanque A'], tubes: [{ d: '2', c: '10' }] })]; } },
    apiUsageBucket: { async upsert({ create }) { return { id: create.windowKind }; }, async updateMany() { return { count: 1 }; }, async update() {} },
    apiRequestLog: { async create() {} }, apiCredentialEvent: { async create() {} }, apiCredential: { async findUnique() { return credential; }, async updateMany() { return { count: 1 }; } } };
  db.$transaction = async action => typeof action === 'function' ? action(db) : Promise.all(action);
  return { db, credential };
}

test('real HTTP route handler and administrative playground return the same enriched service data', async () => {
  const { db, credential } = meteredDb();
  const result = await executePlaygroundOperation(db, 'credential', { operationId: serviceResource.operationId, query: { projectCode: '05776', reportType: 'RDO' }, pathParams: {} }, { cursorKey: ctx().cursorKey });
  assert.equal(result.response.body.items[0].equipmentName, 'Tanque A');
  const requestUrl = new URL(result.request.path, 'https://example.invalid');
  assert.equal(requestUrl.pathname, '/api/integracoes/v1/rdo/servicos');
  assert.equal(requestUrl.searchParams.get('projectCode'), '05776');
  assert.equal(requestUrl.searchParams.get('reportType'), 'RDO');
  const router = createOperationalRouter({ prismaClient: db, envConfig: { apiTokenGlobalMaxPageSize: 500, apiTokenHashKeys: { 1: ctx().cursorKey }, apiTokenActiveKeyVersion: 1 } });
  const route = router.stack.find(layer => layer.route?.path === '/rdo/servicos').route;
  const req = { query: { projectCode: '05776', reportType: 'RDO' }, requestId: 'rdo-details-request', headers: {}, apiAuth: { credential, scopeCodes: ctx().scopes, projectIds: new Set(), projectCodes: new Set() } };
  const response = await new Promise((resolve, reject) => route.stack[0].handle(req, {}, () => route.stack[1].handle(req, { json: resolve }, reject)));
  assert.deepEqual(response.items, result.response.body.items);
  assert.equal(response.items[0].totalLengthMeters, '10');
});
