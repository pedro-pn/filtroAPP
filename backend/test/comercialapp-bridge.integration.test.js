import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import prisma from '../src/lib/prisma.js';
import {
  receiveCommercialAppProposal, listCommercialAppRevisions,
  selectCommercialAppRevision, CommercialAppBridgeError
} from '../src/lib/acompanhamento/comercialapp-bridge.js';
import { listCommercialDashboard } from '../src/lib/acompanhamento/access-import.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('ComercialAPP entrega revisões de modo idempotente e só seleciona a nova revisão explicitamente',
  { skip: !databaseUrl }, async t => {
    assert.equal(new URL(databaseUrl).pathname, '/filtroapp_bridge_test');
    const code = `BRIDGE-${randomUUID().slice(0, 8)}`;
    const project = await prisma.project.create({ data: {
      code, name: 'Projeto de teste da integração', clientName: 'Cliente teste',
      clientCnpj: '', contractCode: code, location: 'Local de teste'
    } });
    t.after(async () => {
      await prisma.commercialAppDelivery.deleteMany({ where: { externalId: { startsWith: code } } });
      await prisma.project.delete({ where: { id: project.id } });
      await prisma.$disconnect();
    });
    const payload = revision => ({
      contractVersion: 1, eventId: randomUUID(), source: 'COMERCIAL_APP',
      proposalId: `${code}-rev-${revision}`, proposalCode: code, revisionNumber: revision,
      projectId: project.id, nectarOpportunityId: '700', approvedAt: new Date().toISOString(),
      client: { name: 'Cliente teste', cnpj: '', contact: 'Contato', email: 'teste@example.com' },
      title: 'Serviço teste', site: 'Obra teste', scope: [],
      salePrice: 1500 + revision * 100, plannedTotalCost: 900,
      expectedMargin: 40, costBreakdown: {}, proposalSnapshot: { title: 'Serviço teste' }
    });
    const first = payload(0);
    assert.equal((await receiveCommercialAppProposal(first)).budgetStatus, 'SELECTED');
    assert.equal((await receiveCommercialAppProposal(first)).duplicate, true);
    assert.equal((await prisma.projectBudget.findUnique({
      where: { projectId_version: { projectId: project.id, version: 1 } }
    })).commercialAppRevision, 0);
    const dashboard = await listCommercialDashboard({ projectIds: [project.id], includeProgress: false });
    assert.equal(dashboard.length, 1);
    assert.equal(dashboard[0].proposalCode, code);
    assert.equal(Number(dashboard[0].salePrice), 1500);

    const second = payload(1);
    assert.equal((await receiveCommercialAppProposal(second)).budgetStatus, 'STAGED');
    assert.equal((await prisma.projectBudget.findUnique({
      where: { projectId_version: { projectId: project.id, version: 1 } }
    })).commercialAppRevision, 0);
    assert.equal((await listCommercialAppRevisions(project.id)).length, 2);
    await assert.rejects(() => receiveCommercialAppProposal({ ...second, salePrice: 9999 }),
      error => error instanceof CommercialAppBridgeError && error.status === 409);
    await prisma.projectBudget.update({
      where: { projectId_version: { projectId: project.id, version: 1 } },
      data: { source: 'ACCESS_IMPORT' }
    });
    await assert.rejects(() => selectCommercialAppRevision(project.id, second.proposalId, null),
      error => error instanceof CommercialAppBridgeError && error.status === 409);
    assert.equal((await selectCommercialAppRevision(project.id, second.proposalId, null,
      { replaceLegacy: true })).budgetStatus,
      'SELECTED');
    assert.equal((await prisma.projectBudget.findUnique({
      where: { projectId_version: { projectId: project.id, version: 1 } }
    })).commercialAppRevision, 1);
  });
