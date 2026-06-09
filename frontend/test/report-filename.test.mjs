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
        Sistema: '53100;FRESHWATER GENERATION SYSTEM;00051632-53100-K-0010',
        Steps: '60'
      }
    }
  };
}

test('RLI/RLF download filename uses selected system code and step', async () => {
  const { reportDownloadFileName } = await loadReportFileName();

  assert.equal(
    reportDownloadFileName(report('RLI'), 'pdf'),
    'Missão 123 Teste - RLI 7 - 53100 - 53100M0060.pdf'
  );
  assert.equal(
    reportDownloadFileName(report('RLI'), 'docx'),
    'Missão 123 Teste - RLI 7 - 53100 - 53100M0060.docx'
  );
  assert.equal(
    reportDownloadFileName(report('RLF'), 'pdf'),
    'Missão 123 Teste - RLF 7 - 53100 - 53100M0060.pdf'
  );
  assert.equal(
    reportDownloadFileName(report('RLF'), 'docx'),
    'Missão 123 Teste - RLF 7 - 53100 - 53100M0060.docx'
  );
});
