import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

test('PrismaCRM → Futuros → projeto: HTTP, concorrência, histórico e rollback em PostgreSQL', {
  skip: !process.env.CRM_OPPORTUNITIES_TEST_DATABASE_URL, timeout: 60_000
}, async t => {
  const databaseUrl = new URL(process.env.CRM_OPPORTUNITIES_TEST_DATABASE_URL);
  assert.match(databaseUrl.pathname, /_test$/);
  assert.equal(process.env.DATABASE_URL, databaseUrl.toString());
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { createCredential } = await import('../src/lib/api-credentials/service.js');
  const { executePlaygroundOperation } = await import('../src/lib/api-credentials/playground.js');
  const { receiveCrmOpportunity } = await import('../src/lib/projects/crm-opportunities.js');
  const { clearProjectDerivedCaches } = await import('../src/lib/resource-list-cache.js');
  const prefix = `crm-test-${randomUUID()}`;
  const users = [];
  const credentials = [];
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.apiCredential.deleteMany({ where: { id: { in: credentials } } });
    await prisma.crmOpportunity.deleteMany({ where: { externalId: { startsWith: prefix } } });
    await prisma.project.deleteMany({ where: { code: { startsWith: prefix } } });
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
  const scopes = ['efetivo.projetos.create', 'acompanhamento.oportunidades.write'];
  async function issue(scopeCodes = scopes, projectIds = []) {
    const now = new Date();
    const issued = await createCredential(prisma, { name: 'CRM de teste', purpose: 'Verificação das oportunidades quentes',
      recipientName: 'Prisma QA', startsAt: now.toISOString(), expiresAt: new Date(+now + 600_000).toISOString(),
      scopeCodes, projectAccess: { mode: projectIds.length ? 'SELECTED' : 'ALL', projectIds },
      allowedIpCidrs: [], allowedFormats: ['JSON'], limits: { requestsPerMinute: 120, requestsPerDay: 1000, rowsPerDay: 1000, maxPageSize: 20 }
    }, { actorUserId: users[0].id, idempotencyKey: randomUUID(), now });
    credentials.push(issued.credential.id);
    return issued;
  }
  const issued = await issue();
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const root = `http://127.0.0.1:${server.address().port}/api`;
  async function post(input, token = issued.token) {
    const response = await fetch(`${root}/integracoes/v1/acompanhamento/oportunidades`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    return { status: response.status, data: await response.json() };
  }
  async function cards() {
    const response = await fetch(`${root}/acompanhamento/comercial/projetos-cards`, { headers: { authorization: `Bearer ${session}` } });
    assert.equal(response.status, 200);
    return response.json();
  }
  const hot = { externalId: `${prefix}-main`, sourceVersion: 1, sourceUpdatedAt: '2026-10-20T12:00:00Z',
    status: 'HOT', name: 'Limpeza quente', clientName: 'Cliente QA' };
  let opportunityId;
  let projectId;
  await t.test('marcação mínima aparece sem projeto, proposta, orçamento ou fluxo operacional', async () => {
    assert.equal((await post(hot, 'invalid-token')).status, 401);
    assert.equal((await post({ ...hot, status: 'WON' })).status, 400);
    const first = await post(hot);
    assert.equal(first.status, 201, JSON.stringify(first.data));
    opportunityId = first.data.opportunity.id;
    assert.equal(first.data.opportunity.projectId, null);
    const listed = (await cards()).filter(item => item.id === opportunityId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].kind, 'OPPORTUNITY');
    assert.equal(listed[0].category, 'FUTURO');
    assert.equal(listed[0].estimatedValue, null);
    assert.equal(await prisma.project.count({ where: { code: { startsWith: prefix } } }), 0);
    assert.equal(await prisma.projectWorkflow.count(), 0);
  });
  await t.test('reenvios, versões antigas e conflito de versão não duplicam nem sobrescrevem', async () => {
    assert.equal((await post(hot)).data.outcome, 'REPLAYED');
    assert.equal((await post({ ...hot, name: 'Conteúdo divergente' })).status, 409);
    assert.equal((await post({ ...hot, sourceVersion: 2, name: 'Limpeza atualizada', estimatedValue: 1500 })).data.outcome, 'UPDATED');
    assert.equal((await post(hot)).data.outcome, 'IGNORED_OLDER');
    assert.equal((await prisma.crmOpportunity.findUnique({ where: { id: opportunityId } })).name, 'Limpeza atualizada');
    assert.equal(await prisma.crmOpportunityEvent.count({ where: { opportunityId } }), 2);
  });
  await t.test('retirada, perda e cancelamento saem de Futuros; uma nova sinalização pode reativar', async () => {
    for (const [index, status] of ['WITHDRAWN', 'LOST', 'CANCELLED'].entries()) {
      await post({ ...hot, sourceVersion: 3 + index, status });
      assert.equal((await cards()).some(item => item.id === opportunityId), false);
    }
    assert.equal((await post({ ...hot, sourceVersion: 6 })).data.outcome, 'UPDATED');
    assert.equal((await cards()).some(item => item.id === opportunityId), true);
  });
  const project = { code: `${prefix}-5801`, name: 'Projeto confirmado', clientName: 'Cliente QA',
    clientCnpj: '12345678000190', proposalCode: '1987654321', revision: 0, location: 'Sede' };
  const won = { ...hot, sourceVersion: 7, status: 'WON', project };
  await t.test('fechamento concorrente preserva um projeto e um histórico, com orçamento ainda pendente', async () => {
    const responses = await Promise.all([post(won), post(won)]);
    assert.ok(responses.every(item => item.status === 200), JSON.stringify(responses));
    assert.deepEqual(responses.map(item => item.data.outcome).sort(), ['CONVERTED', 'REPLAYED']);
    projectId = responses[0].data.opportunity.projectId;
    const stored = await prisma.project.findUnique({ where: { id: projectId } });
    assert.equal(stored.code, project.code);
    assert.equal(stored.registrationPending, true);
    assert.equal(stored.commercialProposalSync.status, 'PENDING');
    assert.equal(await prisma.projectWorkflow.count({ where: { projectId } }), 0);
    assert.equal(await prisma.report.count({ where: { projectId } }), 0);
    const listed = await cards();
    assert.equal(listed.some(item => item.kind === 'OPPORTUNITY' && item.id === opportunityId), false);
    const confirmed = listed.filter(item => item.projectId === projectId);
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].category, 'FUTURO');
    assert.equal(confirmed[0].awaitingCommercialBudget, true);
    assert.equal(confirmed[0].crmOpportunity.id, opportunityId);
    assert.equal(await prisma.crmOpportunityEvent.count({ where: { opportunityId, sourceVersion: 7 } }), 1);
    const detail = await fetch(`${root}/acompanhamento/comercial/projetos/${projectId}/detalhe`, { headers: { authorization: `Bearer ${session}` } });
    assert.equal(detail.status, 200, JSON.stringify(await detail.json()));
  });
  await t.test('atraso de HOT, regressão, troca de projeto e vínculo duplicado não desfazem o fechamento', async () => {
    assert.equal((await post({ ...hot, sourceVersion: 6 })).data.outcome, 'IGNORED_OLDER');
    assert.equal((await post({ ...hot, sourceVersion: 8 })).data.code, 'OPPORTUNITY_ALREADY_CONVERTED');
    assert.equal((await post({ ...won, sourceVersion: 8, project: { ...project, code: `${prefix}-other` } })).status, 409);
    const duplicate = await post({ ...won, externalId: `${prefix}-duplicate` });
    assert.equal(duplicate.data.code, 'PROJECT_OPPORTUNITY_CONFLICT');
    assert.equal(await prisma.crmOpportunity.count({ where: { externalId: `${prefix}-duplicate` } }), 0);
    assert.equal(await prisma.project.count({ where: { code: `${prefix}-other` } }), 0);
  });
  await t.test('falha no histórico desfaz a criação do projeto e a conversão inteira', async () => {
    const externalId = `${prefix}-rollback`;
    await receiveCrmOpportunity(prisma, { ...hot, externalId });
    const database = { $transaction: (callback, options) => prisma.$transaction(tx => callback(new Proxy(tx, { get(target, key) {
      if (key === 'crmOpportunityEvent') return { create: async () => { throw new Error('synthetic-history-failure'); } };
      return target[key];
    } })), options) };
    await assert.rejects(() => receiveCrmOpportunity(database, { ...won, externalId, project: { ...project, code: `${prefix}-rollback` } }), /synthetic-history-failure/);
    assert.equal(await prisma.project.count({ where: { code: `${prefix}-rollback` } }), 0);
    const stored = await prisma.crmOpportunity.findUnique({ where: { externalId } });
    assert.equal(stored.status, 'HOT');
    assert.equal(stored.projectId, null);
    assert.equal(stored.sourceVersion, 1);
  });
  await t.test('evento novo cria uma única oportunidade mesmo quando chega em paralelo', async () => {
    const externalId = `${prefix}-parallel`;
    const responses = await Promise.all([post({ ...hot, externalId }), post({ ...hot, externalId })]);
    assert.deepEqual(responses.map(item => item.data.outcome).sort(), ['CREATED', 'REPLAYED']);
    assert.equal(await prisma.crmOpportunity.count({ where: { externalId } }), 1);
    await Promise.all([post({ ...hot, externalId, sourceVersion: 2, name: 'Versão intermediária' }),
      post({ ...hot, externalId, sourceVersion: 3, name: 'Versão vigente' })]);
    const stored = await prisma.crmOpportunity.findUnique({ where: { externalId } });
    assert.equal(stored.sourceVersion, 3);
    assert.equal(stored.name, 'Versão vigente');
  });
  await t.test('fechamento associa um projeto criado pela API anterior sem duplicação', async () => {
    const payload = { ...project, code: `${prefix}-existing` };
    const response = await fetch(`${root}/integracoes/v1/efetivo/projetos`, { method: 'POST',
      headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal(response.status, 201);
    const existing = await response.json();
    const closed = await post({ ...won, externalId: `${prefix}-existing`, project: payload });
    assert.equal(closed.data.outcome, 'CONVERTED');
    assert.equal(closed.data.opportunity.projectId, existing.project.id);
    assert.equal(await prisma.project.count({ where: { code: payload.code } }), 1);
  });
  await t.test('duas oportunidades concorrentes não assumem o mesmo projeto', async () => {
    const payload = { ...project, code: `${prefix}-exclusive` };
    const responses = await Promise.all(['owner-a', 'owner-b'].map(suffix => post({ ...won,
      externalId: `${prefix}-${suffix}`, project: payload })));
    assert.deepEqual(responses.map(item => item.status).sort(), [200, 409], JSON.stringify(responses));
    assert.equal(responses.find(item => item.status === 409).data.code, 'PROJECT_OPPORTUNITY_CONFLICT');
    assert.equal(await prisma.project.count({ where: { code: payload.code } }), 1);
    assert.equal(await prisma.crmOpportunity.count({ where: { project: { code: payload.code } } }), 1);
  });
  await t.test('escopos e recorte ALL valem no HTTP e playground; revisão posterior segue o fluxo normal', async () => {
    const readOnly = await issue(['efetivo.projetos.status.read']);
    assert.equal((await post(hot, readOnly.token)).data.code, 'INSUFFICIENT_SCOPE');
    const selected = await issue(scopes, [projectId]);
    assert.equal((await post(hot, selected.token)).data.code, 'PROJECT_NOT_ALLOWED');
    await assert.rejects(() => executePlaygroundOperation(prisma, selected.credential.id, {
      operationId: 'acompanhamento.opportunities.post', body: hot
    }), error => error.code === 'PROJECT_NOT_ALLOWED');
    const playback = await executePlaygroundOperation(prisma, issued.credential.id, {
      operationId: 'acompanhamento.opportunities.post', body: { ...hot, externalId: `${prefix}-playground` }
    }, { actorUserId: users[0].id });
    assert.equal(playback.response.status, 201);
    assert.equal(playback.response.body.outcome, 'CREATED');
    const updated = await post({ ...won, sourceVersion: 8, project: { ...project, revision: 1 } });
    assert.equal(updated.data.outcome, 'UPDATED');
    assert.equal(updated.data.opportunity.projectId, projectId);
    assert.equal((await prisma.project.findUnique({ where: { id: projectId } })).commercialProposalSync.revisionNumber, 1);
    await prisma.project.update({ where: { id: projectId }, data: { manualProgressPct: 10 } });
    clearProjectDerivedCaches();
    assert.equal((await cards()).find(item => item.projectId === projectId).category, 'ANDAMENTO');
  });
});
