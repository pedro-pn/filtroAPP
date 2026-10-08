import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import prisma from '../src/lib/prisma.js';
import { receiveProjectIntake } from '../src/lib/projects/project-intake.js';
import { commercialProposalSyncData } from '../src/lib/projects/commercial-proposal-sync-state.js';
import { processCommercialProposalSyncs, syncCommercialProposal } from '../src/lib/projects/commercial-proposal-sync.js';
import { listProjectDocuments } from '../src/lib/efetivo/project-workflow/documents.js';
import { setProjectBudgetRevisionWithClient } from '../src/lib/acompanhamento/access-import.js';

const commercialUrl = process.env.COMMERCIALAPP_TEST_DATABASE_URL;
const source = process.env.COMMERCIALAPP_SOURCE_DIR;

test('FiltroAPP busca revisão e PDFs no ComercialAPP, anexa no handover e importa escopo sem aprovação prévia', {
  skip: !process.env.TEST_DATABASE_URL || !commercialUrl || !source
}, async t => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/filtroapp_bridge_test');
  assert.equal(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL);
  assert.equal(new URL(commercialUrl).pathname, '/comercialapp_test');
  const load = relative => import(pathToFileURL(path.join(source, relative)).href);
  const { createDatabase } = await load('backend/src/db.js');
  const { createApp } = await load('backend/src/app.js');
  const { payloadHash } = await load('backend/src/comercial/documents.js');
  const { storeFile } = await load('backend/src/comercial/storage.js');
  const commercial = createDatabase(commercialUrl);
  const commercialDir = await mkdtemp(path.join(tmpdir(), 'commercial-pull-source-'));
  const filtroDir = await mkdtemp(path.join(tmpdir(), 'commercial-pull-target-'));
  const previous = { token: process.env.FILTROAPP_API_TOKEN, directory: process.env.COMERCIAL_DIR };
  process.env.FILTROAPP_API_TOKEN = 'synthetic-pull-integration-token';
  process.env.COMERCIAL_DIR = commercialDir;
  let server, project, user;
  const number = String(1_000_000 + Math.floor(Math.random() * 1_000_000));
  const projectCode = `PULL-${randomUUID().slice(0, 8)}`;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (project) {
      await prisma.projectDocumentVersion.deleteMany({ where: { document: { projectId: project.id } } });
      await prisma.projectDocument.deleteMany({ where: { projectId: project.id } });
      await prisma.projectPlannedService.deleteMany({ where: { projectId: project.id } });
      await prisma.projectServiceSystem.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
    await prisma.commercialProposal.deleteMany({ where: { codProp: Number(number) } });
    if (user) {
      await commercial.proposal.deleteMany({ where: { createdByUserId: user.id } });
      await commercial.costEstimate.deleteMany({ where: { createdByUserId: user.id } });
      await commercial.user.delete({ where: { id: user.id } });
    }
    await commercial.$disconnect();
    await prisma.$disconnect();
    await rm(commercialDir, { recursive: true, force: true });
    await rm(filtroDir, { recursive: true, force: true });
    if (previous.token === undefined) delete process.env.FILTROAPP_API_TOKEN; else process.env.FILTROAPP_API_TOKEN = previous.token;
    if (previous.directory === undefined) delete process.env.COMERCIAL_DIR; else process.env.COMERCIAL_DIR = previous.directory;
  });
  user = await commercial.user.create({ data: { username: `pull-${randomUUID()}`, name: 'Synthetic QA', role: 'ADMIN' } });
  async function createRevision(revisionNumber, lengthM) {
    const cost = { volumeSystems: [{ id: 'circuit-1', name: 'Caldeira A', enabled: true,
      pipeSegments: [{ id: 'pipe-1', description: 'Linha de vapor', quantity: 2, lengthM,
        internalDiameterMm: 50.8, diameterUnit: 'in' }] }],
    circuitServices: [{ systemId: 'circuit-1', itemId: 'pipe-1', itemType: 'pipes', serviceId: 'teste_hidrostatico' }] };
    const estimate = await commercial.costEstimate.create({ data: {
      proposalCode: number, revisionNumber, title: 'Synthetic estimate', mode: 'NOVA', payload: cost,
      totalCost: 900, salePrice: 1500, marginPercent: 40, createdByUserId: user.id
    } });
    const proposal = await commercial.proposal.create({ data: {
      proposalCode: number, revisionNumber, status: 'FINALIZADA', finalizedAt: new Date(),
      clientName: 'Cliente QA', cnpj: '12345678000190', contact: 'Contato', email: 'qa@example.invalid', site: 'Sede',
      sellerUserId: user.id, sellerName: 'Vendedor', estimatorName: 'Orçamentista', totalValue: 1500, createdByUserId: user.id,
      costEstimateId: estimate.id, payload: { title: 'Synthetic proposal',
        scopeItems: [{ id: 'scope-1', title: 'Teste de pressão' }], technicalServices: [{ serviceId: 'teste_hidrostatico' }] }
    } });
    const generationId = randomUUID();
    for (const kind of ['COMERCIAL', 'TECNICA']) {
      const bytes = Buffer.from(`%PDF-1.7\n${number}:${revisionNumber}:${kind}\n%%EOF`);
      const stored = await storeFile(`${proposal.id}/${kind}.pdf`, bytes);
      await commercial.proposalDocument.create({ data: {
        proposalId: proposal.id, generationId, payloadHash: payloadHash(proposal), kind, format: 'PDF', ...stored
      } });
    }
    return proposal;
  }
  await createRevision(0, 30);
  server = createApp({ commercialDb: commercial, authService: {}, appOrigin: 'http://localhost' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  let transactionError;
  const database = new Proxy(prisma, { get(target, key) {
    if (key === '$transaction') return async (...args) => {
      try { return await target.$transaction(...args); }
      catch (error) { transactionError = error; throw error; }
    };
    return target[key];
  } });
  const options = { database, rootDir: filtroDir, production: false,
    apiUrl: `http://127.0.0.1:${server.address().port}`, token: process.env.FILTROAPP_API_TOKEN };
  const intake = { code: projectCode, name: 'Projeto QA', clientName: 'Cliente QA', clientCnpj: '12345678000190',
    proposalCode: number, revision: 0, location: 'Sede' };
  const received = await receiveProjectIntake(intake);
  project = received.project;
  assert.equal(received.status, 'created');
  const [first] = await processCommercialProposalSyncs(options);
  assert.equal(first.status, 'SYNCED');
  assert.equal(first.scope.status, 'IMPORTED');
  const docs = await listProjectDocuments(project.id, { includeHistory: true }, { isManager: true }, { database: prisma, rootDir: filtroDir });
  assert.equal(docs.documents.length, 2);
  assert.ok(docs.documents.every(document => document.requirementStage === 'HANDOVER' && document.readiness.ready));
  assert.ok(docs.documents.every(document => document.currentVersion.downloadUrl && !document.permissions.addVersion));
  const version = await prisma.projectDocumentVersion.findFirst({ where: { document: { projectId: project.id } } });
  assert.equal((await readFile(path.join(filtroDir, version.storagePath))).subarray(0, 5).toString(), '%PDF-');
  assert.ok(!version.storagePath.includes(options.token));
  const scope = () => prisma.projectPlannedService.findMany({ where: { projectId: project.id }, include: { systems: true } });
  assert.equal(Number((await scope())[0].systems[0].quantity), 60);
  assert.equal((await syncCommercialProposal(project.id, options)).status, 'SKIPPED');
  assert.equal(await prisma.projectDocumentVersion.count({ where: { document: { projectId: project.id } } }), 2);

  await createRevision(1, 45);
  const updated = await receiveProjectIntake({ ...intake, revision: 1 });
  assert.equal(updated.status, 'updated');
  assert.equal(updated.project.id, project.id);
  assert.equal((await syncCommercialProposal(project.id, options)).status, 'SYNCED');
  assert.equal(Number((await scope())[0].systems[0].quantity), 90);
  assert.equal(await prisma.projectDocumentVersion.count({ where: { document: { projectId: project.id } } }), 4);

  // A escolha manual de uma revisão Access também agenda a busca da revisão exata.
  const access = await prisma.commercialProposal.create({ data: {
    codBd: Number(number), codProp: Number(number), nRev: 0, rawRow: {}, clientName: 'Cliente QA'
  } });
  await setProjectBudgetRevisionWithClient(prisma, project.id, access.codBd);
  assert.equal((await prisma.project.findUnique({ where: { id: project.id } })).commercialProposalSync.revisionNumber, 0);
  const manualResult = await syncCommercialProposal(project.id, options);
  assert.equal(manualResult.status, 'SYNCED', transactionError?.message || JSON.stringify(manualResult));
  assert.equal(await prisma.projectDocumentVersion.count({ where: { document: { projectId: project.id } } }), 4);
  const rolledBack = await listProjectDocuments(project.id, {}, { isManager: true }, { database: prisma, rootDir: filtroDir });
  assert.ok(rolledBack.documents.every(document => document.currentVersion.versionLabel.endsWith('Rev. 0')));

  // A resposta de uma busca antiga não substitui uma nova decisão durante o download.
  await prisma.project.update({ where: { id: project.id }, data: commercialProposalSyncData({ proposalCode: number, revisionNumber: 1 }) });
  let superseded = false;
  const result = await syncCommercialProposal(project.id, { ...options, transport: async (url, request) => {
    const response = await fetch(url, request);
    if (!superseded && url.includes('/documentos/')) {
      superseded = true;
      await prisma.project.update({ where: { id: project.id }, data: commercialProposalSyncData({ proposalCode: number, revisionNumber: 2 }) });
    }
    return response;
  } });
  assert.equal(result.status, 'SUPERSEDED');
  assert.equal((await prisma.project.findUnique({ where: { id: project.id } })).commercialProposalSync.revisionNumber, 2);
  const missing = await syncCommercialProposal(project.id, options);
  assert.equal(missing.errorCode, 'COMERCIALAPP_HTTP_404');
  assert.ok((await prisma.project.findUnique({ where: { id: project.id } })).commercialProposalSyncNextAttemptAt > new Date());

  await createRevision(2, 60);
  await prisma.project.update({ where: { id: project.id }, data: { commercialScopeImport: { status: 'MANUAL_OVERRIDE' } } });
  const rolledBackTransaction = await syncCommercialProposal(project.id, { ...options,
    database: new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return (operation, transactionOptions) => target.$transaction(async tx => {
        await operation(tx);
        throw new Error('Synthetic rollback after importing documents and scope');
      }, transactionOptions);
      return target[key];
    } })
  });
  assert.equal(rolledBackTransaction.status, 'ERROR');
  assert.equal(await prisma.projectDocumentVersion.count({ where: { document: { projectId: project.id } } }), 4);
  assert.equal((await readdir(filtroDir, { recursive: true })).filter(file => file.endsWith('.pdf')).length, 4);
  const preserved = await syncCommercialProposal(project.id, options);
  assert.equal(preserved.status, 'SYNCED');
  assert.equal(preserved.scope.status, 'MANUAL_PRESERVED');
  assert.equal(Number((await scope())[0].systems[0].quantity), 60);
  assert.equal(await prisma.projectDocumentVersion.count({ where: { document: { projectId: project.id } } }), 6);
  const files = await readdir(filtroDir, { recursive: true });
  assert.equal(files.filter(file => file.endsWith('.pdf')).length, 6);
});
