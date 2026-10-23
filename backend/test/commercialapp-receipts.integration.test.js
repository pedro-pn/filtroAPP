import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import prisma from '../src/lib/prisma.js';
import { commercialProposalSyncData } from '../src/lib/projects/commercial-proposal-sync-state.js';
import { syncCommercialProposal } from '../src/lib/projects/commercial-proposal-sync.js';
import { processCommercialReceipts } from '../src/lib/projects/commercialapp-receipts.js';
import { prepareStoredCommercialReceipt } from '../src/lib/projects/commercialapp-receipt-backfill.js';
import { selectCommercialAppRevision } from '../src/lib/acompanhamento/comercialapp-bridge.js';

const databaseUrl = process.env.COMMERCIAL_RECEIPT_TEST_DATABASE_URL;
test('PostgreSQL e HTTP: confirmações após commit, retentativa independente e reconciliação dirigida', { skip: !databaseUrl }, async t => {
  assert.equal(process.env.DATABASE_URL, databaseUrl);
  const target = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
  assert.match(target.pathname, /^\/filtroapp_[a-z0-9_]*test[a-z0-9_]*$/);
  const rootDir = await mkdtemp(path.join(tmpdir(), 'filtro-receipts-'));
  const projects = [], fixtures = new Map(), received = new Map(), posts = [];
  let nextCode = 970_000_000;
  let responseMode = 'normal';
  const server = createServer(async (request, response) => {
    const reply = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
    try {
      if (request.headers.authorization !== 'Bearer synthetic-receipt-token') return reply(401, {});
      const match = /^\/api\/integrations\/filtroapp\/propostas\/(\d+)\/revisoes\/(\d+)(.*)$/.exec(request.url);
      const fixture = match && fixtures.get(match[1]);
      if (!fixture || Number(match[2]) !== fixture.bundle.revisionNumber) return reply(404, {});
      if (request.method === 'GET') {
        if (!match[3]) return reply(200, fixture.bundle);
        response.writeHead(200, { 'Content-Type': 'application/pdf' }); response.end(fixture.bytes); return;
      }
      assert.equal(match[3], '/recebimento');
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      posts.push(payload);
      // A separate connection sees the imported documents: the transaction has committed.
      assert.equal(await prisma.projectDocumentVersion.count({ where: { document: { projectId: payload.projectId } } }), fixture.bundle.documents.length);
      assert.equal((await prisma.project.findUnique({ where: { id: payload.projectId } })).commercialProposalSync.status, 'SYNCED');
      assert.deepEqual(payload.documents, fixture.bundle.documents.map(({ id, kind, sha256 }) => ({ id, kind, sha256 })));
      assert.equal(payload.generationId, fixture.bundle.documents[0].generationId);
      assert.deepEqual(Object.keys(payload).sort(), ['contractVersion', 'source', 'eventId', 'proposalId', 'projectId', 'generationId',
        'importedAt', 'budgetStatus', 'scopeStatus', 'documents'].sort(), 'contrato estrito do receptor');
      if (responseMode === 'conflict') return reply(409, { error: 'private upstream body must not be stored' });
      const ack = received.get(payload.eventId) || {
        contractVersion: 1, eventId: payload.eventId, proposalId: payload.proposalId, proposalCode: fixture.bundle.proposalCode,
        revisionNumber: fixture.bundle.revisionNumber, projectId: payload.projectId, generationId: payload.generationId,
        importedAt: payload.importedAt, budgetStatus: payload.budgetStatus, scopeStatus: payload.scopeStatus,
        deliveryStatus: payload.budgetStatus === 'SELECTED' ? 'SUCESSO' : 'AGUARDANDO_SELECAO',
        acknowledgedAt: new Date().toISOString(), duplicate: false
      };
      const duplicate = received.has(payload.eventId);
      received.set(payload.eventId, ack);
      reply(duplicate ? 200 : 201, { ...ack, duplicate,
        ...(responseMode === 'wrong-project' ? { projectId: 'different-project' } : {}) });
    } catch (error) { reply(500, { error: error.message }); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const options = { database: prisma, apiUrl: `http://127.0.0.1:${server.address().port}`, token: 'synthetic-receipt-token', production: false, rootDir };
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await prisma.projectDocumentVersion.deleteMany({ where: { document: { projectId: { in: projects } } } });
    await prisma.projectDocument.deleteMany({ where: { projectId: { in: projects } } });
    await prisma.project.deleteMany({ where: { id: { in: projects } } });
    await prisma.$disconnect();
    await rm(rootDir, { recursive: true, force: true });
  });
  async function fixture({ rental = false, staged = false } = {}) {
    responseMode = 'normal';
    const code = String(nextCode++);
    const project = await prisma.project.create({ data: {
      code: randomUUID(), name: 'Recibo QA', clientName: 'Cliente QA', clientCnpj: '12345678000190',
      contractCode: `${code} R0`, location: 'Sede', commercialProposalCode: code,
      ...commercialProposalSyncData({ proposalCode: code, revisionNumber: 0 })
    } });
    projects.push(project.id);
    if (staged) await prisma.projectBudget.create({ data: { projectId: project.id, version: 1, source: 'MANUAL' } });
    const bytes = Buffer.from('%PDF-1.7\nSynthetic receipt document');
    const generationId = randomUUID();
    const bundle = { contractVersion: 1, source: 'COMERCIAL_APP', proposalId: randomUUID(), proposalCode: code,
      revisionNumber: 0, projectId: null, clientCnpj: '12345678000190', nectarOpportunityId: null, approvedAt: null,
      sourceUpdatedAt: new Date().toISOString(), client: { name: 'Cliente QA', cnpj: '12345678000190', contact: '', email: '' },
      title: 'Recibo QA', site: 'Sede', salePrice: 1500, plannedTotalCost: null, expectedMargin: null,
      estimateSummary: null, scope: [], costBreakdown: null,
      proposalSnapshot: rental ? { estimateNature: 'equipment_rental', modelo: 'locacao_equipamentos' } : {},
      documents: (rental ? ['COMERCIAL'] : ['COMERCIAL', 'TECNICA']).map(kind => ({
        id: `document-${kind}`, kind, generationId, fileName: `${kind}.pdf`, mimeType: 'application/pdf',
        byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')
      })) };
    const f = { project, bytes, bundle };
    fixtures.set(code, f);
    return f;
  }
  const row = projectId => prisma.commercialAppReceipt.findFirst({ where: { projectId }, orderBy: { importedAt: 'desc' } });
  const drain = (extra = {}) => processCommercialReceipts({ ...options, ...extra });

  await t.test('só confirma depois de salvar; preserva pendências, seleção e aprovação', async () => {
    const f = await fixture();
    const before = posts.length;
    assert.equal((await syncCommercialProposal(f.project.id, options)).status, 'SYNCED');
    const receipt = await row(f.project.id);
    assert.equal(receipt.status, 'PENDING'); assert.equal(posts.length, before);
    assert.equal(receipt.payload.scopeStatus, 'NEEDS_REVIEW');
    assert.equal((await prisma.projectBudget.findUnique({ where: { projectId_version: { projectId: f.project.id, version: 1 } } })).approvedAt, null);
    await drain();
    assert.equal((await row(f.project.id)).status, 'DELIVERED');
    assert.equal((await row(f.project.id)).acknowledgement.deliveryStatus, 'SUCESSO');
    assert.equal((await syncCommercialProposal(f.project.id, options)).status, 'SKIPPED');
    assert.equal(await prisma.commercialAppReceipt.count({ where: { projectId: f.project.id } }), 1);
  });

  await t.test('ACK perdido repete o evento sem reimportar e sem alterar escopo manual', async () => {
    const f = await fixture();
    await syncCommercialProposal(f.project.id, options);
    await prisma.project.update({ where: { id: f.project.id }, data: { commercialScopeImport: { status: 'MANUAL_OVERRIDE', note: 'Preservar' } } });
    let lost = false;
    await drain({ transport: async (url, request) => {
      const response = await fetch(url, request);
      if (!lost && request.method === 'POST') { lost = true; await response.arrayBuffer(); throw new Error('lost ACK'); }
      return response;
    } });
    const pending = await row(f.project.id);
    assert.equal(pending.status, 'PENDING'); assert.equal(pending.attempts, 1);
    assert.equal(pending.errorCode, 'COMERCIALAPP_RECEIPT_SEND_FAILED');
    await drain({ now: new Date(pending.nextAttemptAt.getTime() + 1) });
    const delivered = await row(f.project.id);
    assert.equal(delivered.status, 'DELIVERED'); assert.equal(delivered.eventId, pending.eventId);
    assert.equal(delivered.acknowledgement.duplicate, true);
    assert.deepEqual(posts.filter(p => p.projectId === f.project.id), [pending.payload, pending.payload]);
    assert.equal(await prisma.projectDocumentVersion.count({ where: { document: { projectId: f.project.id } } }), 2);
    assert.deepEqual((await prisma.project.findUnique({ where: { id: f.project.id } })).commercialScopeImport, { status: 'MANUAL_OVERRIDE', note: 'Preservar' });
  });

  await t.test('locação usa um PDF e seleção posterior confirma o orçamento anteriormente em staging', async () => {
    const f = await fixture({ rental: true, staged: true });
    assert.equal((await syncCommercialProposal(f.project.id, options)).status, 'SYNCED');
    assert.equal((await row(f.project.id)).payload.budgetStatus, 'STAGED');
    await drain();
    assert.equal((await row(f.project.id)).acknowledgement.deliveryStatus, 'AGUARDANDO_SELECAO');
    await selectCommercialAppRevision(f.project.id, f.bundle.proposalId, null, { replaceLegacy: true });
    assert.equal((await syncCommercialProposal(f.project.id, options)).status, 'SYNCED');
    await drain();
    assert.equal((await row(f.project.id)).payload.budgetStatus, 'SELECTED');
    assert.equal((await row(f.project.id)).status, 'DELIVERED');
    assert.equal(await prisma.projectDocumentVersion.count({ where: { document: { projectId: f.project.id } } }), 1);
  });

  await t.test('conflito exige revisão sem armazenar corpo externo; ACK divergente não confirma', async () => {
    const f = await fixture(); await syncCommercialProposal(f.project.id, options);
    responseMode = 'wrong-project'; await drain();
    assert.equal((await row(f.project.id)).errorCode, 'COMERCIALAPP_RECEIPT_ACK_INVALID');
    const next = (await row(f.project.id)).nextAttemptAt;
    responseMode = 'conflict'; await drain({ now: new Date(next.getTime() + 1) });
    const failed = await row(f.project.id);
    assert.equal(failed.status, 'REVIEW'); assert.equal(failed.nextAttemptAt, null);
    assert.equal(failed.errorCode, 'COMERCIALAPP_HTTP_409'); assert.equal(failed.acknowledgement, null);
    assert.ok(!JSON.stringify(failed).includes('private upstream'));
    assert.equal((await prisma.project.findUnique({ where: { id: f.project.id } })).commercialProposalSync.status, 'SYNCED');
  });

  await t.test('dois processadores não enviam juntos; lease expirado recupera o evento original', async () => {
    const f = await fixture(); await syncCommercialProposal(f.project.id, options);
    const pending = await row(f.project.id);
    await prisma.commercialAppReceipt.update({ where: { eventId: pending.eventId }, data: {
      status: 'SENDING', attemptId: randomUUID(), attemptAt: new Date(Date.now() - 120_000), nextAttemptAt: new Date(Date.now() - 60_000)
    } });
    await Promise.all([drain(), drain()]);
    assert.equal((await row(f.project.id)).status, 'DELIVERED');
    assert.equal(posts.filter(p => p.eventId === pending.eventId).length, 1);
  });

  await t.test('rollback e resposta superada não deixam confirmação para enviar', async () => {
    const f = await fixture();
    const database = new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return (callback, settings) => target.$transaction(async tx => {
        await callback(tx); throw new Error('synthetic rollback');
      }, settings);
      return target[key];
    } });
    assert.equal((await syncCommercialProposal(f.project.id, { ...options, database })).status, 'ERROR');
    assert.equal(await prisma.commercialAppReceipt.count({ where: { projectId: f.project.id } }), 0);
    assert.equal(await prisma.projectDocumentVersion.count({ where: { document: { projectId: f.project.id } } }), 0);
    let changed = false;
    const result = await syncCommercialProposal(f.project.id, { ...options, transport: async (url, request) => {
      const response = await fetch(url, request);
      if (!changed) { changed = true; await prisma.project.update({ where: { id: f.project.id }, data: commercialProposalSyncData({
        proposalCode: f.bundle.proposalCode, revisionNumber: 1
      }) }); }
      return response;
    } });
    assert.equal(result.status, 'SUPERSEDED');
    assert.equal(await prisma.commercialAppReceipt.count({ where: { projectId: f.project.id } }), 0);
  });

  await t.test('reconcilia importação antiga por ID após conferir bytes, preservando escopo manual', async () => {
    const f = await fixture(); await syncCommercialProposal(f.project.id, options);
    await prisma.commercialAppReceipt.deleteMany({ where: { projectId: f.project.id } });
    await prisma.project.update({ where: { id: f.project.id }, data: { commercialScopeImport: { status: 'MANUAL_OVERRIDE' } } });
    const before = await prisma.project.findUnique({ where: { id: f.project.id } });
    assert.equal((await prepareStoredCommercialReceipt(f.project.id, options)).status, 'VERIFIED');
    assert.equal(await prisma.commercialAppReceipt.count({ where: { projectId: f.project.id } }), 0);
    const prepared = await prepareStoredCommercialReceipt(f.project.id, { ...options, apply: true });
    assert.equal(prepared.status, 'QUEUED');
    assert.equal((await row(f.project.id)).payload.scopeStatus, 'MANUAL_PRESERVED');
    assert.equal((await prepareStoredCommercialReceipt(f.project.id, { ...options, apply: true })).status, 'EXISTS');
    assert.deepEqual(await prisma.project.findUnique({ where: { id: f.project.id } }), before);
    const version = await prisma.projectDocumentVersion.findFirst({ where: { document: { projectId: f.project.id } } });
    const file = path.join(rootDir, version.storagePath), bytes = await readFile(file);
    await writeFile(file, Buffer.from('invalid PDF'));
    await assert.rejects(prepareStoredCommercialReceipt(f.project.id, options), { code: 'COMERCIALAPP_RECEIPT_FILE_INVALID' });
    await writeFile(file, bytes);
    await prisma.project.update({ where: { id: f.project.id }, data: { isActive: false } });
    assert.equal((await prepareStoredCommercialReceipt(f.project.id, { ...options, apply: true })).status, 'SKIPPED');
    await drain(); assert.equal((await row(f.project.id)).status, 'PENDING');
  });
});
