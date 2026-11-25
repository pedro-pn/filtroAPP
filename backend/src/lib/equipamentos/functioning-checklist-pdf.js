import fs from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DEFAULT_RESPONSIBLE_LABELS, hasFunctioningChecklist, MONTHLY_LEGEND, resolveFunctioningChecklist } from './functioning-checklist.js';

const GREEN = rgb(48 / 255, 80 / 255, 58 / 255);
const INK = rgb(.09, .13, .11);
const MUTED = rgb(.35, .39, .38);
const LINE = rgb(.72, .77, .73);
const WASH = rgb(.95, .97, .95);
const WHITE = rgb(1, 1, 1);

// Os campos continuam em branco para preenchimento em campo, inclusive mês/data.
export async function buildFunctioningChecklistPdf(equipment, category) {
  const template = resolveFunctioningChecklist(equipment, category);
  if (!hasFunctioningChecklist(template)) throw Object.assign(new Error('Cadastre os itens do checklist de funcionamento.'), { statusCode: 400 });
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Checklist de funcionamento - ${equipment.code}`);
  pdf.setAuthor('Filtrovali');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(await fs.readFile(new URL('../../../assets/Logo/LOGO_COLORIDO.png', import.meta.url)));
  const monthly = template.format === 'MONTHLY';
  const [width, height] = monthly ? [841.89, 595.28] : [595.28, 841.89];
  const margin = 30;
  const usable = width - margin * 2;
  let page;
  let y;
  const printable = value => Array.from(String(value ?? '').replace(/\s+/g, ' ')).map(char => {
    try { regular.encodeText(char); return char; } catch { return '?'; }
  }).join('');
  const wrap = (value, max, size = 9, font = regular) => {
    const lines = [];
    let line = '';
    for (const char of printable(value)) {
      if (line && font.widthOfTextAtSize(line + char, size) > max) {
        const space = line.lastIndexOf(' ');
        lines.push(space > 0 ? line.slice(0, space) : line);
        line = space > 0 ? line.slice(space + 1) + char : char;
      } else line += char;
    }
    if (line) lines.push(line);
    return lines;
  };
  const text = (value, x, top, size = 9, font = regular, color = INK) => page.drawText(printable(value), { x, y: top - size, size, font, color });
  const line = (x1, top, x2, bottom = top) => page.drawLine({ start: { x: x1, y: top }, end: { x: x2, y: bottom }, thickness: .5, color: LINE });
  const block = (label, x, top, w, h = 27) => {
    text(label, x + 7, top - 5, 7, bold, MUTED);
    line(x, top, x + w); line(x, top - h, x + w);
    line(x, top, x, top - h); line(x + w, top, x + w, top - h);
  };
  function newPage(subtitle = 'DEPTO. TÉCNICO · SETOR OPERACIONAL') {
    page = pdf.addPage([width, height]);
    const logoSize = logo.scaleToFit(147, 34);
    page.drawImage(logo, { x: margin, y: height - 66, width: logoSize.width, height: logoSize.height });
    const titleX = monthly ? 295 : 213;
    text('CHECKLIST DE FUNCIONAMENTO', titleX, height - 34, monthly ? 15 : 11, bold, GREEN);
    text(subtitle, titleX, height - 56, 8, regular, MUTED);
    page.drawRectangle({ x: margin, y: height - 79, width: usable, height: 3, color: GREEN });
    y = height - 91;
    for (const label of [`${equipment.code} - ${equipment.name}`, `Categoria: ${category?.name || ''}`]) {
      for (const part of wrap(label, usable, 10, bold)) { text(part, margin, y, 10, bold); y -= 13; }
    }
    y -= 6;
    block('CLIENTE:', margin, y, usable * .50); block('MISSÃO:', margin + usable * .50, y, usable * .25); block('ÁREA:', margin + usable * .75, y, usable * .25);
    y -= 27;
    block('LOCAL DA OBRA:', margin, y, usable * .50); block('PROPOSTA Nº:', margin + usable * .50, y, usable * .25); block(monthly ? 'MÊS / ANO:' : 'DATA:', margin + usable * .75, y, usable * .25);
    y -= 42;
  }
  function ruled(label, rows = 2) {
    text(label, margin, y, 9, bold, GREEN); y -= 16;
    for (let n = 0; n < rows; n++) { y -= 18; line(margin, y, width - margin); }
    y -= 14;
  }
  function monthlyFooter() {
    y -= 12;
    text(MONTHLY_LEGEND, margin, y, 8, regular, MUTED); y -= 24;
    text('Envolvidos na atividade', margin, y, 9, bold, GREEN); y -= 20;
    for (let n = 0; n < 2; n++) {
      const x = margin + n * (usable / 2);
      text('Nome:', x, y); line(x + 34, y - 12, x + usable / 2 - 14);
      text('Assinatura:', x, y - 27); line(x + 51, y - 39, x + usable / 2 - 14);
    }
  }
  newPage();
  if (monthly) {
    const itemWidth = 310;
    const dayWidth = (usable - itemWidth) / 31;
    function tableHeader() {
      page.drawRectangle({ x: margin, y: y - 24, width: usable, height: 24, color: GREEN });
      text('ITENS A VERIFICAR', margin + 8, y - 7, 8, bold, WHITE);
      for (let day = 1; day <= 31; day++) {
        const label = String(day);
        text(label, margin + itemWidth + dayWidth * (day - .5) - bold.widthOfTextAtSize(label, 7) / 2, y - 8, 7, bold, WHITE);
      }
      y -= 24;
    }
    tableHeader();
    template.items.forEach((item, index) => {
      const parts = wrap(`${index + 1}. ${item}`, itemWidth - 16, 8);
      const h = Math.max(27, parts.length * 11 + 12);
      if (y - h < 160) { monthlyFooter(); newPage(); tableHeader(); }
      page.drawRectangle({ x: margin, y: y - h, width: usable, height: h, color: index % 2 ? WHITE : WASH });
      parts.forEach((part, n) => text(part, margin + 8, y - 7 - n * 11, 8));
      line(margin, y, margin, y - h); line(margin, y - h, width - margin);
      for (let n = 0; n <= 31; n++) line(margin + itemWidth + dayWidth * n, y, margin + itemWidth + dayWidth * n, y - h);
      y -= h;
    });
    monthlyFooter();
  } else {
    text('Relação de acessórios fornecidos com o equipamento', margin, y, 10, bold, GREEN); y -= 21;
    const accessories = template.items.length ? template.items : Array(10).fill('');
    accessories.forEach((item, index) => {
      const parts = wrap(`${index + 1}. ${item}`, usable - 12, 9);
      const h = Math.max(21, parts.length * 12 + 8);
      if (y - h < 70) newPage('ACESSÓRIOS · CONTINUAÇÃO');
      parts.forEach((part, n) => text(part, margin + 6, y - 4 - n * 12));
      y -= h; line(margin, y, width - margin);
    });
    y -= 16;
    if (y < 370) newPage('INSPEÇÃO · RESPONSÁVEIS');
    ruled('Defeitos encontrados na inspeção do equipamento:', 3);
    ruled('Observações:', 2);
    const half = usable / 2;
    text('Fornecimento: ____/____/________', margin, y, 9, bold);
    text('Devolução: ____/____/________', margin + half, y, 9, bold); y -= 24;
    const col = usable / 4;
    const labels = (template.responsibleLabels || DEFAULT_RESPONSIBLE_LABELS).map(label => wrap(label, col - 12, 8, bold));
    const fieldsOffset = Math.max(...labels.map(parts => parts.length)) * 10 + 12;
    labels.forEach((parts, n) => {
      const x = margin + n * col;
      parts.forEach((part, row) => text(part, x, y - row * 10, 8, bold, GREEN));
      ['Nome:', 'Função:', 'Assinatura:'].forEach((field, row) => { text(field, x, y - fieldsOffset - row * 27, 8); line(x, y - fieldsOffset - 22 - row * 27, x + col - 12); });
    });
    newPage('REGISTRO FOTOGRÁFICO DO EQUIPAMENTO');
    for (let n = 0; n < 3; n++) {
      block(`FOTO ${n + 1} / IDENTIFICAÇÃO:`, margin, y, usable, 165);
      y -= 180;
    }
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    page = p;
    line(margin, 35, width - margin);
    text('FILTROVALI · CHECKLIST DE FUNCIONAMENTO', margin, 26, 7, regular, MUTED);
    text(`${index + 1} / ${pages.length}`, width - margin - 38, 26, 7, regular, MUTED);
  });
  return Buffer.from(await pdf.save());
}
