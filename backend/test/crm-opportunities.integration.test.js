import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/crm-planning-events.json', import.meta.url)));
test('planning-1.0: HTTP, histórico, concorrência, reconciliação e rollback em PostgreSQL', {
  skip: !process.env.CRM_OPPORTUNITIES_TEST_DATABASE_URL, timeout: 90_000
}, async t => {
  const databaseUrl = new URL(process.env.CRM_OPPORTUNITIES_TEST_DATABASE_URL);
  assert.match(databaseUrl.pathname, /_test$/);
  assert.equal(process.env.DATABASE_URL, databaseUrl.toString());
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { createCredential } = await import('../src/lib/api-credentials/service.js');
  const { executePlaygroundOperation } = await import('../src/lib/api-credentials/playground.js');
  const { receiveCrmOpportunity } = await import('../src/lib/projects/crm-opportunities.js');
  const prefix = `crm-test-${randomUUID()}`;
  const users = [], credentials = [], proposals = [];
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.apiCredential.deleteMany({ where: { id: { in: credentials } } });
    await prisma.crmOpportunity.deleteMany({ where: { externalId: { startsWith: prefix } } });
    await prisma.crmProjectMapping.deleteMany({ where: { project: { code: { startsWith: prefix } } } });
    await prisma.project.deleteMany({ where: { code: { startsWith: prefix } } });
    await prisma.commercialProposal.deleteMany({ where: { id: { in: proposals } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await prisma.$disconnect();
  });
  for (const accountType of ['ADMIN', 'INTERNAL']) users.push(await prisma.user.create({ data: {
    username: `${prefix}-${accountType}`, name: 'Pessoa de teste', passwordHash: 'synthetic', accountType,
    role: 'COLLABORATOR', moduleRoles: { create: { module: 'ACOMPANHAMENTO', role: 'ACOMPANHAMENTO_VIEWER' } }
  } }));
  const session = randomUUID();
  await prisma.userSession.create({ data: { userId: users[1].id,
    tokenHash: createHash('sha256').update(session).digest('hex'), expiresAt: new Date(Date.now() + 600_000) } });
  const writeScopes = ['efetivo.projetos.create', 'acompanhamento.oportunidades.write'];
  const scopes = [...writeScopes, 'acompanhamento.oportunidades.read'];
  async function issue(scopeCodes = scopes, projectIds = []) {
    const now = new Date();
    const issued = await createCredential(prisma, { name: 'CRM de teste', purpose: 'Verificação de planejamento',
      recipientName: 'Prisma QA', startsAt: now.toISOString(), expiresAt: new Date(+now + 600_000).toISOString(),
      scopeCodes, projectAccess: { mode: projectIds.length ? 'SELECTED' : 'ALL', projectIds },
      allowedIpCidrs: [], allowedFormats: ['JSON'], limits: { requestsPerMinute: 300, requestsPerDay: 1000, rowsPerDay: 2000, maxPageSize: 20 }
    }, { actorUserId: users[0].id, idempotencyKey: randomUUID(), now });
    credentials.push(issued.credential.id); return issued;
  }
  const issued = await issue();
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const root = `http://127.0.0.1:${server.address().port}/api`;
  const path = '/integracoes/v1/acompanhamento/oportunidades';
  function event(index = 0, suffix = 'main') {
    const input = structuredClone(fixtures.examples[index].request);
    input.eventId = randomUUID(); input.externalId = `${prefix}-${suffix}`;
    return input;
  }
  function version(input, sourceVersion, alter = () => {}) {
    const next = structuredClone(input); next.eventId = randomUUID(); next.sourceVersion = sourceVersion; alter(next); return next;
  }
  function won(suffix = 'main', sourceVersion = 6) {
    const input = event(4, suffix); input.sourceVersion = sourceVersion;
    input.opportunity.client.taxId = '12345678000190';
    input.opportunity.project = { prismaMissionId: `${prefix}-${suffix}`, number: `${prefix}-${suffix}`, numberScope: 'filtrovali', filtroappProjectId: null };
    return input;
  }
  async function post(input, token = issued.token, key = input.eventId) {
    const response = await fetch(`${root}${path}`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key === null ? {} : { 'Idempotency-Key': key }) }, body: JSON.stringify(input) });
    return { status: response.status, data: await response.json() };
  }
  async function get(suffix, token = issued.token) {
    const response = await fetch(`${root}${path}${suffix}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, data: await response.json() };
  }
  async function cards() {
    const response = await fetch(`${root}/acompanhamento/comercial/projetos-cards`, { headers: { authorization: `Bearer ${session}` } });
    assert.equal(response.status, 200); return response.json();
  }
  const initial = event(); let opportunityId, projectId;
  await t.test('sinalização cria somente um espelho; cabeçalho, ambiente e retrato são validados', async () => {
    assert.equal((await post(initial, 'invalid-token')).status, 401);
    assert.equal((await post(initial, issued.token, null)).data.code, 'IDEMPOTENCY_KEY_REQUIRED');
    assert.equal((await post(initial, issued.token, randomUUID())).data.code, 'IDEMPOTENCY_KEY_MISMATCH');
    assert.equal((await post({ ...initial, environment: 'production' })).data.code, 'NAMESPACE_NOT_ALLOWED');
    assert.equal((await post({ ...initial, opportunity: { ...initial.opportunity, project: undefined } })).status, 422);
    const first = await post(initial);
    assert.equal(first.status, 201, JSON.stringify(first.data));
    opportunityId = first.data.accompanimentId;
    assert.equal(first.data.disposition, 'applied');
    assert.equal(first.data.projectId, null);
    assert.equal((await cards()).find(item => item.id === opportunityId).category, 'FUTURO');
    assert.equal(await prisma.project.count({ where: { code: { startsWith: prefix } } }), 0);
  });
  await t.test('IDs e versões possuem proteção independente, inclusive para versões antigas', async () => {
    assert.equal((await post(initial)).data.disposition, 'duplicate');
    const duplicateVersion = { ...initial, eventId: randomUUID() };
    assert.equal((await post(duplicateVersion)).data.disposition, 'duplicate_version');
    const second = version(initial, 2, input => { input.opportunity.title = 'Atualizada'; });
    assert.equal((await post(second)).data.disposition, 'applied');
    assert.equal((await post(initial)).data.currentSourceVersion, 2);
    const eventConflict = structuredClone(initial); eventConflict.opportunity.title = 'Conflito';
    assert.equal((await post(eventConflict)).data.code, 'EVENT_CONTENT_CONFLICT');
    eventConflict.eventId = randomUUID();
    assert.equal((await post(eventConflict)).data.code, 'VERSION_CONTENT_CONFLICT');
    assert.equal(await prisma.crmOpportunityEvent.count({ where: { opportunityId } }), 2);
    assert.equal(await prisma.crmPlanningReceipt.count({ where: { opportunityId } }), 3);
  });
  await t.test('retirada exige motivo, sai de Futuros, preserva histórico e permite reativação', async () => {
    const withdrawn = event(2); withdrawn.opportunity.planningDecision.reason = null;
    assert.equal((await post(withdrawn)).status, 422);
    withdrawn.opportunity.planningDecision.reason = 'Cliente adiou';
    assert.equal((await post(withdrawn)).status, 200);
    assert.equal((await cards()).some(item => item.id === opportunityId), false);
    assert.equal((await post(event(3))).status, 200);
    assert.equal((await cards()).some(item => item.id === opportunityId), true);
  });
  await t.test('ganho sem CNPJ fica em Futuros; dados completos aproveitam o mesmo registro', async () => {
    const pending = await post(event(4));
    assert.equal(pending.data.projectLinkStatus, 'PENDING_DATA');
    assert.equal(pending.data.accompanimentId, opportunityId);
    const card = (await cards()).find(item => item.id === opportunityId);
    assert.equal(card.commercialStatus, 'WON'); assert.equal(card.category, 'FUTURO');
    const legacy = await prisma.commercialProposal.create({ data: { codBd: 1900000000 + Math.floor(Math.random() * 10000000), codProp: 910001, nRev: 0, salePrice: 999, rawRow: { fixture: prefix } } });
    proposals.push(legacy.id);
    const input = won();
    const results = await Promise.all([post(input), post(input)]);
    assert.ok(results.every(item => item.status === 200), JSON.stringify(results));
    assert.deepEqual(results.map(item => item.data.disposition).sort(), ['applied', 'duplicate']);
    projectId = results[0].data.projectId; assert.ok(projectId);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    assert.equal(project.registrationPending, true);
    assert.equal(await prisma.projectWorkflow.count({ where: { projectId } }), 0);
    assert.equal(await prisma.report.count({ where: { projectId } }), 0);
    const listed = await cards();
    assert.equal(listed.some(item => item.kind === 'OPPORTUNITY' && item.id === opportunityId), false);
    const projects = listed.filter(item => item.projectId === projectId);
    assert.equal(projects.length, 1); assert.equal(projects[0].crmOpportunity.id, opportunityId);
    assert.equal(projects[0].awaitingCommercialBudget, true);
    assert.equal(await prisma.projectBudget.count({ where: { projectId } }), 0);
    await prisma.commercialProposal.delete({ where: { id: legacy.id } });
  });
  await t.test('retirada, perda, exclusão e referência ausente não cancelam o projeto confirmado', async () => {
    for (const [index, status] of ['OPEN', 'LOST', 'CANCELLED'].entries()) {
      const input = version(won(), 7 + index, next => {
        next.opportunity.commercialStatus = status; next.opportunity.planningRequested = false;
        next.opportunity.planningDecision.reason = 'Retirada de planejamento'; next.change.kind = 'STATE_UPDATED';
        if (index === 2) { next.opportunity.project = null; next.opportunity.sourceRecordDeleted = true; }
      });
      const response = await post(input);
      assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(response.data.projectId, projectId);
      if (index === 2) assert.equal(response.data.projectLinkStatus, 'NEEDS_REVIEW');
    }
    assert.equal((await prisma.project.findUnique({ where: { id: projectId } })).isActive, true);
    const conflicting = version(won(), 10, input => { input.opportunity.project.prismaMissionId = 'other'; });
    assert.equal((await post(conflicting)).data.code, 'PROJECT_REFERENCE_CONFLICT');
    const scopeConflict = version(won(), 10, input => { input.opportunity.scope.kind = 'ADDITIONAL'; });
    assert.equal((await post(scopeConflict)).data.code, 'SCOPE_IDENTITY_CONFLICT');
  });
  await t.test('adicionais em negociação e ganhos compartilham missão sem novo projeto ou orçamento', async () => {
    for (const suffix of ['extra-a', 'extra-b']) {
      const extra = event(8, suffix);
      extra.opportunity.project = { ...won().opportunity.project, filtroappProjectId: projectId };
      extra.opportunity.scope.primaryOpportunityExternalId = initial.externalId;
      const open = await post(extra); assert.equal(open.status, 201, JSON.stringify(open.data));
      assert.equal(open.data.targetProjectId, projectId); assert.equal(open.data.projectId, null);
      const gained = version(extra, 2, input => { input.opportunity.commercialStatus = 'WON'; input.change.kind = 'COMMERCIAL_STATUS_CHANGED'; });
      const closed = await post(gained); assert.equal(closed.data.projectId, projectId, JSON.stringify(closed));
      const badParent = version(gained, 3, input => { input.opportunity.scope.primaryProposal.code = '999999'; });
      assert.equal((await post(badParent)).status, 409);
    }
    assert.equal(await prisma.crmOpportunity.count({ where: { projectId } }), 3);
    assert.equal(await prisma.project.count({ where: { code: `${prefix}-main` } }), 1);
    assert.equal(await prisma.projectBudget.count({ where: { projectId } }), 0);
    assert.equal(await prisma.projectAdditionalProposal.count({ where: { projectId } }), 0);
    assert.equal((await prisma.project.findUnique({ where: { id: projectId } })).commercialProposalSync.proposalCode, '910001');
  });
  await t.test('adicional recebido antes da principal espera o vínculo e é reconciliado na chegada dela', async () => {
    const extra = event(9, 'early-extra'); extra.opportunity.project = won('late-main').opportunity.project;
    extra.opportunity.scope.primaryOpportunityExternalId = `${prefix}-late-main`;
    const early = await post(extra); assert.equal(early.data.projectLinkStatus, 'PENDING_LINK'); assert.equal(early.data.projectId, null);
    const main = await post(won('late-main', 1)); assert.equal(main.status, 201, JSON.stringify(main.data));
    const stored = await prisma.crmOpportunity.findUnique({ where: { id: early.data.accompanimentId } });
    assert.equal(stored.projectId, main.data.projectId); assert.equal(stored.projectLinkStatus, 'LINKED');
    assert.equal(await prisma.crmOpportunityLinkEvent.count({ where: { opportunityId: stored.id } }), 2);
    const wrongParent = version(extra, 3, input => { input.opportunity.scope.primaryOpportunityExternalId = initial.externalId; });
    assert.equal((await post(wrongParent)).data.code, 'SCOPE_IDENTITY_CONFLICT');
  });
  await t.test('pausadas, estados terminais e tombstones ficam consultáveis fora de Futuros', async () => {
    const paused = event(0, 'paused'); paused.opportunity.commercialStatus = 'POSTPONED';
    const response = await post(paused); assert.equal(response.status, 201);
    assert.equal((await cards()).find(item => item.id === response.data.accompanimentId).category, 'PAUSADA');
    for (const index of [5, 6, 7]) {
      const terminal = await post(event(index, `terminal-${index}`));
      assert.equal(terminal.status, 201); assert.equal((await cards()).some(item => item.id === terminal.data.accompanimentId), false);
    }
    const detail = await get(`/por-origem/prismaCRM/${initial.externalId}`);
    assert.equal(detail.status, 200); assert.equal(detail.data.sourceRecordDeleted, true);
    assert.equal(detail.data.currentSourceVersion, 9); assert.equal(detail.data.projectId, projectId);
    assert.equal((await get('/por-origem/prismaCRM/unknown')).status, 404);
    assert.equal((await get('/vinculos?limit=21')).status, 400);
    let next = null; const ids = [];
    do {
      const response = await get(`/vinculos?limit=2${next ? `&after=${encodeURIComponent(next)}` : ''}`);
      assert.equal(response.status, 200, JSON.stringify(response.data));
      ids.push(...response.data.items.map(item => item.externalId)); next = response.data.page.nextCursor;
      assert.ok(response.data.page.reconcileFrom); assert.equal(new Set(ids).size, ids.length);
      if (next && ids.length === 2) {
        assert.equal((await get(`/vinculos?after=${encodeURIComponent(next)}&updatedSince=2020-01-01T00:00:00Z`)).data.code, 'INVALID_CURSOR');
        assert.equal((await get(`/vinculos?after=${encodeURIComponent(next)}x`)).status, 400);
      }
    } while (next);
    assert.ok(ids.includes(initial.externalId)); assert.ok(ids.includes(`${prefix}-terminal-5`));
  });
  await t.test('versões em lacuna, obsoletas e máximas não regredem o estado nem vazam BigInt', async () => {
    const newest = event(0, 'versions'); newest.sourceVersion = 10;
    assert.equal((await post(newest)).status, 201);
    const old = version(newest, 2, input => { input.opportunity.title = 'Antiga'; });
    const stale = await post(old); assert.equal(stale.data.disposition, 'stale_ignored'); assert.equal(stale.data.currentSourceVersion, 10);
    assert.equal((await post(old)).data.disposition, 'duplicate');
    const conflicting = version(old, 2, input => { input.opportunity.title = 'Antiga divergente'; });
    assert.equal((await post(conflicting)).data.code, 'VERSION_CONTENT_CONFLICT');
    const max = await post(version(newest, Number.MAX_SAFE_INTEGER)); assert.equal(max.data.currentSourceVersion, Number.MAX_SAFE_INTEGER);
    assert.equal((await prisma.crmOpportunityEvent.findFirst({ where: { opportunity: { externalId: newest.externalId }, sourceVersion: 2n } })).applied, false);
    const simultaneous = event(0, 'parallel');
    assert.deepEqual((await Promise.all([post(simultaneous), post(simultaneous)])).map(item => item.data.disposition).sort(), ['applied', 'duplicate']);
  });
  await t.test('número sozinho não associa projeto legado; ID confirmado permite associação', async () => {
    const input = won('existing', 1);
    const payload = { code: input.opportunity.project.number, name: 'Existente', clientName: 'Cliente', clientCnpj: '12345678000190', proposalCode: '910001', revision: 0, location: 'Sede' };
    const response = await fetch(`${root}/integracoes/v1/efetivo/projetos`, { method: 'POST', headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal(response.status, 201); const existing = await response.json();
    const pending = await post(input); assert.equal(pending.data.projectLinkStatus, 'NEEDS_REVIEW'); assert.equal(pending.data.projectId, null);
    const associated = await post(version(input, 2, next => { next.opportunity.project.filtroappProjectId = existing.project.id; }));
    assert.equal(associated.data.projectId, existing.project.id);
    assert.equal(await prisma.project.count({ where: { code: payload.code } }), 1);
  });
  await t.test('falha no recibo desfaz projeto, vínculo, evento e espelho na mesma transação', async () => {
    const input = won('rollback', 1);
    const database = { $transaction: (callback, options) => prisma.$transaction(tx => callback(new Proxy(tx, { get(target, key) {
      if (key === 'crmPlanningReceipt') return { ...target[key], create: async () => { throw new Error('synthetic-receipt-failure'); } };
      return target[key];
    } })), options) };
    await assert.rejects(() => receiveCrmOpportunity(database, input), /synthetic-receipt-failure/);
    assert.equal(await prisma.project.count({ where: { code: input.opportunity.project.number } }), 0);
    assert.equal(await prisma.crmOpportunity.count({ where: { externalId: input.externalId } }), 0);
    assert.equal(await prisma.crmProjectMapping.count({ where: { prismaMissionId: input.opportunity.project.prismaMissionId } }), 0);
  });
  await t.test('escopos, ALL e playground usam as mesmas regras e respostas', async () => {
    const readOnly = await issue(['acompanhamento.oportunidades.read']);
    assert.equal((await post(initial, readOnly.token)).data.code, 'INSUFFICIENT_SCOPE');
    assert.equal((await get(`/por-origem/prismaCRM/${initial.externalId}`, readOnly.token)).status, 200);
    const writeOnly = await issue(writeScopes); assert.equal((await get('/vinculos', writeOnly.token)).status, 403);
    const selected = await issue(scopes, [projectId]);
    assert.equal((await post(initial, selected.token)).data.code, 'PROJECT_NOT_ALLOWED');
    assert.equal((await get('/vinculos', selected.token)).data.code, 'PROJECT_NOT_ALLOWED');
    await assert.rejects(() => executePlaygroundOperation(prisma, selected.credential.id, { operationId: 'acompanhamento.opportunities.post', body: initial }), error => error.code === 'PROJECT_NOT_ALLOWED');
    const result = await executePlaygroundOperation(prisma, issued.credential.id, { operationId: 'acompanhamento.opportunities.post', body: event(0, 'playground') }, { actorUserId: users[0].id });
    assert.equal(result.response.status, 201); assert.equal(result.response.body.disposition, 'applied');
    assert.match(result.request.curl, /Idempotency-Key:/);
    const listed = await executePlaygroundOperation(prisma, issued.credential.id, { operationId: 'acompanhamento.opportunities.links.list', query: { limit: 2 } });
    assert.equal(listed.response.status, 200); assert.equal(listed.response.body.items.length, 2);
  });
});
