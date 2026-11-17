import { createHash } from 'node:crypto';
import { open, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';

const rulesUrl = new URL('./data/epi-sizes-catalog.json', import.meta.url);
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const familyKey = value => fold(value).replace(/\bNR\s+(\d+)\b/g, 'NR$1').replace(/[^A-Z0-9]+/g, ' ').trim();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const catalogFields = ['name', 'ca', 'hasSizes', 'sizes', 'isActive'];
const recordFields = ['catalogItemId', 'epiName', 'ca', 'size'];
const pick = (row, fields) => Object.fromEntries(fields.map(field => [field, row[field] ?? null]));

export function normalizeSize(value) {
  const text = String(value ?? '').trim();
  const key = fold(text).replace(/^TAM(?:ANHO)?\.?\s*[:=-]?\s*/, '');
  const aliases = { PEQUENA: 'P', PEQUENO: 'P', MEDIA: 'M', MEDIO: 'M', GRANDE: 'G', ESPECIAL: 'Especial', UNICO: 'Único' };
  return aliases[key] || (/^(?:PP|P|M|G|GG|XG|XGG|XXG|G[1-6]|\d{2})$/.test(key) ? key : text);
}

export function splitEpiSize(name) {
  const text = String(name ?? '').trim();
  const match = text.match(/(?:\s*[-–—:]\s*|\s+)(?:(?:TAM(?:ANHO)?\.?|N[º°o.]?|N[ÚU]MERO)\s*[:=-]?\s*)?(PP|P|M|G|GG|XG|XGG|XXG|G[1-6]|ESPECIAL|M[EÉ]DI[AO]|PEQUEN[AO]|GRANDE|[2-6]\d)\s*$/iu);
  if (!match) return { name: text, size: null };
  const base = text.slice(0, match.index).replace(/[\s\-–—:]+$/, '').trim();
  // NR 10, classe 40 and similar model identifiers are not clothing sizes.
  if (!base || (/^\d+$/.test(match[1]) && /\b(?:NR|CA|CLASSE|TIPO|MODELO|INVERNO)$/.test(fold(base)))) {
    return { name: text, size: null };
  }
  return { name: base, size: normalizeSize(match[1]) };
}

function caSize(value) {
  const text = fold(value);
  if (/^(?:(?:TAM(?:ANHO)?\.?)\s*[:=-]?\s*)?(?:PP|P|M|G|GG|XG|XGG|XXG|G[1-6]|ESPECIAL|TAMANHO ESPECIAL|MEDI[AO]|PEQUEN[AO]|GRANDE)$/.test(text)
    || /^TAM(?:ANHO)?\.?\s*[:=-]?\s*[2-6]\d$/.test(text)) return normalizeSize(value);
  return null;
}

function actualCa(value) {
  const text = String(value ?? '').trim();
  return caSize(text) || /^[\s.\-–—]*$/.test(text) ? '' : text;
}

function sortedSizes(values) {
  const sizes = [...new Set(values.filter(Boolean).map(normalizeSize))];
  if (sizes.some(size => size.length > 40) || sizes.length > 100) throw new Error('Lista de tamanhos inválida.');
  const order = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'XXG', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'Especial', 'Único'];
  const rank = size => order.includes(size) ? order.indexOf(size) : 100;
  return sizes.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'pt-BR', { numeric: true }));
}

export function buildEpiSizePlan(snapshot, rules) {
  if (rules.version !== 1 || !Array.isArray(rules.items) || rules.items.some(item => !item.name?.trim()
    || item.name.length > 180 || !Array.isArray(item.sizes) || !item.sizes.length)) throw new Error('Arquivo de regras inválido.');
  const aliases = new Map();
  for (const item of rules.items) {
    for (const name of [item.name, ...(item.aliases || [])]) {
      const key = familyKey(name);
      if (aliases.has(key) && aliases.get(key) !== item) throw new Error(`Alias repetido: ${name}`);
      aliases.set(key, item);
    }
  }
  const family = name => aliases.get(familyKey(name))?.name || name;
  const groups = new Map();
  for (const row of snapshot.catalog) {
    const parsed = splitEpiSize(row.name);
    const name = family(parsed.name);
    const ca = actualCa(row.ca);
    const key = `${familyKey(name)}\0${ca}`;
    if (!groups.has(key)) groups.set(key, { key, name, ca, seed: aliases.get(familyKey(parsed.name)), members: [] });
    groups.get(key).members.push({ row, parsed, caHint: caSize(row.ca) });
  }
  for (const seed of rules.items) {
    if (![...groups.values()].some(group => group.seed === seed)) {
      const key = `${familyKey(seed.name)}\0`;
      groups.set(key, { key, name: seed.name, ca: '', seed, members: [] });
    }
  }

  const plan = { version: 1, catalogInserts: [], catalogUpdates: [], recordUpdates: [], groups: [], blockers: [], warnings: [] };
  const requestById = new Map((snapshot.signatureRequests || []).map(row => [row.id, row]));
  const catalogById = new Map(snapshot.catalog.map(row => [row.id, row]));
  const recordsByCatalog = new Map();
  for (const record of snapshot.records) {
    if (!recordsByCatalog.has(record.catalogItemId)) recordsByCatalog.set(record.catalogItemId, []);
    recordsByCatalog.get(record.catalogItemId).push(record);
  }
  for (const group of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    if (!group.seed && !group.members.some(({ row, parsed, caHint }) => row.hasSizes || parsed.size || caHint
      || (recordsByCatalog.get(row.id) || []).some(record => record.size || splitEpiSize(record.epiName).size || caSize(record.ca)))) continue;
    const members = [...group.members].sort((a, b) => {
      const rank = ({ row, parsed, caHint }) => (row.name === group.name && row.ca === group.ca ? 100 : 0)
        + (!parsed.size && !caHint ? 20 : 0) + (row.isActive ? 10 : 0);
      return rank(b) - rank(a) || a.row.id.localeCompare(b.row.id);
    });
    const targetId = members[0]?.row.id || `epi-size-${digest(group.key).slice(0, 24)}`;
    const name = group.seed?.name || members.find(member => !member.parsed.size)?.parsed.name || group.name;
    const sizes = [...(group.seed?.sizes || []), ...members.flatMap(({ row, parsed, caHint }) => [...(row.sizes || []), parsed.size, caHint])];
    const unknownSizeRecordIds = [];
    const signedRecordIds = [];
    for (const member of members) {
      for (const record of recordsByCatalog.get(member.row.id) || []) {
        const parsed = splitEpiSize(record.epiName);
        const recordFamily = familyKey(family(parsed.name));
        if (familyKey(record.epiName).startsWith('USADO ') !== familyKey(group.name).startsWith('USADO ')) {
          plan.blockers.push({ recordId: record.id, reason: 'Condição usado/novo da ficha difere do catálogo.' });
          continue;
        }
        if (recordFamily !== familyKey(group.name)) {
          // The existing FK establishes identity even if the catalog was renamed later.
          plan.warnings.push({ recordId: record.id, reason: 'Nome histórico será alinhado ao catálogo já vinculado.', originalName: record.epiName, catalogName: name });
        }
        const hints = sortedSizes([record.size, parsed.size, caSize(record.ca), member.parsed.size, member.caHint]);
        if (hints.length > 1) {
          plan.blockers.push({ recordId: record.id, reason: 'Tamanhos conflitantes entre ficha, nome e CA.', sizes: hints });
          continue;
        }
        const recordCa = actualCa(record.ca);
        if (recordCa && recordCa !== group.ca) {
          plan.blockers.push({ recordId: record.id, reason: 'CA real da ficha difere do CA do catálogo; não sobrescrever.', ca: recordCa, catalogCa: group.ca });
          continue;
        }
        const size = hints[0] || null;
        if (size) sizes.push(size);
        else unknownSizeRecordIds.push(record.id);
        const before = pick(record, recordFields);
        const after = { catalogItemId: targetId, epiName: name, ca: group.ca, size };
        const request = requestById.get(record.signatureRequestId);
        const signed = Boolean(record.signedAt || record.hasSignatureImage || request?.status === 'SIGNED' || request?.signedAt);
        if (!isDeepStrictEqual(before, after)) {
          plan.recordUpdates.push({ id: record.id, before, after, signed });
          if (signed) signedRecordIds.push(record.id);
        }
      }
    }
    const available = sortedSizes(sizes);
    if (!available.length) {
      plan.blockers.push({ catalogItemId: targetId, reason: 'EPI com tamanhos habilitados sem nenhum tamanho conhecido.' });
      continue;
    }
    const after = { name, ca: group.ca, hasSizes: true, sizes: available, isActive: Boolean(group.seed || members.some(member => member.row.isActive)) };
    if (!members.length) plan.catalogInserts.push({ id: targetId, ...after });
    else {
      const before = pick(members[0].row, catalogFields);
      if (!isDeepStrictEqual(before, after)) plan.catalogUpdates.push({ id: targetId, before, after });
      for (const member of members.slice(1)) {
        if (member.row.isActive) plan.catalogUpdates.push({ id: member.row.id, before: pick(member.row, catalogFields), after: { ...pick(member.row, catalogFields), isActive: false } });
      }
    }
    plan.groups.push({ targetId, name, ca: group.ca, sizes: available,
      sources: members.map(({ row, parsed, caHint }) => ({ id: row.id, name: row.name, ca: row.ca, inferredSize: parsed.size || caHint })),
      fromImage: Boolean(group.seed), unknownSizeRecordIds, signedRecordIds });
    const additional = group.seed ? available.filter(size => !sortedSizes(group.seed.sizes).includes(size)) : [];
    if (additional.length) plan.warnings.push({ name, reason: 'Tamanhos históricos além da imagem foram preservados.', sizes: additional });
  }
  // Never strand a delivery whose catalog was removed manually.
  for (const record of snapshot.records) {
    if (record.catalogItemId && !catalogById.has(record.catalogItemId)) plan.blockers.push({ recordId: record.id, reason: 'Referência de catálogo inexistente.' });
    if (!record.catalogItemId && (splitEpiSize(record.epiName).size || caSize(record.ca) || aliases.has(familyKey(record.epiName)))) {
      plan.blockers.push({ recordId: record.id, reason: 'Ficha sem vínculo no catálogo; associar explicitamente antes da consolidação.' });
    }
  }
  const projected = new Map(snapshot.catalog.map(row => [row.id, pick(row, catalogFields)]));
  for (const update of plan.catalogUpdates) projected.set(update.id, update.after);
  for (const insert of plan.catalogInserts) {
    if (projected.has(insert.id)) plan.blockers.push({ catalogItemId: insert.id, reason: 'ID de criação já existe.' });
    projected.set(insert.id, pick(insert, catalogFields));
  }
  const unique = new Set();
  for (const row of projected.values()) {
    const key = JSON.stringify([row.name, row.ca]);
    if (unique.has(key)) plan.blockers.push({ name: row.name, ca: row.ca, reason: 'Conflito na chave única nome/CA.' });
    unique.add(key);
  }
  for (const field of ['catalogInserts', 'catalogUpdates', 'recordUpdates']) plan[field].sort((a, b) => a.id.localeCompare(b.id));
  plan.hash = digest(plan);
  return plan;
}

export async function readEpiSnapshot(client) {
  const catalog = (await client.query('SELECT * FROM "EpiCatalogItem" ORDER BY id')).rows;
  const records = (await client.query(`SELECT id, "catalogItemId", "epiName", ca, size, quantity, "lendDate", "devolutionDate",
    "signedAt", "archivedAt", "pendingReturn", "returnSourceRecordId", "signatureRequestId", "createdAt", "updatedAt", "createdByUserId",
    md5(coalesce("signatureImageDataUrl", '')) AS "signatureImageHash", "signatureSignerName",
    ("signatureImageDataUrl" IS NOT NULL) AS "hasSignatureImage" FROM "EpiRecord" ORDER BY id`)).rows;
  const signatureRequests = (await client.query(`SELECT id, status, "signedAt", ("signedPdfPath" IS NOT NULL) AS "hasSignedPdf"
    FROM "EpiSignatureRequest" ORDER BY id`)).rows;
  return { catalog, records, signatureRequests };
}

export async function applyEpiSizePlan(client, plan) {
  if (plan.blockers.length) throw new Error('Plano bloqueado; nenhuma correção pode ser aplicada.');
  // Retire legacy choices without deleting rows or changing their identifying keys.
  const updates = [...plan.catalogUpdates].sort((a, b) => Number(a.after.isActive) - Number(b.after.isActive));
  for (const row of plan.catalogInserts) {
    await client.query(`INSERT INTO "EpiCatalogItem" (id, name, ca, "hasSizes", sizes, "isActive", "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`, [row.id, row.name, row.ca, row.hasSizes, row.sizes, row.isActive]);
  }
  for (const { id, after } of updates) {
    const result = await client.query(`UPDATE "EpiCatalogItem" SET name=$2, ca=$3, "hasSizes"=$4, sizes=$5, "isActive"=$6, "updatedAt"=NOW() WHERE id=$1 RETURNING id`,
      [id, after.name, after.ca, after.hasSizes, after.sizes, after.isActive]);
    if (result.rows.length !== 1) throw new Error(`Catálogo não encontrado: ${id}`);
  }
  for (const { id, after } of plan.recordUpdates) {
    const result = await client.query(`UPDATE "EpiRecord" SET "catalogItemId"=$2, "epiName"=$3, ca=$4, size=$5, "updatedAt"=NOW() WHERE id=$1 RETURNING id`,
      [id, after.catalogItemId, after.epiName, after.ca, after.size]);
    if (result.rows.length !== 1) throw new Error(`Ficha não encontrada: ${id}`);
  }
}

export function verifyEpiSizeResult(before, after, plan, rules) {
  const expectedCatalog = new Map(before.catalog.map(row => [row.id, pick(row, catalogFields)]));
  for (const row of plan.catalogUpdates) expectedCatalog.set(row.id, row.after);
  for (const row of plan.catalogInserts) expectedCatalog.set(row.id, pick(row, catalogFields));
  if (after.catalog.length !== expectedCatalog.size) throw new Error('Contagem do catálogo divergiu.');
  for (const row of after.catalog) {
    if (!isDeepStrictEqual(pick(row, catalogFields), expectedCatalog.get(row.id))) throw new Error(`Catálogo divergente: ${row.id}`);
  }
  const changes = new Map(plan.recordUpdates.map(row => [row.id, row.after]));
  const stableRecord = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'updatedAt'));
  const expectedRecords = new Map(before.records.map(row => [row.id, { ...stableRecord(row), ...(changes.get(row.id) || {}) }]));
  if (after.records.length !== expectedRecords.size) throw new Error('Quantidade de fichas mudou.');
  for (const row of after.records) {
    if (!isDeepStrictEqual(stableRecord(row), expectedRecords.get(row.id))) throw new Error(`Dados históricos da ficha divergiram: ${row.id}`);
  }
  const rerun = buildEpiSizePlan(after, rules);
  if (rerun.blockers.length || rerun.catalogInserts.length || rerun.catalogUpdates.length || rerun.recordUpdates.length) {
    throw new Error('Verificação de idempotência falhou; a transação será desfeita.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--apply', '--dry-run', '--help'].includes(arg)) flags.add(arg);
    else if (['--input', '--report', '--backup', '--expect-plan', '--rules'].includes(arg) && args[index + 1] && !args[index + 1].startsWith('--')) values.set(arg, args[++index]);
    else throw new Error(`Argumento inválido: ${arg}`);
  }
  if (flags.has('--help')) {
    console.log('Prévia: node scripts/consolidate-epi-sizes.js [--input snapshot.json] [--report plano.json]\nAplicação: node scripts/consolidate-epi-sizes.js --apply --expect-plan HASH --backup /diretorio/novo-backup.json');
    return;
  }
  const apply = flags.has('--apply');
  if (apply && (flags.has('--dry-run') || values.has('--input') || !values.get('--backup') || !values.get('--expect-plan'))) {
    throw new Error('--apply exige --backup e --expect-plan, e não aceita --input/--dry-run.');
  }
  const rules = JSON.parse(await readFile(values.get('--rules') || rulesUrl, 'utf8'));
  let client;
  try {
    let snapshot;
    if (values.has('--input')) snapshot = JSON.parse(await readFile(values.get('--input'), 'utf8'));
    else {
      await import('dotenv/config');
      if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL para o banco desejado.');
      const { Client } = await import('pg');
      client = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'manual-epi-size-consolidation' });
      await client.connect();
      await client.query(apply ? 'BEGIN' : 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';");
      if (apply) await client.query('LOCK TABLE "EpiCatalogItem", "EpiRecord" IN SHARE ROW EXCLUSIVE MODE');
      snapshot = await readEpiSnapshot(client);
    }
    const plan = buildEpiSizePlan(snapshot, rules);
    if (values.has('--report')) await writeFile(values.get('--report'), JSON.stringify(plan, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', hash: plan.hash, catalogItems: snapshot.catalog.length, records: snapshot.records.length,
      catalogToCreate: plan.catalogInserts.length, catalogToUpdate: plan.catalogUpdates.length, recordsToUpdate: plan.recordUpdates.length,
      signedRecordsToNormalize: plan.recordUpdates.filter(row => row.signed).length,
      historicalRecordsWithoutSize: plan.groups.reduce((sum, group) => sum + group.unknownSizeRecordIds.length, 0),
      blockers: plan.blockers, warnings: plan.warnings, groups: plan.groups.map(({ name, ca, sizes }) => ({ name, ca, sizes })) }, null, 2));
    if (plan.blockers.length) throw new Error('Há bloqueios no plano. Revise o relatório; nenhuma escrita foi feita.');
    if (apply) {
      if (values.get('--expect-plan') !== plan.hash) throw new Error('Plano mudou desde a prévia; gere e revise outra prévia.');
      const backup = await open(values.get('--backup'), 'wx', 0o600);
      try {
        await backup.writeFile(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), plan,
          originalCatalog: snapshot.catalog.filter(row => plan.catalogUpdates.some(update => update.id === row.id)),
          originalRecords: snapshot.records.filter(row => plan.recordUpdates.some(update => update.id === row.id)) }, null, 2) + '\n');
        await backup.sync();
      } finally { await backup.close(); }
      await applyEpiSizePlan(client, plan);
      verifyEpiSizeResult(snapshot, await readEpiSnapshot(client), plan, rules);
      await client.query('COMMIT');
      console.log('Correção confirmada. Assinaturas, PDFs e hashes existentes foram preservados.');
    } else if (client) await client.query('ROLLBACK');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client?.end(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
