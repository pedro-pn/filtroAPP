import assert from 'node:assert/strict';
import test from 'node:test';

import { processSignatureReminders, signatureReminderDueWhere } from '../src/lib/signature-reminders.js';
import { encryptSignatureToken, signatureTokenHash } from '../src/lib/signature-token.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';

test('reminders stop at 30 days for existing pendencies even with renewed links', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const client = database.client;
  const now = new Date('2026-11-11T12:00:00.000Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  const day = 86_400_000;
  const cutoff = now.getTime() - 30 * day;
  const project = await client.project.create({ data: {
    code: 'reminder-limit', name: 'Projeto', clientName: 'Cliente', clientCnpj: '', contractCode: '', location: ''
  } });
  const fixtures = [
    { id: 'expired-first', createdAt: new Date(cutoff - day), lastReminderAt: null },
    { id: 'expired-renewed', createdAt: new Date('2026-09-08T11:47:12.617Z'), lastReminderAt: new Date(now - 4 * day) },
    { id: 'boundary-first', createdAt: new Date(cutoff), lastReminderAt: null },
    { id: 'boundary-repeat', createdAt: new Date(cutoff), lastReminderAt: new Date(now - 4 * day) },
    { id: 'inside-window', createdAt: new Date(cutoff + 1), lastReminderAt: null },
    { id: 'recent-repeat', createdAt: new Date(now - 10 * day), lastReminderAt: new Date(now - 4 * day) },
    { id: 'too-soon', createdAt: new Date(now - 10 * day), lastReminderAt: new Date(now - day) }
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const token = `token-${fixture.id}`;
    await client.report.create({ data: {
      id: `report-${fixture.id}`, projectId: project.id, reportType: 'RDO', status: 'APPROVED', sequenceNumber: index + 1,
      reportDate: fixture.createdAt, approvedAt: fixture.createdAt,
      arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1,
      versions: { create: {
        id: `version-${fixture.id}`, versionNumber: 1, status: 'ACTIVE', sourcePdfUrl: 'test.pdf', sourceDocumentHash: 'source-hash',
        signatures: { create: {
          ...fixture, reportId: `report-${fixture.id}`, signerName: 'Cliente', signerEmail: 'cliente@example.com',
          signerRole: 'CLIENT', status: 'PENDING', isRequired: true, sourceDocumentHash: 'source-hash',
          tokenHash: signatureTokenHash(token), ...encryptSignatureToken(token),
          tokenExpiresAt: new Date(now.getTime() + 20 * day), reminderCount: fixture.lastReminderAt ? 8 : 0
        } }
      } }
    } });
  }

  const expiredIds = fixtures.slice(0, 4).map(fixture => fixture.id);
  const expiredBefore = await client.reportSignature.findMany({ where: { id: { in: expiredIds } }, orderBy: { id: 'asc' } });
  const sent = [];
  const options = { client, limit: 2, missingMailerConfig: [], mailer: async message => { sent.push(message); } };

  await t.test('filters both first and repeat reminders at the exact deadline before applying the batch limit', async () => {
    const due = await client.reportSignature.findMany({ where: signatureReminderDueWhere(now), orderBy: { createdAt: 'asc' } });
    assert.deepEqual(due.map(signature => signature.id), ['inside-window', 'recent-repeat']);
    assert.deepEqual(await processSignatureReminders(options), { checked: 2, sent: 1 });
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /2 RDOs pendentes/);
    assert.match(sent[0].text, /RDO 005/);
    assert.match(sent[0].text, /RDO 006/);
    assert.doesNotMatch(sent[0].text, /RDO 00[1-4]/);
    const updated = await client.reportSignature.findUnique({ where: { id: 'recent-repeat' } });
    assert.equal(updated.reminderCount, 9);
    assert.equal(updated.lastReminderAt.getTime(), now.getTime());
    assert.deepEqual(await client.reportSignature.findMany({ where: { id: { in: expiredIds } }, orderBy: { id: 'asc' } }), expiredBefore);
  });

  await t.test('rechecks the deadline when claiming a reminder selected before expiry', async () => {
    const signature = await client.reportSignature.create({ data: {
      reportId: 'report-inside-window', versionId: 'version-inside-window',
      signerName: 'Outro cliente', signerEmail: 'deadline@example.com', signerRole: 'CLIENT',
      sourceDocumentHash: 'source-hash', createdAt: new Date(cutoff + 1)
    } });
    const advancingClient = client.$extends({ query: { reportSignature: {
      async findMany({ args, query }) {
        const rows = await query(args);
        t.mock.timers.tick(1);
        return rows;
      }
    } } });
    assert.deepEqual(await processSignatureReminders({ ...options, client: advancingClient }), { checked: 1, sent: 0 });
    assert.deepEqual(await client.reportSignature.findUnique({ where: { id: signature.id } }), signature);
    assert.equal(sent.length, 1);
  });

  await t.test('restarts and subsequent runs never revive expired reminders or renew their links', async () => {
    assert.deepEqual(await processSignatureReminders(options), { checked: 0, sent: 0 });
    t.mock.timers.tick(31 * day);
    assert.deepEqual(await processSignatureReminders(options), { checked: 0, sent: 0 });
    assert.equal(sent.length, 1);
    assert.deepEqual(await client.reportSignature.findMany({ where: { id: { in: expiredIds } }, orderBy: { id: 'asc' } }), expiredBefore);
  });
});
