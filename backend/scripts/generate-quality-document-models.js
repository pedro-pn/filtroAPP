import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { qualityDocumentModelReports } from './fixtures/quality-document-models.js';

// No projectId is supplied: the examples use no database records or customer data.
process.env.DATABASE_URL ||= 'postgresql://example:example@127.0.0.1:5432/example';
const { buildReportDocx } = await import('../src/lib/report-docx.js');
const { buildRcpDocx } = await import('../src/lib/report-rcp.js');
const { buildRlqDocx } = await import('../src/lib/report-rlq.js');
const { buildRtpDocx } = await import('../src/lib/report-rtp.js');
const { convertDocxToPdf } = await import('../src/lib/report-pdf-from-docx.js');

const builders = { RDO: buildReportDocx, RCPU: buildRcpDocx, RLQ: buildRlqDocx, RTP: buildRtpDocx };
const outputDir = fileURLToPath(new URL('../../frontend/src/assets/report-models/', import.meta.url));
const docxOnly = process.argv.includes('--docx-only');
const workDir = process.env.QUALITY_MODELS_WORK_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-quality-models-'));

function keepServiceHeadingWithTable(bytes) {
  const zip = new AdmZip(bytes);
  const doc = new DOMParser().parseFromString(zip.readAsText('word/document.xml'), 'text/xml');
  const heading = Array.from(doc.getElementsByTagName('w:p')).find(node => node.textContent.trim() === 'SERVIÇOS REALIZADOS');
  // Keep the existing heading and its blank spacer on the service table's page.
  for (let node = heading; node?.nodeName === 'w:p'; node = node.nextSibling) {
    let properties = node.getElementsByTagName('w:pPr')[0];
    if (!properties) {
      properties = doc.createElement('w:pPr');
      node.insertBefore(properties, node.firstChild);
    }
    if (!properties.getElementsByTagName('w:keepNext').length) properties.appendChild(doc.createElement('w:keepNext'));
    if (node.nextSibling?.textContent.trim()) break;
  }
  zip.updateFile('word/document.xml', Buffer.from(new XMLSerializer().serializeToString(doc)));
  return zip.toBuffer();
}

try {
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  for (const report of qualityDocumentModelReports()) {
    const name = `${report.reportType}-modelo`;
    const docxPath = path.join(workDir, `${name}.docx`);
    const bytes = await builders[report.reportType](report);
    await fs.writeFile(docxPath, report.reportType === 'RDO' ? keepServiceHeadingWithTable(bytes) : bytes);
    if (docxOnly) {
      console.log(docxPath);
    } else {
      const pdfPath = path.join(workDir, `${name}.pdf`);
      await convertDocxToPdf(docxPath, pdfPath);
      await fs.copyFile(pdfPath, path.join(outputDir, `${name}.pdf`));
      console.log(`Generated ${name}.pdf`);
    }
  }
} finally {
  if (!docxOnly && !process.env.QUALITY_MODELS_WORK_DIR) await fs.rm(workDir, { recursive: true, force: true });
}
