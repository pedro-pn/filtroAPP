import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const readSource = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('relatórios aparecem abaixo do escopo em projeto individual e grupo mesclado', async () => {
  const source = await readSource('src/components/projects/ProjectDetailDashboard.tsx');

  const scopeIndex = source.indexOf('<PlannedScopeView scope={effectiveScope} />');
  const reportsIndex = source.indexOf('<ProjectReportsDialog');

  assert.ok(scopeIndex >= 0, 'o escopo cadastrado deve continuar visível');
  assert.ok(reportsIndex > scopeIndex, 'o acesso aos relatórios deve ficar abaixo do escopo');
  assert.match(source, /isGroup \? Boolean\(data\.group\?\.members\.some\(member => member\.visible !== false\)\) : Boolean\(projectId\)/);
  assert.match(source, /groupMembers=\{isGroup \? data\.group\?\.members : undefined\}/);
});

test('diálogo exige papel de gestor ou coordenador do módulo RDO', async () => {
  const source = await readSource('src/components/projects/ProjectReportsDialog.tsx');

  assert.match(source, /hasAnyModuleRole\(user, \['rdo:manager', 'rdo:coordinator'\]\)/);
  assert.match(source, /if \(!canViewReports \|\| !reportProjectId\) return null/);
  assert.match(source, /useAccumulatedReportsPage\(filters, canViewReports && open && Boolean\(reportProjectId\)\)/);
});

test('filtro do grupo seleciona apenas missões visíveis e conserva a missão escolhida', async () => {
  const source = await readSource('src/components/projects/ProjectReportsDialog.tsx');
  const tree = ts.createSourceFile('ProjectReportsDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const resolver = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'resolveProjectReportsMission');
  assert.ok(resolver, 'seletor de missão');
  const code = ts.transpileModule(`${resolver.getText(tree)}\nresolveProjectReportsMission;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const resolveProjectReportsMission = runInNewContext(code);
  const members = [
    { projectId: 'p1', code: '101', visible: true },
    { projectId: 'p2', code: '102', visible: true },
    { projectId: 'p3', code: '103', visible: false }
  ];

  assert.equal(resolveProjectReportsMission(undefined, members, 'p2').reportProjectId, 'p2');
  assert.equal(resolveProjectReportsMission(undefined, members, 'p3').reportProjectId, 'p1');
  assert.deepEqual(
    Array.from(resolveProjectReportsMission(undefined, members, 'p2').missions, member => member.projectId),
    ['p1', 'p2']
  );
  assert.equal(resolveProjectReportsMission('individual', undefined, '').reportProjectId, 'individual');
  assert.equal(resolveProjectReportsMission(undefined, [{ projectId: 'p3', visible: false }], '').reportProjectId, '');

  assert.match(source, /resolveProjectReportsMission\(projectId, groupMembers, selectedProjectId\)/);
  assert.match(source, /projectId: reportProjectId/);
  assert.match(source, /<select[\s\S]*?value=\{reportProjectId\}[\s\S]*?onChange=\{event => setSelectedProjectId\(event\.target\.value\)\}/);
});

test('diálogo replica os cards aprovados em modo consulta e oferece somente ações de PDF', async () => {
  const dialogSource = await readSource('src/components/projects/ProjectReportsDialog.tsx');
  const cardSource = await readSource('src/components/reports/ReportSummaryCard.tsx');

  assert.match(dialogSource, /statuses: \['APPROVED', 'SIGNED'\]/);
  assert.match(dialogSource, /projectId: reportProjectId/);
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
