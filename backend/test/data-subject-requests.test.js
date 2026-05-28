import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';
import {
  dataSubjectProtocol,
  deletionRequestDetails,
  normalizeDataSubjectRequestType
} from '../src/lib/data-subject-requests.js';
import prisma from '../src/lib/prisma.js';
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
  SELF_SERVICE_PROJECT_EMAIL_SCOPE_BATCH_SIZE,
  SELF_SERVICE_PROJECT_EMAIL_SCOPE_MAX_SCOPES,
  SELF_SERVICE_PROJECT_EMAIL_SCOPE_QUERY_CONCURRENCY,
  selfServiceDataExportIdentifiers
} from '../src/routes/resources/privacy.js';

function dispatchApp(method, pathName, body, token = 'privacy-export-test-token') {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = new Readable({
      read() {
        if (payload) this.push(payload);
        this.push(null);
      }
    });
    req.method = method;
    req.url = pathName;
    req.headers = {
      authorization: `Bearer ${token}`,
      host: '127.0.0.1',
      ...(payload ? {
        'content-type': 'application/json',
        'content-length': String(payload.length)
      } : {})
    };
    req.socket = new PassThrough();
    req.socket.remoteAddress = '127.0.0.1';
    req.socket.encrypted = false;
    req.connection = req.socket;

    const chunks = [];
    const responseHeaders = new Map();
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    res.statusCode = 200;
    res.setHeader = (name, value) => responseHeaders.set(String(name).toLowerCase(), value);
    res.getHeader = name => responseHeaders.get(String(name).toLowerCase());
    res.getHeaders = () => Object.fromEntries(responseHeaders);
    res.removeHeader = name => responseHeaders.delete(String(name).toLowerCase());
    res.writeHead = (statusCode, headersToSet = {}) => {
      res.statusCode = statusCode;
      Object.entries(headersToSet).forEach(([name, value]) => res.setHeader(name, value));
      return res;
    };
    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      Writable.prototype.end.call(res, callback);
      const rawBody = Buffer.concat(chunks).toString('utf8');
      resolve({ statusCode: res.statusCode, body: rawBody, json: rawBody ? JSON.parse(rawBody) : null });
      return res;
    };

    app.handle(req, res, reject);
  });
}

function dispatchAppGet(pathName, token = 'privacy-export-test-token') {
  return dispatchApp('GET', pathName, undefined, token);
}

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

test('email verification migration only backfills immutable email usernames', () => {
  const migration = fs.readFileSync(
    new URL('../prisma/migrations/20260525120000_add_user_email_verified_at/migration.sql', import.meta.url),
    'utf8'
  );

  assert.match(migration, /POSITION\('@' IN "username"\) > 0/);
  assert.match(migration, /lower\(trim\("email"\)\) = lower\(trim\("username"\)\)/);
  assert.doesNotMatch(migration, /WHERE "email" IS NOT NULL\s+AND "accountType" IN \('ADMIN', 'INTERNAL'\);/);
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

test('self-service data export resolves email identifiers only from immutable username', () => {
  assert.deepEqual(selfServiceDataExportIdentifiers({
    id: 'user-1',
    email: ' Victim@Example.com ',
    username: ' Titular@Example.com ',
    collaboratorId: 'collab-1',
    clientCnpj: '12.345.678/0001-90'
  }), {
    userId: 'user-1',
    emails: ['titular@example.com'],
    username: 'Titular@Example.com',
    collaboratorId: 'collab-1',
    clientCnpj: '12.345.678/0001-90'
  });

  assert.deepEqual(selfServiceDataExportIdentifiers({
    id: 'user-2',
    email: ' Joao@Example.com ',
    emailVerifiedAt: new Date('2026-05-22T12:00:00.000Z'),
    username: 'joao',
    collaboratorId: null,
    clientCnpj: null
  }), {
    userId: 'user-2',
    emails: ['joao@example.com'],
    username: 'joao',
    collaboratorId: null,
    clientCnpj: null
  });
});

test('self-service data export includes public signatures and survey responses matched by email', async () => {
  const calls = [];
  const user = {
    id: 'user-1',
    username: 'titular@example.com',
    name: 'Titular dos Dados',
    email: 'changed@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    clientCnpj: null,
    collaboratorId: null,
    collaborator: null,
    moduleRoles: ['rdo:client'],
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

test('self-service data export includes verified account email for non-email usernames', async () => {
  const calls = [];
  const user = {
    id: 'user-1',
    username: 'joao',
    name: 'Joao',
    email: 'joao@example.com',
    emailVerifiedAt: new Date('2026-05-22T12:00:00.000Z'),
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    isActive: true,
    clientCnpj: null,
    collaboratorId: null,
    collaborator: null,
    moduleRoles: ['rdo:collaborator'],
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
        return [{ id: 'sig-verified-1', signerEmail: 'joao@example.com' }];
      }
    },
    satisfactionSurvey: {
      findMany: async args => {
        calls.push(['satisfactionSurvey', args]);
        return [{ id: 'survey-verified-1', emailTo: 'joao@example.com' }];
      }
    },
    dataSubjectRequest: {
      findMany: async args => {
        calls.push(['dataSubjectRequest', args]);
        return [{ id: 'dsr-verified-1', protocol: 'LGPD-1', type: 'ACCESS', status: 'OPEN' }];
      }
    },
    collaborator: {
      findFirst: async args => {
        calls.push(['collaborator', args]);
        return { id: 'collab-verified-1', email: 'joao@example.com', epiRecords: [], epiSignatureRequests: [] };
      }
    }
  };

  const exported = await buildSelfServiceDataExport(user, {
    prismaClient,
    now: new Date('2026-05-22T14:00:00.000Z')
  });

  assert.deepEqual(exported.identifiers.emails, ['joao@example.com']);
  assert.equal(exported.reportSignatures[0].id, 'sig-verified-1');
  assert.equal(exported.surveyResponses[0].id, 'survey-verified-1');
  assert.equal(exported.dataSubjectRequests[0].id, 'dsr-verified-1');
  assert.equal(exported.collaboratorDetails.id, 'collab-verified-1');
  assert.deepEqual(calls[0][1].where, {
    OR: [{ signerEmail: { equals: 'joao@example.com', mode: 'insensitive' } }]
  });
  assert.deepEqual(calls[3][1].where, {
    OR: [{ email: { equals: 'joao@example.com', mode: 'insensitive' } }]
  });
});

test('PUT /auth/account preserves verified email when normalized email is unchanged', async t => {
  const verifiedAt = new Date('2026-05-22T12:00:00.000Z');
  const user = {
    id: 'user-1',
    username: 'joao',
    name: 'Joao',
    email: 'joao@example.com',
    emailVerifiedAt: verifiedAt,
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    isActive: true,
    clientCnpj: null,
    collaboratorId: null,
    collaborator: null,
    moduleRoles: [{ role: 'RDO_COLLABORATOR' }],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const originalSessionFindUnique = prisma.userSession.findUnique;
  const originalUserFindUniqueOrThrow = prisma.user.findUniqueOrThrow;
  const originalUserUpdate = prisma.user.update;
  const originalReportSignatureFindMany = prisma.reportSignature.findMany;
  const originalSatisfactionSurveyFindMany = prisma.satisfactionSurvey.findMany;
  const originalDataSubjectRequestFindMany = prisma.dataSubjectRequest.findMany;
  const originalCollaboratorFindFirst = prisma.collaborator.findFirst;

  prisma.userSession.findUnique = async () => ({
    id: 'session-1',
    expiresAt: new Date(Date.now() + 60_000),
    user
  });
  prisma.user.findUniqueOrThrow = async args => {
    if (args.include && Object.keys(args.include).length === 2) {
      assert.deepEqual(args.include, { collaborator: true, moduleRoles: true });
    }
    return user;
  };
  prisma.user.update = async args => {
    throw new Error(`E-mail já verificado não deveria ser atualizado: ${JSON.stringify(args)}`);
  };
  prisma.reportSignature.findMany = async args => {
    assert.deepEqual(args.where, {
      OR: [{ signerEmail: { equals: 'joao@example.com', mode: 'insensitive' } }]
    });
    return [{ id: 'sig-preserved-1', signerEmail: 'joao@example.com' }];
  };
  prisma.satisfactionSurvey.findMany = async args => {
    assert.deepEqual(args.where, {
      OR: [{ emailTo: { equals: 'joao@example.com', mode: 'insensitive' } }]
    });
    return [{ id: 'survey-preserved-1', emailTo: 'joao@example.com' }];
  };
  prisma.dataSubjectRequest.findMany = async args => {
    assert.deepEqual(args.where, {
      OR: [{ email: { equals: 'joao@example.com', mode: 'insensitive' } }]
    });
    return [{ id: 'dsr-preserved-1', protocol: 'LGPD-1', type: 'ACCESS', status: 'OPEN' }];
  };
  prisma.collaborator.findFirst = async args => {
    assert.deepEqual(args.where, {
      OR: [{ email: { equals: 'joao@example.com', mode: 'insensitive' } }]
    });
    return { id: 'collab-preserved-1', email: 'joao@example.com', epiRecords: [], epiSignatureRequests: [] };
  };
  t.after(() => {
    prisma.userSession.findUnique = originalSessionFindUnique;
    prisma.user.findUniqueOrThrow = originalUserFindUniqueOrThrow;
    prisma.user.update = originalUserUpdate;
    prisma.reportSignature.findMany = originalReportSignatureFindMany;
    prisma.satisfactionSurvey.findMany = originalSatisfactionSurveyFindMany;
    prisma.dataSubjectRequest.findMany = originalDataSubjectRequestFindMany;
    prisma.collaborator.findFirst = originalCollaboratorFindFirst;
  });

  const accountResponse = await dispatchApp('PUT', '/api/auth/account', { email: ' Joao@Example.com ' });
  assert.equal(accountResponse.statusCode, 200);
  assert.equal(accountResponse.json.user.emailVerifiedAt, verifiedAt.toISOString());

  const exportResponse = await dispatchAppGet('/api/privacy/me/data-export');
  assert.equal(exportResponse.statusCode, 200);
  assert.deepEqual(exportResponse.json.identifiers.emails, ['joao@example.com']);
  assert.equal(exportResponse.json.reportSignatures[0].id, 'sig-preserved-1');
  assert.equal(exportResponse.json.surveyResponses[0].id, 'survey-preserved-1');
  assert.equal(exportResponse.json.dataSubjectRequests[0].id, 'dsr-preserved-1');
  assert.equal(exportResponse.json.collaboratorDetails.id, 'collab-preserved-1');
});

test('self-service data export omits unverified mutable account email for non-email usernames', async () => {
  const user = {
    id: 'user-1',
    username: 'joao',
    name: 'Joao',
    email: 'victim@example.com',
    emailVerifiedAt: null,
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    isActive: true,
    clientCnpj: null,
    collaboratorId: null,
    collaborator: null,
    moduleRoles: ['rdo:collaborator'],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const prismaClient = {
    reportSignature: {
      findMany: async () => {
        throw new Error('unverified account email must not query report signatures');
      }
    },
    satisfactionSurvey: {
      findMany: async () => {
        throw new Error('unverified account email must not query surveys');
      }
    },
    dataSubjectRequest: {
      findMany: async () => {
        throw new Error('unverified account email must not query LGPD requests');
      }
    },
    collaborator: {
      findFirst: async () => {
        throw new Error('unverified account email must not query collaborators');
      }
    }
  };

  const exported = await buildSelfServiceDataExport(user, {
    prismaClient,
    now: new Date('2026-05-22T14:00:00.000Z')
  });

  assert.deepEqual(exported.identifiers.emails, []);
  assert.equal(exported.reportSignatures.length, 0);
  assert.equal(exported.surveyResponses.length, 0);
  assert.equal(exported.dataSubjectRequests.length, 0);
  assert.equal(exported.collaboratorDetails, null);
});

test('self-service data export includes primary project email records for CNPJ clients', async () => {
  const calls = [];
  const user = {
    id: 'user-1',
    username: '11222333000144',
    name: 'Cliente',
    email: 'changed@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    clientCnpj: '11222333000144',
    collaboratorId: null,
    collaborator: null,
    moduleRoles: ['rdo:client'],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const prismaClient = {
    project: {
      findMany: async args => {
        calls.push(['project', args]);
        return [{ id: 'project-allowed', clientEmailPrimary: ' Cliente@Example.com ' }];
      }
    },
    reportSignature: {
      findMany: async args => {
        calls.push(['reportSignature', args]);
        return [{
          id: 'sig-cnpj-1',
          signerEmail: 'cliente@example.com',
          status: 'SIGNED'
        }];
      }
    },
    satisfactionSurvey: {
      findMany: async args => {
        calls.push(['satisfactionSurvey', args]);
        return [{
          id: 'survey-cnpj-1',
          emailTo: 'cliente@example.com',
          responses: { nps: 10 }
        }];
      }
    },
    dataSubjectRequest: {
      findMany: async () => {
        throw new Error('project primary emails must not query LGPD requests as personal email identifiers');
      }
    },
    collaborator: {
      findFirst: async () => {
        throw new Error('project primary emails must not query collaborator details as personal email identifiers');
      }
    }
  };

  const exported = await buildSelfServiceDataExport(user, {
    prismaClient,
    now: new Date('2026-05-22T14:00:00.000Z')
  });

  assert.deepEqual(exported.identifiers.emails, []);
  assert.equal(exported.reportSignatures[0].id, 'sig-cnpj-1');
  assert.equal(exported.surveyResponses[0].id, 'survey-cnpj-1');
  assert.equal(exported.dataSubjectRequests.length, 0);
  assert.equal(exported.collaboratorDetails, null);
  assert.deepEqual(calls.map(([model]) => model), ['project', 'reportSignature', 'satisfactionSurvey']);
  assert.deepEqual(calls[0][1].where, {
    clientCnpj: '11222333000144',
    managerOnly: false,
    deletedAt: null
  });
  assert.deepEqual(calls[0][1].select, { id: true, clientEmailPrimary: true });
  assert.deepEqual(calls[0][1].orderBy, { id: 'asc' });
  assert.equal(calls[0][1].take, SELF_SERVICE_PROJECT_EMAIL_SCOPE_MAX_SCOPES + 1);
  assert.deepEqual(calls[1][1].where, {
    OR: [{
      signerEmail: { equals: 'cliente@example.com', mode: 'insensitive' },
      report: { projectId: 'project-allowed' }
    }]
  });
  assert.deepEqual(calls[2][1].where, {
    OR: [{
      projectId: 'project-allowed',
      emailTo: { equals: 'cliente@example.com', mode: 'insensitive' }
    }]
  });
});

test('self-service data export derives CNPJ project scopes from canonical username when clientCnpj is missing', async () => {
  const calls = [];
  const user = {
    id: 'user-1',
    username: '11222333000144',
    name: 'Cliente',
    email: null,
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    clientCnpj: null,
    collaboratorId: null,
    collaborator: null,
    moduleRoles: ['rdo:client'],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const prismaClient = {
    project: {
      findMany: async args => {
        calls.push(['project', args]);
        return [{ id: 'project-allowed', clientEmailPrimary: 'cliente@example.com' }];
      }
    },
    reportSignature: {
      findMany: async args => {
        calls.push(['reportSignature', args]);
        return [{ id: 'sig-cnpj-1', signerEmail: 'cliente@example.com' }];
      }
    },
    satisfactionSurvey: {
      findMany: async args => {
        calls.push(['satisfactionSurvey', args]);
        return [{ id: 'survey-cnpj-1', emailTo: 'cliente@example.com' }];
      }
    }
  };

  const exported = await buildSelfServiceDataExport(user, {
    prismaClient,
    now: new Date('2026-05-22T14:00:00.000Z')
  });

  assert.deepEqual(exported.identifiers.emails, []);
  assert.equal(exported.reportSignatures[0].id, 'sig-cnpj-1');
  assert.equal(exported.surveyResponses[0].id, 'survey-cnpj-1');
  assert.equal(calls[0][1].where.clientCnpj, '11222333000144');
});

test('self-service data export does not expand project primary emails for email client accounts', async () => {
  const calls = [];
  const user = {
    id: 'user-1',
    username: 'cc@example.com',
    name: 'Contato CC',
    email: 'owner@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    clientCnpj: '11222333000144',
    collaboratorId: null,
    collaborator: null,
    moduleRoles: ['rdo:client'],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const prismaClient = {
    project: {
      findMany: async () => {
        throw new Error('email client accounts must not inherit primary project emails by CNPJ');
      }
    },
    reportSignature: {
      findMany: async args => {
        calls.push(['reportSignature', args]);
        return [];
      }
    },
    satisfactionSurvey: {
      findMany: async args => {
        calls.push(['satisfactionSurvey', args]);
        return [];
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
        return null;
      }
    }
  };

  const exported = await buildSelfServiceDataExport(user, {
    prismaClient,
    now: new Date('2026-05-22T14:00:00.000Z')
  });

  assert.deepEqual(exported.identifiers.emails, ['cc@example.com']);
  assert.equal(exported.reportSignatures.length, 0);
  assert.equal(exported.surveyResponses.length, 0);
  assert.equal(exported.dataSubjectRequests.length, 0);
  assert.deepEqual(calls.map(([model]) => model), ['reportSignature', 'satisfactionSurvey', 'dataSubjectRequest', 'collaborator']);
  assert.deepEqual(calls[0][1].where, {
    OR: [{ signerEmail: { equals: 'cc@example.com', mode: 'insensitive' } }]
  });
  assert.deepEqual(calls[1][1].where, {
    OR: [{ emailTo: { equals: 'cc@example.com', mode: 'insensitive' } }]
  });
  assert.deepEqual(calls[2][1].where, {
    OR: [{ email: { equals: 'cc@example.com', mode: 'insensitive' } }]
  });
  assert.deepEqual(calls[3][1].where, {
    OR: [{ email: { equals: 'cc@example.com', mode: 'insensitive' } }]
  });
});

test('self-service data export does not expand project primary emails for non-CNPJ usernames', async () => {
  const user = {
    id: 'user-1',
    username: 'cliente-interno',
    name: 'Cliente',
    email: 'owner@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    clientCnpj: '11222333000144',
    collaboratorId: null,
    collaborator: null,
    moduleRoles: ['rdo:client'],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const prismaClient = {
    project: {
      findMany: async () => {
        throw new Error('non-CNPJ usernames must not inherit primary project emails by clientCnpj');
      }
    }
  };

  const exported = await buildSelfServiceDataExport(user, {
    prismaClient,
    now: new Date('2026-05-22T14:00:00.000Z')
  });

  assert.deepEqual(exported.identifiers.emails, []);
  assert.equal(exported.reportSignatures.length, 0);
  assert.equal(exported.surveyResponses.length, 0);
  assert.equal(exported.dataSubjectRequests.length, 0);
  assert.equal(exported.collaboratorDetails, null);
});

test('self-service data export does not expand CNPJ-shaped usernames for non-client accounts', async () => {
  const user = {
    id: 'user-1',
    username: '11222333000144',
    name: 'Interno',
    email: 'interno@example.com',
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    isActive: true,
    clientCnpj: '11222333000144',
    collaboratorId: null,
    collaborator: null,
    moduleRoles: ['rdo:collaborator'],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const prismaClient = {
    project: {
      findMany: async () => {
        throw new Error('internal accounts must not expand project primary emails by CNPJ-shaped username');
      }
    }
  };

  const exported = await buildSelfServiceDataExport(user, {
    prismaClient,
    now: new Date('2026-05-22T14:00:00.000Z')
  });

  assert.deepEqual(exported.identifiers.emails, []);
  assert.equal(exported.reportSignatures.length, 0);
  assert.equal(exported.surveyResponses.length, 0);
  assert.equal(exported.dataSubjectRequests.length, 0);
  assert.equal(exported.collaboratorDetails, null);
});

test('GET /privacy/me/data-export does not expand CNPJ-shaped usernames for internal accounts', async t => {
  const originalSessionFindUnique = prisma.userSession.findUnique;
  const originalUserFindUniqueOrThrow = prisma.user.findUniqueOrThrow;
  const originalProjectFindMany = prisma.project.findMany;
  prisma.userSession.findUnique = async () => ({
    id: 'session-1',
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'user-1',
      username: '11222333000144',
      name: 'Interno',
      email: 'interno@example.com',
      role: 'COLLABORATOR',
      accountType: 'INTERNAL',
      isActive: true,
      clientCnpj: '11222333000144',
      collaboratorId: null,
      moduleRoles: [{ role: 'RDO_COLLABORATOR' }]
    }
  });
  prisma.user.findUniqueOrThrow = async () => ({
    id: 'user-1',
    username: '11222333000144',
    name: 'Interno',
    email: 'interno@example.com',
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    isActive: true,
    clientCnpj: '11222333000144',
    collaboratorId: null,
    collaborator: null,
    moduleRoles: [{ role: 'RDO_COLLABORATOR' }],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  });
  prisma.project.findMany = async () => {
    throw new Error('internal route export must not expand project primary emails by CNPJ-shaped username');
  };
  t.after(() => {
    prisma.userSession.findUnique = originalSessionFindUnique;
    prisma.user.findUniqueOrThrow = originalUserFindUniqueOrThrow;
    prisma.project.findMany = originalProjectFindMany;
  });

  const response = await dispatchAppGet('/api/privacy/me/data-export');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.identifiers.emails, []);
  assert.equal(response.json.reportSignatures.length, 0);
  assert.equal(response.json.surveyResponses.length, 0);
});

test('self-service data export chunks high-cardinality project email scopes', async () => {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  async function withTrackedDelay(callback) {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 5));
    try {
      return callback();
    } finally {
      inFlight -= 1;
    }
  }
  const projectCount = SELF_SERVICE_PROJECT_EMAIL_SCOPE_BATCH_SIZE + 3;
  const user = {
    id: 'user-1',
    username: '11222333000144',
    name: 'Cliente',
    email: 'changed@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    clientCnpj: '11222333000144',
    collaboratorId: null,
    collaborator: null,
    moduleRoles: ['rdo:client'],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const prismaClient = {
    project: {
      findMany: async args => {
        calls.push(['project', args]);
        return Array.from({ length: projectCount }, (_, index) => ({
          id: `project-${index + 1}`,
          clientEmailPrimary: `cliente-${index + 1}@example.com`
        }));
      }
    },
    reportSignature: {
      findMany: args => withTrackedDelay(() => {
        calls.push(['reportSignature', args]);
        return [{
          id: 'sig-duplicate',
          signerEmail: args.where.OR[0].signerEmail.equals,
          status: 'SIGNED'
        }];
      })
    },
    satisfactionSurvey: {
      findMany: args => withTrackedDelay(() => {
        calls.push(['satisfactionSurvey', args]);
        return [{
          id: 'survey-duplicate',
          projectId: args.where.OR[0].projectId,
          emailTo: args.where.OR[0].emailTo.equals,
          responses: { nps: 9 }
        }];
      })
    },
    dataSubjectRequest: {
      findMany: async () => {
        throw new Error('project primary emails must not query LGPD requests as personal email identifiers');
      }
    },
    collaborator: {
      findFirst: async () => {
        throw new Error('project primary emails must not query collaborator details as personal email identifiers');
      }
    }
  };

  const exported = await buildSelfServiceDataExport(user, {
    prismaClient,
    now: new Date('2026-05-22T14:00:00.000Z')
  });

  const signatureCalls = calls.filter(([model]) => model === 'reportSignature');
  const surveyCalls = calls.filter(([model]) => model === 'satisfactionSurvey');
  assert.equal(signatureCalls.length, 2);
  assert.equal(surveyCalls.length, 2);
  assert.equal(maxInFlight <= SELF_SERVICE_PROJECT_EMAIL_SCOPE_QUERY_CONCURRENCY, true);
  assert.equal(signatureCalls.every(([, args]) => args.where.OR.length <= SELF_SERVICE_PROJECT_EMAIL_SCOPE_BATCH_SIZE), true);
  assert.equal(surveyCalls.every(([, args]) => args.where.OR.length <= SELF_SERVICE_PROJECT_EMAIL_SCOPE_BATCH_SIZE), true);
  assert.deepEqual(signatureCalls.map(([, args]) => args.where.OR.length), [SELF_SERVICE_PROJECT_EMAIL_SCOPE_BATCH_SIZE, 3]);
  assert.deepEqual(surveyCalls.map(([, args]) => args.where.OR.length), [SELF_SERVICE_PROJECT_EMAIL_SCOPE_BATCH_SIZE, 3]);
  assert.deepEqual(exported.identifiers.emails, []);
  assert.deepEqual(exported.reportSignatures.map(item => item.id), ['sig-duplicate']);
  assert.deepEqual(exported.surveyResponses.map(item => item.id), ['survey-duplicate']);
});

test('self-service data export rejects excessive project email scopes', async () => {
  const user = {
    id: 'user-1',
    username: '11222333000144',
    name: 'Cliente',
    email: 'changed@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    clientCnpj: '11222333000144',
    collaboratorId: null,
    collaborator: null,
    moduleRoles: ['rdo:client'],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const prismaClient = {
    project: {
      findMany: async () => Array.from({ length: SELF_SERVICE_PROJECT_EMAIL_SCOPE_MAX_SCOPES + 1 }, (_, index) => ({
        id: `project-${index + 1}`,
        clientEmailPrimary: `cliente-${index + 1}@example.com`
      }))
    },
    reportSignature: {
      findMany: async () => {
        throw new Error('excessive scopes must be rejected before report signature queries');
      }
    },
    satisfactionSurvey: {
      findMany: async () => {
        throw new Error('excessive scopes must be rejected before survey queries');
      }
    }
  };

  await assert.rejects(
    () => buildSelfServiceDataExport(user, {
      prismaClient,
      now: new Date('2026-05-22T14:00:00.000Z')
    }),
    error => error?.statusCode === 413
  );
});

test('self-service data export rejects excessive raw project scopes before filtering blank emails', async () => {
  const user = {
    id: 'user-1',
    username: '11222333000144',
    name: 'Cliente',
    email: 'changed@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    clientCnpj: '11222333000144',
    collaboratorId: null,
    collaborator: null,
    moduleRoles: ['rdo:client'],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const prismaClient = {
    project: {
      findMany: async args => {
        assert.deepEqual(args.orderBy, { id: 'asc' });
        return Array.from({ length: SELF_SERVICE_PROJECT_EMAIL_SCOPE_MAX_SCOPES + 1 }, (_, index) => ({
          id: `project-${index + 1}`,
          clientEmailPrimary: index === SELF_SERVICE_PROJECT_EMAIL_SCOPE_MAX_SCOPES ? '' : `cliente-${index + 1}@example.com`
        }));
      }
    },
    reportSignature: {
      findMany: async () => {
        throw new Error('excessive raw project scopes must be rejected before report signature queries');
      }
    },
    satisfactionSurvey: {
      findMany: async () => {
        throw new Error('excessive raw project scopes must be rejected before survey queries');
      }
    }
  };

  await assert.rejects(
    () => buildSelfServiceDataExport(user, {
      prismaClient,
      now: new Date('2026-05-22T14:00:00.000Z')
    }),
    error => error?.statusCode === 413
  );
});

test('self-service data export ignores mutable account email for third-party lookups', async () => {
  const calls = [];
  const user = {
    id: 'user-1',
    username: '11222333000144',
    name: 'Cliente',
    email: 'victim@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    clientCnpj: '11222333000144',
    collaboratorId: 'collab-own',
    collaborator: null,
    moduleRoles: ['rdo:client'],
    drafts: [],
    clientReportReviews: [],
    reportSignatures: [],
    createdReports: [],
    sentSurveys: [],
    dataSubjectRequests: []
  };
  const prismaClient = {
    project: {
      findMany: async args => {
        calls.push(['project', args]);
        return [{ id: 'project-owner', clientEmailPrimary: 'owner@example.com' }];
      }
    },
    reportSignature: {
      findMany: async args => {
        calls.push(['reportSignature', args]);
        return [];
      }
    },
    satisfactionSurvey: {
      findMany: async args => {
        calls.push(['satisfactionSurvey', args]);
        return [];
      }
    },
    dataSubjectRequest: {
      findMany: async () => {
        throw new Error('project primary emails must not query LGPD requests as personal email identifiers');
      }
    },
    collaborator: {
      findFirst: async args => {
        calls.push(['collaborator', args]);
        return {
          id: 'collab-own',
          code: 'COL-OWN',
          name: 'Cliente',
          role: 'Operador',
          email: 'owner@example.com',
          cpf: '000.000.000-00',
          epiRecords: [],
          epiSignatureRequests: []
        };
      }
    }
  };

  const exported = await buildSelfServiceDataExport(user, {
    prismaClient,
    now: new Date('2026-05-22T14:00:00.000Z')
  });

  assert.deepEqual(exported.identifiers.emails, []);
  assert.equal(exported.reportSignatures.length, 0);
  assert.equal(exported.surveyResponses.length, 0);
  assert.equal(exported.dataSubjectRequests.length, 0);
  assert.equal(exported.collaboratorDetails.id, 'collab-own');
  assert.deepEqual(calls.map(([model]) => model), ['project', 'collaborator', 'reportSignature', 'satisfactionSurvey']);
  assert.deepEqual(calls[1][1].where, {
    OR: [{ id: 'collab-own' }]
  });
  assert.deepEqual(calls[2][1].where, {
    OR: [{
      signerEmail: { equals: 'owner@example.com', mode: 'insensitive' },
      report: { projectId: 'project-owner' }
    }]
  });
  assert.deepEqual(calls[3][1].where, {
    OR: [{
      projectId: 'project-owner',
      emailTo: { equals: 'owner@example.com', mode: 'insensitive' }
    }]
  });
});
