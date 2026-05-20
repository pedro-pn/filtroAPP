import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  activePublicEpiRequestOrThrow,
  activePendingEpiSignatureRequestIdsForRecords,
  assertCanCreateEpiSignatureRequest,
  assertCanDeleteEpiRecord,
  assertCanUnarchiveEpiRecords,
  assertCanUpdateEpiRecord,
  assertEpiDateOrder,
  canAccessEpiCollaborator,
  confirmPublicEpiSignatureRequest,
  epiCollaboratorAccessWhere,
  expiredEpiSignatureRequestIdsForRecords,
  isSignedEpiReturnUpdate,
  parseDateOnly,
  publicPdfEpiRequestOrThrow,
  publicEpiSignaturePayload,
  requireEpiAccess,
  requireEpiTechnician,
  requestStatus,
  signedPublicPdfFileOrThrow
} from '../src/routes/resources/epis.js';
import { redactedEpiCollaboratorForPublicPdf } from '../src/lib/epi-docx.js';
import {
  decodableSignatureImageDataUrl,
  parseSignatureImageDataUrl,
  signatureEvidenceFromRequest
} from '../src/lib/internal-report-signatures.js';

const validSignatureImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const testPdfArtifact = async () => ({
  signedPdfPath: '/tmp/epi-signed-test.pdf',
  signedPdfHash: 'signed-pdf-hash',
  signedPdfFileName: 'signed-test.pdf'
});

const technicianAuth = {
  user: {
    accountType: 'INTERNAL',
    moduleRoles: ['epi:technician'],
    collaboratorId: null
  }
};

const collaboratorAuth = {
  user: {
    accountType: 'INTERNAL',
    moduleRoles: ['epi:collaborator'],
    collaboratorId: 'collab-1'
  }
};

function signatureRequest(overrides = {}) {
  return {
    id: 'request-1',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    signedAt: null,
    collaborator: {
      id: 'collab-1',
      name: 'Colaborador',
      role: 'Técnico',
      cpf: '123.456.789-09',
      registrationNumber: 'M-1',
      admissionDate: new Date('2024-01-01T12:00:00.000Z')
    },
    records: [
      {
        id: 'record-1',
        collaboratorId: 'collab-1',
        catalogItemId: 'catalog-1',
        epiName: 'Capacete',
        ca: '',
        quantity: 1,
        lendDate: new Date('2024-02-01T12:00:00.000Z'),
        devolutionDate: null,
        signatureRequestId: 'request-1',
        signatureImageDataUrl: 'data:image/png;base64,secret',
        signatureSignerName: 'Assinante',
        signedAt: null,
        archivedAt: null,
        createdAt: new Date('2024-02-01T12:00:00.000Z'),
        updatedAt: new Date('2024-02-01T12:00:00.000Z')
      }
    ],
    ...overrides
  };
}

test('EPI collaborator access is scoped to the linked collaborator', () => {
  assert.deepEqual(epiCollaboratorAccessWhere(technicianAuth), {});
  assert.deepEqual(epiCollaboratorAccessWhere(collaboratorAuth), { id: 'collab-1' });
  assert.equal(canAccessEpiCollaborator(collaboratorAuth, 'collab-1'), true);
  assert.equal(canAccessEpiCollaborator(collaboratorAuth, 'collab-2'), false);
  assert.deepEqual(
    epiCollaboratorAccessWhere({ user: { accountType: 'INTERNAL', moduleRoles: ['epi:collaborator'], collaboratorId: null } }),
    { id: '__NO_MATCH__' }
  );
});

test('EPI guards require explicit module roles even for admin accounts', () => {
  const adminWithoutEpiRole = { auth: { user: { accountType: 'ADMIN', moduleRoles: [] } } };
  const forbidden = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  let nextCalled = false;

  requireEpiAccess(adminWithoutEpiRole, forbidden, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(forbidden.statusCode, 403);

  requireEpiTechnician(
    { auth: { user: { accountType: 'ADMIN', moduleRoles: ['epi:technician'] } } },
    forbidden,
    () => {
      nextCalled = true;
    }
  );
  assert.equal(nextCalled, true);
});

test('public EPI signature payload omits CPF and signature image data', () => {
  const payload = publicEpiSignaturePayload(signatureRequest());

  assert.equal(payload.status, 'ACTIVE');
  assert.deepEqual(payload.collaborator, {
    id: 'collab-1',
    name: 'Colaborador',
    role: 'Técnico'
  });
  assert.equal('cpf' in payload.collaborator, false);
  assert.equal('registrationNumber' in payload.collaborator, false);
  assert.equal('admissionDate' in payload.collaborator, false);
  assert.equal('signatureImageDataUrl' in payload.records[0], false);
  assert.equal('signatureSignerName' in payload.records[0], false);
});

test('public EPI signature payload hides records after token is consumed or expired', () => {
  const signed = publicEpiSignaturePayload(signatureRequest({ status: 'SIGNED', signedAt: new Date() }));
  const expired = publicEpiSignaturePayload(signatureRequest({ expiresAt: new Date(Date.now() - 60_000) }));

  assert.equal(signed.status, 'SIGNED');
  assert.equal(signed.collaborator, null);
  assert.deepEqual(signed.records, []);
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(expired.collaborator, null);
  assert.deepEqual(expired.records, []);
});

test('active public EPI request guard rejects expired and consumed links', async () => {
  const signedClient = {
    epiSignatureRequest: {
      findUnique: async () => signatureRequest({ status: 'SIGNED', signedAt: new Date() })
    }
  };
  const expiredClient = {
    epiSignatureRequest: {
      findUnique: async () => signatureRequest({ expiresAt: new Date(Date.now() - 60_000) })
    }
  };
  const activeClient = {
    epiSignatureRequest: {
      findUnique: async () => signatureRequest()
    }
  };

  await assert.rejects(() => activePublicEpiRequestOrThrow('token', signedClient), /indisponível/);
  await assert.rejects(() => activePublicEpiRequestOrThrow('token', expiredClient), /indisponível/);
  assert.equal((await activePublicEpiRequestOrThrow('token', activeClient)).id, 'request-1');
});

test('public EPI PDF guard allows signed links until public download expiry', async () => {
  const signedClient = {
    epiSignatureRequest: {
      findUnique: async () => signatureRequest({ status: 'SIGNED', signedAt: new Date() })
    }
  };
  const expiredSignedClient = {
    epiSignatureRequest: {
      findUnique: async () => signatureRequest({
        status: 'SIGNED',
        signedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 1_000)
      })
    }
  };
  const expiredClient = {
    epiSignatureRequest: {
      findUnique: async () => signatureRequest({ expiresAt: new Date(Date.now() - 60_000) })
    }
  };

  assert.equal((await publicPdfEpiRequestOrThrow('token', signedClient)).id, 'request-1');
  await assert.rejects(() => publicPdfEpiRequestOrThrow('token', expiredSignedClient), /indisponível/);
  await assert.rejects(() => publicPdfEpiRequestOrThrow('token', expiredClient), /indisponível/);
});

test('EPI date parser requires strict DD/MM/YYYY calendar dates', () => {
  assert.equal(parseDateOnly('29/02/2024', 'lendDate').toISOString(), '2024-02-29T15:00:00.000Z');
  assert.throws(() => parseDateOnly('31/02/2024', 'lendDate'), /DD\/MM\/YYYY/);
  assert.throws(() => parseDateOnly('2024-02-29', 'lendDate'), /DD\/MM\/YYYY/);
  assert.throws(() => parseDateOnly('29/02/2024T00:00:00', 'lendDate'), /DD\/MM\/YYYY/);
});

test('EPI creation rejects devolution date before lend date', () => {
  const lendDate = parseDateOnly('20/05/2026', 'lendDate');
  const devolutionDate = parseDateOnly('19/05/2026', 'devolutionDate');
  assert.throws(() => assertEpiDateOrder(lendDate, devolutionDate), /anterior à data de fornecimento/);
  assert.doesNotThrow(() => assertEpiDateOrder(lendDate, parseDateOnly('20/05/2026', 'devolutionDate')));
});

test('unsigned EPI edits reject date ranges that move return before lend date', () => {
  const currentLendDate = parseDateOnly('20/05/2026', 'lendDate');
  const currentDevolutionDate = parseDateOnly('22/05/2026', 'devolutionDate');
  assert.throws(
    () => assertEpiDateOrder(parseDateOnly('23/05/2026', 'lendDate'), currentDevolutionDate),
    /anterior à data de fornecimento/
  );
  assert.throws(
    () => assertEpiDateOrder(currentLendDate, parseDateOnly('19/05/2026', 'devolutionDate')),
    /anterior à data de fornecimento/
  );
});

test('signed EPI return revisions reject devolution date before signed lend date', () => {
  const signedLendDate = parseDateOnly('20/05/2026', 'lendDate');
  const returnedAt = parseDateOnly('19/05/2026', 'devolutionDate');
  assert.throws(() => assertEpiDateOrder(signedLendDate, returnedAt), /anterior à data de fornecimento/);
});

test('public EPI confirmation rejects invalid token before decoding signature image', async () => {
  let transactionStarted = false;
  const client = {
    epiSignatureRequest: {
      findUnique: async () => null
    },
    $transaction: async () => {
      transactionStarted = true;
      throw new Error('transaction should not start');
    }
  };

  await assert.rejects(
    () => confirmPublicEpiSignatureRequest({
      token: 'token',
      body: {
        signerName: 'Assinante',
        signatureImageDataUrl: `data:image/png;base64,${Buffer.from('not-a-png').toString('base64')}`
      },
      req: { headers: {}, ip: '203.0.113.10' },
      client
    }),
    /Link de assinatura inválido/
  );
  assert.equal(transactionStarted, false);
});

test('public EPI confirmation rejects malformed signature image before updating records', async () => {
  let transactionStarted = false;
  const client = {
    epiSignatureRequest: {
      findUnique: async () => signatureRequest()
    },
    $transaction: async () => {
      transactionStarted = true;
      throw new Error('transaction should not start');
    }
  };

  await assert.rejects(
    () => confirmPublicEpiSignatureRequest({
      token: 'token',
      body: {
        signerName: 'Assinante',
        signatureImageDataUrl: `data:image/png;base64,${Buffer.from('not-a-png').toString('base64')}`
      },
      req: { headers: {}, ip: '203.0.113.10' },
      client
    }),
    /Assinatura visual invalida/
  );
  assert.equal(transactionStarted, false);
});

test('public EPI confirmation is idempotent after successful signing', async () => {
  let transactionStarted = false;
  let pdfCreated = false;
  const signedRequest = signatureRequest({
    status: 'SIGNED',
    signedAt: new Date('2026-05-20T12:00:00.000Z'),
    expiresAt: new Date(Date.now() + 60_000),
    signedPdfPath: '/tmp/epi-signed-test.pdf',
    signedPdfHash: 'signed-pdf-hash',
    signedPdfFileName: 'signed-test.pdf'
  });
  const client = {
    epiSignatureRequest: {
      findUnique: async () => signedRequest
    },
    $transaction: async () => {
      transactionStarted = true;
      throw new Error('transaction should not start');
    }
  };

  const result = await confirmPublicEpiSignatureRequest({
    token: 'token',
    body: {
      signerName: 'Assinante',
      signatureImageDataUrl: validSignatureImageDataUrl
    },
    req: { headers: {}, ip: '203.0.113.10' },
    client,
    pdfArtifactFactory: async () => {
      pdfCreated = true;
      return testPdfArtifact();
    }
  });

  assert.equal(result.signed, signedRequest);
  assert.equal(result.alreadySigned, true);
  assert.equal(transactionStarted, false);
  assert.equal(pdfCreated, false);
});

test('signature image parser requires decodable PNG or JPEG bytes', async () => {
  const malformedPng = `data:image/png;base64,${Buffer.from('not-a-png').toString('base64')}`;

  assert.equal(parseSignatureImageDataUrl(malformedPng), null);
  assert.equal(await decodableSignatureImageDataUrl(malformedPng), null);
  assert.equal(parseSignatureImageDataUrl(validSignatureImageDataUrl)?.mimeType, 'image/png');
  assert.equal((await decodableSignatureImageDataUrl(validSignatureImageDataUrl))?.width, 1);
});

test('public EPI confirmation persists trusted proxy signer IP evidence and audit log', async () => {
  const request = signatureRequest({ requestedByUserId: 'user-1' });
  const updates = [];
  const recordUpdates = [];
  const auditLogs = [];
  const txClient = {
    epiSignatureRequest: {
      findUnique: async () => request,
      update: async args => {
        updates.push(args);
        return signatureRequest({
          ...request,
          status: 'SIGNED',
          signedAt: args.data.signedAt,
          expiresAt: args.data.expiresAt,
          signatureImageDataUrl: args.data.signatureImageDataUrl,
          signatureSignerName: args.data.signatureSignerName,
          ipAddress: args.data.ipAddress,
          userAgent: args.data.userAgent
        });
      }
    },
    epiRecord: {
      updateMany: async args => {
        recordUpdates.push(args);
        return { count: request.records.length };
      }
    },
    epiSignatureRequestAuditLog: {
      create: async args => {
        auditLogs.push(args);
        return { id: 'audit-1', ...args.data };
      }
    }
  };
  const client = {
    epiSignatureRequest: {
      findUnique: async () => request
    },
    $transaction: async callback => callback(txClient)
  };

  const result = await confirmPublicEpiSignatureRequest({
    token: 'token',
    body: {
      signerName: 'Assinante',
      signatureImageDataUrl: validSignatureImageDataUrl
    },
    req: {
      headers: {
        'x-forwarded-for': '8.8.8.8',
        'user-agent': 'Unit Test Browser'
      },
      app: { get: key => key === 'trust proxy' },
      ips: ['8.8.8.8'],
      ip: '172.18.0.5'
    },
    client,
    pdfArtifactFactory: testPdfArtifact
  });

  assert.equal(result.evidence.ipAddress, '8.8.8.8');
  assert.equal(result.evidence.userAgent, 'Unit Test Browser');
  assert.equal(recordUpdates[0].data.signatureImageDataUrl, undefined);
  assert.equal(recordUpdates[0].data.signatureSignerName, 'Assinante');
  assert.equal(updates[0].data.signatureImageDataUrl, validSignatureImageDataUrl);
  assert.equal(updates[0].data.signatureSignerName, 'Assinante');
  assert.equal(updates[0].data.signedPdfPath, '/tmp/epi-signed-test.pdf');
  assert.equal(updates[0].data.signedPdfHash, 'signed-pdf-hash');
  assert.equal(updates[0].data.signedPdfFileName, 'signed-test.pdf');
  assert.equal(updates[0].data.ipAddress, '8.8.8.8');
  assert.equal(updates[0].data.userAgent, 'Unit Test Browser');
  assert.equal(auditLogs[0].data.action, 'SIGNED');
  assert.equal(auditLogs[0].data.ipAddress, '8.8.8.8');
  assert.equal(auditLogs[0].data.userAgent, 'Unit Test Browser');
});

test('public EPI confirmation promotes signed pending return revisions', async () => {
  const request = signatureRequest({
    records: [
      {
        ...signatureRequest().records[0],
        id: 'return-record-1',
        signedAt: null,
        pendingReturn: true,
        returnSourceRecordId: 'record-1',
        archivedAt: null
      }
    ]
  });
  const recordUpdates = [];
  const client = {
    epiSignatureRequest: {
      findUnique: async () => request
    },
    $transaction: async callback => callback({
      epiSignatureRequest: {
        findUnique: async () => request,
        update: async args => signatureRequest({
          ...request,
          status: 'SIGNED',
          signedAt: args.data.signedAt,
          expiresAt: args.data.expiresAt,
          signatureImageDataUrl: args.data.signatureImageDataUrl,
          signatureSignerName: args.data.signatureSignerName
        })
      },
      epiRecord: {
        updateMany: async args => {
          recordUpdates.push(args);
          return { count: args.data.signedAt ? request.records.length : 1 };
        }
      },
      epiSignatureRequestAuditLog: {
        create: async args => ({ id: 'audit-1', ...args.data })
      }
    })
  };

  await confirmPublicEpiSignatureRequest({
    token: 'token',
    body: {
      signerName: 'Assinante',
      signatureImageDataUrl: validSignatureImageDataUrl
    },
    req: { headers: {}, ip: '198.51.100.7' },
    client,
    pdfArtifactFactory: testPdfArtifact
  });

  assert.deepEqual(recordUpdates[0].where, { signatureRequestId: request.id, signedAt: null, archivedAt: null });
  assert.equal(recordUpdates[0].data.signedAt instanceof Date, true);
  assert.deepEqual(recordUpdates[1].where.id, { in: ['record-1'] });
  assert.deepEqual(recordUpdates[1].where.signedAt, { not: null });
  assert.equal(recordUpdates[1].data.archivedAt instanceof Date, true);
  assert.deepEqual(recordUpdates[2].where.id, { in: ['return-record-1'] });
  assert.equal(recordUpdates[2].data.pendingReturn, false);
});

test('public EPI confirmation rejects stale pending return revisions when source is already archived', async () => {
  const request = signatureRequest({
    records: [
      {
        ...signatureRequest().records[0],
        id: 'return-record-1',
        signedAt: null,
        pendingReturn: true,
        returnSourceRecordId: 'record-1',
        archivedAt: null
      }
    ]
  });
  const client = {
    epiSignatureRequest: {
      findUnique: async () => request
    },
    $transaction: async callback => callback({
      epiSignatureRequest: {
        findUnique: async () => request,
        update: async args => signatureRequest({
          ...request,
          status: 'SIGNED',
          signedAt: args.data.signedAt,
          expiresAt: args.data.expiresAt
        })
      },
      epiRecord: {
        updateMany: async args => {
          if (args.where?.id?.in?.includes('record-1')) return { count: 0 };
          return { count: request.records.length };
        }
      },
      epiSignatureRequestAuditLog: {
        create: async args => ({ id: 'audit-1', ...args.data })
      }
    })
  };

  await assert.rejects(
    () => confirmPublicEpiSignatureRequest({
      token: 'token',
      body: {
        signerName: 'Assinante',
        signatureImageDataUrl: validSignatureImageDataUrl
      },
      req: { headers: {}, ip: '198.51.100.7' },
      client,
      pdfArtifactFactory: testPdfArtifact
    }),
    /não corresponde mais ao EPI assinado original/
  );
});

test('signature evidence ignores forwarded IP headers unless Express trusts proxies', () => {
  assert.equal(
    signatureEvidenceFromRequest({
      headers: {
        'x-forwarded-for': '8.8.8.8',
        'x-real-ip': '1.1.1.1'
      },
      ip: '198.51.100.7'
    }).ipAddress,
    '198.51.100.7'
  );

  assert.equal(
    signatureEvidenceFromRequest({
      headers: {
        'x-forwarded-for': '8.8.8.8'
      },
      app: { get: key => key === 'trust proxy' },
      ips: ['8.8.8.8'],
      ip: '198.51.100.7'
    }).ipAddress,
    '8.8.8.8'
  );
});

test('signed EPI records cannot be hard-deleted', () => {
  assert.doesNotThrow(() => assertCanDeleteEpiRecord({ id: 'record-1', signedAt: null, signatureImageDataUrl: null }));
  assert.throws(
    () => assertCanDeleteEpiRecord({ id: 'record-1', signedAt: new Date(), signatureImageDataUrl: null }),
    /não pode ser removido/
  );
  assert.throws(
    () => assertCanDeleteEpiRecord({ id: 'record-1', signedAt: null, signatureImageDataUrl: 'data:image/png;base64,abc' }),
    /não pode ser removido/
  );
});

test('pending EPI return revisions cannot be edited or deleted while unsigned', () => {
  const pendingReturn = {
    id: 'return-record-1',
    signedAt: null,
    signatureImageDataUrl: null,
    pendingReturn: true,
    signatureRequest: {
      id: 'request-expired',
      status: 'EXPIRED',
      expiresAt: new Date(Date.now() - 60_000)
    }
  };

  assert.throws(() => assertCanUpdateEpiRecord(pendingReturn), /devolução pendente/);
  assert.throws(() => assertCanDeleteEpiRecord(pendingReturn), /devolução pendente/);
});

test('signed EPI records cannot be updated', () => {
  assert.doesNotThrow(() => assertCanUpdateEpiRecord({ id: 'record-1', signedAt: null, signatureImageDataUrl: null }));
  assert.throws(
    () => assertCanUpdateEpiRecord({ id: 'record-1', signedAt: new Date(), signatureImageDataUrl: null }),
    /não pode ser alterado/
  );
  assert.throws(
    () => assertCanUpdateEpiRecord({ id: 'record-1', signedAt: null, signatureImageDataUrl: 'data:image/png;base64,abc' }),
    /não pode ser alterado/
  );
});

test('signed EPI return update is limited to first devolution date only', () => {
  const signedRecord = {
    id: 'record-1',
    signedAt: new Date(),
    signatureImageDataUrl: validSignatureImageDataUrl,
    devolutionDate: null
  };

  assert.equal(isSignedEpiReturnUpdate(signedRecord, { devolutionDate: '19/05/2026' }), true);
  assert.equal(isSignedEpiReturnUpdate(signedRecord, { devolutionDate: null }), false);
  assert.equal(isSignedEpiReturnUpdate({ ...signedRecord, devolutionDate: new Date() }, { devolutionDate: '19/05/2026' }), false);
  assert.equal(isSignedEpiReturnUpdate(signedRecord, { devolutionDate: '19/05/2026', quantity: 2 }), false);
  assert.equal(isSignedEpiReturnUpdate({ id: 'record-1', signedAt: null, signatureImageDataUrl: null }, { devolutionDate: '19/05/2026' }), false);
});

test('EPI records with active pending signature requests cannot be updated or deleted', () => {
  const record = {
    id: 'record-1',
    signedAt: null,
    signatureImageDataUrl: null,
    signatureRequest: {
      id: 'request-active',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000)
    }
  };

  assert.throws(() => assertCanUpdateEpiRecord(record), /solicitação de assinatura ativa/);
  assert.throws(() => assertCanDeleteEpiRecord(record), /solicitação de assinatura ativa/);
});

test('pending EPI signature requests cannot be overwritten by a new token', () => {
  const activeRequest = {
    id: 'request-active',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000)
  };
  const expiredRequest = {
    id: 'request-expired',
    status: 'PENDING',
    expiresAt: new Date(Date.now() - 60_000)
  };

  assert.throws(
    () => assertCanCreateEpiSignatureRequest([{ id: 'record-1', signatureRequest: activeRequest }], 1),
    /solicitação de assinatura ativa/
  );
  assert.doesNotThrow(() => assertCanCreateEpiSignatureRequest([{ id: 'record-1', signatureRequest: expiredRequest }], 1));
  assert.deepEqual(
    expiredEpiSignatureRequestIdsForRecords([{ id: 'record-1', signatureRequest: expiredRequest }]),
    ['request-expired']
  );
});

test('active pending EPI signature request ids can be revoked during archive', () => {
  const activeRequest = {
    id: 'request-active',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000)
  };
  const expiredRequest = {
    id: 'request-expired',
    status: 'PENDING',
    expiresAt: new Date(Date.now() - 60_000)
  };

  assert.deepEqual(
    activePendingEpiSignatureRequestIdsForRecords([
      { id: 'record-1', signatureRequest: activeRequest },
      { id: 'record-2', signatureRequest: expiredRequest },
      { id: 'record-3', signatureRequest: null }
    ]),
    ['request-active']
  );
});

test('archived source records cannot be restored while a return revision is active', () => {
  assert.doesNotThrow(() => assertCanUnarchiveEpiRecords(
    [{ id: 'record-1', archivedAt: new Date() }],
    []
  ));
  assert.throws(
    () => assertCanUnarchiveEpiRecords(
      [{ id: 'record-1', archivedAt: new Date() }],
      [{ id: 'return-record-1', returnSourceRecordId: 'record-1', archivedAt: null }]
    ),
    /devolvido não pode ser restaurado/
  );
});

test('empty public EPI signature requests are not active', () => {
  assert.equal(requestStatus(signatureRequest({ records: [] })), 'INVALID');
});

test('public EPI signature requests with archived records are expired before signing', () => {
  const request = signatureRequest({
    records: [
      {
        id: 'record-1',
        archivedAt: new Date()
      }
    ]
  });

  assert.equal(requestStatus(request), 'EXPIRED');
});

test('public EPI PDF collaborator data is redacted before document generation', () => {
  const collaborator = {
    id: 'collab-1',
    name: 'Colaborador',
    cpf: '123.456.789-09',
    registrationNumber: 'M-1',
    admissionDate: new Date('2024-01-01T12:00:00.000Z'),
    epiRecords: [{ id: 'record-1' }]
  };

  const redacted = redactedEpiCollaboratorForPublicPdf(collaborator);

  assert.equal(redacted.name, 'Colaborador');
  assert.equal(redacted.cpf, '');
  assert.equal(redacted.registrationNumber, '');
  assert.equal(redacted.admissionDate, null);
  assert.deepEqual(redacted.epiRecords, collaborator.epiRecords);
});

test('signed EPI public PDF is served from immutable stored artifact and hash', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'epi-signed-pdf-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const pdfPath = path.join(dir, 'signed.pdf');
  const signedBytes = Buffer.from('%PDF signed immutable artifact');
  await fs.writeFile(pdfPath, signedBytes);
  const hash = cryptoHash(signedBytes);

  const file = await signedPublicPdfFileOrThrow(signatureRequest({
    status: 'SIGNED',
    signedAt: new Date(),
    signedPdfPath: pdfPath,
    signedPdfHash: hash,
    signedPdfFileName: 'assinada.pdf'
  }));

  assert.equal(file.pdfPath, pdfPath);
  assert.equal(file.fileName, 'assinada.pdf');
  assert.equal(file.hash, hash);

  await fs.writeFile(pdfPath, Buffer.from('%PDF changed later'));
  await assert.rejects(
    () => signedPublicPdfFileOrThrow(signatureRequest({
      status: 'SIGNED',
      signedAt: new Date(),
      signedPdfPath: pdfPath,
      signedPdfHash: hash
    })),
    /hash registrado/
  );
});

function cryptoHash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
