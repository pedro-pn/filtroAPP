import assert from 'node:assert/strict';
import test from 'node:test';
import router from '../src/routes/resources/reports.js';
import { manualReportOperationalDataSchema } from '../src/lib/reports/manual-operational-data.js';
import { isValidReportDate, REPORT_DATE_ERROR } from '../../shared/modules/report-date.js';

test('datas de relatório aceitam o calendário real e os anos suportados', () => {
  for (const date of ['1900-01-01', '2024-02-29', '2026-10-08', '2100-12-31', '2026-10-08T00:00:00.000Z', new Date('2026-10-08')]) {
    assert.equal(isValidReportDate(date), true, String(date));
  }
  for (const date of ['0027-10-08', '1899-12-31', '2101-01-01', '2026-02-30', '2026-02-29', '2100-02-29', '2026-10-08Tinválido', '', null, new Date('0027-10-08'), new Date(NaN)]) {
    assert.equal(isValidReportDate(date), false, String(date));
  }
});

const common = {
  projectId: 'reframax', createdByUserId: 'manager', reportDate: '0027-10-08',
  arrivalTime: '07:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1,
  services: [{ serviceType: 'limpeza', startTime: '07:00', endTime: '17:00', finalized: true }]
};

test('criação, edição, serviço independente e upload rejeitam o ano 0027 antes da persistência', async () => {
  for (const [method, path, body] of [
    ['post', '/', common],
    ['put', '/:id', common],
    ['post', '/service-only', common],
    ['post', '/manual-upload', { projectId: 'reframax', reportDate: '0027-10-08', pdfDataUrl: 'data:application/pdf;base64,cGRm' }]
  ]) {
    const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    await assert.rejects(new Promise((resolve, reject) => {
      const res = { json: resolve, status() { return this; } };
      route.stack.at(-1).handle({ body, params: { id: 'rdo' }, auth: { user: { id: 'manager', role: 'MANAGER' } } }, res, reject);
    }), error => error.name === 'ZodError' && error.issues.some(issue =>
      issue.path[0] === 'reportDate' && issue.message === REPORT_DATE_ERROR
    ), `${method} ${path}`);
  }
});

test('edição operacional de relatório manual valida o ano e mantém a data opcional', () => {
  assert.throws(() => manualReportOperationalDataSchema.parse({ reportDate: '0027-10-08' }), { name: 'ZodError' });
  assert.equal(manualReportOperationalDataSchema.parse({ reportDate: '2026-10-08' }).reportDate, '2026-10-08');
  assert.equal(manualReportOperationalDataSchema.parse({}), undefined);
});
