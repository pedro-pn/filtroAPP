import assert from 'node:assert/strict';
import test from 'node:test';
import reportsRouter from '../src/routes/resources/reports.js';
import { createReportSearchMatcher } from '../src/lib/reports/search.js';
import prisma from '../src/lib/prisma.js';

const report = (id, code, overrides = {}) => ({
  id, projectId: `project-${code}`, reportType: 'RTP', status: 'APPROVED',
  sequenceNumber: 52, project: { code, name: 'Reframax' },
  ...overrides
});

test('report search matches visible fields without joining unrelated numbers', () => {
  assert.equal(createReportSearchMatcher('5800')(report('r1', '5800')), true);
  assert.equal(createReportSearchMatcher('5800')(report('r2', '5837', {
    dailyDescription: '58', reviewNotes: '00'
  })), false);
  assert.equal(createReportSearchMatcher('/')(report('r3', '5837')), false);
  assert.equal(createReportSearchMatcher('joao pressao')(report('r4', '5800', {
    createdBy: { name: 'João' }, specialConditions: { serviceData: { description: 'Teste de pressão' } }
  })), true);
  assert.equal(createReportSearchMatcher('12345678000190')(report('r5', '5800', {
    project: { clientCnpj: '12.345.678/0001-90' }
  })), true);
});

function list(query, user = { id: 'manager', role: 'MANAGER' }) {
  const handler = reportsRouter.stack.find(layer => layer.route?.path === '/' && layer.route.methods.get).route.stack.at(-1).handle;
  return new Promise((resolve, reject) => handler({ query, auth: { user } }, { json: resolve }, reject));
}

test('search hydrates only the matching page and preserves totals and access filters', async t => {
  const candidates = [report('r1', '5800'), report('r2', '5837'), report('r3', '5800')];
  const calls = [];
  const original = prisma.report.findMany;
  t.after(() => { prisma.report.findMany = original; });
  prisma.report.findMany = async args => {
    calls.push(args);
    return args.where.id ? candidates.filter(item => args.where.id.in.includes(item.id)) : candidates;
  };
  const response = await list({ search: '5800', statuses: 'APPROVED,SIGNED', projectActive: 'true', summary: 'true', page: '2', pageSize: '1' });
  assert.deepEqual(response.items.map(item => item.id), ['r3']);
  assert.equal(response.pagination.total, 2);
  assert.equal(response.meta.projectTotal, 1);
  assert.deepEqual(response.groups, [{ projectId: 'project-5800', reportType: 'RTP', total: 2 }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].select.reportSignatures, undefined);
  assert.ok(calls[1].select.reportSignatures);
  assert.deepEqual(calls[1].where, { ...calls[0].where, id: { in: ['r3'] } });
  assert.equal(calls[0].where.project.isActive, true);
  assert.equal(calls[0].where.deletedAt, null);
  assert.deepEqual(calls[0].where.status, { in: ['APPROVED', 'SIGNED'] });
});

test('empty and one-character searches never fall back to the unfiltered list', async t => {
  const original = prisma.report.findMany;
  t.after(() => { prisma.report.findMany = original; });
  prisma.report.findMany = async () => [report('r1', '5800')];
  for (const search of ['9999', 'z']) {
    const response = await list({ search, summary: 'true', page: '1', pageSize: '25' });
    assert.deepEqual(response.items, []);
    assert.equal(response.pagination.total, 0);
  }
});
