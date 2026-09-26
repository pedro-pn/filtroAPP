import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const readSource = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('relatórios da missão permanecem na execução sem repetir o escopo cadastrado', async () => {
  const source = await readSource('src/components/projects/ProjectDetailDashboard.tsx');

  const reportsIndex = source.indexOf('<ProjectReportsDialog');

  assert.ok(reportsIndex >= 0, 'o acesso aos relatórios deve permanecer');
  assert.doesNotMatch(source, /<PlannedScopeView|Escopo cadastrado/);
  assert.match(source, /!isGroup && projectId \? \(/);
});

test('diálogo exige papel de gestor ou coordenador do módulo RDO', async () => {
  const source = await readSource('src/components/projects/ProjectReportsDialog.tsx');

  assert.match(source, /hasAnyModuleRole\(user, \['rdo:manager', 'rdo:coordinator'\]\)/);
  assert.match(source, /if \(!canViewReports\) return null/);
  assert.match(source, /useAccumulatedReportsPage\(filters, canViewReports && open\)/);
});

test('diálogo replica os cards aprovados em modo consulta e oferece somente ações de PDF', async () => {
  const dialogSource = await readSource('src/components/projects/ProjectReportsDialog.tsx');
  const cardSource = await readSource('src/components/reports/ReportSummaryCard.tsx');

  assert.match(dialogSource, /statuses: \['APPROVED', 'SIGNED'\]/);
  assert.match(dialogSource, /projectId,/);
  assert.match(dialogSource, /<GroupedReportList/);
  assert.match(dialogSource, /defaultTypeCollapsed/);
  assert.match(dialogSource, /<ReportSummaryCard[\s\S]{0,180}?allowOpenDetail=\{false\}/);
  assert.match(dialogSource, /downloadReportPdf\(report\.id\)/);
  assert.doesNotMatch(dialogSource, /downloadReportDocx|updateReport|deleteReport/);
  assert.match(cardSource, /onClick=\{allowOpenDetail \? handleOpenDetail : undefined\}/);
});

test('categorias de relatório do diálogo iniciam recolhidas', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { GroupedReportList } = await server.ssrLoadModule('/src/components/reports/GroupedReportList.tsx');
    const reports = ['RDO', 'RLQ'].map(reportType => ({
      id: reportType, reportType, projectId: 'p1', project: { code: '5800', name: 'Reframax', isActive: true },
      reportDate: '2026-09-01', sequenceNumber: 1
    }));
    const html = renderToStaticMarkup(createElement(GroupedReportList, {
      appearance: 'design-system', defaultTypeCollapsed: true, reports,
      renderReport: report => createElement('span', null, `Conteúdo ${report.reportType}`)
    }));
    assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 2);
    assert.doesNotMatch(html, /Conteúdo RDO|Conteúdo RLQ/);
    assert.match(html, /1 relatório/);
  } finally {
    await server.close();
  }
});

test('visualizador usa PDF.js localmente e permite baixar o arquivo autenticado', async () => {
  const source = await readSource('src/components/projects/ProjectReportsDialog.tsx');
  const viewerSource = await readSource('src/components/projects/PdfCanvasViewer.tsx');

  assert.match(source, /'Abrir PDF'/);
  assert.match(source, /lazy\(\(\) => import\('\.\/PdfCanvasViewer'\)/);
  assert.match(source, /<PdfCanvasViewer blob=\{pdfPreview\.blob\}/);
  assert.match(source, /downloadBlob\(pdfPreview\.blob, reportDownloadFileName\(pdfPreview\.report, 'pdf'\)\)/);
  assert.doesNotMatch(source, /<iframe|URL\.createObjectURL/);
  assert.match(viewerSource, /getDocument\(\{ data \}\)/);
  assert.match(viewerSource, /page\.render\(/);
  assert.match(viewerSource, /Página \{pageNumber\} de \{pageCount \|\| '—'\}/);
});
