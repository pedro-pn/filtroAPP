import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadReportFileName() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/utils/reportFileName.ts');
  } finally {
    await server.close();
  }
}

function report(reportType) {
  return {
    reportType,
    sequenceNumber: 7,
    project: { code: '123', name: 'Teste' },
    specialConditions: {
      serviceData: {
        'ID da embarcação': '51632',
        Steps: '4'
      }
    }
  };
}

test('RLI download filename follows RLF naming pattern with only the report type changed', async () => {
  const { reportDownloadFileName } = await loadReportFileName();

  assert.equal(
    reportDownloadFileName(report('RLI'), 'pdf'),
    'Missão 123 Teste - RLI 7 - 51632 - 51632M004.pdf'
  );
  assert.equal(
    reportDownloadFileName(report('RLI'), 'docx'),
    'Missão 123 Teste - RLI 7 - 51632 - 51632M004.docx'
  );
  assert.equal(
    reportDownloadFileName(report('RLF'), 'pdf'),
    'Missão 123 Teste - RLF 7 - 51632 - 51632M004.pdf'
  );
  assert.equal(
    reportDownloadFileName(report('RLF'), 'docx'),
    'Missão 123 Teste - RLF 7 - 51632 - 51632M004.docx'
  );
});
