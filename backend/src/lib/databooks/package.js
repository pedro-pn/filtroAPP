import path from 'node:path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFHexString, PDFNumber } from 'pdf-lib';
import { sha256 } from './sources.js';
import { databookError } from './policy.js';
import { createDatabookPresentation, DATABOOK_TEMPLATE, dateLabel } from './presentation.js';

export const MAX_DATABOOK_BYTES = 200 * 1024 * 1024;
const phaseLabel = { UNSPECIFIED: 'Fase a confirmar', BEFORE: 'Antes', DURING: 'Durante', AFTER: 'Depois' };
const statusLabel = { APPROVED: 'Aprovado internamente', SIGNED: 'Assinado', PENDING: 'Pendente', RETURNED: 'Devolvido' };
const acceptanceLabel = { NOT_REQUIRED: 'Não exigido', PENDING: 'Pendente', ACCEPTED: 'Aceito', REJECTED: 'Recusado' };
const safeName = value => path.basename(String(value || 'arquivo')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
const reportLabel = report => `${report.reportType} ${String(report.sequenceNumber ?? 's/n').padStart(3, '0')}`;
const records = report => [report.technical || {}, ...(report.services || []).map(service => service.technical || {})];
const unique = values => [...new Set(values.flat().filter(value => value !== undefined && value !== null && value !== '').map(String))];
const technicalValues = (reports, key) => unique(reports.flatMap(report => records(report).flatMap(record => record[key] ?? [])));
const recorded = values => unique(values).join(' · ') || 'A confirmar';
const numberLabel = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
function declaredUnits(report) {
  const data = report.technical?.['Quantidade de sistemas (un)'] !== undefined ? [report.technical] : (report.services || []).map(service => service.technical || {});
  const quantities = data.map(record => record['Quantidade de sistemas (un)']).filter(value => value !== undefined && value !== null && value !== '')
    .map(value => Number(typeof value === 'string' ? value.replace(',', '.') : value));
  return quantities.length && quantities.every(value => Number.isFinite(value) && value >= 0) ? quantities.reduce((total, value) => total + value, 0) : null;
}

function addBookmarks(pdf, entries) {
  if (!entries.length) return;
  const ctx = pdf.context, root = ctx.obj({ Type: 'Outlines' }), rootRef = ctx.register(root);
  const refs = entries.map(() => ctx.nextRef());
  entries.forEach((entry, index) => {
    const bookmark = ctx.obj({ Title: PDFHexString.fromText(entry.title), Parent: rootRef,
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
  const pdf = await PDFDocument.create(), zip = new AdmZip();
  const manifest = { formatVersion: 1, revision, issuedAt, project: snapshot.project, title: snapshot.title,
    period: { startDate: snapshot.startDate, endDate: snapshot.endDate, inclusive: true },
    author, snapshot, files: [], references: [], warnings: snapshot.warnings };
  const layout = await createDatabookPresentation(pdf, { snapshot, revision, issuedAt });
  const { begin, paragraph, table, heading, note, fields, metrics } = layout;
  let consumed = 0;
  const addFile = (folder, id, fileName, bytes, metadata = {}) => {
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw databookError('Arquivo obrigatório indisponível.');
    if (!bytes.length) throw databookError('Arquivo obrigatório vazio.');
    consumed += bytes.length;
    if (consumed > MAX_DATABOOK_BYTES) throw databookError('O pacote excede 200 MB de originais. Divida o período ou reduza as fotos.', 413);
    const target = `${folder}/${String(manifest.files.length + 1).padStart(4, '0')}-${safeName(fileName)}`;
    zip.addFile(target, Buffer.from(bytes));
    const entry = { path: target, sourceId: id, sha256: sha256(bytes), bytes: bytes.length, ...metadata };
    manifest.files.push(entry); return entry;
  };
  const photos = [];
  for (const [index, photo] of snapshot.photos.entries()) {
    const bytes = await readPhoto(photo);
    const file = addFile('fotos', photo.key, photo.fileName, bytes, { reportId: photo.reportId, caption: photo.caption, tag: photo.tag, phase: photo.phase });
    const optimized = await sharp(bytes).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    const image = await pdf.embedJpg(optimized);
    // Only the cover uses the reference's panoramic crop; the gallery and ZIP
    // preserve the whole image and its original bytes respectively.
    const coverImage = index === 0 ? await pdf.embedJpg(await sharp(bytes).rotate().resize(1346, 570, { fit: 'cover', position: 'centre' }).jpeg({ quality: 85 }).toBuffer()) : null;
    photos.push({ ...photo, image, coverImage, sha256: file.sha256, phaseLabel: phaseLabel[photo.phase] || phaseLabel.UNSPECIFIED });
    await onProgress(10 + Math.round(25 * (index + 1) / snapshot.photos.length));
  }

  const rdos = snapshot.reports.filter(report => report.reportType.startsWith('RDO'));
  const rlqs = snapshot.reports.filter(report => report.reportType === 'RLQ');
  const technicalReports = snapshot.reports.filter(report => !report.reportType.startsWith('RDO'));
  const unitCounts = rlqs.map(declaredUnits), completeUnits = unitCounts.length && unitCounts.every(value => value !== null);
  const totalUnits = completeUnits ? numberLabel(unitCounts.reduce((total, value) => total + value, 0)) : 'A confirmar';
  const systems = unique([...technicalValues(snapshot.reports, 'Sistema'), ...snapshot.reports.flatMap(report => (report.services || []).map(service => service.system))]);
  const equipment = unique([...technicalValues(snapshot.reports, 'Equipamento'), ...technicalValues(snapshot.reports, 'Equipamento(s)'),
    ...snapshot.reports.flatMap(report => (report.services || []).map(service => service.equipment))]);
  const materials = unique([...technicalValues(snapshot.reports, 'Material da tubulação'), ...snapshot.reports.flatMap(report => (report.services || []).map(service => service.material))]);
  const sectionTitles = ['Controle e organização', 'Resumo do projeto', 'Rastreabilidade por relatório e TAG', 'Execução e comprovação',
    'Registro fotográfico', 'Recursos e documentos técnicos', 'Produtos e lotes', 'Registro das FDSs', 'Conclusão e aceite', 'Índice dos anexos'];

  layout.cover(photos[0]);
  begin(sectionTitles[0], 'Uma síntese técnica acompanhada dos documentos que comprovam a execução.');
  table(['Revisão', 'Emissão', 'Etapa / finalidade', 'Preparado por'], [[String(revision).padStart(2, '0'), dateLabel(issuedAt), snapshot.title, author]], [.1, .16, .44, .3]);
  table(['Seção', 'Conteúdo', 'Página'], ['Capa e identificação', ...sectionTitles].map((title, i) =>
    [String(i + 1).padStart(2, '0'), title, { reference: `section:${i}`, text: '' }]), [.1, .77, .13], { compact: true });
  note('Como ler este databook', 'O período e as evidências foram selecionados pelo responsável e congelados nesta emissão. “A confirmar” identifica informação não consolidada. Aprovação interna, liberação ao cliente, assinatura e aceite são eventos distintos.');
  note('Originais e revisões', 'Os arquivos originais estão preservados no ZIP com seus hashes SHA-256. Para validar assinaturas digitais, use os PDFs originais: a consolidação não conserva sua validação criptográfica. Uma nova revisão não substitui esta emissão.');

  begin(sectionTitles[1], 'Escopo e cobertura documental da etapa selecionada.');
  paragraph(snapshot.summary || 'Síntese baseada nos relatórios selecionados. Consultar os documentos integrais para os relatos diários, parâmetros e resultados de cada serviço.');
  metrics([[totalUnits, 'unidades declaradas nos RLQs'], [String(rdos.length), 'RDOs selecionados'], [String(rlqs.length), 'RLQs selecionados'], [String(snapshot.photos.length), 'fotos selecionadas']]);
  fields([['Cliente', snapshot.project.clientName], ['Projeto / referência', `${snapshot.project.code} · ${snapshot.project.contractCode || 'A confirmar'}`],
    ['Sistemas registrados', recorded(systems)], ['Materiais registrados', recorded(materials)],
    ['Período desta etapa', `${dateLabel(snapshot.startDate)} a ${dateLabel(snapshot.endDate)}`], ['Equipamentos registrados', recorded(equipment)]]);
  heading('Escopo e cobertura documental');
  table(['Item', 'Registrado nesta etapa', 'Conferência'], [
    ['Relatórios de execução', `${snapshot.reports.length} documento(s) aprovado(s) ou assinado(s)`, 'Datas inicial e final inclusivas; somente a seleção desta revisão.'],
    ['Unidades declaradas nos RLQs', totalUnits, 'Quantidade declarada não comprova TAGs distintas nem o atendimento aos critérios.'],
    ['Fotografias', `${snapshot.photos.length} foto(s) na ordem conferida`, 'TAGs, fases e legendas conforme a seleção do responsável.'],
    ['Produtos / documentos técnicos', `${snapshot.products.length} produto(s) · ${snapshot.documents.length} documento(s)`, 'Somente itens confirmados e versões selecionadas.']
  ], [.27, .34, .39]);

  begin(sectionTitles[2], 'Referências de identificação transcritas dos relatórios selecionados.');
  table(['Relatório', 'Data', 'Desenhos / TAGs registrados', 'UN', 'Formulário'], (technicalReports.length ? technicalReports : rdos).map(report => [
    reportLabel(report), dateLabel(report.date), recorded(technicalValues([report], 'Desenhos / TAGs')),
    declaredUnits(report) === null ? '—' : numberLabel(declaredUnits(report)),
    `${recorded(technicalValues([report], 'Serviço finalizado?'))} / ${recorded(technicalValues([report], 'Aprovado pelo cliente?'))}`
  ]), [.13, .15, .44, .06, .22], { compact: true, size: 7.5 });
  note('Identificação e aprovação no formulário', 'A coluna “Formulário” mostra “Serviço finalizado?” / “Aprovado pelo cliente?” quando esses campos existem na origem. Essas declarações não equivalem à assinatura ou ao aceite formal do cliente. Identificações repetidas devem ser conferidas na origem.');

  begin(sectionTitles[3], 'O método aplicado e seus resultados devem permanecer ligados às evidências de origem.');
  table(['Aspecto', 'Registro nos relatórios desta etapa'], [
    ['Método / local de limpeza', `${recorded(technicalValues(snapshot.reports, 'Método de limpeza'))} / ${recorded(technicalValues(snapshot.reports, 'Local de limpeza'))}`],
    ['Sistema e material', `${recorded(systems)} / ${recorded(materials)}`],
    ['Equipamentos', recorded(equipment)], ['Inspeção', recorded(technicalValues(snapshot.reports, 'Tipo de inspeção'))],
    ['Serviços registrados', recorded(snapshot.reports.flatMap(report => (report.services || []).map(service => service.type)))],
    ['Liberação ao cliente', `${snapshot.reports.filter(report => report.clientReleased).length} de ${snapshot.reports.length} relatório(s) com liberação registrada`]
  ], [.3, .7]);
  heading('Etapas registradas');
  paragraph(recorded(technicalValues(snapshot.reports, 'Etapas realizadas no dia')));
  heading('Critérios e resultados');
  table(['Critério / procedimento', 'Resultado / evidência', 'Conferência'], [
    ['Procedimento e revisão aplicados', 'Consultar o relatório e os documentos técnicos selecionados.', 'A confirmar por serviço / TAG'],
    ['Inspeção e parâmetros do processo', 'Resultados e medições nos relatórios integrais; fotos identificadas nesta síntese.', 'Validar os requisitos contratados']
  ], [.31, .44, .25]);
  note('Fonte da conclusão', 'A síntese não infere atendimento técnico nem aceite a partir de contagens, fotos ou aprovação interna. Os estados de assinatura e aceite de cada relatório estão discriminados no índice dos anexos.', true);

  begin(sectionTitles[4]);
  paragraph('Imagens na ordem selecionada, sem recorte técnico. A data é a do relatório de origem; a captura deve ser confirmada. Originais e hashes estão na pasta fotos do ZIP.', { size: 8.25 });
  layout.gallery(photos);

  begin(sectionTitles[5], 'Equipamentos registrados e documentos aplicáveis ao serviço contratado.');
  table(['Recurso', 'Evidência encontrada', 'Complemento para revisão'], [
    ['Equipamentos / sistemas', recorded(equipment), 'Conferir identificação e uso efetivo nesta etapa.'],
    ['Inspeção', recorded(technicalValues(snapshot.reports, 'Tipo de inspeção')), 'Conferir instrumento, evidência e vínculo ao serviço.'],
    ['Instrumentos e calibração', 'Consultar os documentos técnicos selecionados.', 'Série, certificado e validade na data do uso.']
  ], [.24, .38, .38]);
  heading('Documentação selecionada');
  if (snapshot.documents.length) table(['Documento', 'Versão', 'Estado de aceite'], snapshot.documents.map(document => [
    document.title, document.versionLabel || 'Sem rótulo de versão', acceptanceLabel[document.acceptanceStatus] || document.acceptanceStatus || 'Não registrado'
  ]), [.53, .2, .27]);
  else paragraph('Nenhum documento técnico selecionado para esta etapa.');
  note('Documentação aplicável', 'Conferir proposta / autorização, procedimentos, desenhos, certificados, responsabilidade técnica e comprovantes de SSMA ou resíduos conforme o escopo contratado. A ausência na seleção não prova ausência fora deste databook.');

  begin(sectionTitles[6], 'Produtos confirmados pelo responsável como utilizados nesta etapa.');
  if (snapshot.products.length) {
    table(['Código', 'Produto cadastrado', 'Transferências registradas'], snapshot.products.map(product => [product.code, product.name,
      `${numberLabel(product.movements.reduce((total, movement) => total + movement.quantity, 0))} ${product.unitLabel || ''}`]), [.14, .55, .31], { compact: true });
    heading('Detalhamento por lote');
    table(['Produto', 'Lote cadastrado', 'Transferência', 'Data / recorte'], snapshot.products.flatMap(product => product.movements.map(movement => [
      product.code, movement.lot || 'Não informado', `${numberLabel(movement.quantity)} ${product.unitLabel || ''}`,
      `${dateLabel(movement.date)} · ${movement.inPeriod ? 'Dentro' : 'Fora'}`
    ])), [.14, .32, .25, .29], { compact: true });
  } else paragraph('Nenhum produto confirmado como utilizado nesta etapa.');
  note('Consumo efetivo', 'As quantidades representam transferências de estoque vinculadas ao projeto, inclusive fora do período quando selecionadas. Não são uma declaração de consumo. Conciliar aplicação, sobras, devoluções e estornos.', true);
  note('Rastreabilidade por aplicação', 'Conferir produto comercial, fabricante / fornecedor, lote, validade, TAG, fase, quantidade aplicada e unidade. A FDS específica e sua revisão acompanham os produtos confirmados.');

  begin(sectionTitles[7], 'Fichas com Dados de Segurança selecionadas e preservadas integralmente.');
  if (snapshot.products.length) table(['Produto', 'Documento / identificação', 'Revisão conferida', 'Anexo'], snapshot.products.map(product => [
    `${product.code}\n${product.name}`, `${product.document.fileName}\nFabricante: ${product.manufacturer || 'A confirmar'}\nCAS: ${product.casNumber || 'A confirmar'} · ONU: ${product.unNumber || 'A confirmar'}`,
    product.revision, { reference: `fds:${product.id}`, text: '' }
  ]), [.24, .38, .24, .14]);
  else paragraph('Nenhuma FDS selecionada nesta etapa.');
  heading('Conferência da ficha com o produto');
  paragraph('O responsável confirmou o uso, a correspondência e a revisão de cada FDS selecionada. A data de upload não equivale à data de revisão. Conferir identidade, composição e apresentação com o fabricante / fornecedor.');
  note('Estado dos anexos', 'As fichas são copiadas na íntegra, sem resumo ou reescrita. A coluna “Anexo” permite localizar as páginas no PDF consolidado. Os arquivos originais estão na pasta fds do ZIP.');

  begin(sectionTitles[8], 'Revisão técnica, pendências e formalização da entrega.');
  note('Síntese documental', `${snapshot.reports.length} relatório(s), ${snapshot.photos.length} fotografia(s), ${snapshot.products.length} produto(s) e ${snapshot.documents.length} documento(s) técnico(s) nesta revisão. O período é ${dateLabel(snapshot.startDate)} a ${dateLabel(snapshot.endDate)}. A emissão não encerra o projeto nem registra aceite do cliente.`);
  heading('Conclusão técnica');
  paragraph(snapshot.summary || 'Conclusão técnica a confirmar pelo responsável: resultado por serviço / TAG, procedimento aplicado, requisito acordado, evidências, ressalvas e recomendações.');
  heading('Conferência e pendências');
  if (snapshot.warnings.length) table(['Item', 'Pendência registrada'], snapshot.warnings.map((warning, i) => [String(i + 1).padStart(2, '0'), warning]), [.1, .9], { compact: true });
  else paragraph('Nenhuma pendência identificada nas verificações automáticas desta seleção.');
  fields([['Elaborado por', `${author} · ${dateLabel(issuedAt)}`], ['Revisão técnica', 'Responsável / registro / data: a confirmar'],
    ['Recebimento pelo cliente', 'Evidência de entrega: a confirmar'], ['Aceite ou ressalvas', 'Documento de evidência: a confirmar']]);

  begin(sectionTitles[9], 'Localização dos documentos integrais e dos arquivos originais desta revisão.');
  table(['Grupo', 'Conteúdo incluído', 'Localização'], [
    ['A · FDSs', `${snapshot.products.length} ficha(s) específica(s), integral(is)`, { reference: 'group:fds', text: '' }],
    ['B · Relatórios técnicos', `${technicalReports.length} relatório(s)`, { reference: 'group:technical', text: '' }],
    ['C · Diário de obra', `${rdos.length} RDO(s)`, { reference: 'group:rdos', text: '' }],
    ['D · Fotografias', `${snapshot.photos.length} original(is) no ZIP`, 'Pasta fotos'],
    ['E · Documentos técnicos', `${snapshot.documents.length} documento(s) / referência(s)`, { reference: 'group:documents', text: '' }]
  ], [.28, .49, .23]);
  heading('Índice dos relatórios integrais');
  table(['Relatório / data', 'Estado interno', 'Liberação / assinatura / aceite do cliente', 'Anexo'], snapshot.reports.map(report => [
    `${reportLabel(report)}\n${dateLabel(report.date)}`, statusLabel[report.status] || report.status,
    `Liberação: ${report.clientReleased ? 'registrada' : 'não registrada'}\nAssinatura: ${report.clientSigned ? 'concluída' : report.clientSignaturesSigned ? `parcial (${report.clientSignaturesSigned}/${report.clientSignaturesRequired})` : 'não registrada'}${report.pendingSignatures ? ` (${report.pendingSignatures} pend.)` : ''}\nAceite: ${report.clientAccepted ? 'registrado' : 'não registrado'}`,
    { reference: `report:${report.id}`, text: '' }
  ]), [.2, .22, .44, .14], { compact: true, size: 7.5 });
  note('Conferência do pacote', 'O sumário e as referências de anexo apontam para o PDF consolidado. O manifesto registra o período, a revisão e os hashes SHA-256. Referências externas e documentos que não sejam PDF ficam identificados no manifesto / ZIP.');
  const synthesisPages = pdf.getPageCount();
  const bookmarks = [...layout.sections], destinations = new Map();
  const appendPdf = async (bytes, entry, title, key, group) => {
    let source;
    try { source = await PDFDocument.load(bytes); } catch { throw databookError(`PDF inválido, protegido ou ilegível: ${title}.`); }
    if (!source.getPageCount() || source.getPageCount() > 2000 || pdf.getPageCount() + source.getPageCount() > 5000) throw databookError('Quantidade de páginas excede o limite. Divida a etapa.', 413);
    entry.pdfStartPage = pdf.getPageCount() + 1; entry.pdfPages = source.getPageCount();
    const destination = { page: pdf.getPageCount(), text: `${entry.pdfStartPage}–${entry.pdfStartPage + entry.pdfPages - 1}` };
    destinations.set(key, destination);
    if (!destinations.has(group)) destinations.set(group, { page: destination.page, text: String(entry.pdfStartPage) });
    bookmarks.push({ title, page: pdf.getPageCount() });
    const pages = await pdf.copyPages(source, source.getPageIndices()); pages.forEach(copied => pdf.addPage(copied));
  };
  // As in the approved preview, the complete safety sheets follow the synthesis.
  for (const product of snapshot.products) {
    const bytes = await readFds(product), entry = addFile('fds', product.document.id, product.document.fileName, bytes, { itemId: product.id, revision: product.revision });
    await appendPdf(bytes, entry, `Anexo A · FDS · ${product.code} · ${product.name}`, `fds:${product.id}`, 'group:fds');
  }
  for (const [index, report] of [...technicalReports, ...rdos].entries()) {
    const file = await readReport(report), entry = addFile('relatorios', report.id, file.fileName, file.buffer, { type: report.reportType, date: report.date });
    await appendPdf(file.buffer, entry, `${reportLabel(report)} · ${dateLabel(report.date)}`, `report:${report.id}`, report.reportType.startsWith('RDO') ? 'group:rdos' : 'group:technical');
    await onProgress(40 + Math.round(30 * (index + 1) / snapshot.reports.length));
  }
  for (const document of snapshot.documents) {
    if (document.externalUrl) {
      manifest.references.push({ sourceId: document.versionId, title: document.title, url: document.externalUrl }); continue;
    }
    const file = await readDocument(document), entry = addFile('documentos', document.versionId, file.fileName, file.buffer, { title: document.title });
    if (file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.fileName)) await appendPdf(file.buffer, entry, document.title, `document:${document.versionId}`, 'group:documents');
  }
  layout.sections.forEach((section, i) => destinations.set(`section:${i}`, { page: section.page, text: String(section.page + 1) }));
  layout.finish(key => destinations.get(key) || { text: key === 'group:documents' && snapshot.documents.length ? 'ZIP / manifesto' : key.startsWith('group:') ? 'Não incluído' : 'No ZIP' });
  // Imported annex pages receive neither branding nor overlays.
  addBookmarks(pdf, bookmarks);
  manifest.presentation = { template: DATABOOK_TEMPLATE, synthesisPages, sections: layout.sections.map(section => ({ title: section.title, startPage: section.page + 1 })) };
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
