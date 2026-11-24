import assert from 'node:assert/strict';
import test from 'node:test';
import { reportDateFromWhere, reportListSummary } from '../src/lib/reports/report-route-helpers.js';

test('resumo da lista remove a assinatura histórica preservando identificação e dados usados na busca', () => {
  const report = { id: 'r1', specialConditions: {
    __leaderSnapshot: { name: 'Responsável', role: 'Técnico', signatureImage: 'data:image/png;base64,large' },
    serviceData: { client: 'Cliente', system: 'Sistema' },
    dds: [{ name: 'Segurança' }]
  } };
  const summary = reportListSummary(report);
  assert.deepEqual(summary, { id: 'r1', specialConditions: {
    __leaderSnapshot: { name: 'Responsável', role: 'Técnico' },
    serviceData: report.specialConditions.serviceData,
    dds: report.specialConditions.dds
  } });
  assert.equal(report.specialConditions.__leaderSnapshot.signatureImage, 'data:image/png;base64,large');
});

test('resumo tolera relatórios sem snapshot e sem condições especiais', () => {
  for (const report of [{ id: 'r1' }, { specialConditions: null }, { specialConditions: {} }, { specialConditions: { __leaderSnapshot: null } }]) {
    assert.equal(reportListSummary(report), report);
  }
});

test('data inicial inclui todo o dia do escopo e os relatórios posteriores', () => {
  const where = reportDateFromWhere('2026-09-10');
  assert.equal(where.reportDate.gte.toISOString(), '2026-09-10T00:00:00.000Z');
  const dates = ['2026-09-09T23:59:59.999Z', '2026-09-10T00:00:00.000Z', '2026-09-10T12:00:00.000Z', '2026-10-01T00:00:00.000Z'];
  assert.deepEqual(dates.filter(date => new Date(date) >= where.reportDate.gte), dates.slice(1));
  assert.deepEqual(reportDateFromWhere(undefined), {});
  assert.deepEqual(reportDateFromWhere(null), {});
  assert.deepEqual(reportDateFromWhere(''), {});
});

test('data inicial rejeita formatos e dias inválidos em vez de ignorar o filtro', () => {
  for (const value of ['2026-02-29', '2026-09-31', '10/09/2026', '2026-09-10T00:00:00Z', ['2026-09-10'], 'inválida']) {
    assert.throws(() => reportDateFromWhere(value), error => error.statusCode === 400);
  }
  assert.equal(reportDateFromWhere('2024-02-29').reportDate.gte.toISOString(), '2024-02-29T00:00:00.000Z');
});
