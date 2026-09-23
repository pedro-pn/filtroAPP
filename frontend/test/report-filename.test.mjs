import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadModule(modulePath = '/src/utils/reportFileName.ts') {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule(modulePath);
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
  const { reportDownloadFileName } = await loadModule();

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
  const { manualReportMetadataFromFileName } = await loadModule();

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
  const { manualReportMetadataFromFileName } = await loadModule();

  assert.deepEqual(
    manualReportMetadataFromFileName('Missão 5724 - Cliente - RTP 8 - 31-02-2025.pdf', 'RDO'),
    { sequenceNumber: '', reportDate: '' }
  );
  assert.deepEqual(
    manualReportMetadataFromFileName('Missão 5724 - Cliente - RDO 8 - sem data.pdf', 'RDO'),
    { sequenceNumber: '8', reportDate: '' }
  );
});

test('manual service reports recognize the standard and legacy filename numbers', async () => {
  const { manualReportMetadataFromFileName, reportDownloadFileName } = await loadModule();

  for (const reportType of ['RTP', 'RLQ', 'RCPU', 'RLM', 'RLI', 'RLF']) {
    assert.equal(
      manualReportMetadataFromFileName(reportDownloadFileName(report(reportType), 'pdf'), reportType).sequenceNumber,
      '7'
    );
    for (const prefix of [`${reportType}017`, `${reportType}-017`, `${reportType}_017`, `${reportType} Nº 017`]) {
      assert.equal(
        manualReportMetadataFromFileName(`Missão 5719 Ilha Solteira - ${prefix} - UG01 - Sistema 53100.pdf`, reportType).sequenceNumber,
        '17'
      );
    }
    assert.equal(manualReportMetadataFromFileName('Missão 5719 - UG01 - Sistema 53100.pdf', reportType).sequenceNumber, '');
    assert.equal(manualReportMetadataFromFileName('Missão 5719 - RDO 17.pdf', reportType).sequenceNumber, '');
  }
});

test('selecting the service type after the PDF fills each report number', async () => {
  const { updateManualReportUploadFileType } = await loadModule('/src/pages/gestor/manualReportUploadFile.ts');
  const files = [17, 18].map(number => ({
    fileName: `Missão 5719 Ilha Solteira - RLQ ${number} - UG01 - Mancal.pdf`,
    sequenceNumber: '',
    reportDate: '2026-04-01',
    serviceEquipment: 'UG01',
    serviceSystem: 'Mancal',
    arrivalTime: '08:00',
    departureTime: '17:00',
    collaboratorIds: ['col-1']
  }));

  const updated = files.map(file => updateManualReportUploadFileType(file, 'RDO', 'RLQ'));
  assert.deepEqual(updated, files.map((file, index) => ({ ...file, sequenceNumber: String(17 + index) })));
  assert.equal(files[0].sequenceNumber, '');

  const mismatched = updateManualReportUploadFileType(updated[0], 'RLQ', 'RCPU');
  assert.equal(mismatched.sequenceNumber, '');
  assert.equal(updateManualReportUploadFileType(mismatched, 'RCPU', 'RLQ').sequenceNumber, '17');
});

test('changing the upload type preserves a corrected report number', async () => {
  const { updateManualReportUploadFileType } = await loadModule('/src/pages/gestor/manualReportUploadFile.ts');
  const file = {
    fileName: 'Missão 5719 - RLQ 017 - UG01 - Mancal.pdf',
    sequenceNumber: '42',
    serviceEquipment: 'UG01',
    serviceSystem: 'Mancal'
  };

  assert.equal(updateManualReportUploadFileType(file, 'RDO', 'RLQ').sequenceNumber, '42');
  assert.equal(updateManualReportUploadFileType(file, 'RLQ', 'RCPU').sequenceNumber, '42');
});
