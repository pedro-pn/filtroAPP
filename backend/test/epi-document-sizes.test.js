import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { buildEpiDocx } from '../src/lib/epi-docx.js';
import { appendEpiEvidencePages } from '../src/lib/epi/evidence-pdf.js';

function collaborator(epiRecords) {
  return { id: 'collaborator', name: 'Colaborador', epiRecords };
}

function record(id, size) {
  return {
    id, epiName: `Equipamento ${id}`, size, ca: '12345', quantity: 1,
    lendDate: new Date('2026-11-16T15:00:00Z'),
    createdAt: new Date('2026-11-16T15:00:00Z')
  };
}

function equipmentDescriptionsFromBytes(bytes) {
  const zip = new AdmZip(bytes);
  const xml = zip.readAsText('word/document.xml');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const rows = Array.from(doc.getElementsByTagName('w:tr'));
  return rows.flatMap(row => {
    const cells = Array.from(row.getElementsByTagName('w:tc'));
    return cells[0]?.textContent.startsWith('Equipamento ')
      ? [cells[0].textContent]
      : [];
  });
}

async function equipmentDescriptions(records, options) {
  return equipmentDescriptionsFromBytes(await buildEpiDocx(collaborator(records), options));
}

test('EPI sheet includes each saved size in its equipment description', async () => {
  const records = ['P', 'M', 'G', 'GG', 'XG', 'Especial'].map((size, index) => record(String(index), size));
  // Changing the catalog after delivery must not change the recorded size.
  records[0].catalogItem = { hasSizes: false, sizes: [] };
  assert.deepEqual(await equipmentDescriptions(records), records.map(item => `${item.epiName} (Tamanho: ${item.size})`));
});

test('custom sizes survive XML escaping and also appear in the public redacted sheet', async () => {
  const item = record('custom', 'Especial & 42 <largo>');
  const expected = ['Equipamento custom (Tamanho: Especial & 42 <largo>)'];
  assert.deepEqual(await equipmentDescriptions([item]), expected);
  assert.deepEqual(await equipmentDescriptions([item], { redactCollaboratorFields: true }), expected);
});

test('EPI sheet preserves descriptions for legacy and unsized equipment', async () => {
  const records = [record('legacy'), record('null', null), record('empty', '')];
  assert.deepEqual((await equipmentDescriptions(records)).sort(), records.map(item => item.epiName).sort());
});

test('marker-like custom sizes remain literal and do not block signed sheet generation', { timeout: 20_000 }, async () => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const records = ['<<epi>>', '<<ca>>', '<<ass>>', '<<assinatura>>', '<<collaborator>>', 'Especial <<epi>> & <largo>']
    .map((size, index) => ({ ...record(String(index), size), signatureImageDataUrl: image }));
  // A subprocess timeout also catches a synchronous replacement loop without hanging the test runner.
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import { buildEpiDocx } from ${JSON.stringify(new URL('../src/lib/epi-docx.js', import.meta.url).href)};
    const bytes = await buildEpiDocx(${JSON.stringify(collaborator(records))});
    process.stdout.write(bytes.toString('base64'));
  `], { timeout: 10_000, maxBuffer: 1024 * 1024 });
  const bytes = Buffer.from(stdout, 'base64');
  assert.deepEqual(equipmentDescriptionsFromBytes(bytes), records.map(item => `${item.epiName} (Tamanho: ${item.size})`));
  const xml = new AdmZip(bytes).readAsText('word/document.xml');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  assert.equal(doc.getElementsByTagName('w:drawing').length, records.length + 1, 'each row and the sheet retain their signature');
  for (const row of Array.from(doc.getElementsByTagName('w:tr'))) {
    const cells = Array.from(row.getElementsByTagName('w:tc'));
    if (!cells[0]?.textContent.startsWith('Equipamento ')) continue;
    assert.equal(cells[0].getElementsByTagName('w:drawing').length, 0);
    assert.equal(cells.at(-1).getElementsByTagName('w:drawing').length, 1);
  }
});

test('signed PDF evidence includes the saved size alongside its corresponding item', async () => {
  const source = await PDFDocument.create();
  source.addPage();
  const signedAt = new Date('2026-11-16T16:00:00Z');
  const records = [record('sized', 'Especial & 42'), record('unsized')].map(item => ({
    ...item, signedAt, signatureRequestId: 'request',
    signatureRequest: { id: 'request', status: 'SIGNED', signedAt, signatureSignerName: 'Colaborador' }
  }));
  const result = await appendEpiEvidencePages(Buffer.from(await source.save()), collaborator(records));
  const task = pdfjs.getDocument({
    data: new Uint8Array(result.bytes), useSystemFonts: false, isEvalSupported: false,
    standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json')))
  });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(2);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join('\n');
    assert.ok(text.includes('Linha 1: Equipamento sized | Tamanho: Especial & 42 | CA: 12345'));
    assert.ok(text.includes('Linha 2: Equipamento unsized | CA: 12345'));
    assert.equal((text.match(/Tamanho:/g) || []).length, 1);
  } finally {
    await task.destroy();
  }
});
