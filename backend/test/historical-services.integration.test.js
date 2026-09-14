import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { HISTORICAL_CSV_TEMPLATE } from '../src/lib/reports/historical-services.js';

// Opt-in: this suite creates fixtures only in an explicitly designated test database.
test('historical import HTTP + PostgreSQL: permissions, preview, atomic writes, reimport, editing and progress', {
  skip: !process.env.HISTORICAL_TEST_DATABASE_URL
}, async t => {
  const databaseUrl = new URL(process.env.HISTORICAL_TEST_DATABASE_URL);
  assert.match(databaseUrl.pathname, /_test$/);
  process.env.DATABASE_URL = databaseUrl.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { computeProgressForProjects, computeProgressHistoryForProjects } = await import('../src/lib/acompanhamento/avanco.js');
  const suffix = randomUUID();
  const project = await prisma.project.create({ data: {
    code: `history-test-${suffix}`, name: 'Projeto antigo', clientName: 'Cliente teste', clientCnpj: '', contractCode: '', location: '', isActive: false,
    plannedServices: { create: { serviceType: 'LIMPEZA_QUIMICA', systems: { create: { systemType: 'TUBULACAO', quantity: 100, unit: 'M' } } } }
  } });
  const manager = await prisma.user.create({ data: {
    username: `history-manager-${suffix}`, name: 'Gestor teste', passwordHash: 'test-only', role: 'MANAGER', accountType: 'ADMIN',
    moduleRoles: { create: { module: 'RDO', role: 'RDO_MANAGER' } }
  } });
  const collaborator = await prisma.user.create({ data: {
    username: `history-collaborator-${suffix}`, name: 'Colaborador teste', passwordHash: 'test-only', role: 'COLLABORATOR', accountType: 'INTERNAL',
    moduleRoles: { create: { module: 'RDO', role: 'RDO_COLLABORATOR' } }
  } });
  const tokens = [randomUUID(), randomUUID()];
  await prisma.userSession.createMany({ data: [manager, collaborator].map((user, index) => ({
    userId: user.id, tokenHash: createHash('sha256').update(tokens[index]).digest('hex'), expiresAt: new Date(Date.now() + 600_000)
  })) });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await prisma.historicalServiceReport.deleteMany({ where: { projectId: project.id } });
    await prisma.report.deleteMany({ where: { projectId: project.id } });
    await prisma.projectPlannedService.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.user.deleteMany({ where: { id: { in: [manager.id, collaborator.id] } } });
    await prisma.$disconnect();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/rdo/reports/historical-services`;
  const request = async (path, method = 'GET', body, token = tokens[0]) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await request(`/${project.id}`, 'GET', undefined, '')).status, 401);
  assert.equal((await request(`/${project.id}`, 'GET', undefined, tokens[1])).status, 403);
  const importCsv = HISTORICAL_CSV_TEMPLATE.replace(';2;35;m', ";2';3500;cm").replace(';5000;L', ';5000000;mL');
  let preview = await request(`/${project.id}/preview`, 'POST', { csv: importCsv });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.canImport, true);
  assert.equal(await prisma.historicalServiceReport.count({ where: { projectId: project.id } }), 0);
  const importBody = { csv: importCsv, token: preview.data.token, fileName: 'levantamento.csv' };
  const imported = await request(`/${project.id}/import`, 'POST', importBody);
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  assert.deepEqual(imported.data, { created: 5, skipped: 0 });
  assert.deepEqual((await request(`/${project.id}/import`, 'POST', importBody)).data, { created: 0, skipped: 5 });
  const progress = (await computeProgressForProjects([project.id])).get(project.id);
  assert.equal(progress.services[0].systems[0].realizedQty, 80);
  const history = (await computeProgressHistoryForProjects([project.id])).get(project.id);
  assert.ok(history);
  const listed = await request(`/${project.id}`);
  const rlq = listed.data.items.find(report => report.reportType === 'RLQ' && report.sequenceNumber === 1);
  const editedCsv = HISTORICAL_CSV_TEMPLATE.split('\r\n').filter(line => line.includes('Relatorio') || line.startsWith('RLQ;001;')).join('\n').replace(';35;m', ';36;m');
  const edited = await request(`/${project.id}/${rlq.id}`, 'PUT', { csv: editedCsv, revision: 1 });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.revision, 2);
  assert.equal((await request(`/${project.id}/${rlq.id}`, 'PUT', { csv: editedCsv, revision: 1 })).status, 409);
  assert.equal((await computeProgressForProjects([project.id])).get(project.id).services[0].systems[0].realizedQty, 81);
  preview = await request(`/${project.id}/preview`, 'POST', { csv: HISTORICAL_CSV_TEMPLATE });
  assert.equal(preview.data.canImport, false);
  assert.equal(preview.data.reports.find(report => report.reportType === 'RLQ').action, 'CONFLICT');
  // A later native report with the same identity supersedes the historical source.
  await prisma.report.create({ data: {
    projectId: project.id, reportType: 'RLQ', sequenceNumber: 1, reportDate: new Date('2026-01-01'),
    arrivalTime: '00:00', departureTime: '00:00', lunchBreak: '00:00', daytimeCount: 0, status: 'APPROVED',
    services: { create: { serviceType: 'limpeza', finalized: true, extraData: { tubes: [{ c: 81, lengthUnit: 'm', d: '2', unit: 'pol' }] } } }
  } });
  assert.equal((await computeProgressForProjects([project.id])).get(project.id).services[0].systems[0].realizedQty, 81);
  assert.equal(await prisma.equipment.count(), 0);
  const pressureCsv = HISTORICAL_CSV_TEMPLATE.split('\r\n').filter(line => line.includes('Relatorio') || line.startsWith('RTP')).join('\n').replace('RTP;001;', 'RTP;099;');
  const countBefore = await prisma.historicalServiceReport.count({ where: { projectId: project.id } });
  const invalidCsv = `${pressureCsv}\nRLQ;999;31/02/2026;Limpeza química;UG;Kaplan;2;35;m`;
  const invalidPreview = await request(`/${project.id}/preview`, 'POST', { csv: invalidCsv });
  assert.equal(invalidPreview.data.canImport, false);
  assert.equal((await request(`/${project.id}/import`, 'POST', { csv: invalidCsv, token: invalidPreview.data.token })).status, 409);
  assert.equal(await prisma.historicalServiceReport.count({ where: { projectId: project.id } }), countBefore);
  const concurrentPreview = await request(`/${project.id}/preview`, 'POST', { csv: pressureCsv });
  const concurrentBody = { csv: pressureCsv, token: concurrentPreview.data.token };
  const concurrent = await Promise.all([
    request(`/${project.id}/import`, 'POST', concurrentBody), request(`/${project.id}/import`, 'POST', concurrentBody)
  ]);
  assert.ok(concurrent.some(response => response.status === 201));
  assert.ok(concurrent.every(response => [200, 201, 409].includes(response.status)));
  assert.equal(await prisma.historicalServiceReport.count({ where: { projectId: project.id, reportType: 'RTP', sequenceNumber: 99 } }), 1);
});
