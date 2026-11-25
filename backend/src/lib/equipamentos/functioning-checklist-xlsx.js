import fs from 'node:fs';
import AdmZip from 'adm-zip';
import { columnLetter } from '../../../../shared/modules/xlsx-workbook.js';
import { DEFAULT_RESPONSIBLE_LABELS, hasFunctioningChecklist, resolveFunctioningChecklist } from './functioning-checklist.js';

export const CHECKLIST_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const STYLES = fs.readFileSync(new URL('../../../assets/Equipamentos/checklist-styles.xml', import.meta.url));
const LOGO = fs.readFileSync(new URL('../../../assets/Logo/LOGO_COLORIDO.png', import.meta.url));
// IDs authored with openpyxl in scripts/generate-functioning-checklist-styles.py.
const STYLE = Object.fromEntries([
  'blank', 'title', 'subtitle', 'rule', 'code', 'equipment', 'category',
  'fieldLabel', 'fieldValue', 'section', 'sectionSoft', 'itemNumber', 'item',
  'itemAlternate', 'day', 'dayGroupEnd', 'dayHeader', 'dayHeaderGroupEnd',
  'legendOk', 'legendRestriction', 'legendStopped', 'writing', 'responsible',
  'photo', 'caption'
].map((name, index) => [name, index + 1]));

const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const segment = (from, to, value = '', style = 'blank', merge = true) => ({ from, to, value, style, merge });

function lineCount(value, width) {
  let lines = 1;
  let length = 0;
  for (const word of String(value).trim().split(/\s+/)) {
    if (length && length + 1 + word.length > width) { lines++; length = 0; }
    if (word.length > width) { lines += Math.floor((word.length - 1) / width); length = (word.length - 1) % width + 1; }
    else length += word.length + (length ? 1 : 0);
  }
  return lines;
}

function buildSheet(equipment, category, template, photos = false) {
  const monthly = template.format === 'MONTHLY';
  const cols = monthly ? 43 : 24;
  const last = columnLetter(cols - 1);
  const rows = [];
  const merges = [];
  const addRow = (height, segments = []) => {
    const number = rows.length + 1;
    const cells = Array.from({ length: cols }, () => ({ value: '', style: 'blank' }));
    for (const { from, to, value, style, merge } of segments) {
      for (let col = from; col <= to; col++) cells[col - 1] = { value: col === from ? value : '', style };
      if (to > from && merge) merges.push(`${columnLetter(from - 1)}${number}:${columnLetter(to - 1)}${number}`);
    }
    rows.push({ number, height, cells });
  };
  const full = (height, value = '', style = 'blank') => addRow(height, [segment(1, cols, value, style)]);
  const split = (height, values, style = 'writing') => addRow(height, values.map((value, index) => {
    // The monthly grid has 43 columns, so divide it at the nearest column.
    const start = Math.floor(index * cols / values.length) + 1;
    const end = Math.floor((index + 1) * cols / values.length);
    return segment(start, end, value, style);
  }));

  full(8);
  addRow(24, [segment(7, cols, 'CHECKLIST DE FUNCIONAMENTO', 'title')]);
  addRow(14, [segment(7, cols, 'DEPTO. TÉCNICO · SETOR OPERACIONAL', 'subtitle')]);
  full(3, '', 'rule');
  full(6);
  addRow(10, [segment(1, 6, 'EQUIPAMENTO', 'fieldLabel'), segment(7, cols, equipment.name, 'equipment', false)]);
  addRow(18, [segment(1, 6, equipment.code, 'code', false), segment(7, cols, '', 'equipment', false)]);
  addRow(13, [segment(1, 6, '', 'code', false), segment(7, cols, `Categoria: ${category?.name || ''}`, 'category')]);
  merges.push(`G6:${last}7`, 'A7:F8');
  full(6);

  const info = monthly ? [[1, 21], [22, 32], [33, cols]] : [[1, 12], [13, 18], [19, cols]];
  for (const labels of [['CLIENTE:', 'MISSÃO:', 'ÁREA:'], ['LOCAL DA OBRA:', 'PROPOSTA Nº:', monthly ? 'MÊS / ANO:' : 'DATA:']]) {
    addRow(10, info.map(([start, end], index) => segment(start, end, labels[index], 'fieldLabel')));
    addRow(20, info.map(([start, end]) => segment(start, end, '', 'fieldValue')));
  }
  full(8);

  let bodyStart;
  let bodyEnd;
  if (photos) {
    full(20, 'REGISTRO FOTOGRÁFICO DO EQUIPAMENTO', 'section');
    for (let index = 1; index <= 3; index++) {
      full(132, `FOTO ${index} / IDENTIFICAÇÃO:`, 'photo');
      full(9);
    }
  } else if (monthly) {
    addRow(24, [segment(1, 12, 'ITENS A VERIFICAR', 'section'), ...Array.from({ length: 31 }, (_, index) =>
      segment(index + 13, index + 13, index + 1, (index + 1) % 7 === 0 ? 'dayHeaderGroupEnd' : 'dayHeader'))]);
    bodyStart = rows.length;
    template.items.forEach((item, index) => {
      addRow(Math.max(28, lineCount(item, 56) * 11 + 10), [
        segment(1, 1, index + 1, 'itemNumber'),
        segment(2, 12, item, index % 2 ? 'item' : 'itemAlternate'),
        ...Array.from({ length: 31 }, (_, day) => segment(day + 13, day + 13, '', (day + 1) % 7 === 0 ? 'dayGroupEnd' : 'day'))
      ]);
    });
    bodyEnd = rows.length;
    full(6);
    addRow(24, [
      segment(1, 12, 'OK · Conferido', 'legendOk'),
      segment(13, 27, 'R · Funcionando com restrição', 'legendRestriction'),
      segment(28, cols, 'P · Parado / necessário regularização antes de operar', 'legendStopped')
    ]);
    full(6);
    full(16, 'ENVOLVIDOS NA ATIVIDADE', 'sectionSoft');
    split(22, ['Nome:', 'Nome:']);
    split(30, ['Assinatura:', 'Assinatura:']);
    full(12, 'Preencha os campos em branco em campo. Exemplo de marcação diária: OK.', 'caption');
  } else {
    full(20, 'RELAÇÃO DE ACESSÓRIOS FORNECIDOS COM O EQUIPAMENTO', 'section');
    bodyStart = rows.length;
    (template.items.length ? template.items : Array(10).fill('')).forEach((item, index) => {
      addRow(Math.max(20, lineCount(item, 100) * 11 + 10), [segment(1, 1, index + 1, 'itemNumber'), segment(2, cols, item, 'item')]);
    });
    bodyEnd = rows.length;
    for (const title of ['Defeitos encontrados na inspeção do equipamento:', 'Observações:']) {
      full(6);
      full(18, title, 'sectionSoft');
      full(24, '', 'fieldValue');
      full(24, '', 'fieldValue');
    }
    full(8);
    split(18, ['FORNECIMENTO', 'DEVOLUÇÃO'], 'section');
    split(24, ['Data do fornecimento: ____/____/________', 'Data da devolução: ____/____/________'], 'fieldValue');
    const labels = template.responsibleLabels || DEFAULT_RESPONSIBLE_LABELS;
    split(Math.max(26, ...labels.map(label => lineCount(label, 26) * 10 + 8)), labels, 'responsible');
    split(24, ['Nome:', 'Nome:', 'Nome:', 'Nome:']);
    split(24, ['Função:', 'Função:', 'Função:', 'Função:']);
    split(34, ['Assinatura:', 'Assinatura:', 'Assinatura:', 'Assinatura:']);
    full(12, 'Preencha os campos em branco e assine após a conferência do equipamento.', 'caption');
  }

  // Reserve the complete footer on the last page. Long lists retain a readable
  // scale and repeat their header instead of shrinking 100 items to one page.
  const breaks = [];
  if (bodyStart != null) {
    const repeatedHeight = rows.slice(0, bodyStart).reduce((sum, row) => sum + row.height, 0);
    const footerHeight = rows.slice(bodyEnd).reduce((sum, row) => sum + row.height, 0);
    const printableHeight = (monthly ? 595.28 : 841.89) - 18 - 23.04 - 8;
    const capacity = Math.max(90, printableHeight - repeatedHeight - footerHeight);
    let used = 0;
    for (const row of rows.slice(bodyStart, bodyEnd)) {
      if (used && used + row.height > capacity) { breaks.push(row.number - 1); used = 0; }
      used += row.height;
    }
  }
  // Excel/Calc shrink oversized content to the page, but do not expand a narrow
  // sheet. Generous column widths make the form use the available A4 width.
  const widths = monthly
    ? '<col min="1" max="12" width="4.7" customWidth="1"/><col min="13" max="43" width="3.1" customWidth="1"/>'
    : '<col min="1" max="24" width="4.3" customWidth="1"/>';
  const sheetData = rows.map(row => `<row r="${row.number}" ht="${row.height}" customHeight="1">${row.cells.map((cell, col) =>
    `<c r="${columnLetter(col)}${row.number}" s="${STYLE[cell.style]}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`).join('')}</row>`).join('');
  const rowBreaks = breaks.length ? `<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">${breaks.map(id => `<brk id="${id}" min="0" max="16383" man="1"/>`).join('')}</rowBreaks>` : '';
  return {
    name: photos ? 'Registro fotográfico' : 'Funcionamento', rows: rows.length, last, printTitleEnd: bodyStart || 15,
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}" xmlns:r="${REL}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${rows.length}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="100"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths}</cols><sheetData>${sheetData}</sheetData><mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.2" right="0.2" top="0.25" bottom="0.32" header="0.1" footer="0.1"/><pageSetup paperSize="9" orientation="${monthly ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="${breaks.length ? 0 : 1}"/><headerFooter><oddFooter>&amp;L&amp;"Arial,Regular"&amp;7FILTROVALI · CHECKLIST DE FUNCIONAMENTO&amp;R&amp;P / &amp;N</oddFooter></headerFooter>${rowBreaks}<drawing r:id="rIdLogo"/></worksheet>`
  };
}

function logoDrawing() {
  const width = LOGO.readUInt32BE(16);
  const height = LOGO.readUInt32BE(20);
  const scale = Math.min(175 / width, 42 / height);
  const cx = Math.round(width * scale * 9525);
  const cy = Math.round(height * scale * 9525);
  return `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>28575</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Logo Filtrovali" descr="Filtrovali"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="${REL}" r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;
}

// Text cells remain literal, including equipment names/items beginning with '='.
export function buildFunctioningChecklistXlsx(equipment, category) {
  const template = resolveFunctioningChecklist(equipment, category);
  if (!hasFunctioningChecklist(template)) throw Object.assign(new Error('Cadastre os itens do checklist de funcionamento.'), { statusCode: 400 });
  const zip = new AdmZip();
  const sheets = [buildSheet(equipment, category, template)];
  if (template.format === 'INSPECTION') sheets.push(buildSheet(equipment, category, template, true));
  const add = (name, value) => zip.addFile(name, Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'));
  add('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, n) => `<Override PartName="/xl/worksheets/sheet${n + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${n + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('')}</Types>`);
  add('_rels/.rels', `<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  add('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${sheets.map((sheet, n) => `<sheet name="${xml(sheet.name)}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`).join('')}</sheets><definedNames>${sheets.map((sheet, n) => `<definedName name="_xlnm.Print_Area" localSheetId="${n}">'${sheet.name}'!$A$1:$${sheet.last}$${sheet.rows}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="${n}">'${sheet.name}'!$1:$${sheet.printTitleEnd}</definedName>`).join('')}</definedNames></workbook>`);
  add('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${PACKAGE_REL}">${sheets.map((_, n) => `<Relationship Id="rId${n + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${n + 1}.xml"/>`).join('')}<Relationship Id="styles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`);
  add('xl/styles.xml', STYLES);
  add('xl/media/filtrovali.png', LOGO);
  sheets.forEach((sheet, n) => {
    add(`xl/worksheets/sheet${n + 1}.xml`, sheet.data);
    add(`xl/worksheets/_rels/sheet${n + 1}.xml.rels`, `<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rIdLogo" Type="${REL}/drawing" Target="../drawings/drawing${n + 1}.xml"/></Relationships>`);
    add(`xl/drawings/drawing${n + 1}.xml`, logoDrawing());
    add(`xl/drawings/_rels/drawing${n + 1}.xml.rels`, `<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rIdImage" Type="${REL}/image" Target="../media/filtrovali.png"/></Relationships>`);
  });
  return zip.toBuffer();
}
