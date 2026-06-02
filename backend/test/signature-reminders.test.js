import assert from 'node:assert/strict';
import test from 'node:test';
import { ReportSignatureStatus, ReportStatus, ReportType, ReportVersionStatus } from '@prisma/client';

import {
  ensureReminderSignatureToken,
  processSignatureReminders,
  publicSignatureUrl,
  signatureReminderDueWhere
} from '../src/lib/signature-reminders.js';
import { encryptSignatureToken, signatureTokenHash } from '../src/lib/signature-token.js';

test('signatureReminderDueWhere selects pending signatures every three days', () => {
  const now = new Date('2026-06-02T12:00:00.000Z');
  const where = signatureReminderDueWhere(now);

  assert.equal(where.status, ReportSignatureStatus.PENDING);
  assert.deepEqual(where.OR, [
    {
      lastReminderAt: null,
      createdAt: { lt: new Date('2026-05-30T12:00:00.000Z') }
    },
    {
      lastReminderAt: { lt: new Date('2026-05-30T12:00:00.000Z') }
    }
  ]);
  assert.deepEqual(where.report, {
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED,
    deletedAt: null,
    project: {
      deletedAt: null,
      managerOnly: false
    }
  });
  assert.deepEqual(where.version, {
    status: ReportVersionStatus.ACTIVE,
    finalDocumentHash: null
  });
});

test('ensureReminderSignatureToken reuses an encrypted signature token', async () => {
  const token = 'existing-signature-token';
  const encrypted = encryptSignatureToken(token);
  const updates = [];
  const client = {
    reportSignature: {
      async update(args) {
        updates.push(args);
      }
    }
  };

  const result = await ensureReminderSignatureToken({
    id: 'sig-1',
    tokenHash: signatureTokenHash(token),
    tokenExpiresAt: new Date('2026-06-10T12:00:00.000Z'),
    ...encrypted
  }, client, new Date('2026-06-02T12:00:00.000Z'));

  assert.equal(result.token, token);
  assert.equal(result.expiresAt.toISOString(), '2026-06-10T12:00:00.000Z');
  assert.deepEqual(updates, []);
});

test('processSignatureReminders sends a reusable public signing link and records cadence', async () => {
  const sent = [];
  const updates = [];
  const createdAt = new Date('2026-05-25T12:00:00.000Z');
  const signature = {
    id: 'sig-1',
    status: ReportSignatureStatus.PENDING,
    isRequired: true,
    signerName: 'Cliente',
    signerEmail: 'cliente@example.com',
    createdAt,
    tokenHash: null,
    tokenExpiresAt: null,
    report: {
      id: 'report-1',
      reportType: 'RDO',
      sequenceNumber: 12,
      reportDate: new Date('2026-05-25T00:00:00.000Z'),
      status: ReportStatus.APPROVED,
      project: {
        code: 'P-001',
        name: 'Projeto Teste',
        deletedAt: null,
        managerOnly: false
      }
    },
    version: {
      id: 'version-1',
      status: ReportVersionStatus.ACTIVE,
      finalDocumentHash: null
    }
  };
  const client = {
    reportSignature: {
      async findMany() {
        return [signature];
      },
      async updateMany(args) {
        updates.push({ type: 'updateMany', args });
        return { count: 1 };
      },
      async update(args) {
        updates.push({ type: 'update', args });
        return { id: args.where.id, ...args.data };
      }
    },
    user: {
      async findMany() {
        return [{
          id: 'user-1',
          email: 'cliente@example.com',
          username: 'cliente@example.com',
          notifyReportsByEmail: true,
          notifySignaturesByEmail: true,
          notifySignatureRemindersByEmail: true,
          notifySurveyRemindersByEmail: true
        }];
      }
    },
    notificationPreferenceToken: {
      async findFirst() {
        return { tokenHash: 'pref-token' };
      }
    }
  };

  const result = await processSignatureReminders({
    client,
    missingMailerConfig: [],
    mailer: async message => {
      sent.push(message);
    }
  });

  assert.deepEqual(result, { checked: 1, sent: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'cliente@example.com');
  assert.match(sent[0].subject, /Lembrete de assinatura/);
  assert.match(sent[0].text, /Assinar relatório: .*\/assinar\//);
  assert.match(sent[0].text, /Não receber notificações: .*\/notificacoes\/pref-token/);
  assert.equal(updates.some(item => item.args.data.tokenEncrypted && item.args.data.tokenHash), true);
  assert.equal(updates.some(item => item.args.data.reminderCount?.increment === 1), true);
});

test('publicSignatureUrl keeps the token in the signing route', () => {
  assert.match(publicSignatureUrl('token with spaces'), /\/assinar\/token%20with%20spaces$/);
});
