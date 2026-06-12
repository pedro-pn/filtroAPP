import assert from 'node:assert/strict';
import test from 'node:test';

import AdmZip from 'adm-zip';

import { buildReportDocx, stringifyReportDocxValue } from '../src/lib/report-docx.js';
import { stringifyValue, wrapPdfText } from '../src/lib/report-pdf.js';

test('stringifyReportDocxValue formats collaborator objects by names', () => {
  assert.equal(
    stringifyReportDocxValue({ ids: ['c1', 'c2'], names: ['Ana Lima', 'Bruno Dias'] }),
    'Ana Lima, Bruno Dias'
  );
});

test('stringifyReportDocxValue does not expose object string fallback', () => {
  assert.equal(stringifyReportDocxValue({ ids: ['c1', 'c2'] }), 'c1, c2');
  assert.equal(stringifyReportDocxValue({}), '');
});

test('stringifyValue formats object arrays for report pdf fields', () => {
  assert.equal(
    stringifyValue('Colaboradores do serviço', { ids: ['c1'], names: ['Ana Lima'] }),
    'Ana Lima'
  );
  assert.equal(
    stringifyValue('Unidade de Flushing', { ids: ['u1'], codes: ['UF-01'] }),
    'UF-01'
  );
});

test('wrapPdfText preserves explicit service observation line breaks', () => {
  const font = { widthOfTextAtSize: text => text.length };

  assert.deepEqual(
    wrapPdfText('Primeira linha\nSegunda linha', font, 9, 100),
    ['Primeira linha', 'Segunda linha']
  );
  assert.deepEqual(
    wrapPdfText('Primeira linha\r\n\r\nTerceira linha', font, 9, 100),
    ['Primeira linha', '', 'Terceira linha']
  );
});

test('buildReportDocx converts service observation line breaks to Word breaks', async () => {
  const report = {
    reportType: 'RDO',
    sequenceNumber: 1,
    reportDate: '2026-06-01',
    project: {
      code: 'P-1',
      name: 'Projeto',
      clientName: 'Cliente',
      clientCnpj: '',
      location: 'Local',
      contractCode: '',
      operator: {}
    },
    services: [
      {
        serviceType: 'limpeza',
        finalized: true,
        extraData: {
          'Equipamento(s)': 'EQ-01',
          Sistema: 'SIS',
          Observações: 'Primeira linha\nSegunda linha'
        }
      }
    ],
    collaborators: []
  };

  const zip = new AdmZip(await buildReportDocx(report));
  const xml = zip.readAsText('word/document.xml');

  assert.match(xml, /Primeira linha[\s\S]*<w:br\s*\/>[\s\S]*Segunda linha/);
  assert.doesNotMatch(xml, /Primeira linha\r?\nSegunda linha/);
});

test('buildReportDocx hides rejected overtime from downloaded report without deleting internal data', async () => {
  const baseReport = {
    reportType: 'RDO',
    sequenceNumber: 1,
    reportDate: '2026-06-01',
    arrivalTime: '08:00',
    departureTime: '20:00',
    lunchBreak: '01:00',
    daytimeCount: 2,
    daytimeOvertimeMinutes: 90,
    nighttimeOvertimeMinutes: 30,
    overtimeReason: 'Atendimento emergencial',
    project: {
      code: 'P-1',
      name: 'Projeto',
      clientName: 'Cliente',
      clientCnpj: '',
      location: 'Local',
      contractCode: '',
      operator: {}
    },
    services: [],
    collaborators: []
  };

  const rejectedZip = new AdmZip(await buildReportDocx({
    ...baseReport,
    specialConditions: { overtimeAccepted: false }
  }));
  const rejectedXml = rejectedZip.readAsText('word/document.xml');
  assert.doesNotMatch(rejectedXml, /Atendimento emergencial/);
  assert.doesNotMatch(rejectedXml, /01:30/);
  assert.doesNotMatch(rejectedXml, /00:30/);

  const acceptedZip = new AdmZip(await buildReportDocx({
    ...baseReport,
    specialConditions: {}
  }));
  const acceptedXml = acceptedZip.readAsText('word/document.xml');
  assert.match(acceptedXml, /Atendimento emergencial/);
  assert.match(acceptedXml, /01:30/);
  assert.match(acceptedXml, /00:30/);
});
