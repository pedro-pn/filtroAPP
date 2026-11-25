import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import env from '../src/config/env.js';
import app from '../src/app.js';
import prisma from '../src/lib/prisma.js';
import { CLIENT_PRIVACY_NOTICE_VERSION } from '../src/lib/privacy-consent.js';
import { PGlite } from '@electric-sql/pglite';
import { accessOf, normalizeQrAccess, buildPublicQrPage, buildQrLinkSettings, resolveQrDownload } from '../src/lib/equipamentos/qr-link.js';

const token = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const equipment = { id: 'eq', name: 'Compressor', code: 'CMR 001', isActive: true, updatedAt: new Date(), category: {
    name: 'Compressores', updatedAt: new Date(), functioningChecklist: { format: 'MONTHLY', items: ['Mangueiras'] }
  }, attachments: [{ id: 'doc1', kind: 'DOCUMENT', fileName: 'Interno.pdf', publicToken: 'file', createdAt: new Date() }] };
  let maintenance = { attachments: [{ kind: 'DOCUMENT', storagePath: 'Equipamentos/Manutenções/a.pdf', fileName: 'Manutenção recente.pdf', createdAt: new Date() }] };
  let maintenanceQuery;
  const client = {
    companyEquipment: { findUnique: async () => equipment },
    romaneioCatalogItem: { findUnique: async () => ({ isActive: true, sourceType: 'EQUIPAMENTOS', sourceId: 'eq', publicToken: token }), findFirst: async () => ({ publicToken: token }) },
    maintenanceRecord: { findFirst: async args => { maintenanceQuery = args; return maintenance; } }
  };
  return { equipment, client, setMaintenance: value => { maintenance = value; }, getQuery: () => maintenanceQuery };
}

test('padrões do QR e normalização preservam PUBLIC explícito de arquivo e ocultam novos anexos', () => {
  for (const key of ['manual', 'datasheet', 'checklist', 'maintenance']) assert.equal(accessOf({}, key), 'PUBLIC');
  assert.equal(accessOf({}, 'doc:old'), 'HIDDEN');
  const modes = normalizeQrAccess({ 'doc:old': 'PUBLIC', manual: 'PUBLIC', checklist: 'LOGIN', maintenance: 'HIDDEN', invalid: 'PUBLIC' });
  assert.deepEqual(modes, { 'doc:old': 'PUBLIC', checklist: 'LOGIN', maintenance: 'HIDDEN' });
  assert.equal(accessOf(modes, 'doc:old'), 'PUBLIC');
  assert.equal(accessOf(modes, 'doc:new'), 'HIDDEN');
});

test('QR expõe checklist e somente documento da última manutenção aprovada; acompanha novos registros', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-maintenance-'));
  const previousDir = env.uploadDir;
  env.uploadDir = directory;
  t.after(async () => { env.uploadDir = previousDir; await fs.rm(directory, { recursive: true, force: true }); });
  await fs.mkdir(path.join(directory, 'Equipamentos/Manutenções'), { recursive: true });
  await fs.writeFile(path.join(directory, 'Equipamentos/Manutenções/nova.pdf'), '%PDF-1.4');
  const f = fixture();
  const page = await buildPublicQrPage(f.client, token);
  assert.deepEqual(page.documents.map(doc => doc.key), ['checklist', 'maintenance']);
  assert.match(page.documents[0].url, /checklist\/publico$/);
  assert.match(page.documents[0].spreadsheetDownloadPath, /checklist\/planilha$/);
  assert.deepEqual(f.getQuery().where, { equipmentId: 'eq', status: 'APPROVED' });
  assert.equal(f.getQuery().orderBy[0].maintenanceDate, 'desc');
  assert.deepEqual(f.getQuery().select.attachments.where, { kind: 'DOCUMENT' });
  f.setMaintenance({ attachments: [{ kind: 'DOCUMENT', fileName: 'Manutenção nova.pdf', storagePath: 'Equipamentos/Manutenções/nova.pdf' }] });
  assert.equal((await buildPublicQrPage(f.client, token)).documents.at(-1).fileName, 'Manutenção nova.pdf');
  assert.match((await resolveQrDownload(f.client, token, 'maintenance', { publicOnly: true })).targetPath, /nova\.pdf$/);
  f.setMaintenance({ attachments: [] });
  assert.deepEqual((await buildPublicQrPage(f.client, token)).documents.map(doc => doc.key), ['checklist']);
});

test('QR respeita HIDDEN/LOGIN no download e nunca gera planilha pública', async () => {
  const { client, equipment } = fixture();
  equipment.qrDocumentAccess = { checklist: 'LOGIN', maintenance: 'HIDDEN' };
  const page = await buildPublicQrPage(client, token);
  assert.equal(page.documents.length, 1);
  assert.equal(page.documents[0].url, null);
  assert.equal(page.documents[0].requiresLogin, true);
  assert.equal(await resolveQrDownload(client, token, 'checklist', { publicOnly: true }), null);
  assert.equal(await resolveQrDownload(client, token, 'checklist', { publicOnly: true, spreadsheet: true }), null);
  assert.equal(await resolveQrDownload(client, token, 'maintenance'), null);
  const sheet = await resolveQrDownload(client, token, 'checklist', { spreadsheet: true });
  assert.equal(sheet.bytes.subarray(0, 2).toString(), 'PK');
  const settings = await buildQrLinkSettings(client, 'eq');
  assert.equal(settings.documents.find(doc => doc.key === 'doc:doc1').access, 'HIDDEN');
  assert.equal(settings.documents.find(doc => doc.key === 'maintenance').access, 'HIDDEN');
  equipment.qrDocumentAccess.checklist = 'HIDDEN';
  assert.equal(await resolveQrDownload(client, token, 'checklist', { spreadsheet: true }), null);
  equipment.isActive = false;
  assert.equal(await buildPublicQrPage(client, token), null);
});

test('migration aplica padrões aos arquivos existentes preservando configuração de certificado', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE "EquipmentCategory" (id TEXT PRIMARY KEY);
      CREATE TABLE "CompanyEquipment" (id TEXT PRIMARY KEY, "qrDocumentAccess" JSONB NOT NULL DEFAULT '{}');
      CREATE TABLE "EquipmentAttachment" (id TEXT PRIMARY KEY, "equipmentId" TEXT, kind TEXT);
      INSERT INTO "EquipmentCategory" VALUES ('cat');
      INSERT INTO "CompanyEquipment" VALUES ('eq', '{"manual":"LOGIN","datasheet":"HIDDEN","certificate":"LOGIN","doc:old":"PUBLIC"}');
      INSERT INTO "EquipmentAttachment" VALUES ('old','eq','DOCUMENT'),('other','eq','CALIBRATION_CERTIFICATE');`);
    await db.exec(await fs.readFile(new URL('../prisma/migrations/20261125120000_equipment_functioning_checklist/migration.sql', import.meta.url), 'utf8'));
    const rows = await db.query('SELECT * FROM "CompanyEquipment"');
    assert.deepEqual(rows.rows[0].qrDocumentAccess, { certificate: 'LOGIN', 'doc:old': 'HIDDEN' });
    assert.equal(rows.rows[0].functioningChecklist, null);
    const cat = await db.query('SELECT * FROM "EquipmentCategory"');
    assert.deepEqual(cat.rows[0].functioningChecklist, { format: 'MONTHLY', items: [] });
  } finally { await db.close(); }
});

test('HTTP: PDF público e XLSX somente com sessão interna; URL alternativa não libera planilha', async t => {
  const f = fixture();
  for (const [model, method, implementation] of [
    ['companyEquipment', 'findUnique', f.client.companyEquipment.findUnique],
    ['romaneioCatalogItem', 'findUnique', f.client.romaneioCatalogItem.findUnique],
    ['maintenanceRecord', 'findFirst', f.client.maintenanceRecord.findFirst],
    ['userSession', 'findUnique', async () => ({
      id: 'session', expiresAt: new Date(Date.now() + 60000),
      user: { id: 'user', name: 'Usuário', username: 'user', role: 'MANAGER', accountType: accountType,
        moduleRoles: [], collaborator: null, isActive: true,
        privacyPolicyAcceptedAt: new Date(), privacyPolicyVersion: CLIENT_PRIVACY_NOTICE_VERSION }
    })]
  ]) {
    const original = prisma[model][method];
    prisma[model][method] = implementation;
    t.after(() => { prisma[model][method] = original; });
  }
  let accountType = 'INTERNAL';
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/equipamentos-qr/${token}/documentos/checklist`;
  const pdf = await fetch(`${base}/publico`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  assert.equal((await fetch(`${base}/planilha`)).status, 401);
  assert.equal((await fetch(`${base}/publico?spreadsheet=true`)).headers.get('content-type'), 'application/pdf');
  const headers = { Cookie: 'fv_session=internal-session' };
  const xlsx = await fetch(`${base}/planilha`, { headers });
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get('content-type'), /spreadsheetml/);
  assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  accountType = 'CLIENT';
  assert.equal((await fetch(`${base}/planilha`, { headers })).status, 403);
  f.equipment.qrDocumentAccess = { checklist: 'HIDDEN' };
  assert.equal((await fetch(`${base}/publico`)).status, 404);
});
