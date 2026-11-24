import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';

import AdmZip from 'adm-zip';

import prisma from '../src/lib/prisma.js';
import { clearProjectDerivedCaches } from '../src/lib/resource-list-cache.js';
import router from '../src/routes/resources/statistics.js';
import {
  XLSX_MIME_TYPE, buildXlsxWorkbook, columnLetter, sanitizeSheetName
} from '../../shared/modules/xlsx-workbook.js';

function unzip(bytes) {
  const zip = new AdmZip(Buffer.from(bytes));
  return Object.fromEntries(zip.getEntries().map(entry => [entry.entryName, entry.getData().toString('utf8')]));
}

const spec = {
  generatedAt: new Date('2026-11-24T15:30:00.000Z'),
  sheets: [{
    name: 'Calibração: [teste]/2026',
    title: 'Visão geral & calibração',
    subtitle: 'Equipamentos',
    meta: [['Categoria', 'Bombas'], ['Busca', '']],
    columns: [
      { header: 'Código' },
      { header: 'Data', type: 'date' },
      { header: 'Valor', type: 'currency', total: 'sum' },
      { header: 'Horas', type: 'duration', total: 'sum' },
      { header: 'Status', tone: value => (value === 'Expirada' ? 'danger' : 'success') },
      { header: 'Enviada em', type: 'datetime' }
    ],
    rows: [
      ['EQ-1\u0007', '2026-03-10', '1234.50', 90, 'Expirada', '2026-11-24T15:30:00.000Z'],
      ['EQ-2', '15/04/2026', 'n/d', 30, 'Calibrado', null]
    ]
  }]
};

test('xlsx workbook: pacote válido, tipado e no modelo Filtrovali (store e deflate)', () => {
  for (const options of [{}, { deflateRaw: data => zlib.deflateRawSync(data) }]) {
    const files = unzip(buildXlsxWorkbook(spec, options));
    assert.ok(files['[Content_Types].xml'].includes('worksheet+xml'));
    const workbook = files['xl/workbook.xml'];
    const sheet = files['xl/worksheets/sheet1.xml'];
    const strings = files['xl/sharedStrings.xml'];

    // Nome de aba sem caracteres proibidos e com título de impressão.
    assert.match(workbook, /<sheet name="Calibração  teste  2026"|<sheet name="Calibração teste 2026"/);
    assert.match(workbook, /_xlnm\.Print_Titles/);
    // Título com &, contexto sem linhas vazias, gerado em no fuso de São Paulo.
    assert.match(strings, /Visão geral &amp; calibração/);
    assert.match(strings, /FILTROVALI {2}· {2}Equipamentos/);
    assert.match(strings, /<t xml:space="preserve">Categoria: <\/t>/);
    assert.doesNotMatch(strings, /Busca: /);
    assert.match(strings, /24\/11\/2026 às 12:30/);
    assert.doesNotMatch(strings, /\u0007/);
    // Datas como serial do Excel (10/03/2026 = 46091), moeda numérica, duração em fração de dia.
    assert.match(sheet, /<v>46091<\/v>/);
    assert.match(sheet, /<v>46127<\/v>/);
    assert.match(sheet, /<v>1234\.5<\/v>/);
    assert.match(sheet, /<v>0\.0625<\/v>/);
    // Hora local (12:30 em São Paulo) no data-hora.
    assert.match(sheet, /<v>46350\.520833333\d*<\/v>/);
    // Texto não numérico em coluna numérica vira texto, sem quebrar.
    assert.match(strings, /n\/d/);
    // Totais com SUBTOTAL e valor em cache; painel congelado e autofiltro.
    assert.match(sheet, /<f>SUBTOTAL\(109,C\d+:C\d+\)<\/f><v>1234\.5<\/v>/);
    assert.match(sheet, /state="frozen"/);
    assert.match(sheet, /<autoFilter ref="A\d+:F\d+"\/>/);
    assert.match(sheet, /showGridLines="0"/);
    // Badge de status com as cores do DS.
    assert.match(files['xl/styles.xml'], /FFFDECEC/);
    assert.match(files['xl/styles.xml'], /FFC81519/);
    assert.match(files['xl/styles.xml'], /formatCode="\[h\]:mm"/);
  }
});

test('xlsx workbook: planilha vazia mostra a mensagem e sem autofiltro', () => {
  const files = unzip(buildXlsxWorkbook({ sheets: [{ name: 'Vazia', columns: [{ header: 'A' }], rows: [], emptyMessage: 'Nada aqui.' }] }));
  assert.match(files['xl/sharedStrings.xml'], /Nada aqui\./);
  assert.doesNotMatch(files['xl/worksheets/sheet1.xml'], /autoFilter/);
});

test('xlsx helpers', () => {
  assert.equal(columnLetter(0), 'A');
  assert.equal(columnLetter(25), 'Z');
  assert.equal(columnLetter(26), 'AA');
  assert.equal(columnLetter(701), 'ZZ');
  assert.equal(sanitizeSheetName('a'.repeat(40)).length, 31);
  assert.equal(sanitizeSheetName(''), 'Planilha');
});

function requestFile(query) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      write() { reject(new Error('XLSX não deve usar streaming de CSV.')); },
      end(buffer) { resolve({ status: this.statusCode, headers, buffer }); } };
    router.stack.find(layer => layer.route?.path === '/projects/export').route.stack.at(-1).handle(
      { query, auth: { user: { id: 'manager', role: 'MANAGER' } } }, res, reject);
  });
}

test('estatísticas: exportação em planilha XLSX tipada por seção', async t => {
  const originals = { projects: prisma.project.findMany, reports: prisma.report.findMany, count: prisma.report.count };
  t.after(() => {
    prisma.project.findMany = originals.projects;
    prisma.report.findMany = originals.reports;
    prisma.report.count = originals.count;
    clearProjectDerivedCaches();
  });
  clearProjectDerivedCaches();
  prisma.project.findMany = async () => [{ id: 'project', code: 'P1', name: 'Projeto' }];
  prisma.report.count = async () => 1;
  prisma.report.findMany = async ({ where }) => (where.reportType === 'RDO'
    ? [{ id: 'rdo', projectId: 'project', reportType: 'RDO', status: 'SIGNED', sequenceNumber: 12,
      reportDate: '2026-10-15', daytimeWorkedMinutes: 480, services: [] }]
    : []);

  const invalid = await requestFile({ from: '2026-10-15', to: '2026-10-15', section: 'byProject', format: 'pdf' });
  assert.equal(invalid.status, 400);

  const response = await requestFile({ from: '2026-10-15', to: '2026-10-15', projectId: 'project', section: 'byProject', format: 'xlsx' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], XLSX_MIME_TYPE);
  assert.match(response.headers['content-disposition'], /estatisticas-byProject-2026-10-15-2026-10-15\.xlsx/);
  const files = unzip(response.buffer);
  assert.match(files['xl/sharedStrings.xml'], /Estatísticas por projeto/);
  assert.match(files['xl/sharedStrings.xml'], /15\/10\/2026 a 15\/10\/2026/);
  assert.match(files['xl/sharedStrings.xml'], /P1 — Projeto/);
  // 480 minutos = 8h = 1/3 de dia, formatado como [h]:mm.
  assert.match(files['xl/worksheets/sheet1.xml'], /<v>0\.333333333\d*<\/v>/);
  assert.match(files['xl/worksheets/sheet1.xml'], /SUBTOTAL\(109,/);
});
