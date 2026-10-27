import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';

import { formatDateOnly, formatTimestampDate, todayDateOnly } from '../../shared/modules/date-only.js';
import { buildRomaneioDocx, buildRomaneioEmailHtml, buildRomaneioFileName } from '../src/lib/romaneio-docx.js';
import { buildChecklistFileName } from '../src/lib/romaneio/romaneio-checklist-docx.js';
import { buildEpiDocx } from '../src/lib/epi-docx.js';
import { formatScalar } from '../src/lib/equipment-technical-doc.js';
import { buildReportPdf } from '../src/lib/report-pdf.js';

function documentText(bytes) {
  const zip = new AdmZip(bytes);
  const doc = new DOMParser().parseFromString(zip.readAsText('word/document.xml'), 'text/xml');
  return doc.documentElement.textContent;
}

test('calendar dates preserve the selected day while timestamps use São Paulo', () => {
  for (const value of ['2026-11-01', '2026-11-01T00:00:00.000Z', new Date('2026-11-01T00:00:00Z')]) {
    assert.equal(formatDateOnly(value), '01/11/2026');
    assert.equal(formatScalar({ type: 'date' }, value), '01/11/2026');
  }
  assert.equal(formatTimestampDate('2026-11-01T00:00:00Z'), '31/10/2026');
  assert.equal(formatDateOnly(null, '-'), '-');
  assert.equal(formatDateOnly('invalid', '-'), '-');
  assert.equal(formatDateOnly(new Date(NaN), '-'), '-');
});

test('today changes at midnight in São Paulo, including month/year boundaries', () => {
  for (const [instant, expected] of [
    ['2026-11-01T00:00:00Z', '2026-10-31'],
    ['2026-11-01T02:59:59Z', '2026-10-31'],
    ['2026-11-01T03:00:00Z', '2026-11-01'],
    ['2027-01-01T02:59:59Z', '2026-12-31'],
    ['2027-01-01T03:00:00Z', '2027-01-01']
  ]) assert.equal(todayDateOnly(new Date(instant)), expected);
});

test('formatting is independent of the server timezone', () => {
  const moduleUrl = new URL('../../shared/modules/date-only.js', import.meta.url).href;
  const script = `import { formatDateOnly, todayDateOnly } from ${JSON.stringify(moduleUrl)};
    process.stdout.write(JSON.stringify([formatDateOnly('2026-11-01T00:00:00Z'), todayDateOnly(new Date('2026-11-01T01:00:00Z'))]));`;
  for (const TZ of ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo']) {
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(result), ['01/11/2026', '2026-10-31']);
  }
});

test('romaneio document, email and filenames keep the registered calendar date', async () => {
  const romaneio = {
    project: { code: '123', name: 'Missão' }, romaneioDate: new Date('2026-11-01T00:00:00Z'),
    driverName: 'Motorista', vehiclePlate: 'ABC1234', items: [], responsibleName: 'Responsável'
  };
  assert.match(buildRomaneioFileName(romaneio), /01-11-2026\.docx$/);
  assert.match(buildChecklistFileName(romaneio), /01-11-2026\.pdf$/);
  assert.match(buildRomaneioEmailHtml(romaneio), /01\/11\/2026/);
  assert.match(documentText(await buildRomaneioDocx(romaneio)), /01\/11\/2026/);
});

test('RDO PDF keeps its report date when the server is in São Paulo', async () => {
  const originalTimezone = process.env.TZ;
  let bytes;
  try {
    process.env.TZ = 'America/Sao_Paulo';
    bytes = await buildReportPdf({ reportType: 'RDO', sequenceNumber: 1,
      reportDate: new Date('2026-11-01T00:00:00Z'), project: {}, services: [], collaborators: [] }, {});
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: bytes });
  try {
    const pdf = await task.promise;
    const text = await (await pdf.getPage(1)).getTextContent();
    assert.ok(text.items.some(item => item.str === '01/11/2026'));
    assert.ok(!text.items.some(item => item.str === '31/10/2026'));
  } finally { await task.destroy(); }
});

test('EPI document preserves admission and supply dates and converts its creation timestamp', async () => {
  const text = documentText(await buildEpiDocx({
    name: 'Colaborador', admissionDate: new Date('2026-11-01T00:00:00Z'),
    createdAt: new Date('2026-11-02T01:00:00Z'),
    epiRecords: [{ id: 'epi', rowNumber: 1, epiName: 'Luva', quantity: 1, ca: '123',
      lendDate: new Date('2026-11-03T00:00:00Z'), devolutionDate: new Date('2026-11-04T00:00:00Z'),
      createdAt: new Date('2026-11-02T01:00:00Z') }]
  }));
  for (const date of ['01/11/2026', '03/11/2026', '04/11/2026']) assert.ok(text.includes(date), date);
  assert.ok(!text.includes('31/10/2026'));
});
