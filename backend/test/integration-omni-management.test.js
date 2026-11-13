import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import express from 'express';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import appPrisma from '../src/lib/prisma.js';
import { API_SCOPES } from '../src/lib/api-credentials/catalog.js';
import { MANAGEMENT_RESOURCES } from '../src/lib/api-credentials/management-resources.js';
import { managementWeeks, projectWeeklyReview } from '../src/lib/api-credentials/management-service.js';
import { createApiToken } from '../src/lib/api-credentials/token.js';
import { createApiTokenAuthenticator } from '../src/middleware/api-token-auth.js';
import { apiRequestContext, integrationApiBoundary, integrationApiErrorHandler } from '../src/middleware/api-request-context.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { PROJECT_EXECUTION_WEEKLY_CHECKS } from '../../shared/schemas/project-execution.js';
import { getProjectDetail } from '../src/lib/acompanhamento/project-detail.js';
import { projectCostSummary } from '../../shared/modules/project-cost-summary.js';
import { computeProjectProgressDetails } from '../src/lib/acompanhamento/avanco.js';
import { clearProjectDerivedCaches } from '../src/lib/resource-list-cache.js';
import { executePlaygroundOperation } from '../src/lib/api-credentials/playground.js';
import { listOperationalResources } from '../src/lib/api-credentials/operational-service.js';

const key = 'synthetic-management-b6-key-with-at-least-32-characters';
const envConfig = { apiTokenGlobalMaxPageSize: 500, apiTokenHashKeys: { 1: key }, apiTokenActiveKeyVersion: 1 };
const date = day => new Date(day + 'T12:00:00Z');
const week = '2026-09-28';
const checks = Object.fromEntries(PROJECT_EXECUTION_WEEKLY_CHECKS.map(item => [item.key, true]));

test('B6: semanas válidas, limite inclusivo e virada de semana em São Paulo', () => {
  assert.deepEqual(managementWeeks({}, new Date('2026-11-02T01:00:00Z')), ['2026-10-26']);
  assert.equal(managementWeeks({ from: '2026-08-17', to: '2026-11-08' }, date('2026-11-03')).length, 12);
  for (const query of [{ weekStart: '2026-09-29' }, { from: week }, { from: '2026-10-02', to: week },
    { from: '2026-08-10', to: '2026-11-08' }, { weekStart: '2026-11-09' }, { weekStart: week, from: week, to: week }]) {
    assert.throws(() => managementWeeks(query, date('2026-11-03')), { statusCode: 400 });
  }
  const { WEEKLY_TARGET, ...legacy } = checks;
  assert.equal(WEEKLY_TARGET, true);
  assert.equal(projectWeeklyReview({ checks: legacy, completedAt: date(week), note: 'PRIVATE' }).pendencias, 0);
  assert.equal(projectWeeklyReview(null), null);
});

test('B6: HTTP, paridade com painel, privacidade e gatilhos transacionais em PostgreSQL descartável', { timeout: 120_000 }, async t => {
  const db = await apiSimulationDatabase(), prisma = db.client;
  let server;
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); clearProjectDerivedCaches(); await db.close(); });
  // Os serviços legados do painel usam o singleton. Somente seu transporte é
  // redirecionado ao MESMO Prisma/PostgreSQL descartável; nenhum cálculo é mockado.
  for (const model of Prisma.dmmf.datamodel.models) {
    const delegate = model.name[0].toLowerCase() + model.name.slice(1);
    for (const method of ['findMany','findFirst','findUnique','groupBy','count']) {
      if (appPrisma[delegate]?.[method]) {
        const original = appPrisma[delegate][method];
        appPrisma[delegate][method] = args => prisma[delegate][method](args);
        t.after(() => { appPrisma[delegate][method] = original; });
      }
    }
  }
  const originalRaw = appPrisma.$queryRaw;
  appPrisma.$queryRaw = (...args) => prisma.$queryRaw(...args);
  t.after(() => { appPrisma.$queryRaw = originalRaw; });
  const user = await prisma.user.create({ data: { username: 'manager-b6', name: 'PRIVATE_NAME', email: 'private@example.test', passwordHash: 'synthetic', role: 'COORDINATOR' } });
  const role = await prisma.jobRole.create({ data: { name: 'Operador', normalizedKey: 'operador-b6' } });
  const collaborators = await Promise.all([1,2,3].map(n => prisma.collaborator.create({ data: {
    code: 'C' + n, name: 'PRIVATE_NAME_' + n, cpf: 'PRIVATE_CPF', email: 'private@example.test', jobRoleId: role.id
  } })));
  const makeProject = (id, code) => prisma.project.create({ data: { id, code, name: 'Projeto fictício', clientName: 'Cliente',
    clientCnpj: '', contractCode: '501', commercialProposalCode: '501', location: '', manualProgressPct: 60 } });
  // Projeto fora do recorte ordena antes dos permitidos.
  const hidden = await makeProject('a-hidden', '00500'), p1 = await makeProject('b-visible', '00501'), p2 = await makeProject('c-visible', '00502');
  for (const project of [p1, p2, hidden]) {
    await prisma.projectWorkflow.create({ data: { projectId: project.id, leaderUserId: user.id } });
  }
  await prisma.projectManualProgressHistory.createMany({ data: [['2026-09-27',10],['2026-09-28',20],['2026-10-04',45],['2026-10-05',60]]
    .map(([day, progressPct]) => ({ projectId: p1.id, recordedAt: date(day), progressPct })) });
  const group = await prisma.acompanhamentoMissionGroup.create({ data: { name: 'Grupo privado', members: { create: [p1, hidden]
    .map(project => ({ projectId: project.id, activeProjectId: project.id })) } } });
  await prisma.missionWeeklyProgressTarget.create({ data: { groupId: group.id, weekStartDate: new Date(week), plannedPctPoints: 9, createdByName: 'PRIVATE_AUTHOR' } });
  await prisma.missionWeeklyProgressTarget.create({ data: { projectId: p1.id, weekStartDate: new Date(week), plannedPctPoints: 12, createdByName: 'PRIVATE_AUTHOR' } });
  await prisma.missionWeeklyProgressTarget.create({ data: { projectId: p1.id, weekStartDate: new Date(week), revision: 2, plannedPctPoints: 15, createdByName: 'PRIVATE_AUTHOR' } });
  await prisma.projectExecutionWeeklyReview.create({ data: { projectId: p1.id, weekStartDate: new Date(week), checks, completedAt: date('2026-10-01'), note: 'PRIVATE_NOTE', completedByUserId: user.id } });
  await prisma.commercialProposal.create({ data: { codBd: 501, codProp: 501, nRev: 1, rawRow: {}, plannedDays: 22,
    salePrice: 2000, plannedCost: 1000, expectedProfit: 1000, expectedMargin: 50, components: { diariaEquipamento: 123.45, salary: 'PRIVATE_SALARY' } } });
  await prisma.commercialProposal.create({ data: { codBd: 502, codProp: 501, nRev: 2, rawRow: {}, plannedDays: 999, components: { diariaEquipamento: 999 } } });
  await prisma.projectBudget.create({ data: { projectId: p1.id, sourceProposalCodBd: 501,
    plannedDays: 20, salePrice: 2000, plannedTotalCost: 1000, expectedProfit: 1000, expectedMargin: 50 } });
  const plan = await prisma.efetivoPlan.create({ data: { kind: 'OFFICIAL', status: 'ACTIVE', name: 'Plano oficial' } });
  const scenario = await prisma.efetivoPlan.create({ data: { kind: 'SCENARIO', status: 'DRAFT', name: 'PRIVATE_SCENARIO' } });
  const mission = (project, planId) => prisma.efetivoMissionPlan.create({ data: { projectId: project.id, planId, scheduleStatus: 'CONFIRMED',
    headquartersResponsibleUserId: user.id, headquartersResponsibleName: 'PRIVATE_NAME', headquartersResponsibleRole: 'PRIVATE_ROLE',
    mobilizationDate: new Date(week), executionStartDate: new Date(week), executionEndDate: new Date('2026-10-05') } });
  const m1 = await mission(p1, plan.id), mh = await mission(hidden, plan.id), ms = await mission(p1, scenario.id);
  const allocate = (m, c) => prisma.efetivoMissionAllocation.create({ data: { missionId: m.id, collaboratorId: c.id,
    jobRoleId: role.id, jobRoleNameSnapshot: role.name, mobilizationDate: new Date(week) } });
  const allocation = await allocate(m1, collaborators[0]); await allocate(mh, collaborators[2]); await allocate(ms, collaborators[1]);
  async function issue(scopes, all = false) {
    const token = createApiToken({ key });
    const credential = await prisma.apiCredential.create({ data: { name: 'Teste fictício B6', purpose: 'Teste', recipientName: 'Omni',
      selector: token.selector, secretVerifier: token.verifier, secretLastFour: token.secretLastFour, hashKeyVersion: 1,
      startsAt: new Date(0), createdByUserId: user.id, issuanceRequestId: randomUUID(), requestsPerMinute: 600,
      projectAccessMode: all ? 'ALL' : 'SELECTED', scopes: { create: scopes.map(scopeCode => ({ scopeCode, grantedByUserId: user.id })) },
      ...(!all ? { projects: { create: [p1,p2].map(project => ({ projectId: project.id, grantedByUserId: user.id })) } } : {}) } });
    return { token: token.token, credential };
  }
  const full = await issue(API_SCOPES.map(scope => scope.code));
  const operational = await issue(['acompanhamento.progresso.read','projetos.condicoes.read','efetivo.alocacoes.read','ponto.resumos.read','eventos.read']);
  const noScope = await issue(['eventos.read']);
  const app = express(); app.use(apiRequestContext(), integrationApiBoundary(), express.json(), createApiTokenAuthenticator({ prismaClient: prisma, envConfig }));
  app.use('/api/integracoes/v1', createOperationalRouter({ prismaClient: prisma, envConfig }));
  const errors = []; app.use((error, req, res, next) => { errors.push(error.stack); next(error); }); app.use(integrationApiErrorHandler);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}/api/integracoes/v1`;
  async function request(path, auth = full) {
    const response = await fetch(root + path, { headers: { authorization: 'Bearer ' + auth.token } });
    const body = await response.json(); assert.notEqual(response.status, 500, JSON.stringify({ body, errors }));
    return { status: response.status, body };
  }
  await t.test('G1 paridade de histórico, revisões, grupo e conclusão sem notas/autores', async () => {
    const result = await request(`/acompanhamento/projetos/semanas?weekStart=${week}&limit=1`, operational);
    assert.equal(result.status, 200); const row = result.body.items[0];
    assert.equal(row.projectId, p1.id); assert.equal(row.avancoInicio, 10); assert.equal(row.avancoFim, 45);
    const detail = await computeProjectProgressDetails(p1.id, { database: prisma });
    assert.equal(row.avancoFim, detail.dailyProgressHistory.find(point => point.date === '2026-10-04').progressPct);
    assert.equal(row.metaPontos, 15); assert.equal(row.metaDefinidaPor, 'PROJETO'); assert.equal(row.revisao.pendencias, 0);
    assert.equal(row.meta.itens[0].valorCadastrado, 15); assert.equal(row.meta.itens[0].realizado, 35);
    assert.equal(row.meta.situacao, 'ABOVE');
    assert.deepEqual(row.revisao.itens.map(item => item.rotulo), PROJECT_EXECUTION_WEEKLY_CHECKS.map(item => item.label));
    assert.equal(JSON.stringify(row).includes('PRIVATE'), false); assert.equal(JSON.stringify(row).includes(hidden.id), false);
    assert.equal(result.body.page.hasMore, true);
    const next = await request(`/acompanhamento/projetos/semanas?weekStart=${week}&limit=1&cursor=${encodeURIComponent(result.body.page.nextCursor)}`);
    // Cursores são vinculados também aos escopos/credencial.
    assert.equal(next.status, 400);
    const nextAllowed = await request(`/acompanhamento/projetos/semanas?weekStart=${week}&limit=1&cursor=${encodeURIComponent(result.body.page.nextCursor)}`, operational);
    assert.equal(nextAllowed.body.items[0].projectId, p2.id); assert.equal(nextAllowed.body.page.hasMore, false);
    await prisma.missionWeeklyProgressTarget.create({ data: { projectId: p1.id, weekStartDate: new Date(week), revision: 3, isDeleted: true, createdByName: 'PRIVATE_AUTHOR' } });
    const inherited = (await request(`/acompanhamento/projetos/semanas?weekStart=${week}&projectId=${p1.id}`, operational)).body.items[0];
    assert.equal(inherited.metaPontos, 9); assert.equal(inherited.metaDefinidaPor, 'GRUPO');
    assert.equal(inherited.meta.itens[0].valorCadastrado, 9); assert.equal(inherited.meta.itens[0].realizado, 35);
  });
  await t.test('G3 mínimo independente de comercial; valores somente com escopo financeiro', async () => {
    let row = (await request('/projetos/condicoes?projectCode=00501', operational)).body.items[0];
    assert.equal(row.permanenciaPrevistaDias, 20); assert.equal('diariaStandByEquipamento' in row, false); assert.equal('currency' in row, false);
    row = (await request('/projetos/condicoes?projectCode=00501')).body.items[0];
    assert.equal(row.diariaStandByEquipamento, '123.45'); assert.equal(row.currency, 'BRL');
    const since = new Date().toISOString();
    await prisma.projectBudget.update({ where: { projectId_version: { projectId: p1.id, version: 1 } }, data: { plannedDays: null } });
    row = (await request('/projetos/condicoes?projectCode=00501&updatedSince=' + encodeURIComponent(since))).body.items[0];
    assert.equal(row.permanenciaPrevistaDias, 22);
  });
  await t.test('G4 somente oficial, recorte, exclusão lógica e ausência de PII', async () => {
    const since = new Date().toISOString();
    await prisma.efetivoMissionAllocation.update({ where: { id: allocation.id }, data: { deletedAt: new Date() } });
    const result = await request('/efetivo/alocacoes?updatedSince=' + encodeURIComponent(since));
    assert.equal(result.body.items.length, 1); const row = result.body.items[0];
    assert.equal(row.id, allocation.id); assert.equal(row.collaboratorId, collaborators[0].id); assert.ok(row.deletedAt);
    assert.equal(row.mobilizacao, week); assert.equal(JSON.stringify(row).includes('PRIVATE'), false);
  });
  await t.test('G5 aliases, override por dia, merge de imports, extras/noturno e supressão <2 pessoas antes de paginar', async () => {
    await prisma.pontoProjectTagAlias.create({ data: { normalizedTag: 'etiqueta', rawTag: 'Etiqueta', projectId: p1.id } });
    for (const day of [week, '2026-10-05']) await prisma.report.create({ data: {
      projectId: p1.id, reportDate: new Date(day), status: 'APPROVED', arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00',
      daytimeCount: 2, daytimeWorkedMinutes: 480, collaborators: { create: collaborators.slice(0, day === week ? 2 : 1)
        .map(c => ({ collaboratorId: c.id, roleNameSnapshot: role.name })) }
    } });
    const imp = await prisma.pontoImport.create({ data: { fileName: 'PRIVATE.xlsx', contentHash: 'synthetic',
      createdAt: new Date('2026-10-12T08:00:00Z'), periodStart: new Date(week), periodEnd: new Date('2026-10-11') } });
    const days = [
      { date: week, workedMinutes: 480, he70Minutes: 60, he100Minutes: 30, nightMinutes: 120, tags: ['Etiqueta'] },
      { date: '2026-10-05', workedMinutes: 60, tags: ['Etiqueta'] }
    ];
    for (const c of collaborators.slice(0,2)) await prisma.pontoPeriodSummary.create({ data: { importId: imp.id, collaboratorId: c.id,
      rawName: 'PRIVATE_NAME', normalizedName: 'PRIVATE_NAME', periodStart: imp.periodStart, periodEnd: imp.periodEnd,
      monthly: { schemaVersion: 2, months: { '2026-09': { days: [days[0]] }, '2026-10': { days: c === collaborators[0] ? [days[1]] : [] } } } } });
    // Override prevalece sobre o alias para o segundo colaborador.
    await prisma.pontoDayProjectOverride.create({ data: { collaboratorId: collaborators[1].id, workDate: new Date(week), projectId: hidden.id } });
    assert.deepEqual((await request(`/ponto/projetos/semanas?weekStart=${week}`)).body.items, []);
    await prisma.pontoDayProjectOverride.deleteMany({});
    const page = (await request(`/ponto/projetos/semanas?from=${week}&to=2026-10-11&limit=1`)).body;
    assert.equal(page.page.hasMore, false); assert.equal(page.page.nextCursor, null);
    const row = page.items[0];
    assert.equal(row.projectId, p1.id); assert.equal(row.pessoas, 2); assert.equal(row.minutosNormais, 960);
    assert.equal(row.minutosExtra70, 120); assert.equal(row.minutosExtra100, 60); assert.equal(row.minutosNoturnos, 240);
    assert.equal(JSON.stringify(row).includes('PRIVATE'), false); assert.equal('collaboratorId' in row, false);
    // Exercise newer-import precedence without relying on database clock ticks
    // (CURRENT_TIMESTAMP can be identical inside the disposable transaction).
    const newer = await prisma.pontoImport.create({ data: { fileName: 'PRIVATE2.xlsx', contentHash: 'new',
      createdAt: new Date('2026-10-12T08:00:01Z'), periodStart: new Date(week), periodEnd: new Date(week) } });
    await prisma.pontoPeriodSummary.create({ data: { importId: newer.id, collaboratorId: collaborators[0].id, rawName: 'PRIVATE_NAME', normalizedName: 'PRIVATE_NAME',
      periodStart: newer.periodStart, periodEnd: newer.periodEnd, monthly: { schemaVersion: 2, months: { '2026-09': { days: [{ ...days[0], workedMinutes: 240 }] } } } } });
    assert.equal((await request(`/ponto/projetos/semanas?weekStart=${week}`)).body.items[0].minutosNormais, 720);
  });
  await t.test('G2 números iguais ao detalhe com salário/exclusões, estoque líquido, manuais e HH', async () => {
    await prisma.costProfile.create({ data: { key: 'operador', label: 'Modelo', parameterSets: { create: { version: 1, effectiveDate: new Date('2020-01-01'), params: { salarioBase: 3000, cargaHoraria: 220, diasUteis: 22 } } } } });
    await prisma.costProfile.create({ data: { key: 'role-b6', label: 'Operador', jobRoleId: role.id, parameterSets: { create: { version: 1, effectiveDate: new Date('2020-01-01'), params: { salarioBase: 3000 } } } } });
    await prisma.omieCategory.createMany({ data: [{ codigo: 'excluded', descricao: 'Não computar', includeInAcompanhamentoCosts: false }, { codigo: 'chemical', descricao: 'Produtos químicos' }] });
    for (const [code, description, amount] of [['hotel','Hospedagem',100],['salary','Salários',9999],['excluded','Não computar',8888],['chemical','Produtos químicos',500]]) {
      await prisma.omiePurchase.create({ data: { projectId: p1.id, omieId: code, categoriaCodigo: code, categoriaDescricao: description, valor: amount, rawPayload: {} } });
    }
    await prisma.projectManualCost.create({ data: { projectId: p1.id, description: 'PRIVATE_MANUAL', amount: '25.50' } });
    const item = await prisma.stockItem.create({ data: { type: 'PRODUTO_QUIMICO', code: 'chemical', name: 'Químico', unitLabel: 'kg' } });
    const batch = await prisma.stockBatch.create({ data: { itemId: item.id, lotNumber: 'synthetic' } });
    const romaneio = await prisma.romaneio.create({ data: { projectId: p1.id, romaneioDate: new Date(week), type: 'OUTBOUND', driverName: 'PRIVATE_NAME', vehiclePlate: 'PRIVATE_PLATE' } });
    for (const [type, reason, quantity] of [['SAIDA','USO_EM_PROJETO',10],['ENTRADA','DEVOLUCAO_OBRA',2]]) await prisma.stockMovement.create({ data: {
      itemId: item.id, batchId: batch.id, romaneioId: romaneio.id, projectId: p1.id, type, reason, quantity, unitCost: 10, date: date(week), createdById: user.id
    } });
    clearProjectDerivedCaches();
    const detail = await getProjectDetail(p1.id), expected = projectCostSummary(detail);
    const row = (await request('/acompanhamento/projetos/custos?projectCode=00501')).body.items[0];
    assert.equal(row.custoRealizado.total, new Prisma.Decimal(expected.total).toFixed(2));
    assert.equal(row.consumoDoCusto, expected.percent); assert.equal(row.avancoFisico, detail.avancoPct);
    const status = (await request('/efetivo/projetos/status?projectCode=00501')).body.items[0];
    const individual = (await request(`/efetivo/projetos/${p1.id}/status`)).body;
    assert.equal(status.progressPercent, row.avancoFisico);
    assert.equal(status.progressMethod, 'MANUAL');
    assert.equal(individual.progressPercent, status.progressPercent);
    assert.equal(individual.progressMethod, status.progressMethod);
    assert.equal(row.orcamento.custoPrevisto, new Prisma.Decimal(detail.consumo.previsto).toFixed(2));
    assert.equal(row.orcamento.precoVenda, new Prisma.Decimal(detail.faturamento.previsto).toFixed(2));
    assert.equal(row.custoRealizado.porCategoria.find(c => c.codigo === 'COMPRAS_OMIE').valor, '100.00');
    assert.equal(row.custoRealizado.porCategoria.find(c => c.codigo === 'ESTOQUE').valor, '80.00');
    assert.equal(row.custoRealizado.porCategoria.find(c => c.codigo === 'CUSTOS_MANUAIS').valor, '25.50');
    assert.ok(Number(row.custoRealizado.porCategoria.find(c => c.codigo === 'MAO_DE_OBRA').valor) > 0);
    assert.equal(JSON.stringify(row).includes('PRIVATE'), false);
    assert.equal((await request('/acompanhamento/projetos/custos', operational)).status, 403);
    assert.equal((await request('/acompanhamento/projetos/custos?projectCode=00502')).body.items[0].orcamento, null);
    await prisma.commercialProposal.create({ data: { codBd: 601, codProp: 601, parentCodProp: 501, nRev: 1, rawRow: {},
      salePrice: 1000, plannedCost: 400, expectedProfit: 600, plannedDays: 10 } });
    await prisma.projectAdditionalProposal.create({ data: { projectId: p1.id, codProp: 601, proposalCode: '601', sourceProposalCodBd: 601 } });
    await prisma.project.update({ where: { id: p1.id }, data: { proposalPercentage: 50 } });
    clearProjectDerivedCaches();
    const scaledDetail = await getProjectDetail(p1.id);
    const scaled = (await request('/acompanhamento/projetos/custos?projectCode=00501')).body.items[0];
    assert.equal(scaled.orcamento.custoPrevisto, '700.00'); assert.equal(scaled.orcamento.precoVenda, '1500.00');
    assert.equal(scaled.orcamento.margemPrevista, scaledDetail.budgetBreakdown.totals.expectedMargin);
    assert.equal(scaled.consumoDoCusto, projectCostSummary(scaledDetail).percent);
    await prisma.projectBudget.update({ where: { projectId_version: { projectId: p1.id, version: 1 } }, data: { plannedTotalCost: 0 } });
    await prisma.projectAdditionalProposal.deleteMany({ where: { projectId: p1.id } });
    clearProjectDerivedCaches();
    assert.equal((await request('/acompanhamento/projetos/custos?projectCode=00501')).body.items[0].consumoDoCusto, null);
  });
  await t.test('avanço por RDO e alteração só na fonte mantêm paridade e sincronização; cursor atravessa a segunda-feira', async () => {
    await prisma.projectPlannedService.create({ data: { projectId: p2.id, serviceType: 'LIMPEZA_QUIMICA',
      systems: { create: { systemType: 'TUBULACAO', quantity: 100, unit: 'M' } } } });
    let lastService;
    for (const [day, amount] of [['2026-09-27',25],['2026-09-30',50]]) {
      const report = await prisma.report.create({ data: { projectId: p2.id, reportType: 'RDO', status: 'APPROVED', reportDate: new Date(day),
        arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 0 } });
      lastService = await prisma.reportService.create({ data: { reportId: report.id, finalized: true, serviceType: 'limpeza_quimica',
        extraData: { tubes: [{ c: String(amount), lengthUnit: 'm' }] } } });
    }
    let row = (await request(`/acompanhamento/projetos/semanas?projectCode=00502&weekStart=${week}`)).body.items[0];
    assert.equal(row.avancoInicio, 25); assert.equal(row.avancoFim, 75);
    const since = new Date().toISOString();
    const before = await prisma.project.findUnique({ where: { id: p2.id } });
    await prisma.reportService.update({ where: { id: lastService.id }, data: { extraData: { tubes: [{ c: '60', lengthUnit: 'm' }] } } });
    row = (await request(`/acompanhamento/projetos/semanas?projectCode=00502&weekStart=${week}&updatedSince=${encodeURIComponent(since)}`)).body.items[0];
    assert.equal(row.avancoFim, 85); assert.equal(+(await prisma.project.findUnique({ where: { id: p2.id } })).updatedAt, +before.updatedAt);
    const detail = await getProjectDetail(p2.id);
    assert.equal(detail.avancoPct, row.avancoFim);
    assert.equal((await request('/acompanhamento/projetos/custos?projectCode=00502')).body.items[0].avancoFisico, detail.avancoPct);
    const status = (await request('/efetivo/projetos/status?projectCode=00502')).body.items[0];
    const individual = (await request(`/efetivo/projetos/${p2.id}/status`)).body;
    assert.equal(status.progressPercent, detail.avancoPct);
    assert.equal(status.progressMethod, 'RDO');
    assert.equal(individual.progressPercent, status.progressPercent);
    assert.equal(individual.progressMethod, status.progressMethod);
    const context = { scopes: new Set(['acompanhamento.progresso.read']), credentialId: full.credential.id,
      projectAccessMode: 'SELECTED', projectIds: new Set([p1.id,p2.id]), projectCodes: new Set([p1.code,p2.code]), cursorKey: key,
      snapshotAt: new Date('2026-11-02T01:00:00Z') };
    const first = await listOperationalResources(prisma, 'acompanhamento.projects.weeks.list', { limit: 1 }, context);
    assert.equal(first.items[0].weekStart, '2026-10-26');
    const next = await listOperationalResources(prisma, 'acompanhamento.projects.weeks.list', { limit: 1, cursor: first.page.nextCursor },
      { ...context, snapshotAt: new Date('2026-11-02T04:00:00Z') });
    assert.equal(next.items[0].weekStart, '2026-10-26'); assert.equal(next.items[0].projectId, p2.id);
    await prisma.project.update({ where: { id: p2.id }, data: { contractCode: '999999', commercialProposalCode: null } });
    clearProjectDerivedCaches();
    const unlinked = (await request('/acompanhamento/projetos/custos?projectCode=00502')).body.items[0];
    assert.equal(unlinked.orcamento, null); assert.equal(unlinked.avancoFisico, 85);
  });
  await t.test('escopos e recorte em todas as operações, datas inválidas, feed por família e rollback', async () => {
    for (const resource of MANAGEMENT_RESOURCES) {
      assert.equal((await request(resource.path, noScope)).status, 403, resource.path);
      assert.equal((await request(resource.path + '?projectCode=00500')).status, 403, resource.path);
      assert.equal((await request(resource.path + '?projectId=' + hidden.id)).status, 403, resource.path);
      assert.equal((await request(resource.path + '?projectCode=00501&projectId=' + p1.id)).status, 400, resource.path);
    }
    for (const query of ['weekStart=2026-02-30','weekStart=2026-09-29','from=2026-01-01&to=2026-09-30','weekStart='+week+'&from='+week+'&to='+week]) {
      assert.equal((await request('/acompanhamento/projetos/semanas?' + query)).status, 400);
    }
    for (const [scope, types] of [['acompanhamento.progresso.read',['acompanhamento.meta_alterada','acompanhamento.revisao_concluida']], ['efetivo.alocacoes.read',['alocacao.alterada']]]) {
      const auth = await issue([scope, 'eventos.read']); const items = (await request('/eventos', auth)).body.items;
      assert.ok(items.length > 0); assert.ok(items.every(row => row.projectId !== hidden.id && types.includes(row.type)));
      assert.equal(JSON.stringify(items).includes('PRIVATE'), false);
    }
    assert.deepEqual((await request('/eventos', noScope)).body.items, []);
    const count = await prisma.integrationEvent.count();
    await prisma.projectExecutionWeeklyReview.update({ where: { projectId_weekStartDate: { projectId: p1.id, weekStartDate: new Date(week) } }, data: { note: 'PRIVATE_EDIT' } });
    assert.equal(await prisma.integrationEvent.count(), count);
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.missionWeeklyProgressTarget.create({ data: { projectId: p1.id, weekStartDate: new Date('2026-10-05'), plannedPctPoints: 20, createdByName: 'PRIVATE_AUTHOR' } });
      await tx.efetivoMissionAllocation.update({ where: { id: allocation.id }, data: { deletedAt: null } });
      throw new Error('rollback B6');
    }), /rollback B6/);
    assert.equal(await prisma.integrationEvent.count(), count);
    const playground = await executePlaygroundOperation(prisma, operational.credential.id, { operationId: 'acompanhamento.projects.weeks.list', query: { weekStart: week } }, { cursorKey: key });
    assert.equal(playground.response.status, 200); assert.equal(playground.response.body.schemaVersion, '1.0');
  });
});
