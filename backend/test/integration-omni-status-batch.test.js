import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { createApiToken } from '../src/lib/api-credentials/token.js';
import { createApiTokenAuthenticator } from '../src/middleware/api-token-auth.js';
import { apiRequestContext, integrationApiBoundary, integrationApiErrorHandler } from '../src/middleware/api-request-context.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { projectEfetivoStatus } from '../src/lib/api-credentials/efetivo-project-status.js';
import { getProjectWorkflow } from '../src/lib/efetivo/project-workflow/service.js';
import { computeProgressDetailsForProjects } from '../src/lib/acompanhamento/avanco.js';
import { PROJECT_WORKFLOW_COMMERCIAL_FACTS, PROJECT_WORKFLOW_CRITICAL_QUESTIONS, PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_CLIENT_RELEASES, PROJECT_WORKFLOW_DOCUMENTATION_DEFINITIONS,
  PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS, PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS } from '../../shared/schemas/project-workflow.js';

const key = 'synthetic-status-batch-key-with-at-least-32-characters';
const envConfig = { apiTokenGlobalMaxPageSize: 500, apiTokenHashKeys: { 1: key }, apiTokenActiveKeyVersion: 1 };
const statusPath = '/efetivo/projetos/status';
const progressTables = ['ProjectPlannedService', 'ReportService', 'HistoricalServiceReport', 'ProjectRealizedCorrection', 'ProjectManualProgressHistory'];

test('status: limit=100 serves 90 projects under 5s with constant SQL queries and parity', { timeout: 120_000 }, async t => {
  const queries = [];
  const queryValues = [];
  const db = await apiSimulationDatabase({ onQuery: (sql, values) => {
    if (/^SELECT\b/i.test(sql)) { queries.push(sql); queryValues.push(values); }
  } });
  const prisma = db.client;
  let server;
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await db.close(); });
  const user = await prisma.user.create({ data: { username: 'status-batch', name: 'PRIVATE', passwordHash: 'synthetic', role: 'COORDINATOR' } });
  const projects = Array.from({ length: 90 }, (_, n) => ({ id: 'status-' + String(n).padStart(3, '0'),
    code: String(6000 + n), name: 'Projeto fictício', clientName: 'Cliente', clientCnpj: '', contractCode: '', location: '',
    manualProgressPct: n % 3 === 1 ? 42 : null }));
  await prisma.project.createMany({ data: [...projects,
    { ...projects[0], id: 'deleted', code: '9999', deletedAt: new Date() },
    { ...projects[0], id: 'manager', code: '9998', managerOnly: true }
  ] });
  await prisma.projectWorkflow.createMany({ data: projects.filter((_, n) => n % 5 !== 4).map(project => ({
    projectId: project.id, leaderUserId: user.id, stage: 'PREPARATION',
    commercialExpectedStartDate: new Date('2026-09-01'), commercialExpectedDurationDays: 20
  })) });
  const rdoProjects = projects.filter((_, n) => n % 3 === 0);
  await prisma.projectPlannedService.createMany({ data: rdoProjects.map(project => ({
    id: 'planned-' + project.id, projectId: project.id, serviceType: 'LIMPEZA_QUIMICA'
  })) });
  await prisma.projectPlannedServiceSystem.createMany({ data: rdoProjects.map(project => ({
    serviceId: 'planned-' + project.id, systemType: 'TUBULACAO', quantity: 100, unit: 'M'
  })) });
  // Vinte dias de fontes por projeto exercitam o avanço e seus históricos reais.
  const reports = rdoProjects.flatMap(project => Array.from({ length: 20 }, (_, n) => ({
    id: 'report-' + project.id + '-' + n, projectId: project.id, reportType: 'RDO', status: 'APPROVED',
    reportDate: new Date(Date.UTC(2026, 8, n + 1)), arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 0
  })));
  await prisma.report.createMany({ data: reports });
  await prisma.reportService.createMany({ data: reports.map(report => ({ reportId: report.id, finalized: true,
    serviceType: 'LIMPEZA_QUIMICA', extraData: { tubes: [{ c: '6.25', lengthUnit: 'm' }] }
  })) });
  const question = PROJECT_WORKFLOW_CRITICAL_QUESTIONS.find(item => item.createsIssue !== false).key;
  await prisma.projectWorkflowCriticalAnswer.create({ data: { projectId: projects[0].id, key: question, answer: true } });
  await prisma.projectWorkflowIssue.create({ data: { projectId: projects[0].id, sourceQuestion: question,
    description: 'PRIVATE', area: 'PRIVATE', criticality: 'HIGH' } });
  await prisma.projectWorkflowCommercialFact.createMany({ data: PROJECT_WORKFLOW_COMMERCIAL_FACTS.map(fact => ({
    projectId: projects[0].id, key: fact.key, status: 'CONFIRMED', occurredOn: new Date('2026-09-01'), note: 'PRIVATE', reference: 'PRIVATE'
  })) });

  async function issue(mode = 'ALL') {
    const token = createApiToken({ key });
    const credential = await prisma.apiCredential.create({ data: { name: 'Status sintético', purpose: 'Teste', recipientName: 'Omni',
      selector: token.selector, secretVerifier: token.verifier, secretLastFour: token.secretLastFour, hashKeyVersion: 1,
      startsAt: new Date(0), createdByUserId: user.id, issuanceRequestId: randomUUID(), requestsPerMinute: 600,
      maxPageSize: 100, projectAccessMode: mode,
      scopes: { create: { scopeCode: 'efetivo.projetos.status.read', grantedByUserId: user.id } },
      ...(mode === 'SELECTED' ? { projects: { create: { projectId: projects[0].id, grantedByUserId: user.id } } } : {})
    } });
    return { token: token.token, credential };
  }
  const full = await issue(), selected = await issue('SELECTED');
  const app = express();
  let timeoutMs = 15_000;
  let onApiError = () => {};
  app.use((req, res, next) => apiRequestContext({ timeoutMs })(req, res, next),
    integrationApiBoundary(), createApiTokenAuthenticator({ prismaClient: prisma, envConfig }));
  app.use('/api/integracoes/v1', createOperationalRouter({ prismaClient: prisma, envConfig }));
  app.use((error, req, res, next) => { onApiError(error, req); next(error); });
  app.use(integrationApiErrorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}/api/integracoes/v1`;
  async function request(path, auth = full) {
    const response = await fetch(root + path, { headers: { authorization: 'Bearer ' + auth.token } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  }
  await t.test('página de 100, fontes em lote, ordem e envelope', async () => {
    queries.length = 0;
    const started = performance.now();
    const large = await request(statusPath + '?limit=100&active=true');
    const elapsedMs = performance.now() - started;
    const largeQueries = [...queries];
    assert.ok(elapsedMs < 5_000, `90 projetos: ${elapsedMs.toFixed(1)}ms`);
    assert.equal(large.items.length, 90);
    assert.equal(large.page.limit, 100);
    assert.equal(large.page.hasMore, false);
    assert.equal(large.schemaVersion, '1.0');
    assert.deepEqual(large.items.map(row => row.projectId), projects.map(row => row.id));
    assert.doesNotMatch(JSON.stringify(large), /PRIVATE|passwordHash|criticalAnswers/);
    assert.equal(large.items[0].progressPercent, 125);
    assert.equal(large.items[0].progressMethod, 'RDO');
    assert.equal(large.items[0].commercialReadiness, 'RELEASED');
    assert.equal(large.items[0].criticalIssueCount, 1);
    assert.equal(large.items[1].progressPercent, 42);
    assert.equal(large.items[1].progressMethod, 'MANUAL');
    assert.equal(large.items[2].progressPercent, null);
    assert.equal(large.items[2].progressMethod, null);
    queries.length = 0;
    await request(statusPath + '?limit=10&active=true');
    assert.equal(largeQueries.length, queries.length, 'SQL count must not grow with the page');
    for (const table of progressTables) {
      const sourceQueries = largeQueries.filter(sql => sql.includes(`FROM "public"."${table}"`));
      assert.equal(sourceQueries.length, 1, `${table}: one source query per page`);
      assert.match(sourceQueries[0], /\bIN\s*\(/, `${table}: projects loaded together`);
    }
    const log = await prisma.apiRequestLog.findFirst({ where: { requestId: large.requestId } });
    assert.equal(log.statusCode, 200);
    assert.equal(log.responseRows, 90);
    assert.deepEqual((await request(statusPath + '?limit=100')).items, large.items);
    t.diagnostic(`limit=100, 90 projetos, 600 RDOs: ${elapsedMs.toFixed(1)}ms; ${largeQueries.length} SELECTs (mesmo total com limit=10).`);
  });
  await t.test('status individual e workflow detalhado preservam o resumo e o avanço oficial', async () => {
    const expected = await computeProgressDetailsForProjects(projects.slice(0, 5).map(row => row.id), { database: prisma });
    const collection = await request(statusPath + '?limit=10');
    for (const project of projects.slice(0, 5)) {
      const detail = await getProjectWorkflow(project.id, {}, { database: prisma });
      const projection = projectEfetivoStatus(detail, expected.get(project.id).progress);
      const individual = await request(`/efetivo/projetos/${project.id}/status`);
      const row = collection.items.find(row => row.projectId === project.id);
      for (const [field, value] of Object.entries(projection)) {
        assert.deepEqual(row[field], value, `${project.id}/${field}: collection versus workflow`);
        assert.deepEqual(individual[field], value, `${project.id}/${field}: individual versus workflow`);
      }
    }
  });
  await t.test('recorte SELECTED só carrega as fontes da página autorizada', async () => {
    queries.length = 0;
    queryValues.length = 0;
    const result = await request(statusPath + '?limit=100', selected);
    assert.deepEqual(result.items.map(row => row.projectId), [projects[0].id]);
    for (const table of progressTables) {
      const index = queries.findIndex(sql => sql.includes(`FROM "public"."${table}"`));
      assert.ok(index >= 0, table);
      const ids = queryValues[index].flat(Infinity).filter(value => typeof value === 'string' && value.startsWith('status-'));
      assert.deepEqual(ids, [projects[0].id], `${table}: only the authorized page`);
    }
  });
  await t.test('gates completos mantêm paridade com documentos, equipe, materiais e categoria sem IDs legados', async () => {
    const projectId = projects[3].id;
    const role = await prisma.jobRole.create({ data: { name: 'Operador', normalizedKey: 'status-operator' } });
    const collaborator = await prisma.collaborator.create({ data: { code: 'status-member', name: 'PRIVATE', jobRoleId: role.id } });
    const plan = await prisma.efetivoPlan.create({ data: { name: 'Plano oficial', kind: 'OFFICIAL', status: 'ACTIVE' } });
    await prisma.efetivoMissionPlan.create({ data: { projectId, planId: plan.id, scheduleStatus: 'CONFIRMED',
      headquartersResponsibleUserId: user.id, headquartersResponsibleName: 'PRIVATE', headquartersResponsibleRole: 'PRIVATE',
      mobilizationDate: new Date('2026-09-01'), executionStartDate: new Date('2026-09-01'), executionEndDate: new Date('2026-09-20'),
      allocations: { create: { collaboratorId: collaborator.id, jobRoleId: role.id, jobRoleNameSnapshot: 'Operador', mobilizationDate: new Date('2026-09-01') } }
    } });
    const category = await prisma.equipmentCategory.create({ data: { name: 'Categoria', systemKey: 'status-category' } });
    const equipment = await prisma.companyEquipment.create({ data: { name: 'Equipamento', code: 'status-equipment', categoryId: category.id } });
    await prisma.projectWorkflow.update({ where: { projectId }, data: {
      commercialExpectedStartDate: null, preJobNotApplicable: true, qsmsVerified: true,
      logisticsPlan: { lodgingRequired: false, freightRequired: false },
      travelPlan: { teamTransportDefined: true, teamTransportMode: 'BUS', teamTransportQuantity: 1 },
      supplyPlan: [{ id: 'material', name: 'Material', requiredQuantity: 1 }],
      equipmentCategoryPlans: { create: { categoryId: category.id, equipmentIds: [] } },
      teamMemberChecks: { create: PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS.map(item => ({ collaboratorId: collaborator.id, key: item.key, status: 'DONE' })) },
      preparationItemChecks: { create: [
        ...PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS.EQUIPMENT.map(item => ({ itemType: 'EQUIPMENT', itemId: equipment.id, key: item.key, status: 'DONE' })),
        { itemType: 'MATERIAL', itemId: 'material', key: 'SEPARATED', status: 'DONE' }
      ] },
      clientReleases: { create: [
        ...PROJECT_WORKFLOW_CLIENT_RELEASES.map(item => ({ key: item.key, requested: true, requestedAt: new Date('2026-09-01'),
          completed: true, completedAt: new Date('2026-09-02') })),
        { key: 'ATTENDANCE_CONFIRMATION', attendanceDate: new Date('2026-09-01'), attendanceConfirmedAt: new Date('2026-09-01') }
      ] },
      documentationCategories: { create: PROJECT_WORKFLOW_DOCUMENTATION_DEFINITIONS.map(item => ({ type: item.type,
        required: item.type === 'DOCUMENT', ...(item.type === 'DOCUMENT' ? { requirements: { create: { name: 'Documento', status: 'CONFIRMED',
          requestedAt: new Date('2026-09-01'), confirmedAt: new Date('2026-09-02') } } } : {})
      })) },
      checklists: { create: PROJECT_WORKFLOW_CHECKLISTS.map(item => ({ key: item.key, status: 'DONE' })) },
      postJob: { create: { meetingDate: new Date('2026-09-01') } },
      measurement: { create: { approvedAt: new Date('2026-09-01'), approvedAmount: 100 } }
    } });
    async function compare() {
      const detail = await getProjectWorkflow(projectId, {}, { database: prisma });
      const row = (await request(statusPath + '?projectId=' + projectId)).items[0];
      assert.equal(row.mobilizationReady, detail.workflow.mobilizationGate.ready);
      assert.equal(row.closureReady, detail.workflow.closureGate.ready);
      return { row, detail };
    }
    const ready = await compare();
    assert.equal(ready.row.mobilizationReady, true, JSON.stringify(ready.detail.workflow.mobilizationGate.blockers));
    assert.equal(ready.row.closureReady, true);
    await prisma.projectWorkflowPreparationItemCheck.updateMany({ where: { projectId, itemId: equipment.id, key: 'TESTED' }, data: { status: 'PENDING' } });
    assert.equal((await compare()).row.mobilizationReady, false);
    for (const stage of ['MOBILIZATION_PLANNING', 'MOBILIZATION', 'EXECUTION', 'FINISHED']) {
      await prisma.projectWorkflow.update({ where: { projectId }, data: { stage } });
      await compare();
    }
  });
  await t.test('timeout de fonte ou do pool responde 504 e registra REQUEST_TIMEOUT', async () => {
    const original = prisma.reportService.findMany;
    try {
      for (const error of [
        Object.assign(new Error('PRIVATE SQL'), { code: '57014' }),
        Object.assign(new Error('PRIVATE SQL'), { code: 'P2024' }),
        Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
        new Error('timeout exceeded when trying to connect'),
        Object.assign(new Error('PRIVATE SQL'), { meta: { driverAdapterError: { cause: { kind: 'SocketTimeout' } } } })
      ]) {
        prisma.reportService.findMany = async () => { throw error; };
        const response = await fetch(root + statusPath + '?limit=100', { headers: { authorization: 'Bearer ' + full.token } });
        const body = await response.json();
        assert.equal(response.status, 504);
        assert.equal(body.code, 'REQUEST_TIMEOUT');
        assert.equal(body.requestId, response.headers.get('x-request-id'));
        assert.doesNotMatch(JSON.stringify(body), /PRIVATE|57014|P2024|SocketTimeout/);
        const log = await prisma.apiRequestLog.findFirst({ where: { requestId: body.requestId } });
        assert.equal(log.statusCode, 504);
        assert.equal(log.outcomeCode, 'REQUEST_TIMEOUT');
        assert.equal(log.responseRows, 0);
      }
    } finally { prisma.reportService.findMany = original; }
  });
  await t.test('prazo HTTP responde 504 e não registra sucesso quando a consulta termina depois', { timeout: 5_000 }, async () => {
    const findMany = prisma.reportService.findMany;
    let resolveCompletion;
    const completed = new Promise(resolve => { resolveCompletion = resolve; });
    try {
      timeoutMs = 50;
      onApiError = (error, req) => resolveCompletion({ error, requestId: req.requestId });
      prisma.reportService.findMany = async args => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return findMany(args);
      };
      const response = await fetch(root + statusPath + '?limit=100', { headers: { authorization: 'Bearer ' + full.token } });
      assert.equal(response.status, 504);
      const body = await response.json();
      assert.equal(body.code, 'REQUEST_TIMEOUT');
      const completion = await completed;
      assert.equal(completion.requestId, body.requestId);
      assert.equal(completion.error.code, 'REQUEST_TIMEOUT');
      const log = await prisma.apiRequestLog.findFirst({ where: { requestId: body.requestId } });
      assert.equal(log.requestId, body.requestId);
      assert.equal(log.statusCode, 504);
      assert.equal(log.outcomeCode, 'REQUEST_TIMEOUT');
      assert.equal(log.responseRows, 0);
      assert.equal(await prisma.apiRequestLog.count({ where: { requestId: body.requestId } }), 1);
    } finally {
      timeoutMs = 15_000;
      prisma.reportService.findMany = findMany;
      onApiError = () => {};
    }
  });
});
