import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import prisma from '../src/lib/prisma.js';
import {
  receiveCommercialAppProposal, listCommercialAppRevisions,
  selectCommercialAppRevision, CommercialAppBridgeError
} from '../src/lib/acompanhamento/comercialapp-bridge.js';
import { listCommercialDashboard } from '../src/lib/acompanhamento/access-import.js';
import { loadPlannedHours } from '../src/lib/acompanhamento/planned-hours.js';

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
      title: 'Serviço teste', site: 'Obra teste',
      scope: [{ id: 'servico-1', title: 'Limpeza' }],
      salePrice: 1500 + revision * 100, plannedTotalCost: 900,
      expectedMargin: 40,
      costBreakdown: {
        volumeSystems: [{ id: 'circuito-1', name: 'Caldeira A', enabled: true,
          pipeSegments: [{ id: 'tubo-1', description: 'Linha de vapor', quantity: 2,
            lengthM: 30 + revision * 10, internalDiameterMm: 50.8, diameterUnit: 'in' }] }],
        circuitServices: [{ systemId: 'circuito-1', itemId: 'tubo-1',
          itemType: 'pipes', serviceId: 'teste_hidrostatico' }]
      },
      proposalSnapshot: { title: 'Serviço teste',
        scopeItems: [{ id: 'servico-1', title: 'Limpeza' }],
        technicalServices: [{ serviceId: 'teste_hidrostatico' }] },
      estimateSummary: {
        schemaVersion: 1,
        hours: { normal: 100 + revision * 10, overtime: 20, total: 120 + revision * 10 },
        workload: { personDays: 10, peakHeadcount: 2, phases: [] },
        costs: { labor: 500, indirect: 20, materials: 100, inputs: 50, filters: 10,
          effluent: 0, mobilization: 80, demobilization: 40, referralBonus: 0,
          direct: 900, overhead: 0, total: 900, taxesAtEstimatePrice: 100,
          commissionAtEstimatePrice: 0, representativeCommissionAtEstimatePrice: 0,
          commercialExpenseAtEstimatePrice: 0 }
      }
    });
    const first = payload(0);
    const legacyFirst = { ...first, scope: first.proposalSnapshot.technicalServices };
    delete legacyFirst.estimateSummary;
    assert.equal((await receiveCommercialAppProposal(legacyFirst)).budgetStatus, 'SELECTED');
    assert.equal((await receiveCommercialAppProposal(first)).duplicate, true,
      'reenvio da mesma proposta pode acrescentar o resumo e corrigir o escopo antigo');
    assert.equal((await receiveCommercialAppProposal(first)).duplicate, true);
    assert.equal((await prisma.projectBudget.findUnique({
      where: { projectId_version: { projectId: project.id, version: 1 } }
    })).commercialAppRevision, 0);
    assert.equal((await loadPlannedHours([project.id])).get(project.id).hoursPlan.commercial.total, 120);
    const planned = async () => prisma.projectPlannedService.findMany({
      where: { projectId: project.id }, include: { systems: true }
    });
    assert.equal(Number((await planned())[0].systems[0].quantity), 60);
    assert.equal((await planned())[0].systems[0].diameter, '2');
    const dashboard = await listCommercialDashboard({ projectIds: [project.id], includeProgress: false });
    assert.equal(dashboard.length, 1);
    assert.equal(dashboard[0].proposalCode, code);
    assert.equal(Number(dashboard[0].salePrice), 1500);
    assert.equal(dashboard[0].components.commercial_labor, 500);

    const second = payload(1);
    assert.equal((await receiveCommercialAppProposal(second)).budgetStatus, 'STAGED');
    assert.equal((await prisma.projectBudget.findUnique({
      where: { projectId_version: { projectId: project.id, version: 1 } }
    })).commercialAppRevision, 0);
    assert.equal((await listCommercialAppRevisions(project.id)).length, 2);
    assert.equal((await loadPlannedHours([project.id])).get(project.id).hoursPlan.commercial.total, 120,
      'revisão em staging não altera horas do cronograma');
    assert.equal(Number((await planned())[0].systems[0].quantity), 60);
    await assert.rejects(() => receiveCommercialAppProposal({ ...second, salePrice: 9999 }),
      error => error instanceof CommercialAppBridgeError && error.status === 409);
    await prisma.projectBudget.update({
      where: { projectId_version: { projectId: project.id, version: 1 } },
      data: { source: 'ACCESS_IMPORT' }
    });
    assert.equal((await receiveCommercialAppProposal(first)).budgetStatus, 'STAGED',
      'reenvio não importa escopo quando o orçamento vigente passou ao Access');
    assert.equal(Number((await planned())[0].systems[0].quantity), 60);
    await assert.rejects(() => selectCommercialAppRevision(project.id, second.proposalId, null),
      error => error instanceof CommercialAppBridgeError && error.status === 409);
    assert.equal((await selectCommercialAppRevision(project.id, second.proposalId, null,
      { replaceLegacy: true })).budgetStatus,
      'SELECTED');
    assert.equal((await prisma.projectBudget.findUnique({
      where: { projectId_version: { projectId: project.id, version: 1 } }
    })).commercialAppRevision, 1);
    assert.equal((await loadPlannedHours([project.id])).get(project.id).hoursPlan.commercial.total, 130);
    assert.equal(Number((await planned())[0].systems[0].quantity), 80);
  });
