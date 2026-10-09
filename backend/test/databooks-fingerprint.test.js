import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { z } from 'zod';
import { makeDatabookSchemas } from '../../shared/schemas/databooks.js';
import { loadDatabookSources, selectDatabookSources } from '../src/lib/databooks/sources.js';
import { createDatabook, retryDatabook } from '../src/lib/databooks/service.js';
import { claimDatabookJob, generateDatabookJob } from '../src/lib/databooks/jobs.js';
import { databookFixture, databookInput, databookManager } from './helpers/databooks-db.js';

async function photoFixture() {
  const fixture = databookFixture();
  const { database, state } = fixture;
  state.reports[0].attachments = ['first.jpg', 'second.jpg'].map(fileName => ({
    label: fileName, fileName, mimeType: 'image/jpeg', storagePath: `Missão ${state.project.code} - ${state.project.name}/${fileName}`
  }));
  const sources = await loadDatabookSources(database, state.project, databookInput);
  const input = makeDatabookSchemas(z).create.parse({ ...databookInput,
    photos: sources.photos.map(photo => ({ key: photo.key, caption: photo.label, tag: 'APV', phase: 'DURING' })) });
  return { ...fixture, sources, input };
}

function reorderKeys(value) {
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(reorderKeys);
  return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reorderKeys(value[key])]));
}

test('databook mantém as fontes após gravar e reler fotos/seleção em JSONB', async () => {
  const { database, state, sources, input } = await photoFixture();
  const pg = new PGlite();
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'databook-jsonb-'));
  try {
    const record = await createDatabook(database, state.project.id, input, databookManager);
    const { rows: [persisted] } = await pg.query('SELECT $1::jsonb AS options, $2::jsonb AS snapshot', [JSON.stringify(record.options), JSON.stringify(record.snapshot)]);
    assert.deepEqual(persisted.options, record.options);
    assert.notEqual(JSON.stringify(persisted.options.photos[0]), JSON.stringify(record.options.photos[0]), 'PostgreSQL mudou a ordem das chaves, sem mudar os dados');
    assert.equal(selectDatabookSources(sources, persisted.options).fingerprint, record.sourceFingerprint);
    record.options = persisted.options; record.snapshot = persisted.snapshot;
    const job = await claimDatabookJob(database);
    await generateDatabookJob(database, job, { rootDir, silent: true,
      buildPackage: async () => ({ pdf: Buffer.from('pdf'), zip: Buffer.from('zip') }) });
    assert.equal(job.status, 'COMPLETED', job.error);
    assert.deepEqual(job.snapshot.photos.map(photo => photo.key), input.photos.map(photo => photo.key));
    assert.deepEqual(job.snapshot.photos.map(photo => photo.caption), input.photos.map(photo => photo.caption));
  } finally { await pg.close(); await fs.rm(rootDir, { recursive: true, force: true }); }
});

test('databook compara conteúdo independente da ordem das chaves, preservando datas e ordem das fotos', async () => {
  const { sources, input } = await photoFixture();
  sources.reports[0].specialConditions = { technical: { tag: 'APV', pressure: 12 } };
  const fingerprint = selectDatabookSources(sources, input).fingerprint;
  assert.equal(selectDatabookSources(reorderKeys(sources), reorderKeys(input)).fingerprint, fingerprint);
  assert.notEqual(selectDatabookSources(sources, { ...input, photos: [...input.photos].reverse() }).fingerprint, fingerprint);
  assert.notEqual(selectDatabookSources(sources, { ...input, photos: input.photos.map((photo, index) => index ? photo : { ...photo, caption: 'Outra legenda' }) }).fingerprint, fingerprint);
  const changed = structuredClone(sources);
  changed.reports[0].reportDate = new Date('2026-09-17T00:00:00Z');
  assert.notEqual(selectDatabookSources(changed, input).fingerprint, fingerprint);
  changed.reports[0].reportDate = sources.reports[0].reportDate;
  changed.reports[0].specialConditions.technical.pressure = 13;
  assert.notEqual(selectDatabookSources(changed, input).fingerprint, fingerprint);
});

// Captured from the pre-fix implementation with photoFixture(), before JSONB storage.
const PREVIOUS_FINGERPRINT = '5f8a8bf162d977dcd83a491636b614d66e875e6ceeaff18821abf8f955557229';

test('databook permite repetir emissão antiga após JSONB, sem substituir o snapshot nem o hash original', async () => {
  const { database, state, input } = await photoFixture();
  const pg = new PGlite();
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'databook-legacy-'));
  try {
    const record = await createDatabook(database, state.project.id, input, databookManager);
    const { rows: [persisted] } = await pg.query('SELECT $1::jsonb AS options', [JSON.stringify(record.options)]);
    record.options = persisted.options; record.sourceFingerprint = PREVIOUS_FINGERPRINT; record.status = 'FAILED';
    record.error = 'As fontes mudaram após a preparação. Prepare uma nova revisão para conferir os dados.';
    const snapshot = JSON.stringify(record.snapshot);
    await retryDatabook(database, state.project.id, record.id, databookManager);
    const job = await claimDatabookJob(database);
    await generateDatabookJob(database, job, { rootDir, silent: true,
      buildPackage: async () => ({ pdf: Buffer.from('pdf'), zip: Buffer.from('zip') }) });
    assert.equal(job.status, 'COMPLETED', job.error);
    assert.equal(JSON.stringify(job.snapshot), snapshot);
    assert.equal(job.sourceFingerprint, PREVIOUS_FINGERPRINT);
  } finally { await pg.close(); await fs.rm(rootDir, { recursive: true, force: true }); }
});

test('databook bloqueia mudança real antes e durante geração nos dois formatos de fingerprint', async () => {
  for (const legacy of [false, true]) for (const during of [false, true]) {
    const { database, state, input } = await photoFixture();
    const job = await createDatabook(database, state.project.id, input, databookManager);
    if (legacy) job.sourceFingerprint = PREVIOUS_FINGERPRINT;
    await claimDatabookJob(database);
    let generated = false; let writes = 0;
    const change = () => { state.reports[0].specialConditions.pressure = 15; };
    if (!during) change();
    await generateDatabookJob(database, job, { silent: true,
      buildPackage: async () => { generated = true; change(); return { pdf: Buffer.from('pdf'), zip: Buffer.from('zip') }; },
      writeFile: async () => { writes += 1; return 'Databooks/unexpected.pdf'; } });
    assert.equal(job.status, 'FAILED');
    assert.match(job.error, /As fontes mudaram/);
    assert.equal(generated, during);
    assert.equal(writes, 0);
    assert.equal(job.pdfPath, undefined);
  }
});
