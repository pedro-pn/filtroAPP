import assert from 'node:assert/strict';
import test from 'node:test';

import {
  markAmbiguousCompletionClaims,
  markAmbiguousInviteClaims,
  processCompletionEmailQueue,
  queueInviteEmails,
  sendCompletedEmailAttempt,
  sendInviteEmail
} from '../src/lib/assinaturas/notifications.js';
import { signatureTokenData } from '../src/lib/signature-token.js';

function matchesStatus(actual, condition) {
  if (typeof condition === 'string') return actual === condition;
  if (condition?.in) return condition.in.includes(actual);
  return true;
}

function applyData(target, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) target[key] = (target[key] || 0) + value.increment;
    else target[key] = value;
  }
}

function inviteClient(signers) {
  const audits = [];
  const client = {
    signatureDocumentSigner: {
      async findMany({ where }) {
        return signers.filter(signer => {
          if (where.documentId && signer.documentId !== where.documentId) return false;
          if (where.email?.not === null && !signer.email) return false;
          if (!matchesStatus(signer.emailStatus, where.emailStatus)) return false;
          if (where.emailClaimedAt === null && signer.emailClaimedAt !== null) return false;
          if (where.emailClaimedAt?.lte && (!signer.emailClaimedAt || signer.emailClaimedAt > where.emailClaimedAt.lte)) return false;
          return true;
        });
      },
      async findUnique({ where }) {
        return signers.find(signer => signer.id === where.id) || null;
      },
      async updateMany({ where, data }) {
        const signer = signers.find(item => item.id === where.id);
        if (!signer) return { count: 0 };
        if (!matchesStatus(signer.emailStatus, where.emailStatus)) return { count: 0 };
        if (where.email?.not === null && !signer.email) return { count: 0 };
        if (where.emailClaimedAt === null && signer.emailClaimedAt !== null) return { count: 0 };
        if (where.emailClaimedAt instanceof Date && signer.emailClaimedAt?.getTime() !== where.emailClaimedAt.getTime()) return { count: 0 };
        if (where.emailAttempts?.lt !== undefined && signer.emailAttempts >= where.emailAttempts.lt) return { count: 0 };
        applyData(signer, data);
        return { count: 1 };
      }
    },
    signatureDocumentAuditLog: {
      async create({ data }) { audits.push(data); return data; }
    }
  };
  return { client, audits };
}

function signer(overrides = {}) {
  const tokenData = signatureTokenData();
  const document = {
    id: 'document-1',
    title: 'Contrato de manutenção',
    requesterNameSnapshot: 'Pedro Paulo',
    status: 'AGUARDANDO_ASSINATURAS',
    deletedAt: null
  };
  return {
    id: 'signer-1',
    documentId: document.id,
    name: 'Maria Silva',
    email: 'maria@example.com',
    emailStatus: 'PENDENTE',
    emailAttempts: 0,
    emailClaimedAt: null,
    emailLastError: null,
    updatedAt: new Date(0),
    tokenExpiresAt: new Date('2026-10-01T12:00:00.000Z'),
    document,
    ...tokenData,
    ...overrides
  };
}

test('convite é enviado somente para assinante com e-mail', async () => {
  const withEmail = signer();
  const withoutEmail = signer({ id: 'signer-2', email: null, emailStatus: 'NAO_APLICAVEL' });
  const { client, audits } = inviteClient([withEmail, withoutEmail]);
  const messages = [];

  const results = await queueInviteEmails(client, withEmail.documentId, {
    now: new Date('2026-08-28T15:00:00.000Z'),
    mailer: async message => { messages.push(message); return { messageId: 'provider-1' }; },
    missingMailerConfig: []
  });

  assert.equal(results.length, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, withEmail.email);
  assert.match(messages[0].text, /#convite=/);
  assert.equal(withEmail.emailStatus, 'ENVIADO');
  assert.equal(withoutEmail.emailStatus, 'NAO_APLICAVEL');
  assert.deepEqual(audits.map(item => item.action), ['EMAIL_SOLICITADO', 'EMAIL_ENVIADO']);
});

test('falha SMTP não invalida token e erro persistido não contém link ou segredo', async () => {
  const target = signer();
  const originalHash = target.tokenHash;
  const { client, audits } = inviteClient([target]);

  const result = await sendInviteEmail(client, target.id, {
    now: new Date('2026-08-28T15:00:00.000Z'),
    mailer: async message => { throw new Error(`falha ${message.text}`); },
    missingMailerConfig: []
  });

  assert.equal(result.status, 'FALHOU');
  assert.equal(target.emailStatus, 'FALHOU');
  assert.equal(target.tokenHash, originalHash);
  assert.doesNotMatch(target.emailLastError, /convite=|[a-f0-9]{64}/i);
  assert.deepEqual(audits.map(item => item.action), ['EMAIL_SOLICITADO', 'EMAIL_FALHOU']);
});

test('configuração SMTP ausente marca falha conhecida sem invalidar o convite', async () => {
  const target = signer();
  const originalHash = target.tokenHash;
  const { client } = inviteClient([target]);
  const result = await sendInviteEmail(client, target.id, {
    now: new Date('2026-08-28T15:00:00.000Z'),
    missingMailerConfig: ['smtpHost']
  });

  assert.equal(result.status, 'FALHOU');
  assert.equal(target.emailStatus, 'FALHOU');
  assert.equal(target.tokenHash, originalHash);
});

test('claim concorrente envia uma vez e claim antigo ambíguo exige revisão sem reenvio', async () => {
  const target = signer();
  const { client } = inviteClient([target]);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const dependencies = {
    now: new Date('2026-08-28T15:00:00.000Z'),
    mailer: async () => { calls += 1; await gate; return { messageId: 'provider-1' }; },
    missingMailerConfig: []
  };
  const first = sendInviteEmail(client, target.id, dependencies);
  await new Promise(resolve => setImmediate(resolve));
  const second = await sendInviteEmail(client, target.id, dependencies);
  assert.equal(second.status, 'IGNORADO');
  release();
  await first;
  assert.equal(calls, 1);

  const stale = signer({
    id: 'signer-stale',
    emailStatus: 'EM_ENVIO',
    emailClaimedAt: new Date('2026-08-28T14:00:00.000Z')
  });
  const staleClient = inviteClient([stale]);
  assert.equal(await markAmbiguousInviteClaims(staleClient.client, { now: dependencies.now }), 1);
  assert.equal(stale.emailStatus, 'REVISAO_NECESSARIA');
});

function completionClient(notification) {
  const client = {
    signatureDocumentCompletionNotification: {
      async findUnique({ select } = {}) {
        if (select?.attempts) return { attempts: notification.attempts };
        return notification;
      },
      async findMany({ where }) {
        if (!matchesStatus(notification.status, where.status)) return [];
        if (notification.nextAttemptAt && notification.nextAttemptAt > (where.OR?.[1]?.nextAttemptAt?.lte || new Date())) return [];
        return [{ id: notification.id }];
      },
      async updateMany({ where, data }) {
        if (where.id && where.id !== notification.id) return { count: 0 };
        if (!matchesStatus(notification.status, where.status)) return { count: 0 };
        if (where.claimedAt === null && notification.claimedAt !== null) return { count: 0 };
        if (where.claimedAt instanceof Date && notification.claimedAt?.getTime() !== where.claimedAt.getTime()) return { count: 0 };
        if (where.claimedAt?.lte && (!notification.claimedAt || notification.claimedAt > where.claimedAt.lte)) return { count: 0 };
        applyData(notification, data);
        return { count: 1 };
      }
    }
  };
  return client;
}

function completionNotification(overrides = {}) {
  return {
    id: 'notification-1',
    documentId: 'document-1',
    emailTo: 'owner@example.com',
    status: 'PENDENTE',
    attempts: 0,
    claimedAt: null,
    nextAttemptAt: null,
    document: {
      id: 'document-1',
      title: 'Contrato',
      finalDocumentHash: 'd'.repeat(64),
      signers: [{ position: 1, name: 'Maria Silva', declaredSignerName: 'Maria Silva' }]
    },
    ...overrides
  };
}

test('outbox de conclusão sobrevive ao commit, envia uma vez e persiste providerMessageId', async () => {
  const notification = completionNotification();
  const client = completionClient(notification);
  let sends = 0;
  const dependencies = {
    now: new Date('2026-08-28T15:00:00.000Z'),
    mailer: async () => { sends += 1; return { messageId: 'provider-completed-1' }; },
    missingMailerConfig: []
  };

  const result = await processCompletionEmailQueue(client, dependencies);
  assert.equal(result.sent, 1);
  assert.equal(notification.status, 'ENVIADO');
  assert.equal(notification.providerMessageId, 'provider-completed-1');
  await sendCompletedEmailAttempt(client, notification.id, dependencies);
  assert.equal(sends, 1);
});

test('falha confirmada da outbox agenda retry e claim antigo vira revisão', async () => {
  const now = new Date('2026-08-28T15:00:00.000Z');
  const notification = completionNotification();
  const client = completionClient(notification);
  const failed = await sendCompletedEmailAttempt(client, notification.id, {
    now,
    mailer: async () => { throw new Error('provider secret'); },
    missingMailerConfig: []
  });
  assert.equal(failed.status, 'FALHOU');
  assert.equal(notification.status, 'FALHOU');
  assert.ok(notification.nextAttemptAt > now);
  assert.doesNotMatch(notification.lastError, /provider secret|convite=/i);

  notification.status = 'EM_ENVIO';
  notification.claimedAt = new Date('2026-08-28T14:00:00.000Z');
  assert.equal(await markAmbiguousCompletionClaims(client, { now }), 1);
  assert.equal(notification.status, 'REVISAO_NECESSARIA');
});
