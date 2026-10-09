import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildDatabookPackage } from '../src/lib/databooks/package.js';
import { defaultDatabookPeriod } from '../src/lib/databooks/policy.js';
import { sha256 } from '../src/lib/databooks/sources.js';

async function pdfFixture(pages, title) {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) pdf.addPage().drawText(`${title} — pagina ${i + 1}`, { x: 50, y: 700, size: 14, font });
  pdf.setTitle(title); return Buffer.from(await pdf.save());
}
function snapshotFixture() {
  return { project: { id: 'p1', code: 'P1', name: 'Projeto', clientName: 'Cliente', clientCnpj: '00000000000000', contractCode: 'REF', location: 'Local' },
    title: 'Etapa 1', startDate: '2026-09-16', endDate: '2026-09-17', summary: 'Execução da etapa',
    reports: [{ id: 'r1', reportType: 'RDO', sequenceNumber: 1, date: '2026-09-16', status: 'SIGNED', services: [], pendingSignatures: 0,
      clientReleased: true, clientSigned: true, clientAccepted: false, description: 'Serviço executado' }],
    photos: [{ key: 'photo', reportId: 'r1', reportLabel: 'RDO 1', date: '2026-09-16', fileName: 'photo.png', label: 'Evidência', caption: 'Legenda conferida', tag: 'TAG1', phase: 'BEFORE' }],
    products: [{ id: 'i1', code: 'PQ1', name: 'Produto', unitLabel: 'kg', revision: 'Rev 2', movements: [{ date: '2026-09-15', quantity: 20, lot: 'L1', inPeriod: false }],
      document: { id: 'd1', fileName: 'FDS.pdf', revision: 'Rev 2' } }],
    documents: [{ versionId: 'v1', title: 'Certificado', versionLabel: '1', acceptanceStatus: 'PENDING' },
      { versionId: 'v2', title: 'Referência', externalUrl: 'https://example.com/reference', acceptanceStatus: 'NOT_REQUIRED' }], warnings: ['Aceite do cliente não registrado.'] };
}

test('databook PDF inclui FDS inteira, índice/bookmarks, manifesto/hash e ZIP conserva originais', async () => {
  const originalReport = await pdfFixture(2, 'Relatório original'); const originalFds = await pdfFixture(8, 'FDS integral');
  const originalCertificate = await pdfFixture(1, 'Certificado');
  const originalPhoto = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#224433' } }).png().toBuffer();
  let documentReads = 0; const progress = [];
  const result = await buildDatabookPackage({ snapshot: snapshotFixture(), revision: 1, author: 'Responsável', issuedAt: '2026-10-08T12:00:00Z',
    readReport: async () => ({ fileName: 'assinado.pdf', buffer: originalReport }), readPhoto: async () => originalPhoto,
    readFds: async () => originalFds, readDocument: async () => { documentReads += 1; return { fileName: 'certificado.pdf', mimeType: 'application/pdf', buffer: originalCertificate }; },
    onProgress: async value => progress.push(value) });
  const pdf = await PDFDocument.load(result.pdf); const zip = new AdmZip(result.zip);
  const manifest = JSON.parse(zip.readAsText('manifesto.json'));
  assert.equal(manifest.databook.pages, pdf.getPageCount()); assert.equal(manifest.period.inclusive, true);
  assert.equal(manifest.files.find(file => file.path.startsWith('fds/')).pdfPages, 8);
  assert.equal(manifest.files.find(file => file.path.startsWith('relatorios/')).pdfPages, 2);
  assert.equal(manifest.references.length, 1); assert.equal(documentReads, 1);
  const originals = [originalPhoto, originalReport, originalFds, originalCertificate];
  for (const [index, file] of manifest.files.entries()) {
    const bytes = zip.readFile(file.path); assert.deepEqual(bytes, originals[index]); assert.equal(sha256(bytes), file.sha256);
  }
  assert.equal(sha256(zip.readFile('databook.pdf')), manifest.databook.sha256);
  const { PDFName } = await import('pdf-lib'); assert.ok(pdf.catalog.get(PDFName.of('Outlines')));
  assert.ok(progress.includes(90));
});

test('databook rejeita PDF de anexo ilegível e foto obrigatória ausente em vez de omitir evidência', async () => {
  const snapshot = snapshotFixture(); snapshot.photos = []; snapshot.products = []; snapshot.documents = [];
  await assert.rejects(() => buildDatabookPackage({ snapshot, revision: 1, author: 'Gestor', issuedAt: '2026-10-08T12:00:00Z',
    readReport: async () => ({ fileName: 'broken.pdf', buffer: Buffer.from('not a PDF') }) }), /PDF inválido/);
  const withPhoto = snapshotFixture(); withPhoto.reports = []; withPhoto.products = []; withPhoto.documents = [];
  await assert.rejects(() => buildDatabookPackage({ snapshot: withPhoto, revision: 1, author: 'Gestor', issuedAt: '2026-10-08T12:00:00Z', readPhoto: async () => null }), /obrigatório indisponível/);
});

const evidenceRoot = new URL('../../output/playwright/databook-5815-producao/', import.meta.url);
const evidenceAvailable = fsSync.existsSync(new URL('inventario-producao.json', evidenceRoot));
test('databook valida período de 5815 e empacota arquivos reais já copiados de produção', { skip: !evidenceAvailable }, async () => {
  const inventory = JSON.parse(await fs.readFile(new URL('inventario-producao.json', evidenceRoot), 'utf8'));
  const pdfs = JSON.parse(await fs.readFile(new URL('pdfs-producao.json', evidenceRoot), 'utf8'));
  const date = value => `${value.slice(0, 10)}T00:00:00Z`;
  const reports = inventory.reports.map(report => ({ ...report, reportDate: new Date(date(report.reportDate)) }));
  assert.deepEqual(defaultDatabookPeriod(reports), { startDate: '2026-09-16', endDate: '2026-10-07' });
  assert.equal(reports.filter(report => report.reportType === 'RDO').length, 22);
  const snapshot = snapshotFixture();
  snapshot.project = { ...inventory.project, clientCnpj: 'Não coletado no inventário de teste' };
  snapshot.title = 'Validação do gerador — fontes copiadas de produção'; snapshot.endDate = '2026-09-16';
  snapshot.reports = reports.filter(report => report.reportType === 'RDO' && report.sequenceNumber === 1).map(report => ({
    id: report.id, reportType: report.reportType, sequenceNumber: report.sequenceNumber, date: '2026-09-16', status: report.status,
    clientReleased: Boolean(report.clientReleasedAt), clientSigned: Boolean(report.physicalSignedAt), clientAccepted: false,
    pendingSignatures: report.signatures, description: report.dailyDescription, services: [] }));
  const photo = inventory.attachments.find(item => item.reportType === 'RDO' && item.sequenceNumber === 1);
  snapshot.photos = [{ key: photo.id, reportId: snapshot.reports[0].id, reportLabel: 'RDO 1', date: '2026-09-16', label: photo.label,
    fileName: photo.fileName, caption: photo.label, tag: '', phase: 'UNSPECIFIED' }];
  const document = inventory.productDocuments.find(item => item.previewFile === 'documentos/PQ-001-FDS.pdf');
  assert.ok(document);
  snapshot.products = [{ id: 'production-fds-validation', code: document.code, name: document.name, revision: 'Rev. 02 — 26/06/2025 (conforme conferência anterior)',
    movements: [], document: { id: document.id, fileName: document.fileName } }]; snapshot.documents = [];
  snapshot.warnings = ['Artefato de validação gerado com cópias de produção; não é emissão oficial registrada no APP.'];
  const reportPdf = pdfs.find(item => item.localFile.includes('/RDO/') && /RDO 1 -/.test(item.localFile)); assert.ok(reportPdf);
  const file = async localFile => fs.readFile(new URL(encodeURI(localFile), evidenceRoot));
  const originalFds = await file(document.localFile);
  const result = await buildDatabookPackage({ snapshot, revision: 1, author: 'Validação técnica', issuedAt: '2026-10-08T12:00:00Z',
    readReport: async () => ({ fileName: path.basename(reportPdf.localFile), buffer: await file(reportPdf.localFile) }),
    readPhoto: async () => file(photo.localFile), readFds: async () => originalFds });
  const zip = new AdmZip(result.zip); const fdsEntry = result.manifest.files.find(item => item.path.startsWith('fds/'));
  assert.equal(fdsEntry.pdfPages, (await PDFDocument.load(originalFds)).getPageCount()); assert.equal(fdsEntry.sha256, document.sha256);
  assert.equal(sha256(zip.readFile(fdsEntry.path)), document.sha256);
  const output = new URL('validacao-implementacao/', evidenceRoot); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(new URL('databook-validacao.pdf', output), result.pdf); await fs.writeFile(new URL('databook-validacao.zip', output), result.zip);
});
