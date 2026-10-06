import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { qualityDocumentModelReports } from '../scripts/fixtures/quality-document-models.js';
import { buildReportDocx } from '../src/lib/report-docx.js';
import { buildRcpDocx } from '../src/lib/report-rcp.js';
import { buildRlqDocx } from '../src/lib/report-rlq.js';
import { buildRtpDocx } from '../src/lib/report-rtp.js';

const builders = { RDO: buildReportDocx, RCPU: buildRcpDocx, RLQ: buildRlqDocx, RTP: buildRtpDocx };
const expectedDetails = { RDO: '07:30', RCPU: '17/15/12', RLQ: 'Aço carbono', RTP: 'CAL-EX-001' };

test('quality models fill the official templates with fictional data and ship readable PDFs', async t => {
  const reports = qualityDocumentModelReports();
  assert.deepEqual(reports.map(report => report.reportType), ['RDO', 'RCPU', 'RLQ', 'RTP']);
  for (const report of reports) await t.test(report.reportType, async () => {
    assert.equal(report.projectId, undefined, 'the samples must not load project records');
    assert.equal(report.project.operator.signatureImage, undefined, 'no real signature is reused');
    const zip = new AdmZip(await builders[report.reportType](report));
    const xmlTexts = zip.getEntries()
      .filter(entry => /^word\/(document|header\d+)\.xml$/.test(entry.entryName))
      .map(entry => {
        const doc = new DOMParser().parseFromString(zip.readAsText(entry), 'text/xml');
        return Array.from(doc.getElementsByTagName('w:t')).map(node => node.textContent).join(' ');
      }).join(' ');
    assert.match(xmlTexts, /EXEMPLO COM DADOS FICTÍCIOS/);
    assert.match(xmlTexts, /Alex Exemplo/);
    assert.ok(xmlTexts.includes(expectedDetails[report.reportType]));
    assert.doesNotMatch(xmlTexts, /\{\{/);

    const file = new URL(`../../frontend/src/assets/report-models/${report.reportType}-modelo.pdf`, import.meta.url);
    const task = pdfjs.getDocument({
      data: new Uint8Array(await fs.readFile(file)),
      isEvalSupported: false,
      standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json')))
    });
    try {
      const pdf = await task.promise;
      const pages = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const content = await (await pdf.getPage(number)).getTextContent();
        const text = content.items.map(item => item.str).join(' ');
        assert.ok(text.trim(), `page ${number} must not be empty`);
        pages.push(text);
      }
      const text = pages.join(' ');
      assert.match(text, /Cliente Exemplo/);
      assert.match(text, /EXEMPLO COM DADOS FICTÍCIOS/);
      assert.match(text, /Alex Exemplo/);
      assert.ok(text.includes(expectedDetails[report.reportType]));
      assert.doesNotMatch(text, /\{\{/);
    } finally {
      await task.destroy();
    }
  });
});
