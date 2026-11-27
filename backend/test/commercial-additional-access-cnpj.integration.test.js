import assert from 'node:assert/strict';
import test from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { receiveCommercialAppProposal } from '../src/lib/acompanhamento/comercialapp-bridge.js';
import { setProjectBudgetRevision } from '../src/lib/acompanhamento/access-import.js';
import { rawHours, additionalPayload } from './helpers/commercial-additional-fixture.js';
const databaseUrl = process.env.TEST_DATABASE_URL;

test('adicional do ComercialAPP aceita mãe do Access com CNPJ sem zeros à esquerda', { skip: !databaseUrl }, async t => {
  assert.equal(new URL(databaseUrl).pathname, '/filtroapp_bridge_test');
  const code = randomInt(20_000_000, 30_000_000), ids = [];
  const project = await prisma.project.create({ data: { code: `cnpj-${randomUUID()}`, name: 'CNPJ Access QA',
    clientName: 'Cliente QA', clientCnpj: '01785706000179', contractCode: String(code), commercialProposalCode: String(code), location: 'Sede' } });
  t.after(async () => {
    await prisma.commercialAppDelivery.deleteMany({ where: { externalId: { in: ids } } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.commercialProposal.deleteMany({ where: { codProp: code } });
    await prisma.$disconnect();
  });
  // O Access armazena o CNPJ como número: 01785706000179 chega como 1785706000179.
  await prisma.commercialProposal.create({ data: { codBd: code, codProp: code, clientCnpj: '1785706000179',
    salePrice: 100_000, plannedCost: 60_000, expectedProfit: 40_000, rawRow: rawHours(1000), isComplete: true } });
  await setProjectBudgetRevision(project.id, code);
  const payload = additionalPayload(project.id, code, code + 1);
  payload.client = { ...payload.client, cnpj: '01.785.706/0001-79' };
  ids.push(payload.proposalId);
  assert.equal((await receiveCommercialAppProposal(payload)).budgetStatus, 'SELECTED');

  const other = additionalPayload(project.id, code, code + 2);
  other.client = { ...other.client, cnpj: '11785706000179' };
  ids.push(other.proposalId);
  await assert.rejects(receiveCommercialAppProposal(other), error => error.status === 422);
});
