import path from 'node:path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFNumber } from 'pdf-lib';
import { sha256 } from './sources.js';
import { databookError } from './policy.js';

export const MAX_DATABOOK_BYTES = 200 * 1024 * 1024;
const A4 = [595.28, 841.89];
const teal = rgb(0.04, 0.27, 0.3);
const gray = rgb(0.3, 0.35, 0.39);
const dateLabel = value => value?.split('-').reverse().join('/') || '—';
const statusLabel = { APPROVED: 'Aprovado internamente', SIGNED: 'Assinado', PENDING: 'Pendente', RETURNED: 'Devolvido' };
const phaseLabel = { UNSPECIFIED: 'Fase não informada', BEFORE: 'Antes', DURING: 'Durante', AFTER: 'Depois' };
const safeName = value => path.basename(String(value || 'arquivo')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');

function printable(font, value) {
  return [...String(value ?? '').replace(/\t/g, ' ')].map(char => {
    if (char === '\n') return char;
    try { font.encodeText(char); return char; } catch { return '?'; }
  }).join('');
}

function wrap(font, text, size, width) {
  const lines = [];
  for (const paragraph of printable(font, text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (font.widthOfTextAtSize(`${line} ${word}`.trim(), size) > width && line) { lines.push(line); line = ''; }
      // Break long identifiers instead of overflowing the printed page.
      for (const char of word) {
        if (font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = ''; }
        line += char;
      }
      line += ' ';
    }
    lines.push(line.trim());
  }
  return lines;
}

function addBookmarks(pdf, entries) {
  if (!entries.length) return;
  const ctx = pdf.context;
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);
  const refs = entries.map(() => ctx.nextRef());
  entries.forEach((entry, index) => {
    const bookmark = ctx.obj({ Title: PDFString.of(entry.title), Parent: rootRef,
      Dest: [pdf.getPage(entry.page).ref, PDFName.of('Fit')] });
    if (index) bookmark.set(PDFName.of('Prev'), refs[index - 1]);
    if (index + 1 < refs.length) bookmark.set(PDFName.of('Next'), refs[index + 1]);
    ctx.assign(refs[index], bookmark);
  });
  root.set(PDFName.of('First'), refs[0]); root.set(PDFName.of('Last'), refs.at(-1));
  root.set(PDFName.of('Count'), PDFNumber.of(refs.length));
  pdf.catalog.set(PDFName.of('Outlines'), rootRef);
}

/** Receives authorized, frozen sources; no network/database/path resolution here. */
export async function buildDatabookPackage({ snapshot, revision, issuedAt, author, readReport, readPhoto, readFds, readDocument, onProgress = async () => {} }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const zip = new AdmZip();
  const manifest = { formatVersion: 1, revision, issuedAt, project: snapshot.project, title: snapshot.title,
    period: { startDate: snapshot.startDate, endDate: snapshot.endDate, inclusive: true },
    author, snapshot, files: [], references: [], warnings: snapshot.warnings };
  const sections = [];
  const bookmarks = [];
  let consumed = 0;
  let page;
  let y;
  const addPage = () => { page = pdf.addPage(A4); y = 778; return page; };
  const text = (value, { size = 10, strong = false, color = gray, gap = 6 } = {}) => {
    const font = strong ? bold : regular;
    for (const line of wrap(font, value, size, 495)) {
      if (y < 65) addPage();
      page.drawText(line, { x: 50, y, size, font, color }); y -= size * 1.4;
    }
    y -= gap;
  };
  const section = title => {
    addPage(); sections.push({ title, page: pdf.getPageCount() - 1 }); bookmarks.push(sections.at(-1));
    text(title, { strong: true, color: teal, size: 20, gap: 16 });
  };
  const addFile = (folder, id, fileName, bytes, metadata = {}) => {
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw databookError('Arquivo obrigatório indisponível.');
    if (!bytes.length) throw databookError('Arquivo obrigatório vazio.');
    consumed += bytes.length;
    if (consumed > MAX_DATABOOK_BYTES) throw databookError('O pacote excede 200 MB de originais. Divida o período ou reduza as fotos.', 413);
    const target = `${folder}/${String(manifest.files.length + 1).padStart(4, '0')}-${safeName(fileName)}`;
    zip.addFile(target, Buffer.from(bytes));
    const entry = { path: target, sourceId: id, sha256: sha256(bytes), bytes: bytes.length, ...metadata };
    manifest.files.push(entry);
    return entry;
  };
  addPage();
  page.drawRectangle({ x: 0, y: 625, width: A4[0], height: 217, color: teal });
  y = 760; text('FILTROVALI', { size: 16, strong: true, color: rgb(1, 1, 1) });
  text('DATABOOK', { size: 32, strong: true, color: rgb(1, 1, 1) });
  y = 588; text(snapshot.title, { size: 22, strong: true, color: teal });
  text(`Projeto ${snapshot.project.code} · ${snapshot.project.name}`, { size: 16, strong: true });
  text(`Cliente: ${snapshot.project.clientName}`);
  text(`Contrato / referência: ${snapshot.project.contractCode}`);
  text(`Local: ${snapshot.project.location}`);
  text(`Período: ${dateLabel(snapshot.startDate)} a ${dateLabel(snapshot.endDate)} (inclusive)`, { strong: true });
  text(`Revisão ${String(revision).padStart(2, '0')} · Emissão ${dateLabel(issuedAt.slice(0, 10))}`);
  text(`Preparado por: ${author}`);
  y -= 25; text('Dossiê de execução e evidências da etapa selecionada. O estado de aprovação, assinatura e aceite é apresentado conforme os registros disponíveis na emissão.');
  const toc = pdf.addPage(A4);
  section('1. Controle e identificação');
  text(`Projeto: ${snapshot.project.code} — ${snapshot.project.name}`);
  text(`Cliente: ${snapshot.project.clientName} · CNPJ: ${snapshot.project.clientCnpj}`);
  text(`Etapa: ${snapshot.title} · revisão ${revision}`);
  text(`Intervalo operacional: ${dateLabel(snapshot.startDate)} até ${dateLabel(snapshot.endDate)}. As datas dos relatórios determinam o recorte; a data de upload não determina a inclusão.`);
  text('Conteúdo congelado nesta emissão. Uma revisão posterior não substitui os arquivos desta revisão. Entrega e aceite do databook não são presumidos pela geração.');
  text('O PDF consolidado é uma cópia para leitura. Para validar assinaturas digitais, use os PDFs originais preservados no ZIP. O manifesto registra SHA-256 de cada arquivo.', { strong: true });
  section('2. Resumo da execução');
  text(snapshot.summary || 'Resumo técnico não informado. Consultar as descrições dos relatórios anexos.');
  text(`${snapshot.reports.length} relatório(s), ${snapshot.photos.length} fotografia(s), ${snapshot.products.length} produto(s) confirmado(s) e ${snapshot.documents.length} documento(s) técnico(s).`, { strong: true });
  for (const report of snapshot.reports) {
    text(`${report.reportType} ${report.sequenceNumber ?? 's/n'} · ${dateLabel(report.date)}`, { strong: true });
    if (report.description) text(report.description);
    for (const service of report.services) text([service.type, service.system, service.material, service.equipment,
      service.finalized === true ? 'Finalizado no registro' : ''].filter(Boolean).join(' · '));
  }
  section('3. Índice dos relatórios');
  for (const report of snapshot.reports) {
    text(`${report.reportType} ${report.sequenceNumber ?? 's/n'} · ${dateLabel(report.date)} · ${statusLabel[report.status] || report.status}`, { strong: true });
    const signature = report.clientSigned ? 'concluída/registrada' : report.clientSignaturesSigned ? `parcial (${report.clientSignaturesSigned}/${report.clientSignaturesRequired})` : 'não registrada';
    text(`Liberação ao cliente: ${report.clientReleased ? 'registrada' : 'não registrada'} · Assinatura do cliente: ${signature} · Aceite: ${report.clientAccepted ? 'registrado' : 'não registrado'} · Assinaturas pendentes: ${report.pendingSignatures}`);
  }
  section('4. Registro fotográfico');
  if (!snapshot.photos.length) text('Nenhuma foto selecionada para esta etapa.');
  for (const [index, photo] of snapshot.photos.entries()) {
    const bytes = await readPhoto(photo);
    addFile('fotos', photo.key, photo.fileName, bytes, { reportId: photo.reportId, caption: photo.caption, tag: photo.tag, phase: photo.phase });
    const optimized = await sharp(bytes).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    const image = await pdf.embedJpg(optimized);
    addPage(); text(`Foto ${index + 1} · ${photo.reportLabel} · ${dateLabel(photo.date)}`, { strong: true, color: teal, size: 14 });
    text([photo.service, photo.system, photo.tag ? `TAG: ${photo.tag}` : '', phaseLabel[photo.phase]].filter(Boolean).join(' · '));
    const dimensions = image.scaleToFit(495, 440);
    page.drawImage(image, { x: 50 + (495 - dimensions.width) / 2, y: 235, ...dimensions });
    y = 215; text(photo.caption || photo.label);
    text('Data acima corresponde ao relatório de origem. Data de captura e fase só são declaradas quando confirmadas.', { size: 8 });
    await onProgress(10 + Math.round(25 * (index + 1) / Math.max(snapshot.photos.length, 1)));
  }
  section('5. Produtos e rastreabilidade');
  text('Produtos abaixo foram confirmados pelo responsável como utilizados nesta etapa. Movimentações de estoque identificam transferências, sem comprovar quantidade consumida.');
  if (!snapshot.products.length) text('Nenhum produto confirmado. Conferir os procedimentos e registros aplicáveis.');
  for (const product of snapshot.products) {
    text(`${product.code} · ${product.name}`, { strong: true });
    text(`Fabricante: ${product.manufacturer || 'não informado'} · CAS: ${product.casNumber || 'não informado'} · ONU: ${product.unNumber || 'não informado'}`);
    text(`FDS: ${product.document.fileName} · revisão/data conferida: ${product.revision}`);
    for (const movement of product.movements) text(`Transferência ${dateLabel(movement.date)} · lote ${movement.lot || 'não informado'} · ${movement.quantity} ${product.unitLabel} · ${movement.inPeriod ? 'dentro' : 'fora'} do período`, { size: 9 });
  }
  section('6. Conferência e pendências');
  if (!snapshot.warnings.length) text('Nenhuma pendência identificada nas verificações automáticas desta seleção.');
  for (const warning of snapshot.warnings) text(`• ${warning}`);
  text('A seleção de FDS foi conferida pelo emissor quanto ao produto e à revisão. O sistema não substitui a confirmação de identidade pelo fabricante/fornecedor.');
  for (const document of snapshot.documents) text(`${document.title} · ${document.versionLabel || 'versão sem rótulo'} · estado de aceite: ${document.acceptanceStatus}`);

  const appendPdf = async (bytes, entry, title) => {
    let source;
    try { source = await PDFDocument.load(bytes); } catch { throw databookError(`PDF inválido, protegido ou ilegível: ${title}.`); }
    if (!source.getPageCount() || source.getPageCount() > 2000 || pdf.getPageCount() + source.getPageCount() > 5000) throw databookError('Quantidade de páginas excede o limite. Divida a etapa.', 413);
    entry.pdfStartPage = pdf.getPageCount() + 1;
    entry.pdfPages = source.getPageCount();
    bookmarks.push({ title, page: pdf.getPageCount() });
    const pages = await pdf.copyPages(source, source.getPageIndices());
    pages.forEach(copied => pdf.addPage(copied));
  };
  section('7. Relatórios integrais');
  text('Os arquivos originais estão na pasta relatorios do ZIP.');
  for (const [index, report] of snapshot.reports.entries()) {
    const file = await readReport(report);
    const entry = addFile('relatorios', report.id, file.fileName, file.buffer, { type: report.reportType, date: report.date });
    await appendPdf(file.buffer, entry, `${report.reportType} ${report.sequenceNumber ?? 's/n'} — ${dateLabel(report.date)}`);
    await onProgress(40 + Math.round(30 * (index + 1) / snapshot.reports.length));
  }
  section('8. FDS integrais');
  if (!snapshot.products.length) text('Nenhuma FDS selecionada.');
  for (const product of snapshot.products) {
    const bytes = await readFds(product);
    const entry = addFile('fds', product.document.id, product.document.fileName, bytes, { itemId: product.id, revision: product.revision });
    await appendPdf(bytes, entry, `FDS — ${product.code} — ${product.name}`);
  }
  section('9. Documentos técnicos');
  if (!snapshot.documents.length) text('Nenhum documento técnico selecionado.');
  for (const document of snapshot.documents) {
    if (document.externalUrl) {
      manifest.references.push({ sourceId: document.versionId, title: document.title, url: document.externalUrl });
      text(`${document.title}: referência externa registrada no manifesto. Não foi baixada automaticamente.`); continue;
    }
    const file = await readDocument(document);
    const entry = addFile('documentos', document.versionId, file.fileName, file.buffer, { title: document.title });
    if (file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.fileName)) await appendPdf(file.buffer, entry, document.title);
    else { addPage(); text(`${document.title}: arquivo ${file.fileName} preservado no ZIP.`); }
  }
  // Index and footers refer to the final page sequence, without modifying original annex pages.
  page = toc; y = 778; text('Índice do databook', { strong: true, color: teal, size: 22, gap: 20 });
  for (const item of sections) text(`${item.title} ................................ ${item.page + 1}`, { size: 12, gap: 12 });
  const annexPages = new Set(manifest.files.flatMap(file => file.pdfPages ? Array.from({ length: file.pdfPages }, (_, i) => file.pdfStartPage - 1 + i) : []));
  pdf.getPages().forEach((current, index) => {
    if (annexPages.has(index)) return;
    current.drawText(printable(regular, `${snapshot.project.code} · Rev. ${revision} · ${index + 1}/${pdf.getPageCount()}`), { x: 50, y: 30, size: 8, font: regular, color: gray });
  });
  addBookmarks(pdf, bookmarks);
  pdf.setTitle(`Databook ${snapshot.project.code} — ${snapshot.title}`); pdf.setAuthor(author); pdf.setSubject(`Período ${snapshot.startDate} a ${snapshot.endDate}`);
  const pdfBytes = Buffer.from(await pdf.save());
  if (consumed + pdfBytes.length > MAX_DATABOOK_BYTES * 2) throw databookError('Pacote muito grande. Reduza o período ou as fotos.', 413);
  zip.addFile('databook.pdf', pdfBytes);
  manifest.databook = { path: 'databook.pdf', sha256: sha256(pdfBytes), bytes: pdfBytes.length, pages: pdf.getPageCount() };
  zip.addFile('manifesto.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('LEIA-ME.txt', Buffer.from('Este pacote preserva os arquivos originais. Valide assinaturas digitais nos originais, pois a consolidação em databook.pdf não conserva a validação criptográfica. Confira os hashes SHA-256 no manifesto.json. Datas inicial e final são inclusivas. A emissão não comprova entrega ou aceite do cliente.\n'));
  await onProgress(90);
  return { pdf: pdfBytes, zip: zip.toBuffer(), manifest };
}
