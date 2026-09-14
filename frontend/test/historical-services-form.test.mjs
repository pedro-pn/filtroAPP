import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { parseHistoricalServicesCsv } from '../../backend/src/lib/reports/historical-services.js';

test('manual form round-trips equipment names, quotes, fractions and decimal quantities through the real CSV parser', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { historicalReportForm, historicalFormCsv, historicalTotals } = await server.ssrLoadModule('/src/pages/gestor/historicalServicesForm.ts');
    const report = { reportType: 'RLQ', sequenceNumber: 1, reportDate: '2026-01-01T00:00:00.000Z', items: [
      { serviceType: 'limpeza', equipment: 'UG "01"; cliente', system: 'Kaplan\nLinha A', diameter: '1 1/2', quantity: 35.125, unit: 'm' },
      { serviceType: 'limpeza', equipment: 'UG "01"; cliente', system: 'Kaplan\nLinha A', diameter: '3', quantity: 45, unit: 'm' }
    ] };
    const parsed = parseHistoricalServicesCsv(historicalFormCsv(historicalReportForm(report)));
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.reports[0].items, report.items);
    const mmReport = { ...report, items: [{ ...report.items[0], diameter: '50', diameterUnit: 'mm' }] };
    const mmRoundTrip = parseHistoricalServicesCsv(historicalFormCsv(historicalReportForm(mmReport)));
    assert.deepEqual(mmRoundTrip.errors, []);
    assert.deepEqual(mmRoundTrip.reports[0].items, mmReport.items);
    assert.deepEqual(historicalTotals([...report.items, { serviceType: 'filtragem', quantity: 5000, unit: 'L' }]), [
      { serviceType: 'limpeza', unit: 'm', quantity: 80.125 }, { serviceType: 'filtragem', unit: 'L', quantity: 5000 }
    ]);
    assert.deepEqual(historicalTotals([
      { serviceType: 'limpeza', quantity: 3500, unit: 'cm' }, { serviceType: 'limpeza', quantity: 45, unit: 'm' },
      { serviceType: 'filtragem', quantity: 5000000, unit: 'mL' }, { serviceType: 'filtragem', quantity: 100, unit: 'L' }
    ]), [{ serviceType: 'limpeza', unit: 'm', quantity: 80 }, { serviceType: 'filtragem', unit: 'L', quantity: 5100 }]);
  } finally { await server.close(); }
});
