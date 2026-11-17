import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyEpiSizePlan, buildEpiSizePlan, normalizeSize, readEpiSnapshot, splitEpiSize, verifyEpiSizeResult } from '../scripts/consolidate-epi-sizes.js';

const rules = JSON.parse(await readFile(new URL('../scripts/data/epi-sizes-catalog.json', import.meta.url), 'utf8'));
const noSeeds = { version: 1, items: [] };
const item = (id, name, ca = '', extra = {}) => ({ id, name, ca, hasSizes: false, sizes: [], isActive: true, ...extra });
const record = (id, catalogItemId, epiName, ca = '', extra = {}) => ({
  id, catalogItemId, epiName, ca, size: null, signedAt: null, signatureRequestId: null, hasSignatureImage: false, ...extra
});

test('EPI consolidation distinguishes sizes from NR/model identifiers and accepts number/CA spellings', () => {
  assert.deepEqual(splitEpiSize('Macacão NR 10'), { name: 'Macacão NR 10', size: null });
  assert.deepEqual(splitEpiSize('MOLETOM UNISSEX - INVERNO 2026'), { name: 'MOLETOM UNISSEX - INVERNO 2026', size: null });
  for (const name of ['Botina Miura 41', 'Botina Miura Nº 41', 'Botina Miura N° 41', 'Botina Miura TAM 41']) {
    assert.deepEqual(splitEpiSize(name), { name: 'Botina Miura', size: '41' });
  }
  assert.deepEqual(splitEpiSize('Luva nitrílica média'), { name: 'Luva nitrílica', size: 'M' });
  assert.deepEqual(splitEpiSize('USADO - Jaqueta - GG'), { name: 'USADO - Jaqueta', size: 'GG' });
  assert.equal(normalizeSize('TAMANHO ESPECIAL'), 'Especial');
});

test('EPI consolidation combines named and misplaced CA sizes while retaining different real CAs', () => {
  const snapshot = { catalog: [item('base', 'Botina Miura', '32494'), item('sized', 'Botina Miura 45', '32494'),
    item('other-ca', 'Botina Miura 40', '99999'), item('shirt', 'Camisa', '------'), item('shirt-m', 'Camisa', 'TAM M')],
  records: [record('r1', 'base', 'Botina Miura Nº 41', '32494'), record('r2', 'sized', 'Botina Miura 45', '32494'),
    record('r3', 'shirt-m', 'Camisa', 'TAM M')] };
  const plan = buildEpiSizePlan(snapshot, noSeeds);
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.groups.find(row => row.ca === '32494').sizes, ['41', '45']);
  assert.equal(plan.groups.filter(row => row.name === 'Botina Miura').length, 2);
  assert.deepEqual(plan.recordUpdates.find(row => row.id === 'r2').after, { catalogItemId: 'base', epiName: 'Botina Miura', ca: '32494', size: '45' });
  assert.equal(plan.recordUpdates.find(row => row.id === 'r3').after.ca, '');
  assert.equal(plan.recordUpdates.find(row => row.id === 'r3').after.size, 'M');
  assert.equal(plan.catalogUpdates.find(row => row.id === 'sized').after.isActive, false);
});

test('EPI consolidation includes all 17 image items and preserves used/gender/material/season variants', () => {
  const snapshot = { catalog: [item('jacket', 'JAQUETA IMPERMEAVEL', 'XG'), item('generic', 'Jaqueta - M'),
    item('sweatshirt', 'MOLETOM UNISSEX', 'GG'), item('nr10', 'Macacão NR10', '44290')], records: [] };
  const plan = buildEpiSizePlan(snapshot, rules);
  assert.deepEqual(plan.blockers, []);
  assert.equal(rules.items.length, 17);
  for (const seed of rules.items) assert.ok(plan.groups.some(group => group.name === seed.name));
  assert.deepEqual(plan.groups.find(row => row.name === 'JAQUETA IMPERMEÁVEL').sizes, ['P', 'M', 'G', 'GG', 'XG']);
  assert.deepEqual(plan.groups.find(row => row.name === 'Jaqueta').sizes, ['M']);
  assert.deepEqual(plan.groups.find(row => row.name === 'USADO - JAQUETA IMPERMEÁVEL').sizes, ['P', 'M', 'G']);
  assert.deepEqual(plan.groups.find(row => row.name === 'MOLETOM UNISSEX - INVERNO 2026').sizes, ['GG', 'XG']);
  assert.equal(plan.groups.find(row => row.name === 'MACACÃO NR10').ca, '44290');
  assert.ok(!plan.catalogInserts.some(row => row.name === 'MACACÃO NR10'));
});

test('EPI consolidation does not guess missing historical sizes and trusts an existing FK after catalog rename', () => {
  const snapshot = { catalog: [item('base', 'CALÇA BRIM MASCULINA', '------'), item('sized', 'CALÇA BRIM MASCULINA', 'GG')],
    records: [record('old', 'base', 'CALÇA', '------'), record('known', 'sized', 'CALÇA BRIM MASCULINA', 'GG')] };
  const plan = buildEpiSizePlan(snapshot, noSeeds);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.recordUpdates.find(row => row.id === 'old').after.size, null);
  assert.equal(plan.recordUpdates.find(row => row.id === 'known').after.size, 'GG');
  assert.deepEqual(plan.groups[0].unknownSizeRecordIds, ['old']);
  assert.equal(plan.warnings[0].originalName, 'CALÇA');
});

test('EPI consolidation blocks contradictory sizes, CA changes, used/new mismatches and unlinked deliveries', () => {
  const snapshot = { catalog: [item('base', 'Luva - M', '123')], records: [
    record('size-conflict', 'base', 'Luva - M', '123', { size: 'G' }),
    record('ca-conflict', 'base', 'Luva - M', '456'),
    record('condition-conflict', 'base', 'USADO - Luva - M', '123'),
    record('unlinked', null, 'Luva - M', '123')
  ] };
  const plan = buildEpiSizePlan(snapshot, noSeeds);
  assert.equal(plan.blockers.length, 4);
  assert.equal(plan.recordUpdates.length, 0);
});

test('EPI consolidation uses record-only size hints even without sizes in the catalog', () => {
  const plan = buildEpiSizePlan({ catalog: [item('base', 'Botina', '123')], records: [record('r', 'base', 'Botina Nº 42', '123')] }, noSeeds);
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.groups[0].sizes, ['42']);
  assert.equal(plan.recordUpdates[0].after.size, '42');
});

test('EPI consolidation on PostgreSQL preserves signed evidence, archived and return rows, references and idempotency', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE "EpiCatalogItem" (id text PRIMARY KEY, name text NOT NULL, ca text NOT NULL, "hasSizes" boolean NOT NULL DEFAULT false,
      sizes text[] NOT NULL DEFAULT '{}', "isActive" boolean NOT NULL DEFAULT true, "createdAt" timestamp DEFAULT NOW(), "updatedAt" timestamp DEFAULT NOW(), UNIQUE(name,ca));
    CREATE TABLE "EpiSignatureRequest" (id text PRIMARY KEY, status text, "signedAt" timestamp, "signedPdfPath" text, "signedPdfHash" text);
    CREATE TABLE "EpiRecord" (id text PRIMARY KEY, "catalogItemId" text REFERENCES "EpiCatalogItem"(id), "epiName" text, ca text, size text,
      quantity integer, "lendDate" timestamp, "devolutionDate" timestamp, "signedAt" timestamp, "archivedAt" timestamp,
      "pendingReturn" boolean DEFAULT false, "returnSourceRecordId" text REFERENCES "EpiRecord"(id),
      "signatureRequestId" text REFERENCES "EpiSignatureRequest"(id), "signatureImageDataUrl" text, "signatureSignerName" text,
      "createdAt" timestamp DEFAULT NOW(), "updatedAt" timestamp DEFAULT NOW(), "createdByUserId" text);
    INSERT INTO "EpiCatalogItem" (id,name,ca) VALUES ('base','Camisa',''), ('sized','Camisa - M',''), ('used','USADO - Camisa - G',''), ('other-ca','Camisa - M','12345');
    INSERT INTO "EpiSignatureRequest" VALUES ('signature','SIGNED','2026-11-01','/original.pdf','immutable-sha256');
    INSERT INTO "EpiRecord" (id,"catalogItemId","epiName",ca,quantity,"lendDate","signedAt","signatureRequestId","signatureImageDataUrl","signatureSignerName")
      VALUES ('signed','sized','Camisa - M','',2,'2026-11-01','2026-11-01','signature','original-signature','Pessoa de teste');
    INSERT INTO "EpiRecord" (id,"catalogItemId","epiName",ca,quantity,"lendDate","archivedAt","returnSourceRecordId","pendingReturn")
      VALUES ('return','sized','Camisa - M','',2,'2026-11-01','2026-11-02','signed',true);
    INSERT INTO "EpiRecord" (id,"catalogItemId","epiName",ca,quantity,"lendDate") VALUES ('unknown','base','Camisa','',1,'2026-11-01');
  `);
  const signatureBefore = (await db.query('SELECT * FROM "EpiSignatureRequest"')).rows;
  const before = await readEpiSnapshot(db);
  const plan = buildEpiSizePlan(before, noSeeds);
  assert.equal(plan.recordUpdates.filter(row => row.signed).length, 1);
  assert.deepEqual(plan.blockers, []);
  await db.exec('BEGIN');
  await applyEpiSizePlan(db, plan);
  const after = await readEpiSnapshot(db);
  verifyEpiSizeResult(before, after, plan, noSeeds);
  await db.exec('COMMIT');
  assert.equal(after.records.length, 3);
  assert.equal(after.records.find(row => row.id === 'signed').catalogItemId, 'base');
  assert.equal(after.records.find(row => row.id === 'signed').size, 'M');
  assert.equal(after.records.find(row => row.id === 'return').returnSourceRecordId, 'signed');
  assert.equal(after.records.find(row => row.id === 'return').pendingReturn, true);
  assert.equal(after.records.find(row => row.id === 'unknown').size, null);
  assert.deepEqual((await db.query('SELECT * FROM "EpiSignatureRequest"')).rows, signatureBefore);
  assert.equal((await db.query('SELECT "signatureImageDataUrl" FROM "EpiRecord" WHERE id=$1', ['signed'])).rows[0].signatureImageDataUrl, 'original-signature');
  const rerun = buildEpiSizePlan(after, noSeeds);
  assert.deepEqual([rerun.catalogInserts.length, rerun.catalogUpdates.length, rerun.recordUpdates.length], [0, 0, 0]);
  const modifiedHistory = structuredClone(after);
  modifiedHistory.records[0].quantity = 999;
  assert.throws(() => verifyEpiSizeResult(before, modifiedHistory, plan, noSeeds), /históricos/);
  // A failure after the first INSERT must leave no partial correction behind.
  const invalid = { ...rerun, catalogInserts: [item('partial', 'Não deve persistir')], recordUpdates: [
    { id: 'missing-record', after: { catalogItemId: 'partial', epiName: 'Não deve persistir', ca: '', size: null } }
  ] };
  await db.exec('BEGIN');
  await assert.rejects(() => applyEpiSizePlan(db, invalid), /Ficha não encontrada/);
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT id FROM "EpiCatalogItem" WHERE id=$1', ['partial'])).rows.length, 0);
  assert.deepEqual(await readEpiSnapshot(db), after);
});
