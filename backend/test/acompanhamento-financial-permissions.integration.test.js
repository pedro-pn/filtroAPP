import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PROJECT_TAXES_AND_BILLING } from '../../shared/modules/acompanhamento-permissions.js';

// Run only against an explicitly designated test database with migrations applied.
test('HTTP + PostgreSQL: only ADMIN can grant project taxes/billing; summaries, groups and invoices enforce grant and revocation', {
  skip: !process.env.ACOMPANHAMENTO_TEST_DATABASE_URL
}, async t => {
  const databaseUrl = new URL(process.env.ACOMPANHAMENTO_TEST_DATABASE_URL);
  assert.match(databaseUrl.pathname, /_test$/);
  process.env.DATABASE_URL = databaseUrl.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const suffix = randomUUID();
  const users = [];
  const projects = [];
  let group;
  let proposal;
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (group) await prisma.acompanhamentoMissionGroup.delete({ where: { id: group.id } });
    await prisma.omieInvoice.deleteMany({ where: { id: `financial-${suffix}` } });
    await prisma.omieReceivable.deleteMany({ where: { omieId: suffix } });
    await prisma.omieProject.deleteMany({ where: { codigo: suffix } });
    await prisma.project.deleteMany({ where: { id: { in: projects.map(project => project.id) } } });
    if (proposal) await prisma.commercialProposal.delete({ where: { id: proposal.id } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await prisma.$disconnect();
  });

  for (const [name, role] of [['Admin', null], ['Gestora selecionada', 'ACOMPANHAMENTO_MANAGER'], ['Outra gestora', 'ACOMPANHAMENTO_MANAGER'], ['Visualizador', 'ACOMPANHAMENTO_VIEWER']]) {
    const user = await prisma.user.create({ data: {
      username: `financial-${name}-${suffix}`, name, passwordHash: 'test-only',
      accountType: role ? 'INTERNAL' : 'ADMIN', role: role ? 'COLLABORATOR' : 'MANAGER',
      ...(role ? { moduleRoles: { create: { module: 'ACOMPANHAMENTO', role } } } : {})
    } });
    assert.deepEqual(user.acompanhamentoExtraPermissions, []);
    users.push(user);
  }
  const tokens = users.map(() => randomUUID());
  await prisma.userSession.createMany({ data: users.map((user, index) => ({
    userId: user.id, tokenHash: createHash('sha256').update(tokens[index]).digest('hex'), expiresAt: new Date(Date.now() + 600_000)
  })) });
  const codProp = Math.floor(Math.random() * 1_000_000_000);
  proposal = await prisma.commercialProposal.create({ data: {
    codBd: codProp, codProp, salePrice: 150000, plannedCost: 80000, taxes: 20000, rawRow: {}, isComplete: true
  } });
  for (let index = 0; index < 2; index += 1) {
    projects.push(await prisma.project.create({ data: {
      code: `financial-${index}-${suffix}`, name: `Projeto ${index}`, clientName: 'Cliente teste', clientCnpj: '',
      contractCode: String(codProp), location: '', commercialProposalCode: String(codProp)
    } }));
  }
  group = await prisma.acompanhamentoMissionGroup.create({ data: {
    name: `Grupo ${suffix}`, members: { create: projects.map((project, order) => ({ projectId: project.id, activeProjectId: project.id, order })) }
  } });
  await prisma.omieProject.create({ data: { codigo: suffix, projectId: projects[0].id } });
  await prisma.omieReceivable.create({ data: {
    omieId: suffix, projectId: projects[0].id, valor: 125000, valorIss: 5000,
    codigoTipoDocumento: 'NFS', numeroDocumentoFiscal: '987', statusTitulo: 'RECEBIDO', rawPayload: {}
  } });
  await prisma.omieInvoice.create({ data: {
    id: `financial-${suffix}`, codigoProjeto: suffix, source: 'NFSE', numero: '987',
    dataEmissao: new Date(), valor: 125000, receiptStatus: 'RECEIVED'
  } });

  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const request = async (path, userIndex = 0, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { authorization: `Bearer ${tokens[userIndex]}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };
  const permission = { acompanhamentoExtraPermissions: [PROJECT_TAXES_AND_BILLING] };
  const updatePath = `/admin/accounts/${users[1].id}`;
  assert.equal((await request(updatePath, 1, 'PUT', permission)).status, 403);
  assert.equal((await request(`/admin/accounts/${users[3].id}`, 0, 'PUT', permission)).status, 400);
  assert.equal((await request(updatePath, 0, 'PUT', { acompanhamentoExtraPermissions: ['UNKNOWN'] })).status, 400);
  const granted = await request(updatePath, 0, 'PUT', permission);
  assert.equal(granted.status, 200, JSON.stringify(granted.data));
  assert.deepEqual(granted.data.acompanhamentoExtraPermissions, permission.acompanhamentoExtraPermissions);
  assert.deepEqual((await prisma.user.findUnique({ where: { id: users[2].id } })).acompanhamentoExtraPermissions, []);

  const base = '/acompanhamento/comercial';
  const summaries = ['/dashboard', '/projetos-cards', `/projetos/${projects[0].id}/detalhe`, `/grupos-missoes/${group.id}/detalhe`];
  const invoices = [`/projetos/${projects[0].id}/faturamentos`, `/grupos-missoes/${group.id}/faturamentos`];
  async function checkAccess(userIndex, allowed) {
    for (const path of summaries) {
      const response = await request(`${base}${path}`, userIndex);
      assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.data)}`);
      const item = Array.isArray(response.data) ? response.data.find(row => row.groupId === group.id) : response.data;
      assert.ok(item, path);
      assert.equal(item.canViewProjectFinancials, allowed, path);
      if (allowed) {
        assert.ok(item.presumedProfitTaxes?.totalTax > 0, path);
        assert.equal(Number(item.faturamento?.realizado ?? item.invoicedRevenue), 125000, path);
      } else {
        for (const key of ['invoicedRevenue', 'invoicedIss', 'invoiceCount', 'presumedProfitTaxes']) assert.equal(Object.hasOwn(item, key), false, `${path}: ${key}`);
        if (item.faturamento) {
          assert.equal(Object.hasOwn(item.faturamento, 'realizado'), false);
          assert.equal(Object.hasOwn(item.faturamento, 'notas'), false);
          assert.ok(Number(item.faturamento.previsto) > 0);
        }
      }
    }
    for (const path of invoices) {
      const response = await request(`${base}${path}`, userIndex);
      assert.equal(response.status, allowed ? 200 : 403, path);
      if (allowed) assert.equal(response.data.total, 125000, path);
      else assert.equal(Object.hasOwn(response.data, 'invoices'), false);
    }
  }
  await checkAccess(0, true);
  await checkAccess(1, true);
  await checkAccess(2, false);
  await checkAccess(3, false);
  assert.equal((await request(updatePath, 0, 'PUT', { acompanhamentoExtraPermissions: [] })).status, 200);
  // Same session token: authorization is reloaded on the very next request.
  await checkAccess(1, false);
  await request(updatePath, 0, 'PUT', permission);
  assert.equal((await request(updatePath, 0, 'PUT', { moduleRoles: ['acompanhamento:viewer'] })).status, 200);
  assert.deepEqual((await prisma.user.findUnique({ where: { id: users[1].id } })).acompanhamentoExtraPermissions, []);
  await checkAccess(1, false);
});
