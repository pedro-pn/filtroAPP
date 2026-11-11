import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink, open, utimes } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { selectReportPdfSource } from '../src/lib/reports/pdf-download-source.js';
import { pdfCacheMetadataForReport } from '../src/lib/reports/pdf-cache.js';
import { readIntegrationReportPdf } from '../src/lib/reports/integration-pdf.js';
import { openOperationalDownload } from '../src/lib/api-credentials/operational-downloads.js';
import { MAX_OPERATIONAL_FILE_BYTES } from '../src/lib/api-credentials/managed-files.js';
import { buildReportFileName } from '../src/lib/report-filename.js';
import { listOperationalResources } from '../src/lib/api-credentials/operational-service.js';
import { API_SCOPES, API_OPERATIONS } from '../src/lib/api-credentials/catalog.js';
import { OPERATIONAL_RESOURCES } from '../src/lib/api-credentials/operational-resources.js';
import { IntegrationApiError, integrationApiErrorHandler } from '../src/middleware/api-request-context.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { executePlaygroundOperation } from '../src/lib/api-credentials/playground.js';
import { Writable } from 'node:stream';
import { Prisma } from '@prisma/client';

const pdfScope = 'rdo.relatorios.pdf.download';
const contactScope = 'colaboradores.contato_corporativo.read';
const operationId = 'operational.Report.download';
const context = (scopes = ['rdo.relatorios.read', pdfScope], extra = {}) => ({ scopes: new Set(scopes),
  projectAccessMode: 'SELECTED', projectIds: new Set(['p1']), cursorKey: 'synthetic-omni-document-key-at-least-32-chars',
  snapshotAt: new Date('2026-11-11T23:00:00Z'), ...extra });

// Mesmo formato Prisma usado pelo serviço, com pais e políticas exercitados na consulta.
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(item => matches(row, item));
    if (key === 'OR') return value.some(item => matches(row, item));
    const actual = row?.[key];
    if (value?.equals === Prisma.DbNull) return actual === null;
    if (value?.path) return value.path.reduce((current, field) => current?.[field], actual) === value.equals;
    if (value === null || typeof value !== 'object' || value instanceof Date) return actual === value;
    if ('in' in value) return value.in.includes(actual);
    if ('lte' in value || 'gte' in value || 'gt' in value) return Object.entries(value).every(([op, target]) => ({ lte: actual <= target, gte: actual >= target, gt: actual > target })[op]);
    return actual != null && matches(actual, value);
  });
}
function database(rows = []) {
  const calls = [], logs = [], events = [], updates = [];
  const credential = { id: 'synthetic-credential', projectAccessMode: 'SELECTED', maxPageSize: 100,
    requestsPerMinute: 60, requestsPerDay: 1000, rowsPerDay: 10000, secretLastFour: 'demo',
    scopes: [...context().scopes].map(scopeCode => ({ scopeCode })), projects: [{ projectId: 'p1' }] };
  const db = { report: {
    async findFirst(args) { calls.push(args); return rows.find(row => matches(row, args.where)) || null; },
    async findMany(args) { calls.push(args); return rows.filter(row => matches(row, args.where)).slice(0, args.take); }
  }, apiCredential: { findUnique: async () => credential, updateMany: async () => ({ count: 1 }) },
  apiUsageBucket: { upsert: async ({ create }) => ({ id: create.windowKind }),
    updateMany: async args => { updates.push(args); return { count: 1 }; }, update: async args => { updates.push(args); return args; } },
  apiCredentialEvent: { create: async ({ data }) => events.push(data) }, apiRequestLog: { create: async ({ data }) => logs.push(data) } };
  db.$transaction = async action => typeof action === 'function' ? action(db) : Promise.all(action);
  return { db, calls, logs, events, updates };
}

const hash = value => createHash('sha256').update(value).digest('hex');
const pdf = Buffer.from('%PDF-1.7\n' + ' '.repeat(1100) + '\n%%EOF');
const stamp = new Date('2026-11-09T12:00:00Z');
const report = extra => ({ id: 'r1', projectId: 'p1', reportType: 'RDO', status: 'APPROVED',
  reportDate: stamp, createdAt: stamp, updatedAt: stamp, sequenceNumber: 147,
  deletedAt: null, project: { id: 'p1', code: '5719', name: 'Jupiá', deletedAt: null, managerOnly: false, distributionSettings: null }, versions: [], ...extra });
const prefix = 'Missão 5719 - Jupiá/';
const version = (extra = {}) => ({ id: 'v1', reportId: 'r1', status: 'ACTIVE', versionNumber: 1,
  createdAt: stamp, sourcePdfUrl: prefix + 'RDO/base.pdf', sourceDocumentHash: hash(pdf), ...extra });

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-report-pdf-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const roots = { uploadDir: root, reportsDir: path.join(root, 'reports') };
  async function save(relative, bytes = pdf, base = root) {
    await mkdir(path.dirname(path.join(base, relative)), { recursive: true });
    await writeFile(path.join(base, relative), bytes);
  }
  return { root, roots, save };
}

test('shared PDF policy preserves final, ZapSign, manual, approved base and cache priority', () => {
  const manual = version({ sourcePdfUrl: prefix + 'uploads-manuais/old.pdf' });
  const r = report({ status: 'SIGNED', zapsignDocToken: 'private', specialConditions: { __manualUpload: { uploadedAt: stamp } },
    versions: [version({ finalPdfUrl: prefix + 'final.pdf', finalDocumentHash: hash(pdf) }), manual] });
  assert.equal(selectReportPdfSource(r).kind, 'FINAL_ASSINADO');
  r.versions.shift(); assert.equal(selectReportPdfSource(r).kind, 'ZAPSIGN');
  delete r.zapsignDocToken; assert.equal(selectReportPdfSource(r).kind, 'MANUAL');
  r.specialConditions = {}; r.status = 'APPROVED'; assert.equal(selectReportPdfSource(r).kind, 'BASE_APROVADO');
  r.status = 'RETURNED'; assert.equal(selectReportPdfSource(r).kind, 'CACHE');
});

for (const reportType of ['RDO', 'RTP', 'RLQ', 'RCPU', 'RLM', 'RLF', 'RLI']) {
  test(`${reportType}: ready final is verified without DB mutations, generation or network`, async t => {
    const { roots, save } = await fixture(t);
    const v = version({ finalPdfUrl: prefix + reportType + '/final.pdf', finalDocumentHash: hash(pdf) });
    await save(v.finalPdfUrl);
    const result = await readIntegrationReportPdf({}, report({ reportType, status: 'SIGNED', versions: [v] }), roots);
    assert.deepEqual(result.buffer, pdf);
    assert.equal(result.kind, 'FINAL_ASSINADO');
  });
}

test('missing priority source never falls back; bad hash is not repaired', async t => {
  const { roots, save } = await fixture(t);
  const v = version({ finalPdfUrl: prefix + 'final.pdf', finalDocumentHash: hash(pdf) });
  await save(v.sourcePdfUrl);
  await assert.rejects(() => readIntegrationReportPdf({}, report({ status: 'SIGNED', versions: [v] }), roots), e => e.statusCode === 404);
  await save(v.finalPdfUrl, Buffer.from('%PDF-1.7\nchanged\n%%EOF'));
  await assert.rejects(() => readIntegrationReportPdf({}, report({ status: 'SIGNED', versions: [v] }), roots), e => e.code === 'PDF_NOT_READY' && e.retryAfterSeconds === 30);
});

test('missing cache and uncached ZapSign return PDF_NOT_READY without external work', async t => {
  const { roots } = await fixture(t);
  for (const r of [report(), report({ status: 'SIGNED', zapsignDocUrl: 'https://invalid.example/signed.pdf' })]) {
    await assert.rejects(() => readIntegrationReportPdf({}, r, roots), e => e.code === 'PDF_NOT_READY' && e.statusCode === 409);
  }
});

test('manual historical source and approved base use stored hash', async t => {
  const { roots, save } = await fixture(t);
  const manual = version({ sourcePdfUrl: prefix + 'RDO/uploads-manuais/original.pdf' });
  await save(manual.sourcePdfUrl);
  const client = { reportVersion: { findFirst: async args => { assert.equal(args.where.reportId, 'r1'); return manual; } } };
  const r = report({ specialConditions: { __manualUpload: { uploadedAt: stamp } } });
  assert.equal((await readIntegrationReportPdf(client, r, roots)).kind, 'MANUAL');
  const base = version(); await save(base.sourcePdfUrl);
  assert.equal((await readIntegrationReportPdf({}, report({ versions: [base] }), roots)).kind, 'BASE_APROVADO');
});

test('managed PDF reads deny paths from other projects, traversal, symlinks and oversized bytes', async t => {
  const { root, roots, save } = await fixture(t);
  await save(prefix + 'RDO/base.pdf');
  await symlink(path.join(root, prefix + 'RDO/base.pdf'), path.join(root, prefix + 'RDO/link.pdf'));
  for (const url of ['other/private.pdf', '../private.pdf', '/tmp/private.pdf', 'https://host/private.pdf', prefix + 'RDO/link.pdf']) {
    await assert.rejects(() => readIntegrationReportPdf({}, report({ versions: [version({ sourcePdfUrl: url })] }), roots), e => e.statusCode === 404);
  }
  const target = prefix + 'RDO/large.pdf';
  const file = await open(path.join(root, target), 'w');
  await file.truncate(MAX_OPERATIONAL_FILE_BYTES + 1); await file.close();
  await assert.rejects(() => readIntegrationReportPdf({}, report({ versions: [version({ sourcePdfUrl: target })] }), roots), e => e.statusCode === 413);
});

test('fresh cache shares screen fingerprint, progress dependencies and link validation', async t => {
  const { root, roots, save } = await fixture(t);
  const r = report();
  const relative = prefix + 'RDO/' + buildReportFileName(r, 'pdf');
  const metadata = { ...pdfCacheMetadataForReport(r), plannedServiceCount: 2 };
  const client = { report: { findFirst: async () => ({ updatedAt: stamp }) }, projectPlannedService: {
    findFirst: async () => ({ updatedAt: stamp }), count: async () => 2 } };
  await save(relative); await save(relative + '.meta.json', JSON.stringify(metadata));
  assert.equal((await readIntegrationReportPdf(client, r, roots)).kind, 'CACHE');
  client.projectPlannedService.count = async () => 3;
  await assert.rejects(() => readIntegrationReportPdf(client, r, roots), e => e.code === 'PDF_NOT_READY');
  client.projectPlannedService.count = async () => 2;
  await save(relative + '.meta.json', JSON.stringify({ ...metadata, fingerprint: 'stale' }));
  await assert.rejects(() => readIntegrationReportPdf(client, r, roots), e => e.code === 'PDF_NOT_READY');
  await save(relative + '.meta.json', JSON.stringify(metadata));
  await utimes(path.join(root, relative), new Date(0), new Date(0));
  await assert.rejects(() => readIntegrationReportPdf(client, r, roots), e => e.code === 'PDF_NOT_READY');
  r.specialConditions = { resolvedCounter: { certificate: { publicUrl: 'https://example.test/cert' } } };
  await save(relative); await save(relative + '.meta.json', JSON.stringify({ ...pdfCacheMetadataForReport(r), plannedServiceCount: 2 }));
  await assert.rejects(() => readIntegrationReportPdf(client, r, roots), e => e.code === 'PDF_NOT_READY');
});

test('ZapSign cached PDF is served without network and pending maintenance has no report PDF', async t => {
  const { roots, save } = await fixture(t);
  await save('_zapsign-assinados/r1.pdf', pdf, roots.reportsDir);
  assert.equal((await readIntegrationReportPdf({}, report({ status: 'SIGNED', zapsignDocToken: 'private' }), roots)).kind, 'ZAPSIGN');
  await assert.rejects(() => readIntegrationReportPdf({}, report({ reportType: 'RDO_MAINTENANCE' }), roots), e => e.statusCode === 404);
});

test('scopes are explicit, PERSONAL, depend on base reads and remain independent of PII', () => {
  for (const [scope, dependency] of [[pdfScope, 'rdo.relatorios.read'], [contactScope, 'colaboradores.operacional.read']]) {
    const item = API_SCOPES.find(item => item.code === scope);
    assert.equal(item.sensitivity, 'PERSONAL'); assert.deepEqual(item.dependencies, [dependency]);
    assert.ok(API_OPERATIONS.some(item => [...item.requiredScopes, ...item.optionalScopes].includes(scope)));
  }
});

test('download validates params/scopes and preserves report visibility, deleted projects and selected project errors', async t => {
  const { roots, save } = await fixture(t);
  await save(version().sourcePdfUrl);
  const download = (db, ctx = context(), params = { id: 'r1' }, query = {}) => openOperationalDownload(db, operationId, params, query, ctx, roots);
  for (const scopes of [[], [pdfScope], ['rdo.relatorios.read']]) {
    await assert.rejects(() => download({}, context(scopes)), e => e.code === 'INSUFFICIENT_SCOPE');
  }
  for (const params of [{ id: '' }, { id: 'x'.repeat(101) }, { id: 'r1', extra: true }]) await assert.rejects(() => download({}, context(), params), e => e.name === 'ZodError');
  await assert.rejects(() => download({}, context(), { id: 'r1' }, { url: 'x' }), e => e.name === 'ZodError');
  for (const status of ['DRAFT', 'PENDING', 'RETURNED', 'SIGNED']) {
    const { db } = database([report({ status })]);
    await assert.rejects(() => download(db), e => e.statusCode === 404);
    if (['PENDING', 'RETURNED'].includes(status)) await assert.rejects(() => download(db, context(['rdo.relatorios.read', pdfScope, 'rdo.relatorios.todos.read'])), e => e.code === 'PDF_NOT_READY');
  }
  const foreign = database([report({ projectId: 'p2', versions: [version()] })]).db;
  await assert.rejects(() => download(foreign), e => e.code === 'PROJECT_NOT_ALLOWED' && e.statusCode === 403);
  for (const extra of [{ deletedAt: stamp }, { project: { deletedAt: stamp } }, { project: { deletedAt: null, managerOnly: true, distributionSettings: null } }]) {
    await assert.rejects(() => download(database([report(extra)]).db), e => e.statusCode === 404);
  }
  const result = await download(database([report({ versions: [version()] })]).db);
  assert.deepEqual(result.buffer, pdf); assert.equal(result.bytes, pdf.length); assert.match(result.disposition, /filename\*=UTF-8/);
});

test('PDF metadata is additive and cheap, with all-state scope independent of document scope', async () => {
  const r = report({ versions: [version()] });
  for (const [scopes, expectsPdf, expectsStates] of [
    [['rdo.relatorios.read'], false, false],
    [['rdo.relatorios.read', pdfScope], true, false],
    [['rdo.relatorios.todos.read'], false, true],
    [['rdo.relatorios.todos.read', pdfScope], true, true]
  ]) {
    const { db, calls } = database([r]);
    const result = await listOperationalResources(db, 'operational.Report.list', {}, context(scopes));
    assert.equal('pdf' in result.items[0], expectsPdf); assert.equal('submittedAt' in result.items[0], expectsStates);
    assert.equal(calls.length, 1); assert.equal(Boolean(calls[0].select.versions), expectsPdf);
    if (expectsPdf) assert.deepEqual(result.items[0].pdf, { disponivel: true, versao: 'BASE_APROVADO', nomeArquivo: 'base.pdf', atualizadoEm: stamp.toISOString() });
    assert.doesNotMatch(JSON.stringify(result), /sourcePdfUrl|sourceDocumentHash|zapsignDocToken|specialConditions/);
  }
  const result = await listOperationalResources(database([report()]).db, 'operational.Report.list', {}, context());
  assert.deepEqual(result.items[0].pdf, { disponivel: false });
});

test('maintenance document IDs obey existing maintenance permissions and visibility', async () => {
  const r = report({ reportType: 'RDO_MAINTENANCE' });
  const scopes = ['rdo.relatorios.read', pdfScope, 'manutencao.registros.read', 'manutencao.anexos.metadata.read'];
  const rows = [
    { id: 'document', kind: 'DOCUMENT', maintenance: { reportId: 'r1', status: 'APPROVED', report: r } },
    { id: 'photo', kind: 'PHOTO', maintenance: { reportId: 'r1', status: 'APPROVED', report: r } },
    { id: 'pending', kind: 'DOCUMENT', maintenance: { reportId: 'r1', status: 'PENDING', report: r } },
    { id: 'foreign', kind: 'DOCUMENT', maintenance: { reportId: 'r2', status: 'APPROVED', report: report({ id: 'r2', projectId: 'p2' }) } }
  ];
  const { db } = database([r]);
  db.maintenanceAttachment = { findMany: async ({ where }) => rows.filter(row => matches(row, where)) };
  const result = await listOperationalResources(db, 'operational.Report.list', {}, context(scopes));
  assert.deepEqual(result.items[0].pdf, { disponivel: false, maintenanceAttachmentIds: ['document'] });
  delete db.maintenanceAttachment;
  const restricted = await listOperationalResources(db, 'operational.Report.list', {}, context());
  assert.deepEqual(restricted.items[0].pdf.maintenanceAttachmentIds, []);
});

test('corporate contact is optional, selects only linked account and rejects personal or deceptive domains', async () => {
  const resource = OPERATIONAL_RESOURCES.find(item => item.model === 'Collaborator');
  const base = { id: 'c1', code: '1', name: 'Pessoa', jobRoleId: 'role', isActive: true, createdAt: stamp, updatedAt: stamp, email: 'PERSONAL', cpf: 'PRIVATE' };
  for (const email of [' PESSOA@FILTROVALI.COM.BR ', 'pessoa@example.test', 'pessoa@filtrovali.com.br.evil.test', 'invalid@@filtrovali.com.br', null]) {
    const calls = [];
    const db = { collaborator: { findMany: async args => { calls.push(args); return [{ ...base, user: { id: 'u1', email, passwordHash: 'PRIVATE' } }, { ...base, id: 'c2', user: null }]; } } };
    for (const allowed of [false, true]) {
      const result = await listOperationalResources(db, resource.operationId, {}, context(['colaboradores.operacional.read', ...(allowed ? [contactScope] : [])], { projectAccessMode: 'ALL' }));
      assert.equal('emailCorporativo' in result.items[0], allowed);
      assert.equal(Boolean(calls.at(-1).select.user), allowed);
      if (allowed) {
        assert.deepEqual(calls.at(-1).select.user.select, { id: true, email: true });
        assert.equal(result.items[0].emailCorporativo, email?.trim().toLowerCase() === 'pessoa@filtrovali.com.br' ? 'pessoa@filtrovali.com.br' : null);
        assert.equal(result.items[0].userId, 'u1'); assert.equal(result.items[1].userId, null);
      }
      assert.doesNotMatch(JSON.stringify(result), /PERSONAL|PRIVATE|passwordHash|"email":|"cpf":/);
    }
  }
});

test('download route sends bounded buffer, records bytes and exposes retry header on 409', async t => {
  const { roots, save } = await fixture(t);
  await save(version().sourcePdfUrl);
  const { db, logs, updates } = database([report({ versions: [version()] })]);
  const route = createOperationalRouter({ prismaClient: db, envConfig: roots }).stack.find(layer => layer.route?.path === '/rdo/relatorios/:id/pdf').route;
  const req = { params: { id: 'r1' }, query: {}, headers: {}, requestId: 'synthetic-request', apiAuth: {
    credential: await db.apiCredential.findUnique(), scopeCodes: context().scopes, projectIds: context().projectIds } };
  const chunks = [], headers = {};
  const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
  res.setHeader = (key, value) => { headers[key] = value; };
  await new Promise((resolve, reject) => { res.on('finish', resolve); res.on('error', reject);
    route.stack[0].handle(req, res, () => route.stack[1].handle(req, res, reject)); });
  assert.deepEqual(Buffer.concat(chunks), pdf);
  assert.equal(headers['Content-Length'], String(pdf.length)); assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff'); assert.equal(headers['Content-Type'], 'application/pdf');
  assert.ok(logs.some(log => log.operationId === operationId && log.responseBytes === pdf.length));
  assert.ok(updates.some(update => update.data.bytes?.increment === pdf.length));
  const errorHeaders = {};
  const errorRes = { setHeader: (key, value) => { errorHeaders[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  integrationApiErrorHandler(new IntegrationApiError(409, 'PDF_NOT_READY', 'PDF indisponível.', { retryAfterSeconds: 30 }), req, errorRes, () => {});
  assert.equal(errorRes.statusCode, 409); assert.equal(errorHeaders['Retry-After'], '30'); assert.equal(errorRes.body.code, 'PDF_NOT_READY');
  const checked = await executePlaygroundOperation(db, 'synthetic-credential', { operationId, pathParams: { id: 'r1' }, query: {} }, { cursorKey: context().cursorKey, fileRoots: roots });
  assert.equal(checked.response.body.kind, 'DOWNLOAD_CHECK'); assert.equal(checked.response.body.file.sizeBytes, pdf.length);
  assert.doesNotMatch(JSON.stringify(checked.response.body), /%PDF|sourcePdfUrl|storagePath|specialConditions/);
});

test('real Prisma projections support PDF, maintenance and corporate contact without broadening legacy tokens', { timeout: 120_000 }, async t => {
  const { apiSimulationDatabase } = await import('./helpers/api-simulation-db.js');
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const client = database.client;
  // Registros criados pelo banco usam o relógio atual, não o snapshot dos fixtures unitários.
  const currentContext = scopes => context(scopes, { snapshotAt: new Date() });
  const { roots, save } = await fixture(t);
  await client.project.create({ data: { id: 'p1', code: '5719', name: 'Jupiá', clientName: 'Cliente fictício', clientCnpj: '', contractCode: '', location: '' } });
  await client.jobRole.create({ data: { id: 'role1', name: 'Operador', normalizedKey: 'operador' } });
  await client.collaborator.create({ data: { id: 'c1', code: '1', name: 'Pessoa fictícia', jobRoleId: 'role1', email: 'personal@example.test', cpf: 'PRIVATE' } });
  await client.user.create({ data: { id: 'u1', username: 'omni-pdf-test', name: 'Conta fictícia', passwordHash: 'synthetic', role: 'COLLABORATOR', collaboratorId: 'c1', email: 'pessoa@filtrovali.com.br' } });
  await client.report.create({ data: { id: 'r1', projectId: 'p1', reportType: 'RDO', status: 'APPROVED',
    reportDate: stamp, arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 0 } });
  await client.reportCollaborator.create({ data: { reportId: 'r1', collaboratorId: 'c1' } });
  const v = version(); await client.reportVersion.create({ data: { id: v.id, reportId: 'r1', versionNumber: 1, sourcePdfUrl: v.sourcePdfUrl, sourceDocumentHash: v.sourceDocumentHash } });
  await save(v.sourcePdfUrl);
  const downloaded = await openOperationalDownload(client, operationId, { id: 'r1' }, {}, currentContext(), roots);
  assert.deepEqual(downloaded.buffer, pdf);
  const reports = await listOperationalResources(client, 'operational.Report.list', {}, currentContext());
  assert.equal(reports.items[0].pdf.versao, 'BASE_APROVADO');
  const oldReports = await listOperationalResources(client, 'operational.Report.list', {}, currentContext(['rdo.relatorios.read']));
  assert.equal('pdf' in oldReports.items[0], false);
  const people = await listOperationalResources(client, 'operational.Collaborator.list', {}, currentContext(['colaboradores.operacional.read', contactScope]));
  assert.equal(people.items[0].emailCorporativo, 'pessoa@filtrovali.com.br'); assert.equal(people.items[0].userId, 'u1');
  assert.doesNotMatch(JSON.stringify(people), /personal@example|PRIVATE|passwordHash|cpf/);

  await client.report.create({ data: { id: 'rm1', projectId: 'p1', reportType: 'RDO_MAINTENANCE', status: 'APPROVED',
    reportDate: stamp, arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 0 } });
  await client.equipmentCategory.create({ data: { id: 'category1', name: 'Categoria', systemKey: 'synthetic' } });
  await client.companyEquipment.create({ data: { id: 'equipment1', code: 'EQ1', name: 'Equipamento', categoryId: 'category1' } });
  await client.maintenanceRecord.create({ data: { id: 'maintenance1', reportId: 'rm1', equipmentId: 'equipment1', maintenanceDate: stamp,
    status: 'APPROVED', responsibleNameSnapshot: 'Responsável', profileNameSnapshot: 'Perfil', selectedServices: [] } });
  await client.maintenanceAttachment.create({ data: { id: 'document1', maintenanceId: 'maintenance1', kind: 'DOCUMENT',
    fileName: 'maintenance.pdf', mimeType: 'application/pdf', storagePath: 'Equipamentos/Manutenções/EQ1/maintenance.pdf', publicToken: 'synthetic-maintenance-token' } });
  const scopes = ['rdo.relatorios.read', pdfScope, 'manutencao.registros.read', 'manutencao.anexos.metadata.read'];
  const allReports = await listOperationalResources(client, 'operational.Report.list', {}, currentContext(scopes));
  assert.deepEqual(allReports.items.find(item => item.id === 'rm1').pdf.maintenanceAttachmentIds, ['document1']);
  // A política básica APPROVED permanece; todos.read é obrigatório para SIGNED.
  await client.report.update({ where: { id: 'r1' }, data: { status: 'SIGNED' } });
  await assert.rejects(() => openOperationalDownload(client, operationId, { id: 'r1' }, {}, currentContext(), roots), e => e.statusCode === 404);
  const allStates = currentContext(['rdo.relatorios.read', pdfScope, 'rdo.relatorios.todos.read']);
  const signed = await openOperationalDownload(client, operationId, { id: 'r1' }, {}, allStates, roots).catch(error => error);
  assert.equal(signed.code, 'PDF_NOT_READY');
});
