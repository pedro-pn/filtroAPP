import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  dataSubjectProtocol,
  deletionRequestDetails,
  normalizeDataSubjectRequestType
} from '../src/lib/data-subject-requests.js';
import {
  buildSelfServiceDataExport,
  dataSubjectCanSendResponse,
  dataSubjectCompletionEvidence,
  dataSubjectDuplicatePublicReceipt,
  dataSubjectRequestIntakeReadiness,
  dataSubjectRequestNotificationRecipients,
  dataSubjectResponseAttemptKey,
  dataSubjectResponseAttemptRetryState,
  dataSubjectResponseFailedUpdateData,
  dataSubjectResponseInitialUpdateData,
  dataSubjectResponseNeedsReviewUpdateData,
  dataSubjectResponseRequiresIdentityVerification,
  dataSubjectResponseSentUpdateData,
  dataSubjectStatusUpdateData,
  notifyDataSubjectRequestCreated,
  prepareDataSubjectResponseAttempt,
  privacyAdminNotificationRecipientWhere,
  requirePrivacyManager,
  selfServiceDataExportIdentifiers
} from '../src/routes/resources/privacy.js';

test('normalizeDataSubjectRequestType falls back to OTHER for unknown values', () => {
  assert.equal(normalizeDataSubjectRequestType('ACCESS'), 'ACCESS');
  assert.equal(normalizeDataSubjectRequestType('access'), 'ACCESS');
  assert.equal(normalizeDataSubjectRequestType('invalid'), 'OTHER');
});

test('dataSubjectProtocol includes date and request type prefix', () => {
  const protocol = dataSubjectProtocol('DELETION', new Date('2026-05-22T12:00:00.000Z'), () => 0);
  assert.equal(protocol, 'LGPD-20260522-DEL-000000');
});

test('deletionRequestDetails documents legal retention caveat', () => {
  const details = deletionRequestDetails({ username: 'cliente@example.com', email: 'cliente@example.com' });
  assert.match(details, /eliminação\/análise manual/);
  assert.match(details, /documentos assinados/);
  assert.match(details, /exercício regular de direitos/);
});

test('LGPD response follow-up does not reopen completed requests', () => {
  const now = new Date('2026-05-22T12:00:00.000Z');

  assert.deepEqual(dataSubjectResponseInitialUpdateData({
    message: 'Resposta complementar.',
    currentStatus: 'COMPLETED'
  }), {
    responseNotes: 'Resposta complementar.',
    status: 'COMPLETED',
    responseEmailStatus: 'PENDING',
    responseEmailError: null
  });

  assert.deepEqual(dataSubjectResponseSentUpdateData({
    currentStatus: 'COMPLETED',
    resolved: false,
    userId: 'user-1',
    now
  }), {
    responseEmailStatus: 'SENT',
    responseEmailSentAt: now,
    responseEmailError: null
  });
});

test('LGPD response failure records delivery failure without completion', () => {
  assert.deepEqual(dataSubjectResponseInitialUpdateData({
    message: 'Resposta em análise.',
    currentStatus: 'OPEN'
  }), {
    responseNotes: 'Resposta em análise.',
    status: 'IN_REVIEW',
    responseEmailStatus: 'PENDING',
    responseEmailError: null
  });

  assert.deepEqual(dataSubjectResponseFailedUpdateData(new Error('SMTP indisponível')), {
    responseEmailStatus: 'FAILED',
    responseEmailError: 'SMTP indisponível'
  });
  assert.deepEqual(dataSubjectResponseNeedsReviewUpdateData('Envio desconhecido'), {
    status: 'IN_REVIEW',
    responseEmailStatus: 'NEEDS_REVIEW',
    responseEmailError: 'Envio desconhecido'
  });
});

test('LGPD completion requires sent email or explicit offline evidence', () => {
  assert.deepEqual(dataSubjectCompletionEvidence({
    responseNotes: 'Resposta preparada.',
    responseEmailStatus: 'FAILED'
  }), {
    allowed: false,
    completionNotes: ''
  });

  assert.deepEqual(dataSubjectCompletionEvidence({
    responseNotes: 'Resposta enviada.',
    responseEmailStatus: 'SENT'
  }), {
    allowed: true,
    completionNotes: 'Concluída com resposta enviada por e-mail ao titular.'
  });

  assert.deepEqual(dataSubjectCompletionEvidence({
    responseNotes: 'Resposta preparada.',
    responseEmailStatus: 'FAILED'
  }, 'Resposta entregue por contato telefônico em 22/05/2026.'), {
    allowed: true,
    completionNotes: 'Resposta entregue por contato telefônico em 22/05/2026.'
  });
});

test('LGPD reopen clears stale completion evidence', () => {
  assert.deepEqual(dataSubjectStatusUpdateData({
    resolved: false,
    completionEvidence: { completionNotes: '' },
    userId: 'privacy-admin-1',
    now: new Date('2026-05-22T12:00:00.000Z')
  }), {
    status: 'IN_REVIEW',
    completedAt: null,
    completedByUserId: null,
    completionNotes: null
  });
});

test('high-risk LGPD responses require identity verification for final responses or completion', () => {
  assert.equal(dataSubjectResponseRequiresIdentityVerification({
    type: 'ACCESS',
    responseKind: 'SUBSTANTIVE',
    resolved: false
  }), true);
  assert.equal(dataSubjectResponseRequiresIdentityVerification({
    type: 'ACCESS',
    responseKind: 'VERIFICATION_REQUEST',
    resolved: false
  }), false);
  assert.equal(dataSubjectResponseRequiresIdentityVerification({
    type: 'CONFIRMATION',
    responseKind: 'SUBSTANTIVE',
    resolved: true
  }), true);

  assert.deepEqual(dataSubjectCanSendResponse({
    type: 'ACCESS',
    identityVerifiedAt: null
  }, {
    responseKind: 'SUBSTANTIVE',
    resolved: false
  }), {
    allowed: false,
    error: 'Verifique a identidade do titular antes de enviar resposta final ou concluir esta solicitação.'
  });

  assert.deepEqual(dataSubjectCanSendResponse({
    type: 'ACCESS',
    identityVerifiedAt: null
  }, {
    responseKind: 'VERIFICATION_REQUEST',
    resolved: false
  }), { allowed: true });

  assert.deepEqual(dataSubjectCanSendResponse({
    type: 'ACCESS',
    identityVerifiedAt: new Date('2026-05-22T12:00:00.000Z')
  }, {
    responseKind: 'SUBSTANTIVE',
    resolved: true
  }), { allowed: true });
});

test('high-risk LGPD completion requires identity verification even with offline evidence', () => {
  assert.deepEqual(dataSubjectCompletionEvidence({
    type: 'DELETION',
    identityVerifiedAt: null,
    responseNotes: 'Resposta entregue.',
    responseEmailStatus: 'SENT'
  }), {
    allowed: false,
    completionNotes: ''
  });

  assert.deepEqual(dataSubjectCompletionEvidence({
    type: 'DELETION',
    identityVerifiedAt: new Date('2026-05-22T12:00:00.000Z'),
    responseNotes: 'Resposta entregue.',
    responseEmailStatus: 'SENT'
  }), {
    allowed: true,
    completionNotes: 'Concluída com resposta enviada por e-mail ao titular.'
  });
});

test('LGPD response attempt key is stable and changes with message or resolution', () => {
  const base = {
    requestId: 'request-1',
    email: 'Titular@Example.com',
    message: 'Resposta preparada.',
    responseKind: 'SUBSTANTIVE',
    resolved: false
  };
  assert.equal(dataSubjectResponseAttemptKey(base), dataSubjectResponseAttemptKey({
    ...base,
    email: 'titular@example.com'
  }));
  assert.notEqual(dataSubjectResponseAttemptKey(base), dataSubjectResponseAttemptKey({
    ...base,
    message: 'Outra resposta.'
  }));
  assert.notEqual(dataSubjectResponseAttemptKey(base), dataSubjectResponseAttemptKey({
    ...base,
    resolved: true
  }));
});

test('privacy manager guard requires dedicated privacy module role', () => {
  function run(user) {
    let statusCode = null;
    let body = null;
    let nextCalled = false;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      }
    };
    requirePrivacyManager({ auth: { user } }, res, () => {
      nextCalled = true;
    });
    return { statusCode, body, nextCalled };
  }

  assert.deepEqual(run({ role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['rdo:manager'] }), {
    statusCode: 403,
    body: { error: 'Acesso restrito ao módulo de privacidade.' },
    nextCalled: false
  });
  assert.deepEqual(run({ role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['privacy:admin'] }), {
    statusCode: null,
    body: null,
    nextCalled: true
  });
});

test('LGPD response attempts allow retry only for failed attempts and quarantine stale sending attempts', () => {
  const now = new Date('2026-05-22T12:20:00.000Z');

  assert.deepEqual(dataSubjectResponseAttemptRetryState(null, now), { retry: true });
  assert.deepEqual(dataSubjectResponseAttemptRetryState({ status: 'FAILED', updatedAt: now }, now), { retry: true });
  assert.deepEqual(dataSubjectResponseAttemptRetryState({ status: 'SENT', updatedAt: now }, now), {
    retry: false,
    reconcileSent: true
  });
  assert.deepEqual(dataSubjectResponseAttemptRetryState({
    status: 'SENDING',
    updatedAt: new Date('2026-05-22T12:00:00.000Z')
  }, now), {
    retry: false,
    needsReview: true,
    status: 'NEEDS_REVIEW',
    error: 'Existe uma tentativa de envio antiga em estado desconhecido. Reconcilie manualmente antes de reenviar esta resposta.'
  });

  const activeSending = dataSubjectResponseAttemptRetryState({
    status: 'SENDING',
    updatedAt: new Date('2026-05-22T12:10:00.001Z')
  }, now);
  assert.equal(activeSending.retry, false);
  assert.match(activeSending.error, /em andamento/);
});

test('LGPD request notifications are sent only to privacy admins', async () => {
  const findManyCalls = [];
  const sent = [];
  const prismaClient = {
    user: {
      findMany: async args => {
        findManyCalls.push(args);
        return [
          { email: 'privacidade@example.com' },
          { email: 'PRIVACIDADE@example.com' }
        ];
      }
    }
  };

  await notifyDataSubjectRequestCreated({
    protocol: 'LGPD-20260522-ACC-000001',
    type: 'ACCESS',
    name: 'Titular dos Dados',
    email: 'titular@example.com',
    identifier: '123.456.789-00',
    details: 'Solicito acesso aos meus dados pessoais mantidos pela empresa.'
  }, {
    prismaClient,
    getMissingMailerConfigFn: () => [],
    sendMailFn: async message => {
      sent.push(message);
      return { messageId: 'mail-1' };
    },
    smtpTestDest: '',
    appUrl: 'https://app.example.com',
    logger: { warn() {}, error() {} }
  });

  assert.deepEqual(findManyCalls, [{
    where: privacyAdminNotificationRecipientWhere(),
    select: { email: true }
  }]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'privacidade@example.com');
  assert.equal('cc' in sent[0], false);
  assert.match(sent[0].text, /Titular dos Dados/);
});

test('LGPD request notification recipient query excludes legacy managers without privacy role', () => {
  assert.deepEqual(privacyAdminNotificationRecipientWhere(), {
    isActive: true,
    email: { not: null },
    moduleRoles: {
      some: {
        module: 'PRIVACY',
        role: 'PRIVACY_ADMIN'
      }
    }
  });
});

test('LGPD request notification recipient query includes internal privacy admins', async () => {
  const sent = [];
  await notifyDataSubjectRequestCreated({
    protocol: 'LGPD-20260522-ACC-000002',
    type: 'ACCESS',
    name: 'Titular Interno',
    email: 'titular@example.com',
    identifier: null,
    details: 'Solicito detalhes sobre tratamento de dados pessoais.'
  }, {
    prismaClient: {
      user: {
        findMany: async args => {
          assert.deepEqual(args.where, privacyAdminNotificationRecipientWhere());
          return [{ email: 'dpo-interno@example.com' }];
        }
      }
    },
    getMissingMailerConfigFn: () => [],
    sendMailFn: async message => {
      sent.push(message);
      return { messageId: 'mail-2' };
    },
    smtpTestDest: '',
    appUrl: 'https://app.example.com',
    logger: { warn() {}, error() {} }
  });

  assert.equal(sent[0].to, 'dpo-interno@example.com');
});

test('LGPD request intake requires mailer config and an operational recipient', async () => {
  const prismaClient = {
    user: {
      findMany: async () => []
    }
  };

  assert.deepEqual(await dataSubjectRequestIntakeReadiness({
    prismaClient,
    getMissingMailerConfigFn: () => ['SMTP_HOST'],
    privacyNotificationEmail: '',
    smtpTestDest: '',
    nodeEnv: 'production'
  }), {
    ready: false,
    statusCode: 503,
    error: 'Canal LGPD indisponível temporariamente. Tente novamente mais tarde.',
    reason: 'Configuração SMTP ausente: SMTP_HOST'
  });

  const noRecipient = await dataSubjectRequestIntakeReadiness({
    prismaClient,
    getMissingMailerConfigFn: () => [],
    privacyNotificationEmail: '',
    smtpTestDest: 'test@example.com',
    nodeEnv: 'production'
  });
  assert.equal(noRecipient.ready, false);
  assert.match(noRecipient.reason, /Nenhum administrador/);
});

test('LGPD request notifications can use an explicit privacy mailbox fallback', async () => {
  const prismaClient = {
    user: {
      findMany: async () => []
    }
  };

  assert.deepEqual(await dataSubjectRequestNotificationRecipients({
    prismaClient,
    privacyNotificationEmail: ' DPO@example.com,privacidade@example.com ',
    smtpTestDest: '',
    nodeEnv: 'production'
  }), ['dpo@example.com', 'privacidade@example.com']);

  const sent = [];
  await notifyDataSubjectRequestCreated({
    protocol: 'LGPD-20260522-ACC-000003',
    type: 'ACCESS',
    name: 'Titular sem operador',
    email: 'titular@example.com',
    identifier: null,
    details: 'Solicito uma cópia completa dos dados pessoais mantidos.'
  }, {
    prismaClient,
    getMissingMailerConfigFn: () => [],
    sendMailFn: async message => {
      sent.push(message);
      return { messageId: 'mail-3' };
    },
    privacyNotificationEmail: 'dpo@example.com',
    smtpTestDest: '',
    nodeEnv: 'production',
    appUrl: 'https://app.example.com',
    logger: { warn() {}, error() {} }
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'dpo@example.com');
});

test('public duplicate LGPD request receipt does not expose existing protocol or status', () => {
  const receipt = dataSubjectDuplicatePublicReceipt();

  assert.equal(receipt.received, true);
  assert.equal(receipt.duplicateWindowHours, 24);
  assert.equal('protocol' in receipt, false);
  assert.equal('status' in receipt, false);
  assert.equal('createdAt' in receipt, false);
});

test('privacy admin migration does not grant the role to every existing ADMIN account', () => {
  const migration = fs.readFileSync(
    new URL('../prisma/migrations/20260522161000_backfill_privacy_admin_roles/migration.sql', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(migration, /INSERT INTO "ModuleRole"/);
  assert.doesNotMatch(migration, /"accountType" = 'ADMIN'/);
  assert.match(migration, /assigned explicitly/);
});

test('LGPD response preparation rejects concurrent conflicting response before email send', async () => {
  const calls = [];
  const request = {
    id: 'request-1',
    status: 'IN_REVIEW',
    email: 'titular@example.com',
    updatedAt: new Date('2026-05-22T12:00:00.000Z')
  };
  const prismaClient = {
    $transaction: async callback => callback({
      dataSubjectRequest: {
        updateMany: async args => {
          calls.push(['dataSubjectRequest', 'updateMany', args]);
          return { count: calls.filter(([model, action]) => model === 'dataSubjectRequest' && action === 'updateMany').length === 1 ? 1 : 0 };
        }
      },
      dataSubjectRequestResponseAttempt: {
        create: async args => {
          calls.push(['dataSubjectRequestResponseAttempt', 'create', args]);
          return { id: 'attempt-1', ...args.data };
        },
        update: async args => {
          calls.push(['dataSubjectRequestResponseAttempt', 'update', args]);
          return { id: args.where.id, ...args.data };
        }
      }
    })
  };

  await prepareDataSubjectResponseAttempt({
    prismaClient,
    request,
    data: {
      message: 'Primeira resposta oficial ao titular.',
      responseKind: 'SUBSTANTIVE',
      resolved: true
    },
    idempotencyKey: 'key-1',
    existingAttempt: null,
    emailSubject: 'Resposta LGPD',
    userId: 'privacy-admin-1'
  });

  await assert.rejects(
    () => prepareDataSubjectResponseAttempt({
      prismaClient,
      request,
      data: {
        message: 'Segunda resposta conflitante ao titular.',
        responseKind: 'SUBSTANTIVE',
        resolved: true
      },
      idempotencyKey: 'key-2',
      existingAttempt: null,
      emailSubject: 'Resposta LGPD',
      userId: 'privacy-admin-2'
    }),
    error => error.statusCode === 409 && /alterada/.test(error.message)
  );

  assert.equal(calls.filter(([model, action]) => model === 'dataSubjectRequestResponseAttempt' && action === 'create').length, 1);
});

test('self-service data export resolves identifiers from account email and username', () => {
  assert.deepEqual(selfServiceDataExportIdentifiers({
    id: 'user-1',
    email: ' Titular@Example.com ',
    username: 'titular@example.com',
    collaboratorId: 'collab-1',
    clientCnpj: '12.345.678/0001-90'
  }), {
    userId: 'user-1',
    emails: ['titular@example.com'],
    username: 'titular@example.com',
    collaboratorId: 'collab-1',
    clientCnpj: '12.345.678/0001-90'
  });
});

test('self-service data export includes public signatures and survey responses matched by email', async () => {
  const calls = [];
  const user = {
    id: 'user-1',
    username: 'titular',
    name: 'Titular dos Dados',
    email: 'titular@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    clientCnpj: null,
    collaboratorId: null,
    collaborator: null,
    moduleRoles: [],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const prismaClient = {
    reportSignature: {
      findMany: async args => {
        calls.push(['reportSignature', args]);
        return [{
          id: 'sig-public-1',
          reportId: 'report-1',
          versionId: 'version-1',
          signerName: 'Titular dos Dados',
          signerEmail: 'titular@example.com',
          status: 'SIGNED',
          signedAt: new Date('2026-05-22T12:00:00.000Z')
        }];
      }
    },
    satisfactionSurvey: {
      findMany: async args => {
        calls.push(['satisfactionSurvey', args]);
        return [{
          id: 'survey-1',
          projectId: 'project-1',
          emailTo: 'titular@example.com',
          respondedAt: new Date('2026-05-22T13:00:00.000Z'),
          responses: { nps: 9 }
        }];
      }
    },
    dataSubjectRequest: {
      findMany: async args => {
        calls.push(['dataSubjectRequest', args]);
        return [];
      }
    },
    collaborator: {
      findFirst: async args => {
        calls.push(['collaborator', args]);
        return {
          id: 'collab-1',
          code: 'COL-1',
          name: 'Titular dos Dados',
          role: 'Técnico',
          email: 'titular@example.com',
          cpf: '123.456.789-00',
          epiRecords: [{
            id: 'epi-1',
            epiName: 'Capacete',
            ca: '12345',
            quantity: 1,
            lendDate: new Date('2026-05-20T12:00:00.000Z')
          }],
          epiSignatureRequests: []
        };
      }
    }
  };

  const exported = await buildSelfServiceDataExport(user, {
    prismaClient,
    now: new Date('2026-05-22T14:00:00.000Z')
  });

  assert.equal(exported.exportedAt, '2026-05-22T14:00:00.000Z');
  assert.deepEqual(exported.identifiers.emails, ['titular@example.com']);
  assert.equal(exported.reportSignatures.length, 1);
  assert.equal(exported.reportSignatures[0].id, 'sig-public-1');
  assert.equal(exported.surveyResponses.length, 1);
  assert.equal(exported.surveyResponses[0].id, 'survey-1');
  assert.equal(exported.collaboratorDetails.id, 'collab-1');
  assert.equal(exported.collaboratorDetails.epiRecords[0].id, 'epi-1');
  assert.deepEqual(calls.map(([model]) => model), ['reportSignature', 'satisfactionSurvey', 'dataSubjectRequest', 'collaborator']);
  assert.deepEqual(calls[0][1].where, {
    OR: [{ signerEmail: { equals: 'titular@example.com', mode: 'insensitive' } }]
  });
  assert.deepEqual(calls[1][1].where, {
    OR: [{ emailTo: { equals: 'titular@example.com', mode: 'insensitive' } }]
  });
});
