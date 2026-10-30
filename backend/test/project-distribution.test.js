import assert from 'node:assert/strict';
import test from 'node:test';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { projectAccessExtension, withProjectAccess, withProjectChannel } from '../src/lib/projects/access-scope.js';
import { projectChannelWhere, projectDistributionDefaults } from '../src/lib/projects/distribution.js';
import { listOperationalResources } from '../src/lib/api-credentials/operational-service.js';
import { getIntegrationQualityRecord } from '../src/lib/qualidade/integration-service.js';
import { projectCardsCache } from '../src/lib/resource-list-cache.js';

const context = { scopes: new Set(['projetos.read', 'rdo.relatorios.read', 'eventos.read', 'qualidade.registros.read', 'omie.notas.read']),
  projectAccessMode: 'ALL', maxPageSize: 100, cursorKey: 'project-distribution-test-cursor-key-32-characters' };

test('projetos privados: isolamento real no Prisma, dados relacionados, paginação e liberações por destino', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const raw = database.client;
  const client = raw.$extends(projectAccessExtension);
  const user = await raw.user.create({ data: { username: 'distribution-admin', name: 'Admin', passwordHash: 'test', role: 'MANAGER', accountType: 'ADMIN' } });
  const makeProject = (code, extra = {}) => raw.project.create({ data: {
    code, name: `Projeto ${code}`, clientName: 'Cliente', clientCnpj: '12345678000195', contractCode: '1234', location: 'Local', ...extra
  } });
  const hidden = await makeProject('private', { managerOnly: true });
  const shared = await makeProject('shared');
  for (const project of [hidden, shared]) {
    await raw.report.create({ data: { id: `r-${project.code}`, projectId: project.id, reportDate: new Date(),
      arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1, status: 'APPROVED',
      createdByUserId: user.id, services: { create: { serviceType: 'TEST' } } } });
    await raw.qualityRecord.create({ data: { id: `q-${project.code}`, number: `Q-${project.code}`, type: 'DESVIO', seq: project === hidden ? 1 : 2,
      year: 2026, registeredAt: new Date(), eventDate: new Date(), projectId: project.id } });
    await raw.omieProject.create({ data: { codigo: `om-${project.code}`, osNumber: project.code, projectId: project.id } });
    await raw.omieInvoice.create({ data: { id: `i-${project.code}`, source: 'NFSE', codigoProjeto: `om-${project.code}`,
      numero: '1', dataEmissao: new Date(), valor: 100, receiptStatus: 'OPEN', syncedAt: new Date() } });
  }

  await t.test('todas as contas não admin, inclusive com papel MANAGER, recebem somente projetos públicos', async () => {
    for (const accountType of ['INTERNAL', 'CLIENT']) {
      await withProjectAccess({ accountType, role: 'MANAGER' }, async () => {
        assert.deepEqual((await client.project.findMany({ select: { id: true } })).map(p => p.id), [shared.id]);
        assert.equal(await client.project.findUnique({ where: { id: hidden.id } }), null);
        assert.equal(await client.report.findUnique({ where: { id: 'r-private' } }), null);
        assert.equal(await client.reportService.count(), 1);
        assert.equal(await client.qualityRecord.findUnique({ where: { id: 'q-private' } }), null);
        await client.$transaction(async tx => assert.equal(await tx.project.findUnique({ where: { id: hidden.id } }), null));
        assert.deepEqual((await client.report.groupBy({ by: ['projectId'], _count: true })).map(r => r.projectId), [shared.id]);
        const nested = await client.user.findUnique({ where: { id: user.id }, select: {
          createdReports: { select: { projectId: true } }, _count: { select: { createdReports: true } }
        } });
        assert.deepEqual(nested.createdReports.map(r => r.projectId), [shared.id]);
        assert.equal(nested._count.createdReports, 1);
        await assert.rejects(client.project.update({ where: { id: hidden.id }, data: { name: 'Tentativa' } }), { code: 'P2025' });
      });
    }
    await withProjectAccess({ accountType: 'ADMIN' }, async () => assert.equal(await client.project.count(), 2));
    const concurrent = await Promise.all(['ADMIN', 'INTERNAL'].map(accountType => withProjectAccess({ accountType }, async () => {
      await new Promise(resolve => setImmediate(resolve));
      return client.project.count();
    })));
    assert.deepEqual(concurrent, [2, 1]);
  });

  await t.test('API, relatórios e eventos ocultam projetos privados mesmo com token ALL ou SELECTED', async () => {
    for (const access of [context, { ...context, projectAccessMode: 'SELECTED', projectIds: new Set([hidden.id, shared.id]) }]) {
      const projects = await listOperationalResources(raw, 'operational.Project.list', { limit: 1 }, access);
      assert.deepEqual(projects.items.map(p => p.id), [shared.id]);
      assert.equal(projects.page.hasMore, false);
      const reports = await listOperationalResources(raw, 'operational.Report.list', {}, access);
      assert.deepEqual(reports.items.map(r => r.projectId), [shared.id]);
      const events = await listOperationalResources(raw, 'integration.events.list', {}, access);
      assert.ok(events.items.every(event => event.projectId === shared.id));
      const invoices = await listOperationalResources(raw, 'operational.OmieInvoice.list', {}, access);
      assert.deepEqual(invoices.items.map(invoice => invoice.projectId), [shared.id]);
      await assert.rejects(getIntegrationQualityRecord(raw, 'q-private', {}, access), { statusCode: 404 });
    }
    await withProjectChannel('api', async () => {
      assert.equal(await client.project.findUnique({ where: { id: hidden.id } }), null);
      assert.equal(await client.qualityRecord.count(), 1);
    });
  });

  await t.test('ativar API explicitamente permite sincronizar sem liberar o projeto para contas não admin', async () => {
    await raw.project.update({ where: { id: hidden.id }, data: {
      distributionSettings: { ...projectDistributionDefaults({ managerOnly: true }), api: true, efetivo: true }
    } });
    const projects = await listOperationalResources(raw, 'operational.Project.list', {}, context);
    assert.equal(projects.items.length, 2);
    assert.equal(await raw.project.count({ where: projectChannelWhere('efetivo') }), 2);
    assert.equal(await raw.project.count({ where: projectChannelWhere('omie') }), 1);
    await withProjectAccess({ accountType: 'INTERNAL' }, async () => {
      assert.equal(await client.project.count({ where: projectChannelWhere('efetivo') }), 1);
    });
  });

  await t.test('caches de admin e de contas internas nunca compartilham os resultados', async () => {
    projectCardsCache.clear();
    await withProjectAccess({ accountType: 'ADMIN' }, () => projectCardsCache.get('same-key', async () => ['private', 'shared']));
    assert.deepEqual(await withProjectAccess({ accountType: 'INTERNAL' }, () => projectCardsCache.get('same-key', async () => ['shared'])), ['shared']);
    projectCardsCache.clear();
  });
});
