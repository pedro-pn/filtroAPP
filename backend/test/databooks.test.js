import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { PGlite } from '@electric-sql/pglite';
import { makeDatabookSchemas } from '../../shared/schemas/databooks.js';
import { databookPermissions, databookPeriodWhere, defaultDatabookPeriod } from '../src/lib/databooks/policy.js';
import { loadDatabookSources, publicDatabookSources, selectDatabookSources, sha256, summarizeDatabookReport } from '../src/lib/databooks/sources.js';
import { authorizeDatabookProject, createDatabook, retryDatabook, resolveDatabookDownload, serializeDatabook } from '../src/lib/databooks/service.js';
import { claimDatabookJob, generateDatabookJob } from '../src/lib/databooks/jobs.js';
import { databookFixture, databookInput, databookManager } from './helpers/databooks-db.js';

const schemas = makeDatabookSchemas(z);
test('databook congela TAG, método, inspeção e quantidade sem expor campos internos do formulário', () => {
  const { state } = databookFixture(); const report = state.reports[1];
  report.specialConditions = { serviceData: { 'Desenhos / TAGs': 'TAG-01 / TAG-02', 'Quantidade de sistemas (un)': 2,
    'Método de limpeza': ['Circulação pressurizada'], 'Tipo de inspeção': ['Visual', 'Vídeo boroscopia'],
    'Aprovado pelo cliente?': 'Sim', __uploads__: [{ storagePath: 'privado' }], contato: 'privado',
    'Sistema': { private: 'objeto inválido' } }, internalNotes: 'privado' };
  report.services = [{ id: 's1', serviceType: 'Limpeza', extraData: { 'Desenhos / TAGs': 'TAG-01',
    'Material da tubulação': 'Aço carbono', internalCost: 1234, __uploads__: [{ storagePath: 'privado' }] } }];
  const summary = summarizeDatabookReport(report);
  assert.equal(summary.technical['Desenhos / TAGs'], 'TAG-01 / TAG-02');
  assert.equal(summary.technical['Quantidade de sistemas (un)'], 2);
  assert.deepEqual(summary.technical['Tipo de inspeção'], ['Visual', 'Vídeo boroscopia']);
  assert.equal(summary.technical.Sistema, undefined);
  assert.equal(summary.services[0].technical['Material da tubulação'], 'Aço carbono');
  assert.equal(summary.clientAccepted, false, 'A declaração do formulário não registra aceite formal');
  assert.equal(JSON.stringify(summary).includes('privado'), false);
  assert.equal(JSON.stringify(summary).includes('internalCost'), false);
});

test('databook diferencia assinatura parcial de todos os signatários do cliente', () => {
  const { state } = databookFixture(); const report = state.reports[0];
  report.reportSignatures = [{ signerRole: 'CLIENT', status: 'SIGNED', isRequired: true }, { signerRole: 'CLIENT', status: 'PENDING', isRequired: true }];
  assert.equal(summarizeDatabookReport(report).clientSigned, false);
  assert.equal(summarizeDatabookReport(report).clientSignaturesSigned, 1);
  report.reportSignatures[1].status = 'SIGNED'; assert.equal(summarizeDatabookReport(report).clientSigned, true);
});
test('databook valida calendário, período inclusivo, duplicidade e curadoria estrita', () => {
  for (const startDate of ['2026-02-29', '2026-09-31', '16/09/2026', '', '2026-09-16T00:00:00Z']) assert.equal(schemas.period.safeParse({ startDate, endDate: '2026-10-07' }).success, false);
  assert.equal(schemas.period.safeParse({ startDate: '2024-02-29', endDate: '2024-02-29' }).success, true);
  assert.equal(schemas.period.safeParse({ startDate: '2026-10-07', endDate: '2026-09-16' }).success, false);
  for (const patch of [{ reportIds: [] }, { reportIds: ['r1', 'r1'] }, { photos: [{ key: 'photo', storagePath: '../../secrets' }] },
    { productsReviewed: false }, { products: [{ itemId: 'i', documentId: 'd', revision: '1', confirmed: false }] }, { storagePath: 'secret' }]) {
    assert.equal(schemas.create.safeParse({ ...databookInput, ...patch }).success, false);
  }
  assert.equal(schemas.create.safeParse(databookInput).success, true);
});

test('databook calcula defaults dos RDOs não excluídos, incluindo os tipos operacionais', () => {
  const { state } = databookFixture();
  state.reports.push({ ...state.reports[0], reportType: 'RLQ', reportDate: new Date('2026-09-01') });
  state.reports.push({ ...state.reports[0], deletedAt: new Date(), reportDate: new Date('2026-08-01') });
  assert.deepEqual(defaultDatabookPeriod(state.reports), { startDate: '2026-09-16', endDate: '2026-10-07' });
  assert.deepEqual(defaultDatabookPeriod([]), { startDate: null, endDate: null });
  state.reports.push({ ...state.reports[0], reportType: 'RDO_MAINTENANCE', reportDate: new Date('2026-09-15') });
  assert.equal(defaultDatabookPeriod(state.reports).startDate, '2026-09-15');
});

test('databook inclui o dia final inteiro e não depende de fuso local', async () => {
  const { database, state } = databookFixture();
  state.reports[1].reportDate = new Date('2026-09-17T23:59:59.999Z');
  state.reports.push({ ...state.reports[1], id: 'outside', reportDate: new Date('2026-09-18T00:00:00Z') });
  const range = databookPeriodWhere('2026-09-16', '2026-09-17');
  assert.equal(range.gte.toISOString(), '2026-09-16T00:00:00.000Z'); assert.equal(range.lt.toISOString(), '2026-09-18T00:00:00.000Z');
  const sources = await loadDatabookSources(database, state.project, databookInput);
  assert.deepEqual(sources.reports.map(report => report.id), ['r1', 'r2']);
});

test('databook autoriza leitores e gestores separadamente e permite projeto arquivado', async () => {
  const { database, state } = databookFixture(); state.project.isActive = false;
  const viewer = { ...databookManager, moduleRoles: ['acompanhamento:viewer'] };
  assert.deepEqual(databookPermissions(viewer, state.project), { canRead: true, canGenerate: false });
  assert.equal(databookPermissions(databookManager, state.project).canGenerate, true);
  await authorizeDatabookProject(database, state.project.id, viewer);
  await assert.rejects(() => createDatabook(database, state.project.id, databookInput, viewer), error => error.statusCode === 403);
  for (const user of [{ ...databookManager, accountType: 'CLIENT' }, { ...databookManager, moduleRoles: ['rdo:collaborator'] }]) assert.equal(databookPermissions(user, state.project).canRead, false);
  state.project.managerOnly = true; assert.equal(databookPermissions(databookManager, state.project).canRead, false);
  assert.equal(databookPermissions({ ...databookManager, accountType: 'ADMIN' }, state.project).canGenerate, true);
  state.project.deletedAt = new Date(); await assert.rejects(() => authorizeDatabookProject(database, state.project.id, databookManager), error => error.statusCode === 404);
});

test('databook valida relatório/foto por projeto/período, recupera fotos legadas e preserva ordem', async () => {
  const { database, state } = databookFixture();
  const folder = `Missão ${state.project.code} - ${state.project.name}`;
  const attachment = { label: 'Foto', fileName: 'first.jpg', mimeType: 'image/jpeg', storagePath: `${folder}/first.jpg` };
  state.reports[0].specialConditions.generalUploads = [attachment];
  state.reports[0].attachments = [attachment, { ...attachment, storagePath: 'Missão outro - secreto/secret.jpg' }];
  state.reports[0].services = [{ id: 'service1', serviceType: 'limpeza', extraData: { __uploads__: [{ label: 'Tubulação', files: [{ ...attachment, fileName: 'second.jpg', storagePath: `${folder}/second.jpg` }] }] }, attachments: [] }];
  const sources = await loadDatabookSources(database, state.project, databookInput);
  assert.deepEqual(sources.photos.map(photo => photo.fileName), ['first.jpg', 'second.jpg']);
  const photoSelection = sources.photos.map(photo => ({ key: photo.key, caption: 'Legenda', tag: '', phase: 'UNSPECIFIED' })).reverse();
  const selected = selectDatabookSources(sources, { ...databookInput, photos: photoSelection });
  assert.equal(selected.photos[0].fileName, 'second.jpg');
  assert.throws(() => selectDatabookSources(sources, { ...databookInput, reportIds: ['r2'], photos: photoSelection }), /não selecionado/);
  assert.throws(() => selectDatabookSources(sources, { ...databookInput, reportIds: ['r3'] }), /fora do projeto/);
  assert.throws(() => selectDatabookSources(sources, { ...databookInput, photos: [{ key: 'tampered' }] }), /Foto fora/);
  const json = JSON.stringify(publicDatabookSources(sources)); assert.equal(json.includes('storagePath'), false);
  assert.equal(JSON.stringify(selected.snapshot).includes('storagePath'), false);
});

test('databook não presume consumo/aceite e exige FDS do produto selecionado', async () => {
  const { database, state } = databookFixture();
  const item = { id: 'item1', code: 'PQ1', name: 'Produto', unitLabel: 'kg', documents: [{ id: 'doc1', fileName: 'FDS.pdf', storagePath: 'Estoque/file.pdf', publicToken: 'private' }] };
  state.movements = [{ id: 'move1', itemId: item.id, item, date: new Date('2026-09-15'), quantity: 20, batch: { lotNumber: 'L1' } }];
  const sources = await loadDatabookSources(database, state.project, databookInput);
  assert.equal(sources.products[0].movements[0].inPeriod, false);
  assert.equal(publicDatabookSources(sources).products[0].documents[0].publicToken, undefined);
  const products = [{ itemId: 'item1', documentId: 'doc1', revision: 'Rev. 2 — 2025', confirmed: true }];
  const selection = selectDatabookSources(sources, { ...databookInput, products });
  assert.equal(selection.snapshot.products[0].document.revision, 'Rev. 2 — 2025');
  assert.equal(selection.snapshot.reports[0].clientAccepted, false);
  assert.equal(selection.snapshot.reports[0].clientSigned, false);
  assert.match(selection.snapshot.warnings.join(' '), /sem assinatura/);
  assert.throws(() => selectDatabookSources(sources, { ...databookInput, products: [{ ...products[0], documentId: 'otherProductDoc' }] }), /FDS fora/);
  assert.throws(() => selectDatabookSources(sources, { ...databookInput, products: [{ ...products[0], confirmed: false }] }), /Confirme/);
  state.reports[0].status = 'PENDING'; assert.throws(() => selectDatabookSources(sources, databookInput), /aprovados/);
});

test('databook mantém etapas independentes e revisões sequenciais sem modificar emissão anterior', async () => {
  const { database, state } = databookFixture();
  const first = await createDatabook(database, state.project.id, databookInput, databookManager);
  const original = JSON.stringify(first);
  const secondStage = await createDatabook(database, state.project.id, { ...databookInput, title: 'Etapa 2' }, databookManager);
  assert.notEqual(first.familyId, secondStage.familyId); assert.equal(secondStage.revision, 1);
  const revisions = await Promise.all([1, 2].map(() => createDatabook(database, state.project.id, { ...databookInput, previousId: first.id }, databookManager)));
  assert.deepEqual(revisions.map(item => item.revision), [2, 3]); assert.equal(JSON.stringify(first), original); assert.equal(state.locks, 4);
  await assert.rejects(() => createDatabook(database, state.project.id, { ...databookInput, previousId: 'anotherProject' }, databookManager), error => error.statusCode === 404);
});

test('databook claim CAS impede dois trabalhadores de processar a mesma tarefa e recupera lease expirado', async () => {
  const { database, state } = databookFixture();
  await createDatabook(database, state.project.id, databookInput, databookManager);
  const now = new Date('2026-10-08T12:00:00Z');
  const claims = await Promise.all([claimDatabookJob(database, now), claimDatabookJob(database, now)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await claimDatabookJob(database, new Date(now.getTime() + 4 * 60000)), null);
  const firstToken = state.records[0].leaseToken;
  const recovered = await claimDatabookJob(database, new Date(now.getTime() + 6 * 60000));
  assert.notEqual(recovered.leaseToken, firstToken); assert.equal(recovered.attempts, 2);
});

test('databook geração conclui somente após dois arquivos íntegros; downloads verificam hash e permissão', async () => {
  const { database, state } = databookFixture();
  await createDatabook(database, state.project.id, databookInput, databookManager);
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'databook-test-'));
  try {
    const job = await claimDatabookJob(database);
    await generateDatabookJob(database, job, { rootDir, silent: true, buildPackage: async ({ onProgress }) => {
      await onProgress(90); return { pdf: Buffer.from('valid pdf bytes'), zip: Buffer.from('valid zip bytes') };
    } });
    assert.equal(job.status, 'COMPLETED'); assert.equal(job.progress, 100);
    const file = await resolveDatabookDownload(database, state.project.id, job.id, 'pdf', databookManager, { rootDir });
    assert.equal(sha256(file.buffer), job.pdfSha256);
    assert.equal(JSON.stringify(serializeDatabook(job)).includes('pdfPath'), false);
    await assert.rejects(() => retryDatabook(database, state.project.id, job.id, databookManager), error => error.statusCode === 409);
    await fs.writeFile(path.join(rootDir, job.pdfPath), 'tampered');
    await assert.rejects(() => resolveDatabookDownload(database, state.project.id, job.id, 'pdf', databookManager, { rootDir }), /diverge/);
  } finally { await fs.rm(rootDir, { recursive: true, force: true }); }
});

test('databook falha não publica parcial, limpa órfãos e pode repetir; fonte alterada exige nova revisão', async () => {
  const { database, state } = databookFixture();
  await createDatabook(database, state.project.id, databookInput, databookManager);
  const job = await claimDatabookJob(database); const removed = [];
  let writes = 0;
  await generateDatabookJob(database, job, { silent: true, buildPackage: async () => ({ pdf: Buffer.from('pdf'), zip: Buffer.from('zip') }),
    writeFile: async () => { if (++writes === 2) throw new Error('/private/path failed'); return 'Databooks/orphan.pdf'; },
    unlinkFile: async file => removed.push(file) });
  assert.equal(job.status, 'FAILED'); assert.deepEqual(removed, ['Databooks/orphan.pdf']);
  assert.equal(job.pdfPath, undefined); assert.equal(job.error.includes('/private'), false);
  await assert.rejects(() => resolveDatabookDownload(database, state.project.id, job.id, 'zip', databookManager), error => error.statusCode === 409);
  await retryDatabook(database, state.project.id, job.id, databookManager);
  const retried = await claimDatabookJob(database); state.reports[0].updatedAt = new Date();
  await generateDatabookJob(database, retried, { silent: true, buildPackage: async () => { throw new Error('must not run'); } });
  assert.equal(retried.status, 'FAILED'); assert.match(retried.error, /fontes mudaram/);
});

test('databook trabalhador com token antigo não finaliza tarefa reclamada', async () => {
  const { database, state } = databookFixture();
  await createDatabook(database, state.project.id, databookInput, databookManager);
  const job = { ...await claimDatabookJob(database) }; const removed = [];
  await generateDatabookJob(database, job, { silent: true,
    buildPackage: async () => { state.records[0].leaseToken = 'new-owner'; return { pdf: Buffer.from('pdf'), zip: Buffer.from('zip') }; },
    writeFile: async () => 'Databooks/file.pdf', unlinkFile: async file => removed.push(file) });
  assert.equal(state.records[0].status, 'RUNNING'); assert.equal(state.records[0].leaseToken, 'new-owner'); assert.deepEqual(removed, []);
});

test('databook migração PostgreSQL protege período, estados, FK e unicidade de revisão', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE "Project" ("id" TEXT PRIMARY KEY); INSERT INTO "Project" VALUES (\'p\');');
    await db.exec(await fs.readFile(new URL('../prisma/migrations/20261008220000_project_databooks/migration.sql', import.meta.url), 'utf8'));
    const insert = (id, start, end, revision = 1) => db.query('INSERT INTO "ProjectDatabook" ("id","projectId","familyId","revision","title","startDate","endDate","options","snapshot","sourceFingerprint","createdByUserId","createdByName","updatedAt") VALUES ($1,\'p\',\'family\',$4,\'Etapa\',$2,$3,\'{}\',\'{}\',\'hash\',\'u\',\'Gestor\',now())', [id, start, end, revision]);
    await insert('one', '2026-09-16', '2026-10-07');
    await assert.rejects(() => insert('invalid', '2026-10-07', '2026-09-16', 2), /period_check/);
    await assert.rejects(() => insert('duplicate', '2026-09-16', '2026-10-07'), /familyId_revision_key/);
    await assert.rejects(() => db.exec('UPDATE "ProjectDatabook" SET "status" = \'INVALID\''), /status_check/);
    await assert.rejects(() => db.exec('DELETE FROM "Project"'), /foreign key/);
  } finally { await db.close(); }
});
