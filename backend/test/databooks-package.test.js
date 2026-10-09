import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { PDFDocument, StandardFonts, PDFName, PDFDict } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
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

async function inspectPdf(bytes, check) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0,
    standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json'))) });
  try { return await check(await task.promise); } finally { await task.destroy(); }
}
const pageText = async page => (await page.getTextContent()).items.map(item => item.str).join(' ');

test('databook reproduz capa fotográfica, síntese organizada e quatro fotos por página do modelo aprovado', async () => {
  const snapshot = snapshotFixture(); snapshot.products = []; snapshot.documents = [];
  snapshot.photos = Array.from({ length: 8 }, (_, i) => ({ ...snapshot.photos[0], key: `photo-${i}`, fileName: `foto-${i}.jpg`, label: `Evidência ${i + 1}`, caption: `Legenda ${i + 1}` }));
  const original = await pdfFixture(1, 'Anexo original');
  const photo = await sharp({ create: { width: 480, height: 640, channels: 3, background: '#224433' } }).jpeg().toBuffer();
  const result = await buildDatabookPackage({ snapshot, revision: 2, issuedAt: '2026-10-09T12:00:00Z', author: 'Gestor',
    readPhoto: async () => photo, readReport: async () => ({ fileName: 'relatorio.pdf', buffer: original }) });
  await inspectPdf(result.pdf, async document => {
    const cover = await document.getPage(1), coverText = await pageText(cover);
    assert.match(coverText, /Projeto.*P1.*Projeto/);
    assert.match(coverText, /16\/09\/2026 a 17\/09\/2026/);
    const coverOperators = await cover.getOperatorList();
    assert.equal(coverOperators.fnArray.filter(op => op === pdfjs.OPS.paintImageXObject).length, 2, 'Capa com logo e foto de abertura');
    const photoPages = [];
    for (let n = 1; n <= result.manifest.presentation.synthesisPages; n++) {
      const page = await document.getPage(n), text = await pageText(page);
      if (/F-\d{3}/.test(text)) {
        photoPages.push(n);
        const operators = await page.getOperatorList();
        assert.equal(operators.fnArray.filter(op => op === pdfjs.OPS.paintImageXObject).length, 5, 'Logo e quatro fotografias inteiras na página');
      }
    }
    assert.equal(photoPages.length, 2, 'Oito fotos distribuídas em duas páginas');
    assert.match(await pageText(await document.getPage(photoPages[0])), /F-001.*F-002.*F-003.*F-004/);
    assert.match(await pageText(await document.getPage(photoPages[1])), /F-005.*F-006.*F-007.*F-008/);
    const expected = ['Resumo do projeto', 'Rastreabilidade por relatório e TAG', 'Execução e comprovação',
      'Recursos e documentos técnicos', 'Produtos e lotes', 'Registro das FDSs', 'Conclusão e aceite', 'Índice dos anexos'];
    for (const title of expected) {
      const section = result.manifest.presentation.sections.find(section => section.title === title);
      assert.ok(section, title); assert.ok((await pageText(await document.getPage(section.startPage))).includes(title), title);
    }
    const annex = result.manifest.files.find(file => file.path.startsWith('relatorios/'));
    assert.equal(await pageText(await document.getPage(annex.pdfStartPage)), 'Anexo original — pagina 1', 'Anexo sem cabeçalho ou rodapé acrescentado');
  });
  const pdf = await PDFDocument.load(result.pdf), toc = pdf.getPage(1);
  const annotations = toc.node.Annots(); assert.ok(annotations?.size() >= 11, 'Sumário com links para as seções');
  for (let i = 0; i < annotations.size(); i++) {
    const destination = annotations.lookup(i, PDFDict).lookup(PDFName.of('Dest'));
    assert.ok(pdf.getPages().some(page => page.ref.toString() === destination.get(0).toString()));
  }
});

test('databook pagina tabelas e legendas extensas sem omitir dados nem invadir o rodapé', async () => {
  const snapshot = snapshotFixture(); snapshot.products = []; snapshot.documents = [];
  snapshot.reports = Array.from({ length: 24 }, (_, i) => ({ ...snapshot.reports[0], id: `rlq-${i}`, reportType: 'RLQ', sequenceNumber: i + 1,
    services: [{ id: `s-${i}`, system: `Sistema-${i} ${'identificado '.repeat(9)} FIM-SISTEMA-${i}` }],
    technical: { 'Desenhos / TAGs': `TAG-${i} ${'identificação '.repeat(55)} FINAL-TAG-${i}`, 'Quantidade de sistemas (un)': 2, 'Aprovado pelo cliente?': 'Sim' } }));
  snapshot.photos[0].caption = `${'Legenda extensa '.repeat(29)}FIM-LEGENDA`;
  const original = await pdfFixture(1, 'Original');
  const photo = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#224433' } }).png().toBuffer();
  const result = await buildDatabookPackage({ snapshot, revision: 1, issuedAt: '2026-10-09T12:00:00Z', author: 'Gestor',
    readPhoto: async () => photo, readReport: async () => ({ fileName: 'original.pdf', buffer: original }) });
  await inspectPdf(result.pdf, async document => {
    let text = '';
    for (let n = 1; n <= result.manifest.presentation.synthesisPages; n++) {
      const page = await document.getPage(n), content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + ' ';
      for (const item of content.items.filter(item => item.str.trim())) {
        assert.ok(item.transform[4] >= 44 && item.transform[4] + item.width <= 551, `Texto dentro da margem na página ${n}: ${item.str}`);
        const y = item.transform[5];
        assert.ok(y > 60 || y < 45, `Texto não invade rodapé na página ${n}: ${item.str}`);
      }
    }
    for (let i = 0; i < 24; i++) assert.ok(text.includes(`FINAL-TAG-${i}`), `TAG ${i} conservada após paginação`);
    for (let i = 0; i < 24; i++) assert.ok(text.includes(`FIM-SISTEMA-${i}`), `Sistema ${i} conservado nos quadros extensos`);
    assert.ok(text.includes('FIM-LEGENDA'));
    assert.match(text, /48.*unidades declaradas nos RLQs/);
    assert.match(text, /Aceite: não registrado/, 'Formulário não vira aceite formal');
  });
});

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
  const fds = manifest.files.find(file => file.path.startsWith('fds/'));
  assert.equal(fds.pdfStartPage, manifest.presentation.synthesisPages + 1, 'FDSs completas seguem a síntese como no modelo aprovado');
  assert.equal(manifest.files.find(file => file.path.startsWith('relatorios/')).pdfPages, 2);
  assert.equal(manifest.references.length, 1); assert.equal(documentReads, 1);
  const originals = { fotos: originalPhoto, relatorios: originalReport, fds: originalFds, documentos: originalCertificate };
  for (const file of manifest.files) {
    const bytes = zip.readFile(file.path); assert.deepEqual(bytes, originals[file.path.split('/')[0]]); assert.equal(sha256(bytes), file.sha256);
  }
  assert.equal(sha256(zip.readFile('databook.pdf')), manifest.databook.sha256);
  assert.ok(pdf.catalog.get(PDFName.of('Outlines')));
  const fdsSection = manifest.presentation.sections.find(section => section.title === 'Registro das FDSs');
  const fdsLinks = pdf.getPage(fdsSection.startPage - 1).node.Annots();
  assert.equal(fdsLinks.lookup(0, PDFDict).lookup(PDFName.of('Dest')).get(0).toString(), pdf.getPage(fds.pdfStartPage - 1).ref.toString(), 'Link da FDS aponta para o documento integral correto');
  assert.ok(progress.includes(90));
});

test('databook localiza documentos não PDF e referências externas no ZIP / manifesto', async () => {
  const snapshot = snapshotFixture(); snapshot.photos = []; snapshot.products = [];
  const original = await pdfFixture(1, 'Relatório'), technicalFile = Buffer.from('Documento técnico original');
  const result = await buildDatabookPackage({ snapshot, revision: 1, author: 'Gestor', issuedAt: '2026-10-09T12:00:00Z',
    readReport: async () => ({ fileName: 'relatorio.pdf', buffer: original }),
    readDocument: async () => ({ fileName: 'documento.txt', mimeType: 'text/plain', buffer: technicalFile }) });
  const entry = result.manifest.files.find(file => file.path.startsWith('documentos/'));
  assert.deepEqual(new AdmZip(result.zip).readFile(entry.path), technicalFile);
  assert.equal(result.manifest.references[0].url, snapshot.documents[1].externalUrl);
  await inspectPdf(result.pdf, async document => {
    const index = result.manifest.presentation.sections.find(section => section.title === 'Índice dos anexos');
    assert.match(await pageText(await document.getPage(index.startPage)), /ZIP \/ manifesto/);
    const resources = result.manifest.presentation.sections.find(section => section.title === 'Recursos e documentos técnicos');
    assert.match(await pageText(await document.getPage(resources.startPage)), /Pendente.*Não exigido/, 'Estado dos documentos em português');
  });
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
