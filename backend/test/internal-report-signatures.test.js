import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';
import { Prisma } from '@prisma/client';

import {
  assertRenderableReportSignatureImageDataUrl,
  assertSignatureSourceCurrent,
  publicSignaturePayload,
  publicValidationPayload,
  publicSignatureStatus,
  rejectAuthenticatedClientSignatureRound,
  rejectPublicInternalSignature,
  shouldCreateInternalSignatureRound,
  verifiedFinalPdfBuffer
} from '../src/routes/resources/reports.js';
import app from '../src/app.js';
import { assertProductionTrustProxyConfigured } from '../src/config/env.js';
import {
  clientSignersForReport,
  createValidationQrCodeMatrix,
  decodableSignatureImageDataUrl,
  finalEvidencePdfTarget,
  ensureInternalSignatureRound,
  invalidateUnsignedInternalSignatureRound,
  parseSignatureImageDataUrl,
  signatureEvidenceFromRequest,
  sha256Hex,
  signInternalReportVersion,
  writeFinalEvidencePdf
} from '../src/lib/internal-report-signatures.js';

const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function malformedPngHeaderDataUrl() {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function dispatchAppGet(pathName, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(null);
      }
    });
    req.method = 'GET';
    req.url = pathName;
    req.headers = headers;
    req.socket = { remoteAddress: '127.0.0.1', encrypted: false };
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
      const body = Buffer.concat(chunks).toString('utf8');
      resolve({ statusCode: res.statusCode, body, json: body ? JSON.parse(body) : null });
      return res;
    };

    app.handle(req, res, reject);
  });
}

test('signatureEvidenceFromRequest uses trusted proxy client IPs', () => {
  assert.deepEqual(
    signatureEvidenceFromRequest({
      headers: {
        'x-real-ip': '203.0.113.10',
        'x-forwarded-for': '198.51.100.20, 10.0.0.2',
        'user-agent': 'Node Test'
      },
      app: { get: key => key === 'trust proxy' },
      ips: ['203.0.113.10'],
      ip: '172.18.0.5'
    }),
    {
      ipAddress: '203.0.113.10',
      userAgent: 'Node Test'
    }
  );
});

test('signatureEvidenceFromRequest prefers public trusted proxy IP over Docker bridge IP', () => {
  assert.deepEqual(
    signatureEvidenceFromRequest({
      headers: {
        'x-real-ip': '172.18.0.1',
        'x-forwarded-for': '172.18.0.1, 198.51.100.20',
        forwarded: 'for=203.0.113.30;proto=https',
        'user-agent': 'Node Test'
      },
      app: { get: key => key === 'trust proxy' },
      ips: ['172.18.0.1', '198.51.100.20'],
      ip: '172.18.0.5'
    }),
    {
      ipAddress: '198.51.100.20',
      userAgent: 'Node Test'
    }
  );
});

test('Express trust proxy setting controls signature evidence client IPs', async t => {
  const previousTrustProxy = app.get('trust proxy');
  const pathName = `/__test/signature-evidence-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  app.get(pathName, (req, res) => {
    res.json(signatureEvidenceFromRequest(req));
  });
  t.after(() => {
    app.set('trust proxy', previousTrustProxy);
  });

  app.set('trust proxy', false);
  const untrusted = await dispatchAppGet(pathName, {
    'host': '127.0.0.1',
    'x-forwarded-for': '203.0.113.10',
    'user-agent': 'Node Test'
  }).then(response => response.json);
  assert.notEqual(untrusted.ipAddress, '203.0.113.10');

  app.set('trust proxy', 'loopback');
  const trusted = await dispatchAppGet(pathName, {
    'host': '127.0.0.1',
    'x-forwarded-for': '203.0.113.10',
    'user-agent': 'Node Test'
  }).then(response => response.json);
  assert.equal(trusted.ipAddress, '203.0.113.10');
});

test('production startup requires explicit trust proxy configuration', () => {
  assert.throws(
    () => assertProductionTrustProxyConfigured({ nodeEnv: 'production', trustProxyConfigured: false }),
    /TRUST_PROXY/
  );
  assert.doesNotThrow(() => assertProductionTrustProxyConfigured({ nodeEnv: 'production', trustProxyConfigured: true }));
  assert.doesNotThrow(() => assertProductionTrustProxyConfigured({ nodeEnv: 'development', trustProxyConfigured: false }));
});

test('signInternalReportVersion stores the signer name provided at signing time', async () => {
  let signatureUpdate;
  let auditLog;
  const tx = {
    reportSignature: {
      updateMany: async payload => {
        signatureUpdate = payload;
        return { count: 1 };
      },
      findUnique: async () => {
        throw new Error('findUnique should not be called after a successful signature update');
      }
    },
    reportAuditLog: {
      create: async payload => {
        auditLog = payload;
        return payload;
      }
    }
  };

  const result = await signInternalReportVersion(tx, {
    report: { id: 'report-1' },
    version: {
      id: 'version-1',
      signatures: [
        {
          id: 'signature-1',
          signerName: 'Nome inicial',
          signerEmail: 'cliente@example.com',
          status: 'PENDING'
        }
      ]
    },
    signer: {
      name: 'Nome editado',
      email: 'cliente@example.com'
    },
    userId: 'user-1',
    evidence: {
      ipAddress: '192.168.0.10',
      userAgent: 'Node Test'
    },
    signatureImageDataUrl: tinyPngDataUrl
  });

  assert.equal(result.alreadySigned, false);
  assert.equal(signatureUpdate.where.id, 'signature-1');
  assert.equal(signatureUpdate.data.signerName, 'Nome editado');
  assert.equal(signatureUpdate.data.signatureImageDataUrl, tinyPngDataUrl);
  assert.match(auditLog.data.description, /Nome editado assinou o relatorio/);
});

test('signInternalReportVersion treats concurrent duplicate confirmation as already signed', async () => {
  let auditLogCount = 0;
  const tx = {
    reportSignature: {
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => ({ id: 'signature-1', status: 'SIGNED' })
    },
    reportAuditLog: {
      create: async () => {
        auditLogCount += 1;
      }
    }
  };

  const result = await signInternalReportVersion(tx, {
    report: { id: 'report-1' },
    version: {
      id: 'version-1',
      signatures: [{
        id: 'signature-1',
        signerName: 'Nome inicial',
        signerEmail: 'cliente@example.com',
        status: 'PENDING'
      }]
    },
    signer: {
      name: 'Nome editado',
      email: 'cliente@example.com'
    },
    userId: 'user-1',
    evidence: {
      ipAddress: '192.168.0.10',
      userAgent: 'Node Test'
    },
    signatureImageDataUrl: tinyPngDataUrl
  });

  assert.deepEqual(result, { alreadySigned: true });
  assert.equal(auditLogCount, 0);
});

test('ensureInternalSignatureRound locks per report before creating an active version', async () => {
  const calls = [];
  const tx = {
    $queryRawUnsafe: async (...args) => {
      calls.push(['lock', args]);
    },
    reportVersion: {
      findFirst: async args => {
        calls.push(['reportVersion.findFirst', args]);
        return null;
      },
      aggregate: async args => {
        calls.push(['reportVersion.aggregate', args]);
        return { _max: { versionNumber: null } };
      },
      create: async args => {
        calls.push(['reportVersion.create', args]);
        return {
          id: 'version-1',
          reportId: 'report-1',
          versionNumber: 1,
          sourcePdfUrl: '/relatorios/source.pdf',
          sourceDocumentHash: 'source-hash',
          signatures: [{
            id: 'signature-1',
            signerEmail: 'cliente@example.com',
            status: 'PENDING'
          }]
        };
      }
    },
    reportAuditLog: {
      create: async args => {
        calls.push(['reportAuditLog.create', args]);
        return args;
      }
    }
  };

  const version = await ensureInternalSignatureRound(tx, {
    report: {
      id: 'report-1',
      project: {
        clientName: 'Cliente',
        clientEmailPrimary: 'cliente@example.com',
        clientSigners: []
      }
    },
    sourcePdfUrl: '/relatorios/source.pdf',
    sourceDocumentHash: 'source-hash',
    createdByUserId: 'manager-1'
  });

  assert.equal(version.id, 'version-1');
  assert.equal(calls[0][0], 'lock');
  assert.deepEqual(calls[0][1], ['SELECT pg_advisory_xact_lock(hashtext($1), 0)', 'report-1']);
  assert.equal(calls.findIndex(([name]) => name === 'lock') < calls.findIndex(([name]) => name === 'reportVersion.create'), true);
});

test('ensureInternalSignatureRound returns concurrent active version after unique race', async () => {
  let findCount = 0;
  const activeVersion = {
    id: 'version-active',
    reportId: 'report-1',
    versionNumber: 2,
    signatures: []
  };
  const tx = {
    $queryRawUnsafe: async () => {},
    reportVersion: {
      findFirst: async () => {
        findCount += 1;
        return findCount === 1 ? null : activeVersion;
      },
      aggregate: async () => ({ _max: { versionNumber: 1 } }),
      create: async () => {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test'
        });
      }
    },
    reportAuditLog: {
      create: async () => {
        throw new Error('audit log should not be created when another request won the race');
      }
    }
  };

  const version = await ensureInternalSignatureRound(tx, {
    report: {
      id: 'report-1',
      project: {
        clientName: 'Cliente',
        clientEmailPrimary: 'cliente@example.com',
        clientSigners: []
      }
    },
    sourcePdfUrl: '/relatorios/source.pdf',
    sourceDocumentHash: 'source-hash',
    createdByUserId: 'manager-1'
  });

  assert.equal(version, activeVersion);
});

test('signature source guard aborts when report changed after PDF preparation', () => {
  assert.doesNotThrow(() => assertSignatureSourceCurrent(
    { updatedAt: new Date('2026-01-01T12:00:00.000Z') },
    '2026-01-01T12:00:00.000Z'
  ));
  assert.throws(
    () => assertSignatureSourceCurrent(
      { updatedAt: new Date('2026-01-01T12:01:00.000Z') },
      '2026-01-01T12:00:00.000Z'
    ),
    error => error?.statusCode === 409 && /atualizada por outra operação/.test(error.message)
  );
});

test('approved RDO without client signers does not require an internal signature round', () => {
  const report = {
    id: 'report-no-signers',
    projectId: 'project-1',
    reportType: 'RDO',
    status: 'APPROVED',
    project: {
      managerOnly: false,
      clientName: 'Cliente sem e-mail',
      clientEmailPrimary: '',
      clientSigners: []
    }
  };

  assert.deepEqual(clientSignersForReport(report), []);
  assert.equal(shouldCreateInternalSignatureRound(report), false);
});

test('publicSignatureStatus blocks links for deleted projects but allows archived projects', () => {
  const activeSignature = {
    status: 'PENDING',
    tokenExpiresAt: new Date(Date.now() + 60_000),
    version: { status: 'ACTIVE' },
    report: {
      deletedAt: null,
      status: 'APPROVED',
      project: {
        deletedAt: null,
        isActive: true
      }
    }
  };

  assert.equal(publicSignatureStatus(activeSignature), 'ACTIVE');
  assert.equal(publicSignatureStatus({
    ...activeSignature,
    report: {
      ...activeSignature.report,
      project: {
        ...activeSignature.report.project,
        deletedAt: new Date()
      }
    }
  }), 'UNAVAILABLE');
  assert.equal(publicSignatureStatus({
    ...activeSignature,
    report: {
      ...activeSignature.report,
      project: {
        ...activeSignature.report.project,
        isActive: false
      }
    }
  }), 'ACTIVE');
});

test('publicSignaturePayload hides metadata for unavailable soft-deleted reports and projects', () => {
  const signature = {
    id: 'signature-1',
    signerName: 'Cliente Assinante',
    signerEmail: 'cliente@example.com',
    status: 'PENDING',
    signedAt: null,
    rejectedAt: null,
    tokenExpiresAt: new Date('2026-01-04T00:00:00.000Z'),
    sourceDocumentHash: 'source-hash',
    report: {
      id: 'report-1',
      deletedAt: null,
      reportType: 'RDO',
      sequenceNumber: 42,
      reportDate: new Date('2026-01-01T00:00:00.000Z'),
      status: 'APPROVED',
      project: {
        deletedAt: null,
        code: 'P-001',
        name: 'Projeto sigiloso',
        clientName: 'Cliente sigiloso'
      }
    }
  };

  assert.deepEqual(publicSignaturePayload({
    ...signature,
    report: {
      ...signature.report,
      deletedAt: new Date('2026-01-03T00:00:00.000Z')
    }
  }, 'UNAVAILABLE'), { status: 'UNAVAILABLE' });
  assert.deepEqual(publicSignaturePayload({
    ...signature,
    report: {
      ...signature.report,
      project: {
        ...signature.report.project,
        deletedAt: new Date('2026-01-03T00:00:00.000Z')
      }
    }
  }, 'UNAVAILABLE'), { status: 'UNAVAILABLE' });
});

test('publicValidationPayload hides metadata for soft-deleted reports and projects', () => {
  const version = {
    validationCode: 'codigo-publico-teste',
    sourceDocumentHash: 'source-hash',
    finalDocumentHash: 'final-hash',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    status: 'ACTIVE',
    report: {
      id: 'report-1',
      deletedAt: null,
      reportType: 'RDO',
      sequenceNumber: 42,
      reportDate: new Date('2026-01-01T00:00:00.000Z'),
      status: 'SIGNED',
      project: {
        deletedAt: null,
        code: 'P-001',
        name: 'Projeto sigiloso',
        clientName: 'Cliente sigiloso'
      }
    },
    signatures: [{
      signerName: 'Cliente Assinante',
      signerEmail: 'cliente@example.com',
      signerRole: 'CLIENT',
      status: 'SIGNED',
      signedAt: new Date('2026-01-02T03:00:00.000Z')
    }]
  };

  assert.equal(publicValidationPayload(version).status, 'VALID');
  assert.deepEqual(publicValidationPayload({
    ...version,
    report: {
      ...version.report,
      deletedAt: new Date('2026-01-03T00:00:00.000Z')
    }
  }), { status: 'UNAVAILABLE' });
  assert.deepEqual(publicValidationPayload({
    ...version,
    report: {
      ...version.report,
      project: {
        ...version.report.project,
        deletedAt: new Date('2026-01-03T00:00:00.000Z')
      }
    }
  }), { status: 'UNAVAILABLE' });
});

test('RDO signature image validation rejects non-decodable image evidence', async () => {
  const malformed = malformedPngHeaderDataUrl();

  assert.equal(parseSignatureImageDataUrl(malformed)?.mimeType, 'image/png');
  assert.equal(await decodableSignatureImageDataUrl(malformed), null);
  await assert.rejects(
    () => assertRenderableReportSignatureImageDataUrl(malformed),
    /Assinatura visual invalida/
  );
});

test('rejectPublicInternalSignature aborts stale confirm/reject races without side effects', async () => {
  const calls = [];
  const signature = {
    id: 'signature-1',
    reportId: 'report-1',
    versionId: 'version-1',
    signerEmail: 'cliente@example.com',
    status: 'PENDING',
    tokenExpiresAt: new Date(Date.now() + 60_000),
    version: { id: 'version-1', status: 'ACTIVE', signatures: [] },
    report: {
      id: 'report-1',
      status: 'APPROVED',
      deletedAt: null,
      specialConditions: {},
      project: { deletedAt: null }
    }
  };
  const tx = {
    reportSignature: {
      findUnique: async args => {
        calls.push(['reportSignature.findUnique', args]);
        return signature;
      },
      updateMany: async args => {
        calls.push(['reportSignature.updateMany', args]);
        return { count: 0 };
      }
    },
    reportVersion: {
      updateMany: async args => {
        calls.push(['reportVersion.updateMany', args]);
        return { count: 1 };
      }
    },
    report: {
      updateMany: async args => {
        calls.push(['report.updateMany', args]);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ id: 'report-1' })
    },
    reportAuditLog: {
      create: async args => {
        calls.push(['reportAuditLog.create', args]);
      }
    }
  };
  const client = {
    $transaction: async callback => callback(tx)
  };

  await assert.rejects(
    () => rejectPublicInternalSignature({
      token: 'token',
      comment: 'Reprovado',
      evidence: { ipAddress: '203.0.113.10', userAgent: 'Node Test' },
      client
    }),
    /indisponível/
  );

  assert.equal(calls.some(([name]) => name === 'reportVersion.updateMany'), false);
  assert.equal(calls.some(([name]) => name === 'report.updateMany'), false);
  assert.equal(calls.some(([name]) => name === 'reportAuditLog.create'), false);
  assert.deepEqual(calls[1][1].where, { id: 'signature-1', status: 'PENDING' });
});

test('rejectAuthenticatedClientSignatureRound does not overwrite signed client signatures', async () => {
  const calls = [];
  const tx = {
    reportVersion: {
      findFirst: async args => {
        calls.push(['reportVersion.findFirst', args]);
        return {
          id: 'version-1',
          signatures: [{
            id: 'signature-1',
            signerEmail: 'cliente@example.com',
            status: 'SIGNED'
          }]
        };
      },
      updateMany: async args => {
        calls.push(['reportVersion.updateMany', args]);
        return { count: 1 };
      }
    },
    reportSignature: {
      updateMany: async args => {
        calls.push(['reportSignature.updateMany', args]);
        return { count: 0 };
      }
    },
    report: {
      updateMany: async args => {
        calls.push(['report.updateMany', args]);
        return { count: 1 };
      },
      findUniqueOrThrow: async args => {
        calls.push(['report.findUniqueOrThrow', args]);
        return args;
      }
    },
    reportAuditLog: {
      create: async args => {
        calls.push(['reportAuditLog.create', args]);
      }
    }
  };

  await assert.rejects(
    () => rejectAuthenticatedClientSignatureRound(tx, {
      report: { id: 'report-1', specialConditions: {} },
      authUser: { id: 'user-1', email: 'cliente@example.com', username: 'cliente@example.com' },
      comment: 'Reprovado',
      evidence: { ipAddress: '203.0.113.10', userAgent: 'Node Test' }
    }),
    /não está mais pendente/
  );

  assert.deepEqual(calls[1][1].where, { id: 'signature-1', status: 'PENDING' });
  assert.equal(calls.some(([name]) => name === 'reportVersion.updateMany'), false);
  assert.equal(calls.some(([name]) => name === 'report.updateMany'), false);
  assert.equal(calls.some(([name]) => name === 'report.findUniqueOrThrow'), false);
  assert.equal(calls.some(([name]) => name === 'reportAuditLog.create'), false);
});

test('rejectAuthenticatedClientSignatureRound requires the client to be a configured signer', async () => {
  const calls = [];
  const tx = {
    reportVersion: {
      findFirst: async args => {
        calls.push(['reportVersion.findFirst', args]);
        return {
          id: 'version-1',
          signatures: [{
            id: 'signature-1',
            signerEmail: 'signer@example.com',
            status: 'PENDING'
          }]
        };
      },
      updateMany: async args => {
        calls.push(['reportVersion.updateMany', args]);
        return { count: 1 };
      }
    },
    reportSignature: {
      updateMany: async args => {
        calls.push(['reportSignature.updateMany', args]);
        return { count: 1 };
      }
    },
    report: {
      updateMany: async args => {
        calls.push(['report.updateMany', args]);
        return { count: 1 };
      },
      findUniqueOrThrow: async args => {
        calls.push(['report.findUniqueOrThrow', args]);
        return args;
      }
    },
    reportAuditLog: {
      create: async args => {
        calls.push(['reportAuditLog.create', args]);
      }
    }
  };

  await assert.rejects(
    () => rejectAuthenticatedClientSignatureRound(tx, {
      report: { id: 'report-1', specialConditions: {} },
      authUser: { id: 'user-1', email: 'cc@example.com', username: 'cc@example.com' },
      comment: 'Reprovado',
      evidence: { ipAddress: '203.0.113.10', userAgent: 'Node Test' }
    }),
    error => error?.statusCode === 403 && /não configurado como signatário/.test(error.message)
  );

  assert.equal(calls.some(([name]) => name === 'reportSignature.updateMany'), false);
  assert.equal(calls.some(([name]) => name === 'reportVersion.updateMany'), false);
  assert.equal(calls.some(([name]) => name === 'report.updateMany'), false);
  assert.equal(calls.some(([name]) => name === 'report.findUniqueOrThrow'), false);
  assert.equal(calls.some(([name]) => name === 'reportAuditLog.create'), false);
});

test('invalidateUnsignedInternalSignatureRound can invalidate pending project-delete rounds with signed signatures', async () => {
  const calls = [];
  const tx = {
    reportVersion: {
      findFirst: async () => ({
        id: 'version-1',
        signatures: [
          { id: 'signature-signed', status: 'SIGNED' },
          { id: 'signature-pending', status: 'PENDING' }
        ]
      }),
      update: async payload => {
        calls.push(['reportVersion.update', payload]);
        return payload;
      }
    },
    reportSignature: {
      updateMany: async payload => {
        calls.push(['reportSignature.updateMany', payload]);
        return { count: 1 };
      }
    },
    reportAuditLog: {
      create: async payload => {
        calls.push(['reportAuditLog.create', payload]);
        return payload;
      }
    }
  };

  const invalidated = await invalidateUnsignedInternalSignatureRound(tx, {
    reportId: 'report-1',
    userId: 'manager-1',
    description: 'Rodada de assinatura invalidada por exclusao do projeto.',
    invalidateSignedRound: true
  });

  assert.equal(invalidated, true);
  assert.deepEqual(calls[0][1].where, {
    versionId: 'version-1',
    status: { in: ['PENDING', 'EXPIRED'] }
  });
  assert.equal(calls[1][1].data.status, 'SUPERSEDED');
  assert.equal(calls[2][1].data.description, 'Rodada de assinatura invalidada por exclusao do projeto.');
});

test('invalidateUnsignedInternalSignatureRound keeps completed signed rounds active on project delete', async () => {
  const calls = [];
  const tx = {
    reportVersion: {
      findFirst: async () => ({
        id: 'version-1',
        signatures: [
          { id: 'signature-signed', status: 'SIGNED', isRequired: true }
        ]
      }),
      update: async payload => {
        calls.push(payload);
        return payload;
      }
    },
    reportSignature: {
      updateMany: async payload => {
        calls.push(payload);
        return { count: 0 };
      }
    },
    reportAuditLog: {
      create: async payload => {
        calls.push(payload);
        return payload;
      }
    }
  };

  const invalidated = await invalidateUnsignedInternalSignatureRound(tx, {
    reportId: 'report-1',
    invalidateSignedRound: true
  });

  assert.equal(invalidated, false);
  assert.deepEqual(calls, []);
});

test('writeFinalEvidencePdf creates final PDF with evidence page and hash', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rdo-signature-pdf-'));
  const sourcePdfPath = path.join(dir, 'relatorio.pdf');
  const sourcePdfUrl = '/relatorios/teste/relatorio.pdf';

  const source = await PDFDocument.create();
  source.addPage([300, 300]);
  const sourceBytes = await source.save();
  await fs.writeFile(sourcePdfPath, sourceBytes);

  const result = await writeFinalEvidencePdf({
    sourcePdfPath,
    sourcePdfUrl,
    report: {
      reportType: 'RDO',
      sequenceNumber: 12,
      project: { code: 'P-001', name: 'Projeto Teste' }
    },
    version: {
      sourceDocumentHash: sha256Hex(Buffer.from(sourceBytes)),
      createdAt: new Date('2026-05-12T11:30:00.000Z')
    },
    validationCode: 'codigo-publico-teste',
    signatures: [
      {
        status: 'SIGNED',
        signerName: 'Cliente Teste',
        signerEmail: 'cliente@example.com',
        signedAt: new Date('2026-05-12T12:00:00.000Z'),
        ipAddress: '192.168.0.10',
        userAgent: 'Node Test',
        signatureImageDataUrl: tinyPngDataUrl
      }
    ]
  });

  const finalBytes = await fs.readFile(result.finalPdfPath);
  const finalPdf = await PDFDocument.load(finalBytes);

  assert.equal(result.finalPdfPath, path.join(dir, 'relatorio-assinado.pdf'));
  assert.equal(result.finalPdfUrl, '/relatorios/teste/relatorio-assinado.pdf');
  assert.equal(finalPdf.getPageCount(), 2);
  assert.equal(finalPdf.getPages()[1].node.Annots()?.size(), 1);
  assert.equal(result.finalDocumentHash, sha256Hex(finalBytes));
  assert.notEqual(result.finalDocumentHash, sha256Hex(Buffer.from(sourceBytes)));
});

test('writeFinalEvidencePdf rejects signed signatures with non-decodable images', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rdo-signature-pdf-invalid-'));
  const sourcePdfPath = path.join(dir, 'relatorio.pdf');
  const sourcePdfUrl = '/relatorios/teste/relatorio.pdf';

  const source = await PDFDocument.create();
  source.addPage([300, 300]);
  const sourceBytes = await source.save();
  await fs.writeFile(sourcePdfPath, sourceBytes);

  await assert.rejects(
    () => writeFinalEvidencePdf({
      sourcePdfPath,
      sourcePdfUrl,
      report: {
        reportType: 'RDO',
        sequenceNumber: 12,
        project: { code: 'P-001', name: 'Projeto Teste' }
      },
      version: {
        sourceDocumentHash: sha256Hex(Buffer.from(sourceBytes)),
        createdAt: new Date('2026-05-12T11:30:00.000Z')
      },
      validationCode: 'codigo-publico-teste',
      signatures: [
        {
          status: 'SIGNED',
          signerName: 'Cliente Teste',
          signerEmail: 'cliente@example.com',
          signedAt: new Date('2026-05-12T12:00:00.000Z'),
          ipAddress: '192.168.0.10',
          userAgent: 'Node Test',
          signatureImageDataUrl: malformedPngHeaderDataUrl()
        }
      ]
    }),
    /Assinatura visual invalida/
  );

  await assert.rejects(
    () => fs.access(path.join(dir, 'relatorio-assinado.pdf')),
    /ENOENT/
  );
});

test('writeFinalEvidencePdf rejects source PDF drift before sealing evidence', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rdo-signature-pdf-drift-'));
  const sourcePdfPath = path.join(dir, 'relatorio.pdf');
  const sourcePdfUrl = '/relatorios/teste/relatorio.pdf';

  const original = await PDFDocument.create();
  original.addPage([300, 300]);
  const originalBytes = await original.save();
  await fs.writeFile(sourcePdfPath, originalBytes);

  const mutated = await PDFDocument.create();
  mutated.addPage([400, 400]);
  const mutatedBytes = await mutated.save();
  await fs.writeFile(sourcePdfPath, mutatedBytes);

  await assert.rejects(
    () => writeFinalEvidencePdf({
      sourcePdfPath,
      sourcePdfUrl,
      report: {
        reportType: 'RDO',
        sequenceNumber: 12,
        project: { code: 'P-001', name: 'Projeto Teste' }
      },
      version: {
        sourceDocumentHash: sha256Hex(Buffer.from(originalBytes)),
        createdAt: new Date('2026-05-12T11:30:00.000Z')
      },
      validationCode: 'codigo-publico-teste',
      signatures: [
        {
          status: 'SIGNED',
          signerName: 'Cliente Teste',
          signerEmail: 'cliente@example.com',
          signedAt: new Date('2026-05-12T12:00:00.000Z'),
          ipAddress: '192.168.0.10',
          userAgent: 'Node Test',
          signatureImageDataUrl: tinyPngDataUrl
        }
      ]
    }),
    error => error?.statusCode === 409 && /PDF-base/.test(error.message)
  );

  await assert.rejects(
    () => fs.access(path.join(dir, 'relatorio-assinado.pdf')),
    /ENOENT/
  );
});

test('finalEvidencePdfTarget can reserve distinct final artifacts per validation code', () => {
  assert.deepEqual(
    finalEvidencePdfTarget('/tmp/relatorio.pdf', '/relatorios/teste/relatorio.pdf', 'codigo-A_1'),
    {
      finalPdfPath: '/tmp/relatorio-assinado-codigo-A_1.pdf',
      finalPdfUrl: '/relatorios/teste/relatorio-assinado-codigo-A_1.pdf'
    }
  );
  assert.notEqual(
    finalEvidencePdfTarget('/tmp/relatorio.pdf', '/relatorios/teste/relatorio.pdf', 'codigo-A_1').finalPdfPath,
    finalEvidencePdfTarget('/tmp/relatorio.pdf', '/relatorios/teste/relatorio.pdf', 'codigo-B_2').finalPdfPath
  );
});

test('verifiedFinalPdfBuffer rejects final PDF drift from stored hash', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rdo-signature-pdf-hash-'));
  const finalPath = path.join(dir, 'relatorio-assinado.pdf');
  const original = Buffer.from('pdf-final-original');
  await fs.writeFile(finalPath, original);

  assert.deepEqual(
    await verifiedFinalPdfBuffer(finalPath, { finalDocumentHash: sha256Hex(original) }),
    original
  );

  await fs.writeFile(finalPath, Buffer.from('pdf-final-corrompido'));
  await assert.rejects(
    () => verifiedFinalPdfBuffer(finalPath, { finalDocumentHash: sha256Hex(original) }),
    /diverge do hash final/
  );
  await assert.rejects(
    () => verifiedFinalPdfBuffer(finalPath, { finalDocumentHash: null }),
    /sem hash final registrado/
  );
});

test('createValidationQrCodeMatrix creates a square QR matrix for validation URLs', () => {
  const matrix = createValidationQrCodeMatrix('/validar-assinatura/codigo-publico-teste');

  assert.ok(Array.isArray(matrix));
  assert.ok(matrix.length >= 21);
  assert.equal(matrix.length, matrix[0].length);
  assert.equal(matrix[0][0], true);
  assert.equal(matrix[6][0], true);
  assert.equal(matrix[6][6], true);
});
