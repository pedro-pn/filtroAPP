import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('presentation snapshots preserve originals, enforce permissions, block writes and restore atomically', {
  skip: !process.env.PRESENTATION_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.PRESENTATION_TEST_DATABASE_URL);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const files = await mkdtemp(path.join(tmpdir(), 'presentation-test-'));
  process.env.ASSETS_DIR = files;
  process.env.REPORTS_DIR = files;
  t.after(() => rm(files, { recursive: true, force: true }));
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { createPresentationCopy, endPresentationCopy, getPresentationCopy, presentationPayload } = await import('../src/lib/acompanhamento/presentation-copies.js');
  const suffix = randomUUID();
  const id = `presentation-${suffix}`;
  const users = [];
  let project, server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.$executeRaw`DELETE FROM "ProjectPresentationCopy" WHERE "id" = ${id}`;
    if (project) await prisma.project.delete({ where: { id: project.id } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  const json = value => JSON.parse(JSON.stringify(value));
  project = await prisma.project.create({ data: {
    code: suffix, name: 'Missão preservada', clientName: 'Cliente', clientCnpj: '', contractCode: 'Contrato', location: 'Local'
  } });
  const original = json(project);
  const detail = { header: { code: project.code, clientName: 'Cliente' },
    consumo: { gasto: 123, previsto: 250, previstoIntegral: 250, previstoOriginal: 200, previstoAdicional: 50, pct: 49 },
    maoDeObra: { custo: 77 }, presumedProfitTaxes: { totalTax: 25 },
    faturamento: { realizado: 300, notas: 2 }, alerts: [{ code: 'CUSTO' }, { code: 'PRAZO' }],
    avancoPct: 55, colaboradores: [{ name: 'Pessoa', horas: 10 }]
  };
  const snapshot = { originalProject: original, taxAmount: 69745,
    variants: {
      admin: { detalhe: detail, card: { projectId: project.id, realizedCost: 200, plannedCost: 250, alerts: detail.alerts } },
      standard: { detalhe: { ...detail, consumo: { ...detail.consumo, gasto: 100 } }, card: { projectId: project.id, realizedCost: 177 } }
    }, auxiliary: { faturamentos: { invoices: [{ amount: 300 }] } },
    deviations: [{ id: 'incident', number: 'Incidente de teste', eventDate: '2026-05-09', description: 'Incidente fictício de teste', cost: 52321 }]
  };
  await prisma.project.update({ where: { id: project.id }, data: { name: 'Mudou durante a captura' } });
  await assert.rejects(createPresentationCopy({ id, snapshot }), /mudou durante/);
  assert.equal(await getPresentationCopy(id), null);
  assert.equal((await prisma.project.findUnique({ where: { id: project.id } })).acompanhamentoArchivedAt, null);
  await prisma.project.update({ where: { id: project.id }, data: { name: original.name } });
  snapshot.originalProject = json(await prisma.project.findUnique({ where: { id: project.id } }));
  const copy = await createPresentationCopy({ id, snapshot });
  const after = json(await prisma.project.findUnique({ where: { id: project.id } }));
  for (const key of Object.keys(snapshot.originalProject)) {
    if (!['acompanhamentoArchivedAt', 'acompanhamentoReviewedAt', 'updatedAt'].includes(key)) assert.deepEqual(after[key], snapshot.originalProject[key], key);
  }
  assert.ok(after.acompanhamentoArchivedAt);
  assert.equal(after.isActive, true);
  const projected = presentationPayload(copy, 'detalhe', true);
  assert.equal(projected.consumo.previsto, null);
  assert.equal(projected.consumo.gasto + projected.maoDeObra.custo, 200, 'incident does not inflate realized cost');
  assert.equal(projected.presumedProfitTaxes.totalTax, 69745);
  assert.deepEqual(projected.colaboradores, detail.colaboradores);
  assert.equal(detail.consumo.previsto, 250, 'projection does not mutate stored original');
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  async function session(admin) {
    const user = await prisma.user.create({ data: { username: `${admin}-${suffix}`, name: 'Teste', passwordHash: 'test-only',
      role: 'MANAGER', accountType: admin ? 'ADMIN' : 'INTERNAL',
      moduleRoles: { create: admin ? [{ module: 'ACOMPANHAMENTO', role: 'ACOMPANHAMENTO_MANAGER' }, { module: 'QUALIDADE', role: 'QUALIDADE_MANAGER' }] : [{ module: 'ACOMPANHAMENTO', role: 'ACOMPANHAMENTO_VIEWER' }] }
    } });
    users.push(user.id);
    const token = randomUUID();
    await prisma.userSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600_000) } });
    return token;
  }
  const admin = await session(true), viewer = await session(false);
  async function request(path, token, method = 'GET') {
    return fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, { method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: '{}' }) });
  }
  const route = `acompanhamento/comercial/projetos/${id}`;
  assert.equal((await request(`${route}/detalhe`)).status, 401);
  assert.equal((await request(`${route}/detalhe`, admin)).status, 200);
  const restricted = await (await request(`${route}/detalhe`, viewer)).json();
  assert.equal(restricted.consumo.gasto, 100, 'admin-only costs use a separate snapshot');
  assert.equal(restricted.presumedProfitTaxes, undefined);
  assert.equal(restricted.presentation.taxAmount, undefined);
  assert.equal((await request(`${route}/faturamentos`, viewer)).status, 403);
  assert.equal((await request(`${route}/faturamentos`, admin)).status, 200);
  for (const [path, method] of [['cronograma', 'PUT'], ['custos-manuais', 'POST'], ['card-name', 'PATCH'], ['metas-semanais', 'PUT']]) {
    assert.equal((await request(`${route}/${path}`, admin, method)).status, 409);
  }
  assert.equal((await request(`qualidade/registros/projeto/${id}/desvios`, viewer)).status, 403);
  const quality = await request(`qualidade/registros/projeto/${id}/desvios`, admin);
  assert.equal(quality.status, 200);
  assert.equal((await quality.json())[0].cost, 52321);
  await prisma.project.update({ where: { id: project.id }, data: { name: 'Nova informação da original' } });
  await endPresentationCopy(id);
  const restored = await prisma.project.findUnique({ where: { id: project.id } });
  assert.equal(restored.acompanhamentoArchivedAt, null);
  assert.equal(restored.name, 'Nova informação da original');
  assert.equal(await getPresentationCopy(id), null);
  assert.equal((await request(`${route}/detalhe`, admin)).status, 404);
  await endPresentationCopy(id); // repeated restores are safe
});
