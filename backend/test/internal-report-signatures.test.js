import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';

import {
  publicSignatureStatus,
  shouldCreateInternalSignatureRound
} from '../src/routes/resources/reports.js';
import {
  clientSignersForReport,
  createValidationQrCodeMatrix,
  invalidateUnsignedInternalSignatureRound,
  signatureEvidenceFromRequest,
  sha256Hex,
  signInternalReportVersion,
  writeFinalEvidencePdf
} from '../src/lib/internal-report-signatures.js';

const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('signatureEvidenceFromRequest prefers proxy real client IP', () => {
  assert.deepEqual(
    signatureEvidenceFromRequest({
      headers: {
        'x-real-ip': '203.0.113.10',
        'x-forwarded-for': '198.51.100.20, 10.0.0.2',
        'user-agent': 'Node Test'
      },
      ip: '172.18.0.5'
    }),
    {
      ipAddress: '203.0.113.10',
      userAgent: 'Node Test'
    }
  );
});

test('signInternalReportVersion stores the signer name provided at signing time', async () => {
  let signatureUpdate;
  let auditLog;
  const tx = {
    reportSignature: {
      update: async payload => {
        signatureUpdate = payload;
        return payload;
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

test('createValidationQrCodeMatrix creates a square QR matrix for validation URLs', () => {
  const matrix = createValidationQrCodeMatrix('/validar-assinatura/codigo-publico-teste');

  assert.ok(Array.isArray(matrix));
  assert.ok(matrix.length >= 21);
  assert.equal(matrix.length, matrix[0].length);
  assert.equal(matrix[0][0], true);
  assert.equal(matrix[6][0], true);
  assert.equal(matrix[6][6], true);
});
