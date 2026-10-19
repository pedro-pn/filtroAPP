import assert from 'node:assert/strict';
import test from 'node:test';
import { randomInt, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import prisma from '../src/lib/prisma.js';
import env from '../src/config/env.js';
import { listCommercialDashboard, setProjectBudgetRevision } from '../src/lib/acompanhamento/access-import.js';
import { loadPlannedHours } from '../src/lib/acompanhamento/planned-hours.js';
import { syncCommercialProposal, requestAdditionalProposalQuery } from '../src/lib/projects/commercial-proposal-sync.js';
import { selectCommercialAppRevision } from '../src/lib/acompanhamento/comercialapp-bridge.js';
import { rawHours } from './helpers/commercial-additional-fixture.js';

const source = process.env.COMMERCIALAPP_SOURCE_DIR;
const commercialUrl = process.env.COMMERCIALAPP_TEST_DATABASE_URL;
test('homologação isolada: produtor real consulta e push v3, composição, PDFs, perda de ACK e resposta atrasada', {
  skip: !process.env.TEST_DATABASE_URL || !commercialUrl || !source
}, async t => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/filtroapp_bridge_test');
  assert.equal(new URL(commercialUrl).pathname, '/comercialapp_test');
  assert.equal(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL);
  const load = relative => import(pathToFileURL(path.join(source, relative)).href);
  const [{ createDatabase }, { createApp }, { payloadHash }, { storeFile },
    { recordManualSelection, deliverToFiltro }, { withCostConfiguration }, model] = await Promise.all([
    load('backend/src/db.js'), load('backend/src/app.js'), load('backend/src/comercial/documents.js'),
    load('backend/src/comercial/storage.js'), load('backend/src/comercial/crm-bridge.js'),
    load('backend/src/comercial/cost-configuration.js'), load('shared/comercial/dist/cost-model.js')
  ]);
  const commercial = createDatabase(commercialUrl), oldEnv = { ...process.env };
  const oldConfig = { token: env.comercialAppServiceToken, contract: env.comercialAppAdditionalContract };
  const commercialDir = await mkdtemp(path.join(tmpdir(), 'real-commercial-v3-'));
  const filtroDir = await mkdtemp(path.join(tmpdir(), 'real-filtro-v3-'));
  process.env.COMERCIAL_DIR = commercialDir;
  process.env.FILTROAPP_API_TOKEN = 'isolated-contract-test-token';
  env.comercialAppServiceToken = process.env.FILTROAPP_API_TOKEN;
  env.comercialAppAdditionalContract = '';
  const code = randomInt(100_000_000, 200_000_000), proposalIds = [];
  let producer, consumer, project, user, manager;
  t.after(async () => {
    for (const server of [producer, consumer]) if (server) await new Promise(resolve => server.close(resolve));
    if (project) {
      await prisma.commercialAppDelivery.deleteMany({ where: { externalId: { in: proposalIds } } });
      await prisma.projectDocumentVersion.deleteMany({ where: { document: { projectId: project.id } } });
      await prisma.projectDocument.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
    await prisma.commercialProposal.deleteMany({ where: { codProp: code } });
    if (manager) await prisma.user.delete({ where: { id: manager.id } });
    if (user) {
      await commercial.proposal.deleteMany({ where: { createdByUserId: user.id } });
      await commercial.additionalProposal.deleteMany({ where: { createdByUserId: user.id } });
      await commercial.costEstimate.deleteMany({ where: { createdByUserId: user.id } });
      await commercial.user.delete({ where: { id: user.id } });
    }
    await commercial.$disconnect(); await prisma.$disconnect();
    await Promise.all([rm(commercialDir, { recursive: true, force: true }), rm(filtroDir, { recursive: true, force: true })]);
    env.comercialAppServiceToken = oldConfig.token; env.comercialAppAdditionalContract = oldConfig.contract;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  });
  const { default: app } = await import('../src/app.js');
  consumer = app.listen(0, '127.0.0.1'); await once(consumer, 'listening');
  process.env.FILTROAPP_API_URL = `http://127.0.0.1:${consumer.address().port}`;
  const prefix = `${process.env.FILTROAPP_API_URL}/api/acompanhamento/comercial`;
  const bearer = { Authorization: `Bearer ${env.comercialAppServiceToken}` };
  assert.equal((await fetch(`${prefix}/comercialapp/capabilities`)).status, 401);
  assert.equal((await (await fetch(`${prefix}/comercialapp/capabilities`, { headers: bearer })).json()).additionalProposals, false);
  // Habilitação somente nesta instância isolada, após os testes de composição.
  env.comercialAppAdditionalContract = '3'; process.env.FILTROAPP_ADDITIONAL_CONTRACT = '3';
  assert.deepEqual(await (await fetch(`${prefix}/comercialapp/capabilities`, { headers: bearer })).json(),
    { contractVersion: 3, additionalProposals: true, budgetMode: 'CONTRIBUTIONS' });
  project = await prisma.project.create({ data: { code: `real-v3-${randomUUID()}`, name: 'Homologação real',
    clientName: 'Cliente QA', clientCnpj: '12345678000190', contractCode: String(code), commercialProposalCode: String(code), location: 'Sede' } });
  await prisma.commercialProposal.create({ data: { codBd: code, codProp: code, clientCnpj: project.clientCnpj,
    salePrice: 100_000, plannedCost: 60_000, expectedProfit: 40_000, rawRow: rawHours(1000), isComplete: true } });
  await setProjectBudgetRevision(project.id, code);
  user = await commercial.user.create({ data: { username: `v3-${randomUUID()}`, name: 'Gestor QA', role: 'ADMIN' } });
  manager = await prisma.user.create({ data: { username: `v3-${randomUUID()}`, name: 'Gestor QA', role: 'MANAGER', passwordHash: 'synthetic',
    accountType: 'INTERNAL', moduleRoles: { create: { module: 'ACOMPANHAMENTO', role: 'ACOMPANHAMENTO_MANAGER' } } } });
  const session = randomUUID();
  await prisma.userSession.create({ data: { userId: manager.id, tokenHash: createHash('sha256').update(session).digest('hex'), expiresAt: new Date(Date.now() + 600_000) } });
  const relation = async number => commercial.additionalProposal.create({ data: { proposalCode: String(number), parentProposalCode: String(code),
    sourceRevisionNumber: 0, sourceProposalId: null, legacyReferenceReason: 'Mãe Access conferida', clientCnpj: project.clientCnpj,
    filtroProjectId: project.id, prismaProjectId: 'prisma-isolated-project', copyMode: 'EMPTY', idempotencyKey: randomUUID(),
    requestHash: randomUUID(), createdByUserId: user.id } });
  return withCostConfiguration(commercial, async () => {
    async function createRevision(additional, revisionNumber, salePrice) {
      const cost = model.createDefaultCostEstimatePayload();
      cost.volumeSystems = [{ id: 'circuit', name: 'Caldeira', enabled: true,
        pipeSegments: [{ id: 'pipe', description: 'Linha', quantity: 1, lengthM: salePrice / 1000, internalDiameterMm: 50.8, diameterUnit: 'in' }] }];
      cost.circuitServices = [{ systemId: 'circuit', itemId: 'pipe', itemType: 'pipes', serviceId: 'teste_hidrostatico' }];
      cost.laborContexts[0].durationDays = 1 + revisionNumber;
      const result = model.calculateEstimate(cost);
      const estimate = await commercial.costEstimate.create({ data: { proposalCode: additional?.proposalCode ?? String(code), revisionNumber,
        title: 'Somente adicional', mode: 'NOVA', status: 'SALVO', payload: cost, totalCost: result.totalCost,
        salePrice: result.salePrice, marginPercent: result.margin * 100, createdByUserId: user.id } });
      const proposal = await commercial.proposal.create({ data: { proposalCode: additional?.proposalCode ?? String(code), revisionNumber,
        additionalProposalId: additional?.id ?? null, costEstimateId: estimate.id, clientName: 'Cliente QA', cnpj: project.clientCnpj,
        contact: '', email: '', site: 'Sede', sellerUserId: user.id, sellerName: 'Gestor QA', estimatorName: 'Gestor QA',
        totalValue: salePrice, status: 'FINALIZADA', finalizedAt: new Date(), createdByUserId: user.id,
        payload: { title: 'Extra escopo', technicalServices: [{ serviceId: 'teste_hidrostatico' }], scopeItems: [{ title: 'Teste de pressão' }] } } });
      proposalIds.push(proposal.id);
      const generationId = randomUUID();
      for (const kind of ['COMERCIAL', 'TECNICA']) {
        const pdf = await PDFDocument.create(); pdf.addPage().drawText(`${proposal.proposalCode} rev ${revisionNumber} ${kind}`);
        const bytes = Buffer.from(await pdf.save());
        const stored = await storeFile(`${proposal.id}/${kind}.pdf`, bytes);
        await commercial.proposalDocument.create({ data: { proposalId: proposal.id, generationId, payloadHash: payloadHash({ ...proposal, additionalProposal: additional }), kind, format: 'PDF', ...stored } });
      }
      return proposal;
    }
    await createRevision(null, 0, 100_000);
    const a = await relation(code + 1), b = await relation(code + 2);
    const a0 = await createRevision(a, 0, 20_000), a1 = await createRevision(a, 1, 25_000), b0 = await createRevision(b, 0, 5_000);
    producer = createApp({ commercialDb: commercial, authService: {}, appOrigin: 'http://localhost' }).listen(0, '127.0.0.1');
    await once(producer, 'listening');
    const apiUrl = `http://127.0.0.1:${producer.address().port}`;
    let transactionError;
    const database = new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return async (...args) => {
        try { return await target.$transaction(...args); } catch (error) { transactionError = error; throw error; }
      };
      return target[key];
    } });
    const options = { database, apiUrl, token: process.env.FILTROAPP_API_TOKEN, production: false, rootDir: filtroDir };
    const referenceUrl = `${apiUrl}/api/integrations/filtroapp/propostas/${a.proposalCode}/revisoes/0`;
    assert.equal((await fetch(referenceUrl, { headers: bearer })).status, 409, 'produtor real exige header v3');
    const mainQuery = await syncCommercialProposal(project.id, options);
    assert.equal(mainQuery.status, 'SYNCED', JSON.stringify({ mainQuery, error: transactionError?.message }));
    const job = await requestAdditionalProposalQuery(project.id, { proposalCode: a.proposalCode, revisionNumber: 0 });
    const queried = await syncCommercialProposal(project.id, { ...options, jobId: job.id });
    assert.equal(queried.status, 'SYNCED', JSON.stringify({ queried, error: transactionError?.message }));
    assert.equal(await prisma.projectAdditionalProposal.count({ where: { projectId: project.id } }), 0, 'consultar não seleciona');
    assert.equal((await prisma.commercialAppProposal.findUnique({ where: { externalId: a0.id } })).approvedAt, null);
    const total = async expected => {
      const [row] = await listCommercialDashboard({ projectIds: [project.id], includeProgress: false });
      assert.equal(Number(row.salePrice), expected); assert.equal(Number(row.originalSalePrice), 100_000);
      const selected = await prisma.commercialAppProposal.findMany({ where: { projectId: project.id, selectionStatus: 'SELECTED' } });
      assert.equal(Number(row.plannedTotalCost), 60_000 + selected.reduce((sum, p) => sum + Number(p.plannedTotalCost), 0));
      assert.equal((await loadPlannedHours([project.id])).get(project.id).hoursPlan.commercial.total,
        1000 + selected.reduce((sum, p) => sum + p.snapshot.estimateSummary.hours.total, 0));
    };
    await recordManualSelection(commercial, user, a0.id, { projectId: project.id, reason: 'Aceite independente QA' });
    let loseAck = true;
    const deliveries = [];
    const transport = async (url, request) => {
      const response = await fetch(url, request);
      if (request?.method === 'POST') {
        const body = await response.clone().json(); deliveries.push({ request: JSON.parse(request.body), response: body });
        if (loseAck) { loseAck = false; await response.arrayBuffer(); throw new Error('ACK perdido após commit real'); }
      }
      return response;
    };
    assert.equal((await deliverToFiltro(commercial, a0.id, transport)).status, 'ERRO'); await total(120_000);
    assert.equal((await deliverToFiltro(commercial, a0.id, transport)).status, 'SUCESSO'); await total(120_000);
    assert.equal(deliveries[0].request.eventId, deliveries[1].request.eventId);
    assert.equal(deliveries[1].response.duplicate, true);
    const conflicting = await fetch(`${prefix}/comercialapp/propostas`, { method: 'POST',
      headers: { ...bearer, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...deliveries[0].request, title: 'Evento alterado' }) });
    assert.equal(conflicting.status, 409);
    const selectUrl = `${prefix}/projetos/${project.id}/comercialapp/selecionar`;
    assert.equal((await fetch(selectUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalId: a0.id, expectedSelectionVersion: 1 }) })).status, 401);
    // Buscar a revisão selecionada não duplica os PDFs já trazidos pela consulta.
    let currentJob = await prisma.commercialProposalSyncJob.findUnique({ where: { id: job.id } });
    assert.equal((await syncCommercialProposal(project.id, { ...options, jobId: currentJob.id })).status, 'SYNCED');
    await recordManualSelection(commercial, user, a1.id, { projectId: project.id, reason: 'Revisão QA' });
    assert.equal((await deliverToFiltro(commercial, a1.id)).status, 'SUCESSO'); await total(125_000);
    currentJob = await prisma.commercialProposalSyncJob.findUnique({ where: { id: job.id } });
    assert.equal((await syncCommercialProposal(project.id, { ...options, jobId: currentJob.id })).status, 'SYNCED');
    await recordManualSelection(commercial, user, b0.id, { projectId: project.id, reason: 'Adicional B QA' });
    assert.equal((await deliverToFiltro(commercial, b0.id)).status, 'SUCESSO'); await total(130_000);
    const jobB = await prisma.commercialProposalSyncJob.findUnique({ where: { projectId_proposalCode: { projectId: project.id, proposalCode: b.proposalCode } } });
    assert.equal((await syncCommercialProposal(project.id, { ...options, jobId: jobB.id })).status, 'SYNCED');
    const scopeRows = await prisma.projectPlannedService.findMany({ where: { projectId: project.id }, include: { systems: true } });
    assert.deepEqual(scopeRows.map(row => [row.contributionKey, Number(row.systems[0].quantity)]).sort(),
      [[`COMERCIAL_APP:${code}`, 100], [`COMERCIAL_APP:${a.proposalCode}`, 25], [`COMERCIAL_APP:${b.proposalCode}`, 5]].sort());
    assert.equal(await prisma.projectDocument.count({ where: { projectId: project.id } }), 6, 'tipos de adicionais têm identidades distintas');
    assert.equal(await prisma.projectDocumentVersion.count({ where: { document: { projectId: project.id } } }), 8, 'revisões preservam histórico');
    const versions = await prisma.projectDocumentVersion.findMany({ where: { document: { projectId: project.id } } });
    for (const version of versions) {
      assert.match(version.externalId, new RegExp(`^comercialapp:(${code}|${a.proposalCode}|${b.proposalCode}):`));
      const bytes = await readFile(path.join(filtroDir, version.storagePath));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), version.sha256);
      assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    }
    // Resposta que termina depois de uma troca manual não pode alterar orçamento, escopo ou documentos atuais.
    await requestAdditionalProposalQuery(project.id, { proposalCode: a.proposalCode, revisionNumber: 0 });
    let switched = false;
    const stale = await syncCommercialProposal(project.id, { ...options, jobId: job.id, transport: async (url, request) => {
      const response = await fetch(url, request);
      if (!switched && url.endsWith('/revisoes/0')) {
        switched = true;
        const selection = await prisma.projectAdditionalProposal.findUnique({ where: { projectId_source_proposalCode: {
          projectId: project.id, source: 'COMERCIAL_APP', proposalCode: a.proposalCode } } });
        await selectCommercialAppRevision(project.id, a0.id, manager.id, { expectedSelectionVersion: selection.selectionVersion,
          allowOlderRevision: true, reason: 'QA concorrência explícita' });
      }
      return response;
    } });
    assert.equal(stale.status, 'SUPERSEDED');
    assert.equal((await prisma.projectAdditionalProposal.findUnique({ where: { projectId_source_proposalCode: {
      projectId: project.id, source: 'COMERCIAL_APP', proposalCode: a.proposalCode } } })).commercialAppProposalId, a0.id);
    const beforeRemoval = await prisma.projectAdditionalProposal.findUnique({ where: { projectId_source_proposalCode: {
      projectId: project.id, source: 'COMERCIAL_APP', proposalCode: a.proposalCode } } });
    const removed = await fetch(`${prefix}/projetos/${project.id}/comercialapp/remover-adicional`, { method: 'POST',
      headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
        proposalCode: a.proposalCode, expectedSelectionVersion: beforeRemoval.selectionVersion, reason: 'Homologação da remoção operacional explícita'
      }) });
    assert.equal(removed.status, 200, await removed.text()); await total(105_000);
    assert.equal(await prisma.projectDocumentVersion.count({ where: { document: { projectId: project.id } } }), 8);
    assert.equal(await prisma.projectPlannedService.count({ where: { projectId: project.id, contributionKey: `COMERCIAL_APP:${a.proposalCode}` } }), 0);
    const replay = await fetch(`${prefix}/comercialapp/propostas`, { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify(deliveries[0].request) });
    assert.equal(replay.status, 200); await total(105_000);
    // ACKs e payloads reais ficam disponíveis no relatório TAP sem dados privados.
    t.diagnostic(JSON.stringify({ producerCommit: '109efb4', totals: [120000, 125000, 130000],
      duplicateAck: deliveries[1].response, documents: { identities: 6, versions: 8 }, costsAndHours: 'checked', explicitRemovalTotal: 105000 }));
  });
});
