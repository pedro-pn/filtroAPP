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

test('manual report metadata is recognized from the uploaded PDF filename', async () => {
  const { manualReportMetadataFromFileName } = await loadReportFileName();

  assert.deepEqual(
    manualReportMetadataFromFileName(
      'Missão 5724 - Thyssenkrupp - RDO 12 - 21-10-2025 - Terça.pdf',
      'RDO'
    ),
    { sequenceNumber: '12', reportDate: '2025-10-21' }
  );
  assert.deepEqual(
    manualReportMetadataFromFileName('Missão 5724 - Cliente - RDO Nº 003 - 2.1.2026.pdf', 'RDO'),
    { sequenceNumber: '3', reportDate: '2026-01-02' }
  );
});

test('manual report metadata ignores the mission number and invalid dates', async () => {
  const { manualReportMetadataFromFileName } = await loadReportFileName();

  assert.deepEqual(
    manualReportMetadataFromFileName('Missão 5724 - Cliente - RTP 8 - 31-02-2025.pdf', 'RDO'),
    { sequenceNumber: '', reportDate: '' }
  );
  assert.deepEqual(
    manualReportMetadataFromFileName('Missão 5724 - Cliente - RDO 8 - sem data.pdf', 'RDO'),
    { sequenceNumber: '8', reportDate: '' }
  );
});
