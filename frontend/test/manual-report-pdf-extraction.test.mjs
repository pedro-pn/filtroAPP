import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadUploadModule() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom'
  });
  try {
    return {
      ...await server.ssrLoadModule('/src/pages/gestor/manualReportUploadFile.ts'),
      ...await server.ssrLoadModule('/src/components/reports/manualReportOperationalData.ts')
    };
  } finally {
    await server.close();
  }
}

const options = { reportType: 'RDO', baseDate: '2026-10-07', serviceEquipment: '', serviceSystem: '' };

test('importação preenche cada PDF com seus próprios horários e preserva data/número do nome', async () => {
  const { readManualReportUploadFiles, buildManualReportOperationalData } = await loadUploadModule();
  const files = [
    { name: 'Missão 5772 - UHE Passo Real - RDO 12 - 07-04-2026 - Terça.pdf' },
    { name: 'Missão 5772 - UHE Passo Real - RDO 13 - 08-04-2026 - Quarta.pdf' }
  ];
  const extracted = [
    { arrivalTime: '07:10', departureTime: '17:30', lunchBreak: '00:45:00' },
    {
      arrivalTime: '08:00', departureTime: '18:00', lunchBreak: '00:30:00',
      noturno: true, noturnoStart: '22:00', noturnoEnd: '05:00', noturnoInterval: '00:40:00',
      standby: true, standbyDuration: '02:00:00', standbyMotivo: 'Aguardando liberação'
    }
  ];
  let index = 0;
  const uploaded = await readManualReportUploadFiles(files, options, {
    readDataUrl: async file => `data:application/pdf;base64,${file.name}`,
    extract: async pdfDataUrl => {
      assert.ok(pdfDataUrl.endsWith(files[index].name));
      return { fields: extracted[index++], source: 'text', warnings: [] };
    }
  });
  assert.deepEqual(uploaded.map(file => file.sequenceNumber), ['12', '13']);
  assert.deepEqual(uploaded.map(file => file.reportDate), ['2026-04-07', '2026-04-08']);
  assert.notEqual(uploaded[0].id, uploaded[1].id);
  assert.deepEqual(buildManualReportOperationalData(uploaded[0], 'RDO'), extracted[0]);
  assert.deepEqual(buildManualReportOperationalData(uploaded[1], 'RDO'), {
    arrivalTime: '08:00', departureTime: '18:00', lunchBreak: '00:30:00',
    noturno: { enabled: true, inicio: '22:00', termino: '05:00', intervalo: '00:40:00', collaboratorIds: [] },
    standby: { enabled: true, total: '02:00:00', motivo: 'Aguardando liberação' }
  });
});

test('falha na leitura de um arquivo mantém importação manual e permite extrair os demais', async () => {
  const { readManualReportUploadFiles, validateManualReportOperationalFields } = await loadUploadModule();
  let index = 0;
  const uploaded = await readManualReportUploadFiles([{ name: 'um.pdf' }, { name: 'dois.pdf' }], options, {
    readDataUrl: async file => file.name,
    extract: async () => {
      if (index++ === 0) throw new Error('OCR indisponível');
      return { fields: { standby: true, standbyDuration: '01:00:00' }, source: 'ocr', warnings: ['Informe o motivo do stand-by identificado no PDF.'] };
    }
  });
  assert.equal(uploaded.length, 2);
  assert.equal(uploaded[0].pdfDataUrl, 'um.pdf');
  assert.equal(uploaded[0].arrivalTime, '');
  assert.match(uploaded[0].extractionWarnings[0], /Preencha os campos manualmente/);
  assert.match(uploaded[1].extractionWarnings[0], /motivo do stand-by/);
  assert.match(validateManualReportOperationalFields(uploaded[1], { reportType: 'RDO' }), /motivo/);
});

test('horários extraídos continuam editáveis e a correção é enviada ao salvar', async () => {
  const { readManualReportUploadFiles, buildManualReportOperationalData } = await loadUploadModule();
  const [file] = await readManualReportUploadFiles([{ name: 'RDO 12 - 07-04-2026.pdf' }], options, {
    readDataUrl: async () => 'pdf',
    extract: async () => ({ fields: { arrivalTime: '07:10', departureTime: '17:30', lunchBreak: '01:00:00' }, source: 'text', warnings: [] })
  });
  const corrected = { ...file, departureTime: '18:00', lunchBreak: '00:30:00' };
  assert.equal(buildManualReportOperationalData(corrected, 'RDO').departureTime, '18:00');
  assert.equal(buildManualReportOperationalData(corrected, 'RDO').lunchBreak, '00:30:00');
  assert.equal(file.departureTime, '17:30');
});
