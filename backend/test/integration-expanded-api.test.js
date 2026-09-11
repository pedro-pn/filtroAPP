import assert from 'node:assert/strict';
import test from 'node:test';
import { API_SCOPES, API_OPERATIONS, futureScopeDefinitions } from '../src/lib/api-credentials/catalog.js';
import { listOperationalResources } from '../src/lib/api-credentials/operational-service.js';
import { EXTENDED_OPERATIONAL_RESOURCES, OPERATIONAL_DOWNLOADS } from '../src/lib/api-credentials/extended-operational-resources.js';
import { openOperationalDownload, MAX_OPERATIONAL_FILE_BYTES } from '../src/lib/api-credentials/operational-downloads.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { executePlaygroundOperation } from '../src/lib/api-credentials/playground.js';
import { runMeteredApiOperation } from '../src/middleware/api-token-auth.js';
import { getApiOperation } from '../src/lib/api-credentials/catalog.js';
import { mkdtemp, mkdir, writeFile, symlink, rm, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Writable } from 'node:stream';

const stamp = new Date('2026-09-07T00:00:00Z');
const report = projectId => ({ id: `r-${projectId}`, projectId, status: 'APPROVED', createdAt: stamp, deletedAt: null, project: { id: projectId, code: projectId, name: 'Teste', deletedAt: null } });
const maintenance = projectId => ({ id: `m-${projectId}`, reportId: `r-${projectId}`, status: 'APPROVED', report: report(projectId) });
const descriptor = model => EXTENDED_OPERATIONAL_RESOURCES.find(r => r.model === model);
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(w => matches(row, w));
    if (key === 'OR') return value.some(w => matches(row, w));
    const actual = row?.[key];
    if (value === null || typeof value !== 'object' || value instanceof Date) return actual instanceof Date ? actual.getTime() === new Date(value).getTime() : actual === value;
    if ('not' in value) return actual !== value.not;
    if ('some' in value) return (actual || []).some(r => matches(r, value.some));
    if ('in' in value) return value.in.includes(actual);
    if (['gt', 'gte', 'lte'].some(op => op in value)) return Object.entries(value).every(([op, target]) => ({ gt: actual > target, gte: actual >= target, lte: actual <= target })[op]);
    return actual != null && matches(actual, value);
  });
}
function sample(resource, projectId = 'p1', extra = {}) {
  return { ...Object.fromEntries(Object.entries(resource.fields).map(([field, type]) => [field, type.endsWith('?') ? null : type === 'datetime' ? stamp : type === 'boolean' ? true : type === 'integer' ? 1 : type === 'decimal' ? '12.345' : `value-${field}`])),
    id: projectId, projectId, project: report(projectId).project, reportId: `r-${projectId}`, report: report(projectId), reportServiceId: null, reportService: null,
    maintenanceId: `m-${projectId}`, maintenance: maintenance(projectId), versionId: `v-${projectId}`, version: { status: 'ACTIVE', report: report(projectId) }, movements: [{ projectId, project: { deletedAt: null } }],
    storagePath: 'NEVER_EXPOSE', tokenEncrypted: 'NEVER_EXPOSE', signerEmail: 'NEVER_EXPOSE', actorNameSnapshot: 'NEVER_EXPOSE', notes: 'NEVER_EXPOSE', supplier: 'NEVER_EXPOSE', nfNumber: 'NEVER_EXPOSE', extraData: { key: 'NEVER_EXPOSE' }, ...extra };
}
function database(resource, rows) {
  const calls = [];
  return { calls, [resource.delegate]: {
    async findMany(args) {
      calls.push(args);
      return rows.filter(row => matches(row, args.where)).sort((a, b) => {
        for (const field of args.orderBy.flatMap(order => Object.keys(order))) {
          if (a[field] < b[field]) return -1;
          if (a[field] > b[field]) return 1;
        }
        return 0;
      }).slice(0, args.take);
    },
    async findFirst(args) { calls.push(args); return rows.find(row => matches(row, args.where)) || null; }
  } };
}

const added = ['rdo.versoes.read', 'rdo.equipe.read', 'rdo.servicos.read', 'rdo.anexos.metadata.read', 'rdo.anexos.download', 'rdo.assinaturas.read', 'rdo.auditoria.read', 'estoque.lotes.read', 'estoque.movimentos.read', 'estoque.documentos.metadata.read', 'estoque.documentos.download', 'estoque.custos.read', 'manutencao.terceiros.read', 'manutencao.anexos.metadata.read', 'manutencao.anexos.download', 'manutencao.auditoria.read'];
const context = (extra = {}) => ({ scopes: new Set(API_SCOPES.map(s => s.code)), projectAccessMode: 'SELECTED', projectIds: new Set(['p1']), maxPageSize: 100, cursorKey: 'synthetic-expanded-key-at-least-32-characters', snapshotAt: new Date('2026-09-08T12:00:00Z'), ...extra });

test('16 requested scopes are grantable with dependencies and real operations', () => {
  for (const code of added) {
    const scope = API_SCOPES.find(s => s.code === code);
    assert.equal(scope?.status, 'AVAILABLE', code);
    assert.ok(scope.dependencies.length, code);
    assert.ok(API_OPERATIONS.some(op => op.requiredScopes.includes(code)), code);
    assert.ok(!futureScopeDefinitions().some(s => s.code === code), code);
  }
  assert.equal(API_SCOPES.length, 33);
  assert.equal(API_OPERATIONS.length, 35);
});

test('team pagination uses real composite key without fictitious timestamps', async () => {
  const calls = [];
  const rows = ['a', 'b', 'c'].map(collaboratorId => ({ reportId: 'r1', collaboratorId, jobRoleIdSnapshot: null, roleNameSnapshot: null }));
  const db = { reportCollaborator: { async findMany(args) { calls.push(args); return calls.length === 1 ? rows : rows.slice(2); } } };
  const first = await listOperationalResources(db, 'operational.ReportCollaborator.list', { limit: 2 }, context());
  assert.deepEqual(first.items.map(r => r.collaboratorId), ['a', 'b']);
  assert.deepEqual(calls[0].orderBy, [{ reportId: 'asc' }, { collaboratorId: 'asc' }]);
  assert.equal(calls[0].select.updatedAt, undefined);
  const next = await listOperationalResources(db, 'operational.ReportCollaborator.list', { cursor: first.page.nextCursor, limit: 2 }, context());
  assert.deepEqual(next.items.map(r => r.collaboratorId), ['c']);
  assert.match(JSON.stringify(calls[1].where), /collaboratorId.*gt.*b/);
  await assert.rejects(() => listOperationalResources({}, 'operational.ReportCollaborator.list', { updatedSince: '2026-09-01T00:00:00Z' }, context()), e => e.code === 'UNKNOWN_PARAMETER');
});

test('created-only collections reject update filters and costs require base movement scope', async () => {
  await assert.rejects(() => listOperationalResources({}, 'operational.StockMovement.list', { updatedSince: '2026-09-01T00:00:00Z' }, context()), e => e.code === 'UNKNOWN_PARAMETER');
  await assert.rejects(() => listOperationalResources({}, 'operational.StockMovementCosts.list', {}, context({ scopes: new Set(['estoque.itens.read', 'estoque.custos.read']) })), e => e.code === 'INSUFFICIENT_SCOPE');
});

for (const resource of EXTENDED_OPERATIONAL_RESOURCES) {
  test(`${resource.operationId}: projection, project policy and every dependency enforced before access`, async () => {
    const rows = ['p1', 'p2'].map(projectId => sample(resource, projectId));
    const db = database(resource, rows);
    const result = await listOperationalResources(db, resource.operationId, {}, context());
    assert.equal(result.items.length, resource.projectPolicy === 'GLOBAL' ? 2 : 1);
    for (const row of result.items) assert.deepEqual(Object.keys(row).sort(), Object.keys(resource.fields).sort());
    assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPOSE/);
    assert.deepEqual(db.calls[0].select, resource.select);
    for (const omitted of resource.requiredScopes) {
      await assert.rejects(() => listOperationalResources({}, resource.operationId, {}, context({ scopes: new Set(resource.requiredScopes.filter(scope => scope !== omitted)) })), e => e.code === 'INSUFFICIENT_SCOPE');
    }
    for (const query of [{ includeDeleted: true }, { fields: '*' }, { limit: 101 }, { itemId: ['one', 'two'] }, { snapshotAt: '2030-01-01T00:00:00Z' }]) {
      await assert.rejects(() => listOperationalResources({}, resource.operationId, query, context()));
    }
    if (resource.projectPolicy !== 'GLOBAL') await assert.rejects(() => listOperationalResources({}, resource.operationId, { projectId: 'p2' }, context()), e => e.code === 'PROJECT_NOT_ALLOWED');
    const parentField = resource.filterFields[0];
    if (parentField) assert.equal((await listOperationalResources(db, resource.operationId, { [parentField]: 'missing' }, context())).items.length, 0);
  });
}

test('created cursor is stable across ties and binds parent filter, date, operation and project restrictions', async () => {
  const resource = descriptor('StockMovement');
  const db = database(resource, ['c', 'a', 'b'].map(id => sample(resource, 'p1', { id, itemId: 'i1' })));
  const query = { limit: 2, itemId: 'i1', createdSince: '2026-09-01T00:00:00Z' };
  const first = await listOperationalResources(db, resource.operationId, query, context());
  assert.deepEqual(first.items.map(row => row.id), ['a', 'b']);
  assert.deepEqual(db.calls[0].orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
  const next = await listOperationalResources(db, resource.operationId, { ...query, cursor: first.page.nextCursor }, context());
  assert.deepEqual(next.items.map(row => row.id), ['c']);
  for (const [op, patch, ctx] of [[resource.operationId, { itemId: 'i2' }, context()], [resource.operationId, { createdSince: '2026-09-02T00:00:00Z' }, context()], ['operational.StockMovementCosts.list', {}, context()], [resource.operationId, {}, context({ projectIds: new Set(['p2']) })]]) {
    await assert.rejects(() => listOperationalResources({}, op, { ...query, cursor: first.page.nextCursor, ...patch }, ctx), e => e.code === 'INVALID_CURSOR');
  }
});

test('unpublished/deleted parents, orphan/conflicting attachment links and draft versions fail closed', async () => {
  for (const resource of EXTENDED_OPERATIONAL_RESOURCES.filter(r => ['REPORT', 'REPORT_ATTACHMENT', 'MAINTENANCE'].includes(r.projectPolicy))) {
    for (const badReport of [{ ...report('p1'), status: 'PENDING' }, { ...report('p1'), deletedAt: stamp }, { ...report('p1'), project: { deletedAt: stamp } }]) {
      const db = database(resource, [sample(resource, 'p1', { report: badReport, maintenance: { ...maintenance('p1'), report: badReport } })]);
      assert.equal((await listOperationalResources(db, resource.operationId, {}, context())).items.length, 0, resource.model);
    }
  }
  const attachment = descriptor('ReportAttachment');
  for (const extra of [{ reportId: null, report: null }, { reportServiceId: 's2', reportService: { report: report('p2') } }]) {
    assert.equal((await listOperationalResources(database(attachment, [sample(attachment, 'p1', extra)]), attachment.operationId, {}, context())).items.length, 0);
  }
  const serviceOnly = sample(attachment, 'p1', { reportId: null, report: null, reportServiceId: 's1', reportService: { reportId: 'r-p1', report: report('p1') } });
  assert.equal((await listOperationalResources(database(attachment, [serviceOnly]), attachment.operationId, { reportId: 'r-p1' }, context())).items.length, 1);
  for (const model of ['ReportVersion', 'ReportSignature', 'ReportAuditLog']) {
    const r = descriptor(model);
    const row = sample(r, 'p1', model === 'ReportVersion' ? { status: 'DRAFT' } : { version: { status: 'DRAFT', report: report('p1') } });
    assert.equal((await listOperationalResources(database(r, [row]), r.operationId, {}, context())).items.length, 0);
  }
});

test('unassigned stock/maintenance are ALL-only; costs are exact strings and operational movements exclude them', async () => {
  const resources = [descriptor('StockMovement'), ...EXTENDED_OPERATIONAL_RESOURCES.filter(r => r.projectPolicy === 'MAINTENANCE')];
  for (const r of resources) {
    const row = sample(r, 'p1', { projectId: null, project: null, maintenance: { ...maintenance('p1'), reportId: null, report: null } });
    const db = database(r, [row]);
    assert.equal((await listOperationalResources(db, r.operationId, {}, context())).items.length, 0);
    assert.equal((await listOperationalResources(db, r.operationId, {}, context({ projectAccessMode: 'ALL' }))).items.length, 1);
  }
  for (const r of EXTENDED_OPERATIONAL_RESOURCES.filter(r => r.model === 'StockMovement')) {
    const db = database(r, [sample(r, 'p1', { unitCost: { toString: () => '1234567890.12' } })]);
    const row = (await listOperationalResources(db, r.operationId, {}, context())).items[0];
    assert.equal(row.unitCost, r.scope === 'estoque.custos.read' ? '1234567890.12' : undefined);
  }
});

test('all downloads: scope/dependency guards, denied parent and missing ID before file access', async () => {
  const router = createOperationalRouter();
  for (const d of OPERATIONAL_DOWNLOADS) {
    const route = router.stack.find(layer => layer.route?.path === d.path).route;
    assert.deepEqual(Object.keys(route.methods), ['get']);
    for (const omitted of d.requiredScopes) {
      const ctx = context({ scopes: new Set(d.requiredScopes.filter(s => s !== omitted)) });
      await assert.rejects(() => openOperationalDownload({}, d.operationId, { id: 'p1' }, {}, ctx, {}), e => e.code === 'INSUFFICIENT_SCOPE');
      const res = { setHeader() {}, status(code) { this.code = code; return this; }, json() {} };
      route.stack[0].handle({ apiAuth: { scopeCodes: ctx.scopes }, query: {} }, res, () => assert.fail('missing scope allowed'));
      assert.equal(res.code, 403);
    }
    await assert.rejects(() => openOperationalDownload({}, d.operationId, { id: 'p1' }, { storagePath: '/private' }, context(), {}));
    const db = database(d.metadata, [sample(d.metadata, 'p2')]);
    await assert.rejects(() => openOperationalDownload(db, d.operationId, { id: d.storage === 'STOCK' ? 'unknown' : 'p2' }, {}, context(), {}), e => e.code === 'FILE_NOT_FOUND');
  }
});

test('authenticated files support all three roots and legacy FISPQ; never return paths/tokens', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'integration-files-'));
  try {
    const roots = { reportsDir: root, uploadDir: root };
    for (const d of OPERATIONAL_DOWNLOADS) {
      const folder = d.storage === 'REPORT' ? 'Missão p1 - Teste' : d.storage === 'STOCK' ? 'Estoque/Documentos' : 'Equipamentos/Manutenções/EQ1';
      await mkdir(path.join(root, folder), { recursive: true });
      const storagePath = `${folder}/file.pdf`;
      await writeFile(path.join(root, storagePath), 'synthetic-pdf');
      const db = database(d.metadata, [sample(d.metadata, 'p1', { storagePath, fileName: 'C:\\private\\teste.pdf\r\n', mimeType: 'application/pdf' })]);
      const result = await openOperationalDownload(db, d.operationId, { id: 'p1' }, {}, context(), roots);
      try {
        assert.equal((await result.handle.readFile()).toString(), 'synthetic-pdf');
        assert.equal(result.bytes, 13);
        assert.match(result.disposition, /^attachment;/);
        assert.doesNotMatch(result.disposition, /private|\r|\n/);
        assert.equal(result.storagePath, undefined);
        assert.equal(result.publicToken, undefined);
      } finally { await result.handle.close(); }
    }
    await mkdir(path.join(root, 'Estoque/FISPQ'), { recursive: true });
    await writeFile(path.join(root, 'Estoque/FISPQ', 'old-synthetic-token.pdf'), 'legacy');
    const d = OPERATIONAL_DOWNLOADS.find(d => d.storage === 'STOCK');
    const result = await openOperationalDownload(database(d.metadata, [sample(d.metadata, 'p1', { storagePath: null, publicToken: 'synthetic-token' })]), d.operationId, { id: 'p1' }, {}, context(), roots);
    try { assert.equal((await result.handle.readFile()).toString(), 'legacy'); } finally { await result.handle.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('download blocks forged project ownership, traversal, URLs, symlinks, absent files and oversized files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'integration-files-denial-'));
  try {
    const d = OPERATIONAL_DOWNLOADS.find(d => d.storage === 'REPORT');
    await mkdir(path.join(root, 'Missão p1 - Teste'));
    await mkdir(path.join(root, 'Missão p2 - Teste'));
    await writeFile(path.join(root, 'Missão p2 - Teste/private.pdf'), 'PRIVATE');
    await symlink(path.join(root, 'Missão p2 - Teste/private.pdf'), path.join(root, 'Missão p1 - Teste/symlink.pdf'));
    await symlink(path.join(root, 'Missão p2 - Teste'), path.join(root, 'Missão p1 - Teste/link'));
    for (const storagePath of ['Missão p2 - Teste/private.pdf', '../private.pdf', '/private.pdf', 'https://example.com/private', 'Missão p1 - Teste/../Missão p2 - Teste/private.pdf', 'Missão p1 - Teste/%2e%2e/private.pdf', 'Missão p1 - Teste\\private.pdf', 'Missão p1 - Teste/symlink.pdf', 'Missão p1 - Teste/link/private.pdf', 'Missão p1 - Teste/absent.pdf']) {
      const db = database(d.metadata, [sample(d.metadata, 'p1', { storagePath })]);
      await assert.rejects(() => openOperationalDownload(db, d.operationId, { id: 'p1' }, {}, context(), { reportsDir: root }), e => e.code === 'FILE_NOT_FOUND' && !e.message.includes(root));
    }
    const largePath = 'Missão p1 - Teste/large.pdf';
    const handle = await open(path.join(root, largePath), 'w');
    try { await handle.truncate(MAX_OPERATIONAL_FILE_BYTES + 1); } finally { await handle.close(); }
    await assert.rejects(() => openOperationalDownload(database(d.metadata, [sample(d.metadata, 'p1', { storagePath: largePath })]), d.operationId, { id: 'p1' }, {}, context(), { reportsDir: root }), e => e.code === 'FILE_TOO_LARGE' && e.statusCode === 413);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function metered(resource, rows) {
  const db = database(resource, rows);
  const logs = [], events = [], updates = [];
  db.apiUsageBucket = {
    async upsert({ create }) { return { id: create.windowKind }; },
    async updateMany(args) { updates.push(args); return { count: 1 }; },
    async update(args) { updates.push(args); return args; }
  };
  db.$transaction = async action => typeof action === 'function' ? action(db) : Promise.all(action);
  db.apiCredentialEvent = { async create({ data }) { events.push(data); } };
  db.apiRequestLog = { async create({ data }) { logs.push(data); } };
  db.apiCredential = {
    async findUnique() { return { id: 'synthetic-credential', projectAccessMode: 'SELECTED', maxPageSize: 3, requestsPerMinute: 10, requestsPerDay: 100, rowsPerDay: 1000, secretLastFour: 'demo', scopes: API_SCOPES.map(s => ({ scopeCode: s.code })), projects: [{ projectId: 'p1' }] }; },
    async updateMany() { return { count: 1 }; }
  };
  return { db, logs, events, updates };
}

test('all expanded collections dispatch in admin playground with quota and audit', async () => {
  for (const resource of EXTENDED_OPERATIONAL_RESOURCES) {
    const { db, events, updates } = metered(resource, [sample(resource)]);
    const result = await executePlaygroundOperation(db, 'synthetic-credential', { operationId: resource.operationId, query: {}, pathParams: {} }, { cursorKey: context().cursorKey, now: context().snapshotAt });
    assert.equal(result.response.body.items.length, 1, resource.model);
    assert.equal(result.response.body.page.limit, 3);
    assert.ok(events.some(event => event.type === 'TESTED'));
    assert.ok(updates.some(update => update.data.rows?.increment === 3));
    assert.ok(updates.some(update => update.data.rows?.decrement === 2));
    assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPOSE/);
  }
});

test('empty downloads meter zero bytes without falling back to a JSON body', async () => {
  const d = OPERATIONAL_DOWNLOADS[0];
  const { db, logs, updates } = metered(d.metadata, []);
  const req = { headers: {}, requestId: 'synthetic-empty-request', apiAuth: { credential: await db.apiCredential.findUnique() } };
  await runMeteredApiOperation(req, { prismaClient: db, operationId: d.operationId, execute: async () => ({ rows: 0, bytes: 0 }) });
  assert.equal(logs[0].responseBytes, 0);
  assert.ok(updates.some(update => update.data.bytes?.increment === 0));
});

test('playground verifies all four downloads with authorization, metadata only, quota and TESTED audit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'generic-playground-'));
  try {
    for (const operationId of ['quality.evidence.download', ...OPERATIONAL_DOWNLOADS.map(d => d.operationId)]) {
      const definition = OPERATIONAL_DOWNLOADS.find(d => d.operationId === operationId);
      const folder = !definition ? 'Qualidade/Evidencias' : definition.storage === 'REPORT' ? 'Missão p1 - Teste' : definition.storage === 'STOCK' ? 'Estoque/Documentos' : 'Equipamentos/Manutenções/EQ1';
      const storagePath = `${folder}/demo.pdf`;
      await mkdir(path.join(root, folder), { recursive: true });
      await writeFile(path.join(root, storagePath), 'PRIVATE_FILE_CONTENT');
      const resource = definition?.metadata || { delegate: 'qualityEvidence' };
      const row = definition ? sample(resource, 'p1', { storagePath, mimeType: 'application/pdf' }) : { id: 'p1', kind: 'ATTACHMENT', storagePath, mimeType: 'application/pdf', record: { projectId: 'p1', deletedAt: null } };
      const { db, events, updates } = metered(resource, [row]);
      if (!definition) db.qualityEvidence.findUnique = async ({ where }) => where.id === row.id ? row : null;
      const input = { operationId, pathParams: { id: 'p1' }, query: {} };
      const options = { now: context().snapshotAt, cursorKey: context().cursorKey, fileRoots: { uploadDir: root, reportsDir: root } };
      const result = await executePlaygroundOperation(db, 'synthetic-credential', input, options);
      assert.deepEqual(result.response.body.file, { id: 'p1', mimeType: 'application/pdf', sizeBytes: 20 });
      assert.equal(result.response.body.kind, 'DOWNLOAD_CHECK');
      assert.equal(result.response.body.available, true);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FILE_CONTENT|NEVER_EXPOSE|storagePath|publicToken|targetPath/);
      assert.match(result.request.curl, /--output "arquivo-baixado.bin"/);
      assert.ok(events.some(event => event.type === 'TESTED'));
      assert.ok(updates.some(update => update.data.rows?.increment === 0));
      assert.ok(updates.some(update => update.data.bytes?.increment === Buffer.byteLength(JSON.stringify(result.response.body))));
      const originalCredential = await db.apiCredential.findUnique();
      for (const scope of getApiOperation(operationId).requiredScopes) {
        db.apiCredential.findUnique = async () => ({ ...originalCredential, scopes: originalCredential.scopes.filter(s => s.scopeCode !== scope) });
        await assert.rejects(() => executePlaygroundOperation(db, 'synthetic-credential', input, options), e => e.code === 'INSUFFICIENT_SCOPE');
      }
      db.apiCredential.findUnique = async () => ({ ...originalCredential, revokedAt: stamp });
      await assert.rejects(() => executePlaygroundOperation(db, 'synthetic-credential', input, options), e => e.code === 'INACTIVE_CREDENTIAL');
      db.apiCredential.findUnique = async () => originalCredential;
      await assert.rejects(() => executePlaygroundOperation(db, 'synthetic-credential', { ...input, pathParams: { id: 'unknown' } }, options), e => e.statusCode === 404);
      if (!definition || definition.storage !== 'STOCK') {
        db.apiCredential.findUnique = async () => ({ ...originalCredential, projects: [{ projectId: 'p2' }] });
        await assert.rejects(() => executePlaygroundOperation(db, 'synthetic-credential', input, options), e => e.statusCode === 404);
        db.apiCredential.findUnique = async () => originalCredential;
      }
      await rm(path.join(root, storagePath));
      await assert.rejects(() => executePlaygroundOperation(db, 'synthetic-credential', input, options), e => e.statusCode === 404);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('download route streams bounded bytes, meters quota/audit, sends attachment and closes its handle', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'integration-stream-'));
  try {
    const d = OPERATIONAL_DOWNLOADS.find(d => d.storage === 'STOCK');
    await mkdir(path.join(root, 'Estoque/Documentos'), { recursive: true });
    const storagePath = 'Estoque/Documentos/demo.pdf';
    await writeFile(path.join(root, storagePath), 'synthetic-pdf');
    const { db, logs, updates } = metered(d.metadata, [sample(d.metadata, 'p1', { storagePath, mimeType: 'application/pdf', fileName: 'demo.pdf' })]);
    const router = createOperationalRouter({ prismaClient: db, envConfig: { uploadDir: root } });
    const route = router.stack.find(layer => layer.route?.path === d.path).route;
    const req = { params: { id: 'p1' }, query: {}, headers: {}, requestId: 'synthetic-request', apiAuth: { credential: await db.apiCredential.findUnique(), scopeCodes: context().scopes, projectIds: context().projectIds } };
    const chunks = [], headers = {};
    const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
    res.setHeader = (key, value) => { headers[key] = value; };
    await new Promise((resolve, reject) => {
      res.on('finish', resolve);
      res.on('error', reject);
      route.stack[0].handle(req, res, () => route.stack[1].handle(req, res, reject));
    });
    assert.equal(Buffer.concat(chunks).toString(), 'synthetic-pdf');
    assert.equal(headers['Content-Length'], '13');
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.match(headers['Content-Disposition'], /^attachment;/);
    assert.ok(logs.some(log => log.operationId === d.operationId && log.responseBytes === 13 && log.responseRows === 0));
    assert.ok(updates.some(update => update.data.bytes?.increment === 13));
  } finally { await rm(root, { recursive: true, force: true }); }
});
