import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import nodemailer from 'nodemailer';

import env from '../src/config/env.js';
import { buildEquipmentCreatedEmailTemplate } from '../src/lib/email-templates.js';
import { notifyEquipmentCreated, notifyEquipmentCreatedSafely } from '../src/lib/equipamentos/created-notification.js';
import { activeRecipientEmails, normalizeNotificationConfig, updateEquipmentNotificationConfig } from '../src/lib/equipment-notifications.js';
import prisma from '../src/lib/prisma.js';
import router from '../src/routes/resources/equipamentos.js';
import { requireEquipamentosManager } from '../src/middleware/auth.js';

const equipment = { id: 'eq-1', code: 'B-01', name: 'Bomba principal', category: { name: 'Bombas' } };
const preferences = { notifyCalibrationReminders: false, notifyCalibrationUpdated: true, notifyEquipmentCreated: true };

function clientFor({ config = { notifyOnEquipmentCreated: true }, recipients = [] } = {}) {
  return {
    equipmentNotificationConfig: { findFirst: async () => config },
    equipmentNotificationRecipient: { findMany: async () => recipients }
  };
}

function mockMethod(t, target, name, implementation) {
  const original = target[name];
  const mock = t.mock.fn(implementation);
  target[name] = mock;
  t.after(() => { target[name] = original; });
  return mock;
}

function invoke(path, method, body, params = {}) {
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { resolve({ status: this.statusCode, value }); }
    };
    route.stack.at(-1).handle({ body, params }, res, reject);
  });
}

test('migração preserva calibração dos destinatários antigos e exige adesão para cadastro', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE "EquipmentNotificationRecipient" ("id" TEXT PRIMARY KEY, "email" TEXT, "isActive" BOOLEAN DEFAULT true);
    CREATE TABLE "EquipmentNotificationConfig" ("id" TEXT PRIMARY KEY, "enabled" BOOLEAN DEFAULT true);
    INSERT INTO "EquipmentNotificationRecipient" VALUES ('old', 'old@example.com', true), ('inactive', 'inactive@example.com', false);
    INSERT INTO "EquipmentNotificationConfig" VALUES ('default', false);
  `);
  await db.exec(await readFile(new URL('../prisma/migrations/20261120100000_equipment_notification_types/migration.sql', import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO "EquipmentNotificationRecipient" ("id", "email") VALUES ('new', 'new@example.com')`);
  const { rows } = await db.query('SELECT * FROM "EquipmentNotificationRecipient" ORDER BY "id"');
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.notifyCalibrationReminders, true);
    assert.equal(row.notifyCalibrationUpdated, true);
    assert.equal(row.notifyEquipmentCreated, false);
    assert.equal(row.isActive, row.id !== 'inactive');
  }
  assert.deepEqual((await db.query('SELECT * FROM "EquipmentNotificationConfig"')).rows, [
    { id: 'default', enabled: false, notifyOnEquipmentCreated: false }
  ]);
});

test('seleciona destinatários por tipo, normaliza e deduplica e-mails', async () => {
  const client = clientFor({ recipients: [
    { email: ' Antigo@Example.com ', isActive: true },
    { email: 'novo@example.com', isActive: true, ...preferences },
    { email: 'NOVO@example.com', isActive: true, ...preferences },
    { email: 'inativo@example.com', isActive: false, ...preferences },
    { email: 'optout@example.com', isActive: true, notifyCalibrationReminders: false, notifyCalibrationUpdated: false, notifyEquipmentCreated: false }
  ] });
  assert.deepEqual(await activeRecipientEmails(client, 'notifyCalibrationReminders'), ['antigo@example.com']);
  assert.deepEqual(await activeRecipientEmails(client, 'notifyCalibrationUpdated'), ['antigo@example.com', 'novo@example.com']);
  assert.deepEqual(await activeRecipientEmails(client, 'notifyEquipmentCreated'), ['novo@example.com']);
});

test('cadastro envia somente aos destinatários ativos que selecionaram esse aviso', async () => {
  const messages = [];
  const client = clientFor({ config: { enabled: false, notifyOnEquipmentCreated: true }, recipients: [
    { email: 'novo@example.com', isActive: true, notifyEquipmentCreated: true },
    { email: 'calibracao@example.com', isActive: true, notifyEquipmentCreated: false },
    { email: 'inativo@example.com', isActive: false, notifyEquipmentCreated: true }
  ] });
  assert.equal(await notifyEquipmentCreated({ equipment, client, mailer: async message => messages.push(message) }), true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'novo@example.com');
  assert.match(messages[0].text, /Código: B-01/);
  assert.match(messages[0].text, /Nome: Bomba principal/);
  assert.match(messages[0].text, /Categoria: Bombas/);
});

test('cadastro não envia quando desativado ou sem destinatários inscritos', async () => {
  for (const options of [
    { config: null, recipients: [{ email: 'novo@example.com', isActive: true, notifyEquipmentCreated: true }] },
    { config: { notifyOnEquipmentCreated: false }, recipients: [{ email: 'novo@example.com', isActive: true, notifyEquipmentCreated: true }] },
    { recipients: [{ email: 'antigo@example.com', isActive: true }] },
    { recipients: [] }
  ]) {
    assert.equal(await notifyEquipmentCreated({ equipment, client: clientFor(options), mailer: async () => assert.fail('Não deve enviar.') }), false);
  }
});

test('cadastro respeita envio operacional desligado e SMTP ausente', async t => {
  const original = env.sendClientEmails;
  t.after(() => { env.sendClientEmails = original; });
  const client = { equipmentNotificationConfig: { findFirst: async () => assert.fail('Não consulta enquanto SMTP indisponível.') } };
  env.sendClientEmails = false;
  assert.equal(await notifyEquipmentCreated({ equipment, client, missingMailerConfig: [] }), false);
  env.sendClientEmails = true;
  assert.equal(await notifyEquipmentCreated({ equipment, client, missingMailerConfig: ['smtpHost'] }), false);
});

test('falha do e-mail é registrada sem interromper cadastro do equipamento', async t => {
  const log = t.mock.method(console, 'error', () => {});
  const client = clientFor({ recipients: [{ email: 'novo@example.com', isActive: true, notifyEquipmentCreated: true }] });
  assert.equal(await notifyEquipmentCreatedSafely({ equipment, client, mailer: async () => { throw new Error('SMTP indisponível'); } }), false);
  assert.equal(log.mock.callCount(), 1);
  assert.equal(log.mock.calls[0].arguments[1].equipmentId, equipment.id);
});

test('modelo do e-mail escapa dados cadastrados no HTML', () => {
  const template = buildEquipmentCreatedEmailTemplate({ equipment: {
    code: 'EQ <01>', name: '<script>alert(1)</script>', category: { name: 'Bombas & motores' }
  } });
  assert.match(template.text, /Nome: <script>alert\(1\)<\/script>/);
  assert.match(template.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(template.html, /Bombas &amp; motores/);
  assert.doesNotMatch(template.html, /<script>/);
});

test('alteração parcial da configuração preserva calibração e aviso de cadastro', async () => {
  let row = { id: 'default', enabled: false, notifyOnEquipmentCreated: true, milestoneDays: [45, 10], repeatGapDays: 8, repeatExpired: false, notifyOnDueDay: false };
  const client = { equipmentNotificationConfig: {
    findFirst: async () => row,
    update: async ({ data }) => { row = { ...row, ...data }; }
  } };
  const updated = await updateEquipmentNotificationConfig(client, { repeatGapDays: 12 });
  assert.deepEqual(updated, { ...normalizeNotificationConfig(row), repeatGapDays: 12 });
  assert.equal(updated.enabled, false);
  assert.equal(updated.notifyOnEquipmentCreated, true);
  assert.deepEqual(updated.milestoneDays, [45, 10]);
  assert.equal(updated.repeatExpired, false);
});

test('API permite alterar somente um tipo sem desativar o destinatário ou os outros avisos', async t => {
  const recipient = { id: 'recipient-1', isActive: true, ...preferences };
  const update = mockMethod(t, prisma.equipmentNotificationRecipient, 'update', async ({ data }) => ({ ...recipient, ...data }));
  const response = await invoke('/notifications/recipients/:id', 'put', { notifyEquipmentCreated: false }, { id: recipient.id });
  assert.deepEqual(update.mock.calls[0].arguments[0], { where: { id: recipient.id }, data: { notifyEquipmentCreated: false } });
  assert.equal(response.value.isActive, true);
  assert.equal(response.value.notifyCalibrationUpdated, true);
  assert.equal(response.value.notifyEquipmentCreated, false);
  await assert.rejects(invoke('/notifications/recipients/:id', 'put', { notifyEquipmentCreated: 'false' }, { id: recipient.id }));
  assert.equal(update.mock.callCount(), 1);
});

for (const identity of [{ email: ' EXTERNO@example.com ' }, { userId: 'user-1' }]) {
  test(`API salva os tipos escolhidos ao adicionar ${identity.userId ? 'conta' : 'e-mail avulso'}`, async t => {
    mockMethod(t, prisma.user, 'findUnique', async () => ({ email: 'interno@example.com', username: 'interno', isActive: true }));
    const upsert = mockMethod(t, prisma.equipmentNotificationRecipient, 'upsert', async ({ create }) => ({ id: 'recipient-1', ...create }));
    const response = await invoke('/notifications/recipients', 'post', { ...identity, ...preferences });
    assert.equal(response.status, 201);
    assert.equal(response.value.email, identity.userId ? 'interno@example.com' : 'externo@example.com');
    for (const [key, value] of Object.entries(preferences)) {
      assert.equal(upsert.mock.calls[0].arguments[0].create[key], value);
      assert.equal(upsert.mock.calls[0].arguments[0].update[key], value);
    }
  });
}

test('somente gestores podem alterar as configurações e preferências de e-mail', () => {
  for (const [path, method] of [['/notifications/config', 'put'], ['/notifications/recipients', 'post'], ['/notifications/recipients/:id', 'put']]) {
    const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    assert.ok(route.stack.some(layer => layer.handle === requireEquipamentosManager));
  }
});

test('API dispara aviso no cadastro, não dispara em edição/duplicidade e tolera falha SMTP', async t => {
  const mailSettings = {
    sendClientEmails: true, smtpHost: 'smtp.invalid', smtpPort: 587, smtpUser: 'test',
    smtpFrom: 'test@example.com', smtpPass: 'synthetic', smtpAuthMode: 'password'
  };
  const previous = Object.fromEntries(Object.keys(mailSettings).map(key => [key, env[key]]));
  Object.assign(env, mailSettings);
  t.after(() => Object.assign(env, previous));
  const messages = [];
  let failSmtp = false;
  mockMethod(t, nodemailer, 'createTransport', () => ({ sendMail: async message => {
    if (failSmtp) throw new Error('SMTP indisponível');
    messages.push(message);
  } }));
  mockMethod(t, prisma, '$transaction', async () => {});
  mockMethod(t, prisma.romaneioCatalogItem, 'findMany', async () => []);
  mockMethod(t, prisma.equipmentNotificationConfig, 'findFirst', async () => ({ notifyOnEquipmentCreated: true }));
  mockMethod(t, prisma.equipmentNotificationRecipient, 'findMany', async () => [
    { email: 'novo@example.com', isActive: true, notifyEquipmentCreated: true },
    { email: 'calibracao@example.com', isActive: true, notifyEquipmentCreated: false }
  ]);
  let saved = null;
  mockMethod(t, prisma.companyEquipment, 'findUnique', async ({ where }) => where.code
    ? (saved?.code === where.code ? saved : null)
    : saved);
  mockMethod(t, prisma.companyEquipment, 'create', async ({ data }) => {
    saved = { ...data, id: 'eq-1', isActive: true, attachments: [], category: { name: 'Bombas' } };
    return saved;
  });
  mockMethod(t, prisma.companyEquipment, 'update', async ({ data }) => {
    saved = { ...saved, ...data };
    return saved;
  });
  const body = { code: 'B-01', name: 'Bomba principal', categoryId: 'cat-1' };
  assert.equal((await invoke('/', 'post', body)).status, 201);
  assert.deepEqual(messages.map(message => message.to), ['novo@example.com']);
  assert.match(messages[0].text, /Categoria: Bombas/);
  assert.equal((await invoke('/:id', 'put', { name: 'Bomba editada' }, { id: 'eq-1' })).status, 200);
  assert.equal((await invoke('/', 'post', body)).status, 409);
  assert.equal(messages.length, 1);
  const log = t.mock.method(console, 'error', () => {});
  failSmtp = true;
  assert.equal((await invoke('/', 'post', { ...body, code: 'B-02' })).status, 201);
  assert.equal(saved.code, 'B-02');
  assert.equal(log.mock.callCount(), 1);
});
