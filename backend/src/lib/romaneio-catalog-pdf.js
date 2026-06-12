import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logoHeaderPath = path.resolve(__dirname, '../../assets/Logo/LOGO_HEADER.png');
const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 18;
const HEADER_HEIGHT = 62;
const TABLE_TOP = PAGE_HEIGHT - HEADER_HEIGHT - 8;
const FOOTER_Y = 12;
const ROW_HEIGHT = 10.5;
const CATEGORY_HEIGHT = 11.5;
const COLUMN_COUNT = 3;
const COLUMN_GAP = 6;
const COLUMN_WIDTH = (PAGE_WIDTH - (MARGIN * 2) - (COLUMN_GAP * (COLUMN_COUNT - 1))) / COLUMN_COUNT;
const CONTROL_WIDTH = 36;
const CODE_WIDTH = 36;
const ITEM_WIDTH = COLUMN_WIDTH - CODE_WIDTH - CONTROL_WIDTH;
const GREEN = rgb(0.188, 0.314, 0.227);
const LIGHT_GRAY = rgb(0.91, 0.91, 0.91);
const BORDER = rgb(0.56, 0.56, 0.56);
const TEXT = rgb(0.1, 0.1, 0.1);
const WARNING_RED = rgb(0.784, 0.082, 0.098);
const FOOTER_WARNING = 'Este documento deve ser usado somente como anotação, o romaneio final deve ser cadastrado no app: https://app.filtrovali.com.br';

function safeText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[–—]/g, '-')
    .replace(/[^\u0020-\u00FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function groupItemsByCategory(items) {
  const groups = new Map();
  (items || []).forEach(item => {
    const key = safeText(item.categoryName) || 'Itens';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return Array.from(groups.entries()).map(([categoryName, groupItems]) => ({
    categoryName,
    items: groupItems
  }));
}

function truncateText(text, font, size, maxWidth) {
  const value = safeText(text);
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let next = value;
  while (next.length > 1 && font.widthOfTextAtSize(`${next}...`, size) > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next.trimEnd()}...`;
}

function drawText(page, font, text, x, y, size = 8, color = TEXT, maxWidth = null) {
  page.drawText(maxWidth ? truncateText(text, font, size, maxWidth) : safeText(text), {
    x,
    y,
    size,
    font,
    color
  });
}

function drawBox(page, x, y, width, height, options = {}) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: options.color,
    borderColor: options.borderColor || BORDER,
    borderWidth: options.borderWidth ?? 0.45
  });
}

function drawHeader(page, fonts, logoImage, pageNumber, pageCount) {
  drawBox(page, 0, PAGE_HEIGHT - 36, PAGE_WIDTH, 36, { color: GREEN, borderWidth: 0 });
  const logoHeight = 20;
  const logoWidth = logoImage.width * (logoHeight / logoImage.height);
  page.drawImage(logoImage, {
    x: MARGIN,
    y: PAGE_HEIGHT - 28,
    width: logoWidth,
    height: logoHeight
  });
  const title = 'ROMANEIO';
  const titleSize = 14;
  const titleWidth = fonts.bold.widthOfTextAtSize(title, titleSize);
  drawText(page, fonts.bold, title, (PAGE_WIDTH - titleWidth) / 2, PAGE_HEIGHT - 24, titleSize, rgb(1, 1, 1));
  drawText(page, fonts.regular, `Página ${pageNumber}/${pageCount}`, PAGE_WIDTH - MARGIN - 52, PAGE_HEIGHT - 23, 7, rgb(1, 1, 1));

  const rowY = PAGE_HEIGHT - 56;
  const fieldHeight = 13;
  const widths = [238, 200, 124, 112, 112];
  const labels = ['Missão', 'Cliente', 'Data', 'Placa', 'Motorista'];
  let x = MARGIN;
  widths.forEach((width, index) => {
    drawBox(page, x, rowY, width, fieldHeight, { color: LIGHT_GRAY, borderColor: BORDER });
    drawText(page, fonts.bold, `${labels[index]}:`, x + 3, rowY + 3.6, 6);
    x += width;
  });
}

function columnX(columnIndex) {
  return MARGIN + (columnIndex * (COLUMN_WIDTH + COLUMN_GAP));
}

function drawTableHeader(page, fonts, columnIndex, y) {
  const x = columnX(columnIndex);
  drawBox(page, x, y - ROW_HEIGHT, CODE_WIDTH, ROW_HEIGHT, { color: LIGHT_GRAY });
  drawBox(page, x + CODE_WIDTH, y - ROW_HEIGHT, ITEM_WIDTH, ROW_HEIGHT, { color: LIGHT_GRAY });
  drawBox(page, x + CODE_WIDTH + ITEM_WIDTH, y - ROW_HEIGHT, CONTROL_WIDTH, ROW_HEIGHT, { color: LIGHT_GRAY });
  drawText(page, fonts.bold, 'Cod.', x + 3, y - 7.3, 5.4);
  drawText(page, fonts.bold, 'Material', x + CODE_WIDTH + 3, y - 7.3, 5.4);
  drawText(page, fonts.bold, 'Qtd.', x + CODE_WIDTH + ITEM_WIDTH + 3, y - 7.3, 5.4);
  return y - ROW_HEIGHT;
}

function controlLabel(item) {
  if (item.measureType === 'WEIGHT') return { type: 'line', label: 'kg' };
  if (item.measureType === 'LENGTH') return { type: 'line', label: 'm' };
  if (item.isSerialized) return { type: 'checkbox', label: '' };
  return { type: 'line', label: safeText(item.defaultUnitLabel) || 'un' };
}

function drawControl(page, fonts, item, x, y) {
  const control = controlLabel(item);
  if (control.type === 'checkbox') {
    drawBox(page, x + 4, y + 2.5, 5.4, 5.4, { borderColor: TEXT, borderWidth: 0.6 });
    return;
  }
  const lineX = x + 4;
  page.drawLine({
    start: { x: lineX, y: y + 3.5 },
    end: { x: lineX + 17, y: y + 3.5 },
    thickness: 0.45,
    color: TEXT
  });
  drawText(page, fonts.regular, control.label, lineX + 20, y + 2.1, 5.1, TEXT, 9);
}

function drawCategory(page, fonts, categoryName, columnIndex, y) {
  const x = columnX(columnIndex);
  drawBox(page, x, y - CATEGORY_HEIGHT, COLUMN_WIDTH, CATEGORY_HEIGHT, { color: GREEN, borderColor: GREEN });
  drawText(page, fonts.bold, categoryName, x + 4, y - 8.1, 5.9, rgb(1, 1, 1), COLUMN_WIDTH - 8);
  return y - CATEGORY_HEIGHT;
}

function drawItemRow(page, fonts, item, columnIndex, y) {
  const x = columnX(columnIndex);
  const rowY = y - ROW_HEIGHT;
  drawBox(page, x, rowY, CODE_WIDTH, ROW_HEIGHT);
  drawBox(page, x + CODE_WIDTH, rowY, ITEM_WIDTH, ROW_HEIGHT);
  drawBox(page, x + CODE_WIDTH + ITEM_WIDTH, rowY, CONTROL_WIDTH, ROW_HEIGHT);
  drawText(page, fonts.regular, item.code || '', x + 3, rowY + 3.1, 5.4, TEXT, CODE_WIDTH - 6);
  drawText(page, fonts.regular, item.name || '', x + CODE_WIDTH + 3, rowY + 3.1, 5.4, TEXT, ITEM_WIDTH - 6);
  drawControl(page, fonts, item, x + CODE_WIDTH + ITEM_WIDTH, rowY);
  return rowY;
}

function drawFooter(page, fonts) {
  page.drawLine({
    start: { x: MARGIN, y: FOOTER_Y + 10 },
    end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_Y + 10 },
    thickness: 0.4,
    color: BORDER
  });
  const warningSize = 6.2;
  const warningWidth = fonts.bold.widthOfTextAtSize(FOOTER_WARNING, warningSize);
  drawText(page, fonts.bold, FOOTER_WARNING, (PAGE_WIDTH - warningWidth) / 2, FOOTER_Y, warningSize, WARNING_RED);
}

export async function buildRomaneioCatalogPdf(catalogItems) {
  const pdf = await PDFDocument.create();
  const logoImage = await pdf.embedPng(await fs.readFile(logoHeaderPath));
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold)
  };
  const groups = groupItemsByCategory(catalogItems);
  const pages = [];

  function addPage() {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    return {
      page,
      columnIndex: 0,
      y: drawTableHeader(page, fonts, 0, TABLE_TOP)
    };
  }

  function nextColumn(current) {
    if (current.columnIndex < COLUMN_COUNT - 1) {
      const columnIndex = current.columnIndex + 1;
      return {
        page: current.page,
        columnIndex,
        y: drawTableHeader(current.page, fonts, columnIndex, TABLE_TOP)
      };
    }
    return addPage();
  }

  let current = addPage();
  if (!groups.length) {
    current.y = drawCategory(current.page, fonts, 'Itens do romaneio', current.columnIndex, current.y);
    current.y = drawItemRow(current.page, fonts, { name: 'Nenhum item cadastrado.' }, current.columnIndex, current.y);
  }

  for (const group of groups) {
    if (current.y - CATEGORY_HEIGHT - ROW_HEIGHT < FOOTER_Y + 12) current = nextColumn(current);
    current.y = drawCategory(current.page, fonts, group.categoryName, current.columnIndex, current.y);
    for (const item of group.items) {
      if (current.y - ROW_HEIGHT < FOOTER_Y + 12) {
        current = nextColumn(current);
        current.y = drawCategory(current.page, fonts, group.categoryName, current.columnIndex, current.y);
      }
      current.y = drawItemRow(current.page, fonts, item, current.columnIndex, current.y);
    }
  }

  pages.forEach((page, index) => {
    drawHeader(page, fonts, logoImage, index + 1, pages.length);
    drawFooter(page, fonts);
  });

  return Buffer.from(await pdf.save());
}
