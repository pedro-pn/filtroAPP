import fs from 'node:fs/promises';
import { StandardFonts, rgb, PDFName } from 'pdf-lib';

// Print design transcribed from the approved modelo-databook-5815-sintese.pdf.
// Measurements are PDF points (the reference's CSS pixels multiplied by .75).
export const DATABOOK_TEMPLATE = 'filtrovali-sintese-v1';
const A4 = [595.28, 841.89];
const MARGIN = 45.35;
const WIDTH = A4[0] - 2 * MARGIN;
const BOTTOM = 775;
const color = hex => rgb(...hex.match(/\w\w/g).map(part => parseInt(part, 16) / 255));
const palette = Object.fromEntries(Object.entries({ green: '0b4c3d', ink: '193c34', muted: '61746c', line: 'dce4df',
  paper: 'f6f7f3', warm: 'fff2dc', note: 'edf3ec', stripe: '82a887', warning: 'c48c30', header: 'eaf0e9', alternate: 'fafbf8' })
  .map(([key, value]) => [key, color(value)]));
export const dateLabel = value => value?.slice(0, 10).split('-').reverse().join('/') || 'A confirmar';

function printable(font, value) {
  return [...String(value ?? '').replace(/\t/g, ' ')].map(char => {
    if (char === '\n') return char;
    try { font.encodeText(char); return char; } catch { return '?'; }
  }).join('');
}

function wrap(font, value, size, width) {
  const lines = [];
  for (const paragraph of printable(font, value).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const char of word) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** A4 presentation with repeating brand, flowing tables and uncropped gallery. */
export async function createDatabookPresentation(pdf, { snapshot, revision, issuedAt }) {
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    serif: await pdf.embedFont(StandardFonts.TimesRoman)
  };
  const logo = await pdf.embedPng(await fs.readFile(new URL('../../../assets/Logo/LOGO_COLORIDO.png', import.meta.url)));
  const sections = [], brandedPages = [], references = [];
  let page, top, currentTitle;
  const linesFor = (value, size = 9.75, width = WIDTH, font = fonts.regular) => wrap(font, value, size, width);
  const draw = (value, x, at, { size = 9.75, font = fonts.regular, ink = palette.ink, width = WIDTH, lineHeight = size * 1.48, target = page, align = 'left' } = {}) => {
    const lines = Array.isArray(value) ? value : linesFor(value, size, width, font);
    lines.forEach((line, index) => target.drawText(line, { x: align === 'right' ? x + width - font.widthOfTextAtSize(line, size) : x,
      y: A4[1] - at - size - index * lineHeight, size, font, color: ink }));
    return lines.length * lineHeight;
  };
  const rectangle = (x, at, width, height, fill, target = page, border) => target.drawRectangle({
    x, y: A4[1] - at - height, width, height, color: fill, ...(border ? { borderColor: border, borderWidth: .6 } : {})
  });
  const line = (at, target = page) => target.drawLine({ start: { x: MARGIN, y: A4[1] - at }, end: { x: A4[0] - MARGIN, y: A4[1] - at }, thickness: .6, color: palette.line });
  function newPage(title, continuation = false) {
    page = pdf.addPage(A4); brandedPages.push(page); top = 99;
    const dimensions = logo.scaleToFit(99.75, 30.75);
    page.drawImage(logo, { x: MARGIN, y: A4[1] - 40 - dimensions.height, ...dimensions });
    draw(`DB-${snapshot.project.code} · REVISÃO ${String(revision).padStart(2, '0')}\nEMISSÃO · ${dateLabel(issuedAt)}`, A4[0] - MARGIN - 210, 43,
      { size: 7.5, width: 210, ink: palette.muted, align: 'right' });
    line(80);
    draw(`DATABOOK DE SERVIÇOS · PROJETO ${snapshot.project.code}`, MARGIN, top, { size: 7.5, font: fonts.bold, ink: palette.stripe });
    top += 17;
    if (title) top += draw(`${title}${continuation ? ' · continuação' : ''}`, MARGIN, top, { size: 23.25, font: fonts.serif, ink: palette.green, lineHeight: 27 }) + 9;
    return page;
  }
  const ensure = height => { if (top + height > BOTTOM) newPage(currentTitle, true); };
  function begin(title, lead) {
    currentTitle = title; newPage(title);
    sections.push({ title, page: pdf.getPageCount() - 1 });
    if (lead) paragraph(lead, { size: 12, ink: palette.muted, gap: 15 });
    return page;
  }
  function paragraph(value, { size = 9.75, font = fonts.regular, ink = palette.ink, gap = 9, lineHeight = size * 1.48 } = {}) {
    const lines = linesFor(value, size, WIDTH, font), height = lineHeight;
    for (const text of lines) { ensure(height); draw([text], MARGIN, top, { size, font, ink }); top += height; }
    top += gap;
  }
  function heading(value) {
    const height = linesFor(value, 11.25, WIDTH, fonts.bold).length * 15 + 23;
    ensure(height + 24); top += 12;
    top += draw(value, MARGIN, top, { size: 11.25, font: fonts.bold, ink: palette.green, lineHeight: 15 }) + 8;
  }
  function note(title, value, warning = false) {
    const size = 9, lineHeight = 13.3, padding = 12, width = WIDTH - 2 * padding;
    const titleLines = linesFor(title, 9.75, width, fonts.bold);
    const titleHeight = titleLines.length * 14;
    const lines = linesFor(value, size, width);
    let offset = 0;
    do {
      ensure(titleHeight + 2 * padding + lineHeight);
      const count = Math.max(1, Math.floor((BOTTOM - top - titleHeight - 2 * padding - 4) / lineHeight));
      const chunk = lines.slice(offset, offset + count);
      const height = titleHeight + chunk.length * lineHeight + 2 * padding + 4;
      rectangle(MARGIN, top, WIDTH, height, warning ? palette.warm : palette.note);
      rectangle(MARGIN, top, 2.25, height, warning ? palette.warning : palette.stripe);
      draw(titleLines, MARGIN + padding, top + padding, { size: 9.75, font: fonts.bold, width, ink: palette.green, lineHeight: 14 });
      draw(chunk, MARGIN + padding, top + padding + titleHeight + 4, { size, width, lineHeight });
      top += height + 10; offset += chunk.length;
      if (offset < lines.length) newPage(currentTitle, true);
    } while (offset < lines.length);
  }
  function table(headers, rows, fractions, { compact = false, size = 8.25 } = {}) {
    const widths = fractions.map(f => WIDTH * f), padding = compact ? 5.25 : 6, lineHeight = size * 1.4;
    const headerLines = headers.map((value, i) => linesFor(value, 7.5, widths[i] - padding * 2, fonts.bold));
    const headerHeight = Math.max(...headerLines.map(l => l.length)) * 10.5 + padding * 2;
    const header = () => {
      rectangle(MARGIN, top, WIDTH, headerHeight, palette.header); let x = MARGIN;
      headerLines.forEach((lines, i) => { draw(lines, x + padding, top + padding, { size: 7.5, font: fonts.bold, ink: palette.green, lineHeight: 10.5 }); x += widths[i]; });
      top += headerHeight;
    };
    const prepared = rows.map(row => row.map((value, i) => {
      const cell = value && typeof value === 'object' ? value : { text: value ?? 'A confirmar' };
      return { ...cell, lines: linesFor(cell.text ?? '', size, widths[i] - padding * 2) };
    }));
    ensure(headerHeight + 2 * padding + lineHeight); header();
    for (const [rowIndex, cells] of prepared.entries()) {
      let offset = 0;
      const count = Math.max(1, ...cells.map(cell => cell.lines.length));
      while (offset < count) {
        const remaining = count - offset, required = remaining * lineHeight + padding * 2;
        // Move ordinary rows intact; split exceptionally long rows with repeated headers.
        if (top + Math.min(required, 550) > BOTTOM) { newPage(currentTitle, true); header(); }
        const capacity = Math.max(1, Math.floor((BOTTOM - top - padding * 2) / lineHeight));
        const take = Math.min(remaining, capacity), height = take * lineHeight + padding * 2;
        if (rowIndex % 2) rectangle(MARGIN, top, WIDTH, height, palette.alternate);
        let x = MARGIN;
        cells.forEach((cell, i) => {
          draw(cell.lines.slice(offset, offset + take), x + padding, top + padding, { size, lineHeight });
          if (!offset && cell.reference) references.push({ key: cell.reference, page, x: x + padding, top: top + padding, width: widths[i] - 2 * padding, size });
          x += widths[i];
        });
        top += height; line(top); offset += take;
        if (offset < count) { newPage(currentTitle, true); header(); }
      }
    }
    top += 12;
  }
  function fields(items, { cover = false } = {}) {
    const gap = 10.5, width = (WIDTH - gap) / 2;
    for (let i = 0; i < items.length; i += 2) {
      const pair = items.slice(i, i + 2);
      const cells = pair.map(([label, value]) => ({ label: linesFor(label.toUpperCase(), 7.5, width - 18), value: linesFor(value || 'A confirmar', 9.75, width - 18, fonts.bold) }));
      const labelHeight = Math.max(...cells.map(cell => cell.label.length * 10)), count = Math.max(...cells.map(cell => cell.value.length));
      let offset = 0;
      while (offset < count) {
        const extra = cover ? 9 : 24;
        ensure(Math.min(labelHeight + (count - offset) * 14 + extra, 550));
        const capacity = Math.max(1, Math.floor((BOTTOM - top - labelHeight - extra) / 14));
        const take = Math.min(count - offset, capacity), height = labelHeight + take * 14 + extra;
        cells.forEach((cell, index) => {
          const x = MARGIN + index * (width + gap), inset = cover ? 0 : 9;
          if (!cover) { rectangle(x, top, width, height, palette.paper); rectangle(x, top, 1.5, height, palette.line); }
          draw(cell.label, x + inset, top + inset, { size: 7.5, ink: palette.muted, lineHeight: 10 });
          draw(cell.value.slice(offset, offset + take), x + inset, top + inset + labelHeight + 4, { size: 9.75, font: fonts.bold, lineHeight: 14 });
        }); top += height + gap; offset += take;
        if (offset < count) newPage(currentTitle, true);
      }
    }
    top += 4;
  }
  function metrics(items) {
    const gap = 8.25, width = (WIDTH - gap * 3) / 4;
    const labels = items.map(([, label]) => linesFor(label, 8.25, width - 21));
    const height = 53 + Math.max(...labels.map(l => l.length)) * 11;
    ensure(height + 12);
    items.forEach(([value], i) => {
      const x = MARGIN + i * (width + gap); rectangle(x, top, width, height, palette.paper);
      const size = fonts.serif.widthOfTextAtSize(String(value), 24) > width - 21 ? 12 : 24;
      draw(value, x + 10.5, top + 10.5, { size, font: fonts.serif, ink: palette.green, width: width - 21 });
      draw(labels[i], x + 10.5, top + 43, { size: 8.25, ink: palette.muted, lineHeight: 11 });
    }); top += height + 14;
  }
  function cover(photo) {
    begin('Databook');
    paragraph(`MEMÓRIA TÉCNICA DOS SERVIÇOS · DB-${snapshot.project.code}`, { size: 10.5, ink: palette.muted, gap: 12 });
    paragraph(`Projeto\n${snapshot.project.code}`, { size: 49.5, font: fonts.serif, ink: palette.green, gap: 12, lineHeight: 50.5 });
    paragraph(snapshot.project.name, { size: 24, gap: 9 });
    paragraph(`${snapshot.title}\n${snapshot.project.clientName}`, { size: 12, ink: palette.muted, gap: 12 });
    // Keep the hero, identity and note together even with a longer project name.
    ensure((photo ? 240 : 0) + 125);
    if (photo) {
      page.drawImage(photo.coverImage, { x: MARGIN, y: A4[1] - top - 213.75, width: WIDTH, height: 213.75 }); top += 219;
      paragraph(`${photo.reportLabel} · data do relatório: ${dateLabel(photo.date)} · ${photo.fileName}`, { size: 7.5, ink: palette.muted, gap: 9 });
    }
    fields([['Referência contratual cadastrada', snapshot.project.contractCode], ['Local de execução', snapshot.project.location],
      ['Período desta etapa (inclusive)', `${dateLabel(snapshot.startDate)} a ${dateLabel(snapshot.endDate)}`], ['Emissão / revisão', `${dateLabel(issuedAt)} · ${String(revision).padStart(2, '0')}`]], { cover: true });
    paragraph('Síntese técnica acompanhada dos documentos de execução. A geração não registra entrega nem aceite do cliente.', { size: 8.25, ink: palette.muted });
  }
  function gallery(photos) {
    const gap = 11.25, width = (WIDTH - gap) / 2, imageHeight = 180, size = 7.5, lineHeight = 10.5;
    if (!photos.length) { paragraph('Nenhuma fotografia selecionada para esta etapa.'); return; }
    for (let i = 0; i < photos.length; i += 2) {
      const pair = photos.slice(i, i + 2).map((photo, j) => ({ ...photo,
        titleLines: linesFor(`F-${String(i + j + 1).padStart(3, '0')} · ${photo.label || 'Registro de campo'}`, 8.25, width, fonts.bold),
        captionLines: linesFor(`${photo.reportLabel} · data do relatório: ${dateLabel(photo.date)}\n${photo.fileName}\n${photo.caption || photo.label || 'Legenda a confirmar'}\n${photo.tag ? `TAG: ${photo.tag} · ` : ''}${photo.phaseLabel}\nSHA-256: ${photo.sha256.slice(0, 16)}…`, size, width)
      }));
      const height = imageHeight + 7 + Math.max(...pair.map(p => p.titleLines.length * 11.5 + p.captionLines.length * lineHeight)) + 15;
      ensure(height);
      pair.forEach((photo, j) => {
        const x = MARGIN + j * (width + gap);
        rectangle(x, top, width, imageHeight, palette.paper, page, palette.line);
        const dimensions = photo.image.scaleToFit(width - 1, imageHeight - 1);
        page.drawImage(photo.image, { x: x + (width - dimensions.width) / 2, y: A4[1] - top - (imageHeight + dimensions.height) / 2, ...dimensions });
        draw(photo.titleLines, x, top + imageHeight + 7, { size: 8.25, font: fonts.bold, ink: palette.green, lineHeight: 11.5 });
        draw(photo.captionLines, x, top + imageHeight + 7 + photo.titleLines.length * 11.5, { size, lineHeight });
      }); top += height;
    }
  }
  function finish(resolveReference) {
    for (const ref of references) {
      const resolved = resolveReference(ref.key);
      draw(resolved?.text || 'No ZIP', ref.x, ref.top, { size: ref.size, width: ref.width, target: ref.page });
      if (Number.isInteger(resolved?.page)) {
        const annotation = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link',
          Rect: [ref.x, A4[1] - ref.top - ref.size * 1.5, ref.x + ref.width, A4[1] - ref.top], Border: [0, 0, 0],
          Dest: [pdf.getPage(resolved.page).ref, PDFName.of('Fit')] }));
        ref.page.node.addAnnot(annotation);
      }
    }
    brandedPages.forEach(current => {
      line(790, current);
      const pageIndex = pdf.getPages().indexOf(current);
      const fullFooter = printable(fonts.regular, `${snapshot.project.code} · ${snapshot.project.name} · REVISÃO ${String(revision).padStart(2, '0')}`);
      let footer = fullFooter;
      while (fonts.regular.widthOfTextAtSize(footer, 6.75) > WIDTH - 45) footer = footer.slice(0, -2);
      if (footer !== fullFooter) footer = `${footer.slice(0, -1)}…`;
      draw(footer, MARGIN, 799,
        { size: 6.75, width: WIDTH - 45, ink: palette.muted, target: current });
      draw(String(pageIndex + 1).padStart(2, '0'), A4[0] - MARGIN - 15, 799, { size: 6.75, ink: palette.muted, target: current });
    });
  }
  return { sections, begin, cover, paragraph, heading, table, fields, metrics, note, gallery, finish };
}
