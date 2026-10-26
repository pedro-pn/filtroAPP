import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { PGlite } from '@electric-sql/pglite';

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const [{ default: app }, { default: prisma }, { default: env }, { getReportPdfDownload }] = await Promise.all([
  import('../src/app.js'), import('../src/lib/prisma.js'), import('../src/config/env.js'),
  import('../src/routes/resources/reports.js')
]);
const { reportPdfAttachmentPath, validateReportPdfAttachment } = await import('../src/lib/reports/pdf-attachments.js');

async function pdf(widths) {
  const document = await PDFDocument.create();
  for (const width of widths) document.addPage([width, 600]);
  return Buffer.from(await document.save({ addDefaultPage: false }));
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'report-pdf-attachments-'));
  const originalUploadDir = env.uploadDir;
  env.uploadDir = root;
  t.after(async () => { env.uploadDir = originalUploadDir; await fs.rm(root, { recursive: true, force: true }); });
  const rows = [];
  const audits = [];
  const reports = new Map(['rdo', 'service'].map((id, index) => [id, {
    id, reportType: index ? 'RTP' : 'RDO', projectId: 'project', status: 'SIGNED',
    reportDate: '2026-10-26', sequenceNumber: 1, specialConditions: {},
    project: { id: 'project', name: 'Projeto', code: 'P1', isActive: true, managerOnly: false }
  }]));
  let user = {
    id: 'manager', username: 'manager', name: 'Gestor', role: 'MANAGER', accountType: 'ADMIN',
    isActive: true, moduleRoles: [{ role: 'RDO_MANAGER' }]
  };
  const stub = (object, name, fn) => {
    const original = object[name]; object[name] = fn;
    t.after(() => { object[name] = original; });
  };
  const match = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  stub(prisma.userSession, 'findUnique', async () => ({ id: 'session', expiresAt: new Date(Date.now() + 60000), user }));
  stub(prisma.report, 'findUnique', async ({ where }) => reports.get(where.id) || null);
  stub(prisma.report, 'findUniqueOrThrow', async ({ where }) => reports.get(where.id));
  stub(prisma.reportPdfAttachment, 'findMany', async ({ where, select, orderBy }) => rows.filter(row => match(row, where))
    .sort((a, b) => orderBy ? a.position - b.position || a.createdAt - b.createdAt || a.id.localeCompare(b.id) : 0)
    .map(row => select ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : { ...row }));
  stub(prisma.reportPdfAttachment, 'findFirst', async ({ where }) => rows.find(row => match(row, where)) || null);
  stub(prisma.reportPdfAttachment, 'aggregate', async ({ where }) => {
    const found = rows.filter(row => match(row, where));
    return { _count: { _all: found.length }, _sum: { sizeBytes: found.reduce((sum, row) => sum + row.sizeBytes, 0) }, _max: { position: found.length ? Math.max(...found.map(row => row.position)) : null } };
  });
  stub(prisma.reportPdfAttachment, 'create', async ({ data }) => {
    const row = { ...data, createdAt: new Date() }; rows.push(row); return row;
  });
  stub(prisma.reportPdfAttachment, 'delete', async ({ where }) => rows.splice(rows.findIndex(row => row.id === where.id), 1)[0]);
  stub(prisma.reportPdfAttachment, 'updateMany', async ({ where, data }) => {
    const found = rows.filter(row => match(row, where));
    for (const row of found) Object.assign(row, data);
    return { count: found.length };
  });
  stub(prisma.reportAuditLog, 'create', async ({ data }) => { audits.push(data); return data; });
  stub(prisma, '$queryRaw', async () => []);
  stub(prisma, '$transaction', async callback => callback(prisma));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(method, suffix, body, token = true) {
    return fetch(`http://127.0.0.1:${server.address().port}/api/rdo/reports/${suffix}`, {
      method, headers: { ...(token ? { Authorization: 'Bearer attachments-test' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  }
  async function upload(reportId, name, widths) {
    return request('POST', `${reportId}/pdf-attachments`, {
      fileName: name, pdfDataUrl: `data:application/pdf;base64,${(await pdf(widths)).toString('base64')}`
    });
  }
  return { root, rows, reports, audits, request, upload, stub, setUser: value => { user = value; } };
}

test('múltiplos anexos persistem por relatório; download mescla em ordem e exclusão remove as páginas e o arquivo', async t => {
  const f = await fixture(t);
  const base = await pdf([300]);
  const hash = createHash('sha256').update(base).digest('hex');
  await fs.writeFile(path.join(f.root, 'original.pdf'), base);
  for (const report of f.reports.values()) report.versions = [{ finalPdfUrl: 'original.pdf', finalDocumentHash: hash }];
  for (const [name, widths] of [['certificado.pdf', [400, 410]], ['laudo.pdf', [500]]]) {
    const result = await f.upload('rdo', name, widths);
    assert.equal(result.status, 201, await result.clone().text());
  }
  assert.equal((await f.upload('service', 'servico.pdf', [550])).status, 201);
  const list = await (await f.request('GET', 'rdo/pdf-attachments')).json();
  assert.deepEqual(list.map(item => item.fileName), ['certificado.pdf', 'laudo.pdf']);
  assert.deepEqual(list.map(item => item.pageCount), [2, 1]);
  assert.equal(list[0].storagePath, undefined);
  const original = await (await f.request('GET', `rdo/pdf-attachments/${list[0].id}/pdf`)).arrayBuffer();
  assert.equal((await PDFDocument.load(original)).getPageCount(), 2);

  const download = await getReportPdfDownload(f.reports.get('rdo'));
  assert.deepEqual((await PDFDocument.load(download.buffer)).getPages().map(page => page.getWidth()), [300, 400, 410, 500]);
  const httpDownload = await f.request('GET', 'rdo/pdf');
  assert.equal(httpDownload.status, 200);
  assert.deepEqual((await PDFDocument.load(await httpDownload.arrayBuffer())).getPages().map(page => page.getWidth()), [300, 400, 410, 500]);
  const service = await getReportPdfDownload(f.reports.get('service'));
  assert.deepEqual((await PDFDocument.load(service.buffer)).getPages().map(page => page.getWidth()), [300, 550]);
  const firstPath = reportPdfAttachmentPath(f.root, f.rows[0].storagePath);
  assert.equal((await f.request('DELETE', `rdo/pdf-attachments/${list[0].id}`)).status, 200);
  await assert.rejects(fs.stat(firstPath), { code: 'ENOENT' });
  const afterRemoval = await getReportPdfDownload(f.reports.get('rdo'));
  assert.deepEqual((await PDFDocument.load(afterRemoval.buffer)).getPages().map(page => page.getWidth()), [300, 500]);
  assert.equal((await f.request('DELETE', `rdo/pdf-attachments/${list[1].id}`)).status, 200);
  const restored = await getReportPdfDownload(f.reports.get('rdo'));
  assert.deepEqual(restored.buffer, base, 'sem anexos, entrega o original byte a byte');
  assert.deepEqual(await fs.readFile(path.join(f.root, 'original.pdf')), base, 'não altera o PDF assinado nem seu hash');
  assert.deepEqual(f.audits.map(audit => audit.action), ['PDF_ATTACHMENT_ADDED', 'PDF_ATTACHMENT_ADDED', 'PDF_ATTACHMENT_ADDED', 'PDF_ATTACHMENT_REMOVED', 'PDF_ATTACHMENT_REMOVED']);
  assert.equal(f.reports.get('rdo').updatedAt, undefined, 'anexos não invalidam liberação ao cliente ou assinatura');
});

test('revisores alcançam apenas os relatórios permitidos; sem permissão todas as operações são bloqueadas', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('GET', 'rdo/pdf-attachments', undefined, false)).status, 401);
  for (const [role, moduleRole] of [['COLLABORATOR', 'RDO_COLLABORATOR'], ['COORDINATOR', 'RDO_COORDINATOR']]) {
    f.setUser({ id: 'internal', username: 'internal', isActive: true, accountType: 'INTERNAL', role, moduleRoles: [{ role: moduleRole }] });
    for (const [method, suffix] of [['GET', ''], ['POST', ''], ['DELETE', '/other'], ['GET', '/other/pdf'], ['PATCH', '/order']]) {
      assert.equal((await f.request(method, `rdo/pdf-attachments${suffix}`, method === 'POST' ? {} : undefined)).status, 403);
    }
  }
  f.setUser({ id: 'reviewer', username: 'reviewer', isActive: true, accountType: 'INTERNAL', role: 'COORDINATOR',
    moduleRoles: [{ role: 'RDO_COORDINATOR' }], rdoExtraPermissions: ['REVIEW_REPORTS'] });
  assert.equal((await f.upload('service', 'revisao.pdf', [400])).status, 201);
  f.reports.get('rdo').project.managerOnly = true;
  assert.equal((await f.upload('rdo', 'privado.pdf', [400])).status, 403);
  assert.equal((await f.request('GET', 'rdo/pdf-attachments')).status, 403);
  const attachment = f.rows[0];
  assert.equal((await f.request('DELETE', `rdo/pdf-attachments/${attachment.id}`)).status, 403);
  f.reports.get('rdo').project.managerOnly = false;
  assert.equal((await f.request('DELETE', `rdo/pdf-attachments/${attachment.id}`)).status, 404, 'não exclui anexo de outro relatório');
  assert.equal((await f.request('GET', `rdo/pdf-attachments/${attachment.id}/pdf`)).status, 404);
  f.reports.get('rdo').deletedAt = new Date();
  assert.equal((await f.request('GET', 'rdo/pdf-attachments')).status, 404);
  f.reports.get('service').project.deletedAt = new Date();
  assert.equal((await f.upload('service', 'excluido.pdf', [400])).status, 404);
  assert.equal((await f.request('GET', 'missing/pdf-attachments')).status, 404);
});

test('valida conteúdo do PDF, limites e limpa arquivos se a transação falhar', async t => {
  const f = await fixture(t);
  const invalid = `data:application/pdf;base64,${Buffer.from('%PDF-1.7\ncorrompido').toString('base64')}`;
  const response = await f.request('POST', 'rdo/pdf-attachments', { fileName: 'ruim.pdf', pdfDataUrl: invalid });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /corrompido/);
  await assert.rejects(validateReportPdfAttachment(`data:application/pdf;base64,${(await pdf([])).toString('base64')}`), /páginas válidas/);
  assert.throws(() => reportPdfAttachmentPath(f.root, '../segredo.pdf'), /inválido/);
  f.stub(prisma.reportPdfAttachment, 'aggregate', async () => ({ _count: { _all: 20 }, _sum: { sizeBytes: 100 } }));
  assert.equal((await f.upload('rdo', 'limite.pdf', [400])).status, 400);
  f.stub(prisma.reportPdfAttachment, 'aggregate', async () => ({ _count: { _all: 1 }, _sum: { sizeBytes: 200 * 1024 * 1024 } }));
  assert.equal((await f.upload('rdo', 'limite.pdf', [400])).status, 400);
  f.stub(prisma.reportPdfAttachment, 'aggregate', async () => ({ _count: { _all: 0 }, _sum: { sizeBytes: 0 }, _max: { position: null } }));
  f.stub(prisma.reportPdfAttachment, 'create', async () => { throw new Error('Falha de persistência'); });
  assert.equal((await f.upload('rdo', 'falha.pdf', [400])).status, 500);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'report-pdf-attachments', 'rdo')), []);
});

test('anexo ausente impede download incompleto e PDFs manuais também recebem anexos', async t => {
  const f = await fixture(t);
  const base = await pdf([300]);
  await fs.mkdir(path.join(f.root, 'uploads-manuais'));
  await fs.writeFile(path.join(f.root, 'uploads-manuais', 'original.pdf'), base);
  const manual = f.reports.get('rdo');
  manual.status = 'APPROVED';
  manual.specialConditions = { source: 'MANUAL_UPLOAD', __manualUpload: { uploadedAt: new Date().toISOString() } };
  manual.versions = [{ sourcePdfUrl: '/relatorios/uploads-manuais/original.pdf', sourceDocumentHash: createHash('sha256').update(base).digest('hex') }];
  assert.equal((await f.upload('rdo', 'manual-anexo.pdf', [400])).status, 201);
  assert.equal((await PDFDocument.load((await getReportPdfDownload(manual)).buffer)).getPageCount(), 2);
  await fs.rm(reportPdfAttachmentPath(f.root, f.rows[0].storagePath));
  await assert.rejects(getReportPdfDownload(manual), error => error.statusCode === 409 && /manual-anexo.pdf/.test(error.message));
});

test('migração preserva relatórios, exige anexos válidos e remove metadados em cascata', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TYPE "ReportAuditAction" AS ENUM ('SIGNED'); CREATE TABLE "Report" ("id" TEXT PRIMARY KEY);
    INSERT INTO "Report" VALUES ('rdo'), ('service');`);
  await db.exec(await fs.readFile(new URL('../prisma/migrations/20261026120000_report_pdf_attachments/migration.sql', import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO "ReportPdfAttachment" ("id", "reportId", "fileName", "storagePath", "sizeBytes", "pageCount")
    VALUES ('one', 'rdo', 'um.pdf', 'one.pdf', 100, 1), ('two', 'service', 'dois.pdf', 'two.pdf', 200, 2);`);
  await db.exec(`INSERT INTO "ReportPdfAttachment" ("id", "reportId", "fileName", "storagePath", "sizeBytes", "pageCount", "createdAt")
    VALUES ('earlier', 'rdo', 'antigo.pdf', 'earlier.pdf', 100, 1, '2026-01-01')`);
  await db.exec(await fs.readFile(new URL('../prisma/migrations/20261026130000_report_pdf_attachment_order/migration.sql', import.meta.url), 'utf8'));
  assert.deepEqual((await db.query('SELECT "id", "position" FROM "ReportPdfAttachment" ORDER BY "reportId", "position"')).rows,
    [{ id: 'earlier', position: 0 }, { id: 'one', position: 1 }, { id: 'two', position: 0 }]);
  await assert.rejects(db.exec(`UPDATE "ReportPdfAttachment" SET "position" = -1 WHERE "id" = 'one'`));
  await assert.rejects(db.exec(`INSERT INTO "ReportPdfAttachment" ("id", "reportId", "fileName", "storagePath", "sizeBytes", "pageCount")
    VALUES ('bad', 'missing', 'x.pdf', 'bad.pdf', 1, 1)`));
  await assert.rejects(db.exec(`UPDATE "ReportPdfAttachment" SET "pageCount" = 0 WHERE "id" = 'one'`));
  assert.equal((await db.query('SELECT * FROM "Report"')).rows.length, 2);
  await db.exec(`DELETE FROM "Report" WHERE "id" = 'rdo'`);
  assert.deepEqual((await db.query('SELECT "id" FROM "ReportPdfAttachment"')).rows, [{ id: 'two' }]);
});

test('reordenação persiste e determina as páginas do PDF; novos anexos entram após os existentes', async t => {
  const f = await fixture(t);
  const base = await pdf([300]);
  await fs.writeFile(path.join(f.root, 'original.pdf'), base);
  const report = f.reports.get('rdo');
  report.versions = [{ finalPdfUrl: 'original.pdf', finalDocumentHash: createHash('sha256').update(base).digest('hex') }];
  const attachments = [];
  for (const [name, width] of [['primeiro.pdf', 400], ['segundo.pdf', 500], ['terceiro.pdf', 600]]) {
    const response = await f.upload('rdo', name, [width]);
    assert.equal(response.status, 201);
    attachments.push(await response.json());
  }
  assert.deepEqual(attachments.map(item => item.position), [0, 1, 2]);
  const ids = [attachments[2].id, attachments[0].id, attachments[1].id];
  const reordered = await f.request('PATCH', 'rdo/pdf-attachments/order', { ids });
  assert.equal(reordered.status, 200);
  assert.deepEqual((await reordered.json()).map(item => item.fileName), ['terceiro.pdf', 'primeiro.pdf', 'segundo.pdf']);
  const reopened = await (await f.request('GET', 'rdo/pdf-attachments')).json();
  assert.deepEqual(reopened.map(item => item.id), ids);
  assert.deepEqual((await PDFDocument.load((await getReportPdfDownload(report)).buffer)).getPages().map(page => page.getWidth()), [300, 600, 400, 500]);
  await f.request('DELETE', `rdo/pdf-attachments/${attachments[0].id}`);
  assert.equal((await f.upload('rdo', 'novo.pdf', [700])).status, 201);
  assert.deepEqual((await PDFDocument.load((await getReportPdfDownload(report)).buffer)).getPages().map(page => page.getWidth()), [300, 600, 500, 700]);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'original.pdf')), base);
  assert.ok(f.audits.some(item => item.action === 'PDF_ATTACHMENT_REORDERED'));
});

test('reordenação rejeita duplicados, anexos de outros relatórios e listas desatualizadas sem alterar posições', async t => {
  const f = await fixture(t);
  for (const name of ['a.pdf', 'b.pdf']) assert.equal((await f.upload('rdo', name, [400])).status, 201);
  assert.equal((await f.upload('service', 'outro.pdf', [500])).status, 201);
  const [a, b, other] = f.rows;
  for (const [ids, status] of [[[a.id, a.id], 400], [[a.id, other.id], 409], [[a.id], 409], [[a.id, b.id, 'desconhecido'], 409]]) {
    assert.equal((await f.request('PATCH', 'rdo/pdf-attachments/order', { ids })).status, status);
    assert.deepEqual(f.rows.map(item => item.position), [0, 1, 0]);
  }
  f.reports.get('rdo').deletedAt = new Date();
  assert.equal((await f.request('PATCH', 'rdo/pdf-attachments/order', { ids: [b.id, a.id] })).status, 404);
  assert.equal(f.audits.some(item => item.action === 'PDF_ATTACHMENT_REORDERED'), false);
});
