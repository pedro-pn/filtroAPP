import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('relatórios da missão aparecem abaixo do escopo apenas no projeto individual', async () => {
  const source = await readSource('src/components/projects/ProjectDetailDashboard.tsx');

  const scopeIndex = source.indexOf('<PlannedScopeView scope={effectiveScope} />');
  const reportsIndex = source.indexOf('<ProjectReportsDialog');

  assert.ok(scopeIndex >= 0, 'o escopo cadastrado deve continuar visível');
  assert.ok(reportsIndex > scopeIndex, 'o acesso aos relatórios deve ficar abaixo do escopo');
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
  assert.match(dialogSource, /<ReportSummaryCard[\s\S]{0,180}?allowOpenDetail=\{false\}/);
  assert.match(dialogSource, /downloadReportPdf\(report\.id\)/);
  assert.doesNotMatch(dialogSource, /downloadReportDocx|updateReport|deleteReport/);
  assert.match(cardSource, /onClick=\{allowOpenDetail \? handleOpenDetail : undefined\}/);
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
