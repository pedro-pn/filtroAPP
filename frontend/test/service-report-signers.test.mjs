import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('cliente dispensado dos serviços continua podendo assinar o RDO', async () => {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    const { clientCanSignReport } = await server.ssrLoadModule('/src/utils/clientSignature.ts');
    for (const onlyPrimary of [true, false]) {
      const report = {
        reportType: 'RTP', status: 'APPROVED',
        project: {
          requireServiceReportSignatures: true,
          clientEmailPrimary: 'primary@example.com',
          clientSignerSignsServiceReports: onlyPrimary,
          clientSigners: [{ email: 'fiscal@example.com', signsServiceReports: !onlyPrimary }]
        }
      };
      for (const [email, canSign] of [['primary@example.com', onlyPrimary], ['fiscal@example.com', !onlyPrimary]]) {
        const user = { username: email };
        assert.equal(clientCanSignReport(report, user), canSign);
        assert.equal(clientCanSignReport({ ...report, reportType: 'RDO' }, user), true);
      }
      assert.equal(clientCanSignReport(report, { username: 'outside@example.com' }), false);
    }
    const legacy = {
      reportType: 'RTP', status: 'APPROVED',
      project: { requireServiceReportSignatures: true, clientEmailPrimary: 'primary@example.com', clientSigners: [{ email: 'fiscal@example.com' }] }
    };
    assert.equal(clientCanSignReport(legacy, { username: 'primary@example.com' }), true);
    assert.equal(clientCanSignReport(legacy, { username: 'fiscal@example.com' }), true);
  } finally {
    await server.close();
  }
});
