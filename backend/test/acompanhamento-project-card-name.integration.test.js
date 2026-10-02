import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

test('HTTP + PostgreSQL: apelido do card é persistido só no Acompanhamento e exige gestor', {
  skip: !process.env.ACOMPANHAMENTO_TEST_DATABASE_URL
}, async t => {
  const databaseUrl = new URL(process.env.ACOMPANHAMENTO_TEST_DATABASE_URL);
  assert.match(databaseUrl.pathname, /_test$/);
  process.env.DATABASE_URL = databaseUrl.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const suffix = randomUUID();
  const tokens = [randomUUID(), randomUUID()];
  const users = [];
  let project;
  let proposal;
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.userSession.deleteMany({ where: { userId: { in: users.map(user => user.id) } } });
    if (project) await prisma.project.delete({ where: { id: project.id } });
    if (proposal) await prisma.commercialProposal.delete({ where: { id: proposal.id } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await prisma.$disconnect();
  });

  for (const [label, role] of [['gestor', 'ACOMPANHAMENTO_MANAGER'], ['visualizador', 'ACOMPANHAMENTO_VIEWER']]) {
    users.push(await prisma.user.create({ data: {
      username: `card-name-${label}-${suffix}`, name: label, passwordHash: 'test-only',
      accountType: 'INTERNAL', role: 'COLLABORATOR',
      moduleRoles: { create: { module: 'ACOMPANHAMENTO', role } }
    } }));
  }
  await prisma.userSession.createMany({ data: users.map((user, index) => ({
    userId: user.id, tokenHash: createHash('sha256').update(tokens[index]).digest('hex'),
    expiresAt: new Date(Date.now() + 600_000)
  })) });
  const codProp = Math.floor(Math.random() * 1_000_000_000);
  proposal = await prisma.commercialProposal.create({ data: {
    codBd: codProp, codProp, salePrice: 1000, plannedCost: 500, rawRow: {}, isComplete: true
  } });
  project = await prisma.project.create({ data: {
    code: `card-name-${suffix}`, name: 'Nome oficial', clientName: 'Cliente teste', clientCnpj: '',
    contractCode: String(codProp), location: '', commercialProposalCode: String(codProp)
  } });

  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const request = async (path, userIndex, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/acompanhamento/comercial${path}`, {
      method, headers: { authorization: `Bearer ${tokens[userIndex]}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };
  const path = `/projetos/${project.id}/card-name`;
  assert.equal((await request(path, 1, 'PATCH', { name: 'Apelido local' })).status, 403);
  assert.equal((await request(path, 0, 'PATCH', { name: ' ' })).status, 400);
  const renamed = await request(path, 0, 'PATCH', { name: ' Apelido local ' });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.deepEqual(renamed.data, { projectId: project.id, cardName: 'Apelido local' });
  assert.deepEqual(await prisma.project.findUnique({ where: { id: project.id }, select: { name: true, acompanhamentoCardName: true } }),
    { name: 'Nome oficial', acompanhamentoCardName: 'Apelido local' });
  const cards = await request('/projetos-cards', 1);
  assert.equal(cards.status, 200);
  const card = cards.data.find(item => item.projectId === project.id);
  assert.equal(card?.name, 'Nome oficial');
  assert.equal(card?.cardName, 'Apelido local');
  assert.equal((await request('/projetos/inexistente/card-name', 0, 'PATCH', { name: 'Apelido' })).status, 404);
  assert.deepEqual((await request(path, 0, 'PATCH', { name: 'Nome oficial' })).data,
    { projectId: project.id, cardName: null });
});
