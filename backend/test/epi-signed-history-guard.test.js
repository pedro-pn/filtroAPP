import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { assertCanDeleteEpiRecord, assertCanUpdateEpiRecord } from '../src/routes/resources/epis.js';

// Pilar 9.2: ficha de EPI assinada é guardada por 20 anos (NR-6, item 6.6.1 "h").
// A trigger da migration roda aqui num PostgreSQL de verdade (PGlite, em memória).

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const MIGRATION = read('backend/prisma/migrations/20261119150000_epi_signed_history_guard/migration.sql');
const LOCKED = /EPI_SIGNED_HISTORY_LOCKED/;

async function database() {
  const db = new PGlite();
  // Só as colunas que a guarda usa; o resto do schema não importa aqui.
  await db.exec(`
    CREATE TABLE "EpiSignatureRequest" (
      id text PRIMARY KEY, status text NOT NULL DEFAULT 'PENDING', "signedAt" timestamptz,
      "signatureImageDataUrl" text, "signatureImageHash" text, "signedPdfPath" text,
      "signedPdfHash" text, "ipAddress" text, "tokenHash" text
    );
    CREATE TABLE "EpiRecord" (
      id text PRIMARY KEY, "epiName" text NOT NULL, "lendDate" timestamptz NOT NULL,
      "signedAt" timestamptz, "signatureImageDataUrl" text, "signatureSignerName" text,
      "archivedAt" timestamptz, "signatureRequestId" text REFERENCES "EpiSignatureRequest"(id) ON DELETE SET NULL
    );
  `);
  await db.exec(MIGRATION);
  await db.exec(`
    INSERT INTO "EpiSignatureRequest" (id, status, "signedAt", "signatureImageDataUrl", "signedPdfPath", "signedPdfHash")
      VALUES ('req-signed', 'SIGNED', now() - interval '1 year', 'data:image/png;base64,x', '/data/epi/a.pdf', 'hash'),
             ('req-pending', 'PENDING', NULL, NULL, NULL, NULL),
             ('req-old', 'SIGNED', now() - interval '21 years', 'data:image/png;base64,x', '/data/epi/old.pdf', 'hash');
    INSERT INTO "EpiRecord" (id, "epiName", "lendDate", "signedAt", "signatureImageDataUrl", "signatureRequestId")
      VALUES ('signed', 'Luva', now() - interval '1 year', now() - interval '1 year', 'data:image/png;base64,x', 'req-signed'),
             ('unsigned', 'Óculos', now(), NULL, NULL, 'req-pending'),
             ('old', 'Capacete', now() - interval '21 years', now() - interval '21 years', 'data:image/png;base64,x', 'req-old');
  `);
  return db;
}

const count = async (db, table, id) => (await db.query(`SELECT count(*)::int AS n FROM "${table}" WHERE id = $1`, [id])).rows[0].n;

test('signed EPI deliveries younger than 20 years cannot be deleted or lose their signature', async () => {
  const db = await database();
  try {
    await assert.rejects(db.exec(`DELETE FROM "EpiRecord" WHERE id = 'signed'`), LOCKED);
    await assert.rejects(db.exec(`UPDATE "EpiRecord" SET "signatureImageDataUrl" = NULL WHERE id = 'signed'`), LOCKED);
    await assert.rejects(db.exec(`UPDATE "EpiRecord" SET "signedAt" = NULL WHERE id = 'signed'`), LOCKED);
    assert.equal(await count(db, 'EpiRecord', 'signed'), 1);

    // Arquivar e corrigir dados descritivos continuam permitidos.
    await db.exec(`UPDATE "EpiRecord" SET "archivedAt" = now(), "epiName" = 'Luva nitrílica' WHERE id = 'signed'`);
    // Entrega não assinada e entrega assinada com mais de 20 anos podem sair.
    await db.exec(`DELETE FROM "EpiRecord" WHERE id IN ('unsigned', 'old')`);
    assert.equal(await count(db, 'EpiRecord', 'unsigned'), 0);
    assert.equal(await count(db, 'EpiRecord', 'old'), 0);
  } finally {
    await db.close();
  }
});

test('signed signature requests keep their PDF, hashes and image for 20 years', async () => {
  const db = await database();
  try {
    await assert.rejects(db.exec(`DELETE FROM "EpiSignatureRequest" WHERE id = 'req-signed'`), LOCKED);
    for (const change of [`"signedPdfPath" = NULL`, `"signedPdfHash" = 'other'`, `"signatureImageDataUrl" = NULL`, `"signedAt" = NULL`]) {
      await assert.rejects(db.exec(`UPDATE "EpiSignatureRequest" SET ${change} WHERE id = 'req-signed'`), LOCKED, change);
    }
    // Dados que não são evidência (ex.: IP anonimizado pela retenção) podem mudar.
    await db.exec(`UPDATE "EpiSignatureRequest" SET "ipAddress" = NULL WHERE id = 'req-signed'`);
    await db.exec(`DELETE FROM "EpiSignatureRequest" WHERE id IN ('req-pending', 'req-old')`);
    assert.equal(await count(db, 'EpiSignatureRequest', 'req-signed'), 1);
  } finally {
    await db.close();
  }
});

test('TRUNCATE is refused; the documented override only works inside its transaction', async () => {
  const db = await database();
  try {
    await assert.rejects(db.exec(`TRUNCATE "EpiRecord"`), LOCKED);
    await db.exec(`BEGIN; SET LOCAL filtrovali.epi_history_override = 'teste'; UPDATE "EpiRecord" SET "signatureImageDataUrl" = NULL WHERE id = 'signed'; COMMIT;`);
    // Fora da transação a guarda volta a valer.
    await assert.rejects(db.exec(`DELETE FROM "EpiSignatureRequest" WHERE id = 'req-signed'`), LOCKED);
  } finally {
    await db.close();
  }
});

test('staging anonymization and sync set the override inside their own transaction', () => {
  for (const [file, marker] of [
    ['deploy/db/anonymize-staging.sql', 'BEGIN;'],
    ['deploy/sync-staging.sh', '<<SQL\nBEGIN;']
  ]) {
    const text = read(file);
    const begin = text.indexOf(marker);
    const override = text.indexOf("SET LOCAL filtrovali.epi_history_override", begin);
    assert.ok(begin >= 0 && override > begin, `${file}: override must be set right after BEGIN`);
    assert.ok(override - begin < 300, `${file}: override must be at the start of the transaction`);
  }
});

test('LGPD retention code never deletes EPI deliveries or signature requests', () => {
  const files = ['backend/src/lib/data-retention.js', ...fs.readdirSync(new URL('../src/lib/privacy/', import.meta.url))
    .filter(name => name.endsWith('.js')).map(name => `backend/src/lib/privacy/${name}`)];
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /\b(epiRecord|epiSignatureRequest)\.(delete|deleteMany|update|updateMany)\b/, `${file} must not touch EPI fichas`);
    assert.doesNotMatch(text, /(DELETE FROM|TRUNCATE)\s+"Epi(Record|SignatureRequest)"/, `${file} must not delete EPI fichas`);
  }
});

test('API refusals cite the 20-year NR-6 retention', () => {
  const signed = { signedAt: new Date(), signatureImageDataUrl: 'data:image/png;base64,x', pendingReturn: false };
  for (const guard of [assertCanDeleteEpiRecord, assertCanUpdateEpiRecord]) {
    assert.throws(() => guard(signed), error => error.statusCode === 409
      && error.code === 'EPI_SIGNED_HISTORY_LOCKED' && /20 anos \(NR-6\)/.test(error.message));
  }
});
