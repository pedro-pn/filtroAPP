import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import prisma from '../src/lib/prisma.js';
import { computeProjectProgressDetails } from '../src/lib/acompanhamento/avanco.js';
import { assertReportServicesProject } from '../src/lib/reports/service-project-validation.js';
import { syncCommercialAppScope } from '../src/lib/acompanhamento/commercialapp-scope.js';
import { getProjectDetail } from '../src/lib/acompanhamento/project-detail.js';
import { listProjectCards } from '../src/lib/acompanhamento/project-cards.js';

const databaseUrl = process.env.MECHANICAL_SCOPE_TEST_DATABASE_URL;
test('PostgreSQL e HTTP: metas mecânicas, relatório por kg e locação sem relatórios ou responsável', { skip: !databaseUrl }, async t => {
  assert.equal(process.env.DATABASE_URL, databaseUrl);
  const target = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
  assert.match(target.pathname, /^\/filtroapp_[a-z0-9_]*test[a-z0-9_]*$/);
  const { default: app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const projectIds = [];
  const user = await prisma.user.create({ data: { username: `mechanical-${randomUUID()}`, name: 'Escopo QA',
    role: 'MANAGER', passwordHash: 'synthetic', accountType: 'ADMIN', reportEmissionPermissions: ['SITE_RDO'],
    moduleRoles: { create: [{ module: 'RDO', role: 'RDO_MANAGER' }, { module: 'ACOMPANHAMENTO', role: 'ACOMPANHAMENTO_MANAGER' }] } } });
  const token = randomUUID();
  await prisma.userSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600_000) } });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await prisma.report.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const create = async data => {
    const response = await fetch(`${api}/projects`, { method: 'POST', headers, body: JSON.stringify({
      code: randomUUID(), name: 'Escopo QA', clientName: 'Cliente QA', clientCnpj: '12345678000190',
      contractCode: 'SEM PROPOSTA', location: 'Sede', ...data
    }) });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    projectIds.push(body.id); return body;
  };
  const project = await create({ serviceCategory: 'SERVICE' });
  const savedScopeResponse = await fetch(`${api}/acompanhamento/comercial/projetos/${project.id}/escopo-previsto`, {
    method: 'PUT', headers, body: JSON.stringify({ services: [{ serviceType: 'LIMPEZA_MECANICA', scopeName: 'Retirada de resíduos', weight: 100,
      systems: [{ equipment: 'UG 01', systemName: 'Resíduos', systemType: 'MECANICA_KG', quantity: 100, unit: 'KG' }] }] })
  });
  const savedScope = await savedScopeResponse.json();
  assert.equal(savedScopeResponse.status, 200, JSON.stringify(savedScope));
  const row = savedScope.services[0].systems[0];
  assert.equal(row.unit, 'KG');
  const systemResponse = await fetch(`${api}/reports/project-systems/${project.id}`, { headers });
  const systems = await systemResponse.json();
  assert.equal(systems[0].measurements[0].unit, 'KG');
  const service = { serviceType: 'mecanica', finalized: true, system: 'Resíduos', extraData: {
    equipmentId: 'UG 01', __projectSystemId: row.projectSystemId, unidadeMecanica: 'KG', quantidadeMecanica: '25'
  } };
  await assertReportServicesProject(prisma, project, [service]);
  await prisma.report.create({ data: { projectId: project.id, createdByUserId: user.id, reportType: 'RDO', status: 'APPROVED',
    reportDate: new Date('2026-10-23'), arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1,
    services: { create: service } } });
  assert.equal((await computeProjectProgressDetails(project.id)).progress.progressPct, 25);

  const rental = await create({ serviceCategory: 'RENTAL', operatorId: 'ignored-operator', startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.equal(rental.operatorId, null);
  assert.equal(rental.visibleToCollaborators, false);
  assert.equal(rental.defaultReportResponsibleUser, null);
  const invalidDates = await fetch(`${api}/projects/${rental.id}`, { method: 'PUT', headers, body: JSON.stringify({ endDate: '2026-09-01' }) });
  assert.equal(invalidDates.status, 400);
  await prisma.$transaction(tx => syncCommercialAppScope(tx, rental.id, { externalId: 'rental-rev', proposalCode: '4900',
    snapshot: { proposalSnapshot: { estimateNature: 'equipment_rental' }, costBreakdown: { equipmentRentals: [
      { id: 'unit-1', description: 'Unidade de filtragem', quantity: 2, days: 31, included: true }
    ] } } }));
  const rentalScope = await prisma.projectPlannedService.findMany({ where: { projectId: rental.id }, include: { systems: true } });
  assert.equal(rentalScope[0].serviceType, 'LOCACAO');
  assert.equal(rentalScope[0].systems[0].unit, 'DIA');
  assert.equal((await getProjectDetail(rental.id)).rentalTracking.plannedDays, 31);
  const card = (await listProjectCards()).find(card => card.projectId === rental.id);
  assert.equal(card.rentalTracking.plannedDays, 31);
  await assert.rejects(assertReportServicesProject(prisma, rental, [service]), /não recebem relatórios/);
});
