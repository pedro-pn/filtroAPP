import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';

import { sha256Hex, signInternalReportVersion, writeFinalEvidencePdf } from '../src/lib/internal-report-signatures.js';

const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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
      sourceDocumentHash: sha256Hex(Buffer.from(sourceBytes))
    },
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
  assert.equal(result.finalDocumentHash, sha256Hex(finalBytes));
  assert.notEqual(result.finalDocumentHash, sha256Hex(Buffer.from(sourceBytes)));
});
