import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

import env from '../src/config/env.js';
import prisma from '../src/lib/prisma.js';
import {
  buildInternalSignatureProgress,
  clientSignersForReport,
  resolveInternalClientSigner,
  sha256Hex
} from '../src/lib/internal-report-signatures.js';
import {
  publicSignatureStatus,
  reconcileProjectClientSignatureRequirements
} from '../src/routes/resources/reports.js';

const serviceTypes = ['RTP', 'RLQ', 'RCPU', 'RLM', 'RLF', 'RLI'];
const signatureImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function project() {
  return {
    id: 'project-1', code: 'P-1', name: 'Projeto', isActive: true,
    clientName: 'Cliente', clientCnpj: '11222333000144',
    clientEmailPrimary: 'primary@example.com',
    clientSigners: [{ name: 'Fiscal', email: 'fiscal@example.com' }],
    requireServiceReportSignatures: true
  };
}

test('projetos existentes continuam exigindo todos os assinantes nos relatórios de serviço', () => {
  for (const reportType of ['RDO', ...serviceTypes]) {
    assert.deepEqual(clientSignersForReport({ reportType, project: project() }).map(s => s.email), [
      'primary@example.com', 'fiscal@example.com'
    ]);
  }
});

test('seleção de assinantes dos serviços é independente dos assinantes do RDO', () => {
  for (const onlyPrimary of [true, false]) {
    const configured = project();
    configured.clientSignerSignsServiceReports = onlyPrimary;
    configured.clientSigners[0].signsServiceReports = !onlyPrimary;
    const selectedEmail = onlyPrimary ? 'primary@example.com' : 'fiscal@example.com';
    const excludedEmail = onlyPrimary ? 'fiscal@example.com' : 'primary@example.com';
    for (const reportType of serviceTypes) {
      const report = { reportType, project: configured };
      assert.deepEqual(clientSignersForReport(report).map(s => s.email), [selectedEmail]);
      assert.equal(resolveInternalClientSigner(report, { username: selectedEmail }).email, selectedEmail);
      assert.throws(() => resolveInternalClientSigner(report, { username: excludedEmail }), { statusCode: 403 });
    }
    assert.equal(clientSignersForReport({ reportType: 'RDO', project: configured }).length, 2);
  }
});

for (const onlyPrimary of [true, false]) {
  for (const alreadySigned of [true, false]) {
    test(`remover ${onlyPrimary ? 'adicional' : 'principal'} do serviço ${alreadySigned ? 'conclui com assinatura existente' : 'aguarda assinatura restante'} e preserva o RDO`, async t => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'service-report-signers-'));
      const oldDirs = { uploadDir: env.uploadDir, reportsDir: env.reportsDir };
      env.uploadDir = dir;
      env.reportsDir = dir;
      t.after(async () => {
        Object.assign(env, oldDirs);
        await fs.rm(dir, { recursive: true, force: true });
      });
      const pdf = await PDFDocument.create();
      pdf.addPage([300, 300]);
      const sourceBytes = Buffer.from(await pdf.save());
      await fs.writeFile(path.join(dir, 'service.pdf'), sourceBytes);

      const configured = project();
      configured.clientSignerSignsServiceReports = onlyPrimary;
      configured.clientSigners[0].signsServiceReports = !onlyPrimary;
      const makeSignatures = prefix => [
        { email: 'primary@example.com', selected: onlyPrimary },
        { email: 'fiscal@example.com', selected: !onlyPrimary }
      ].map((signer, index) => ({
        id: `${prefix}-${index}`, signerEmail: signer.email, signerName: index ? 'Fiscal' : 'Cliente',
        isRequired: true, status: signer.selected && alreadySigned ? 'SIGNED' : 'PENDING',
        signedAt: signer.selected && alreadySigned ? new Date('2026-10-20T12:00:00Z') : null,
        signatureImageDataUrl: signer.selected && alreadySigned ? signatureImageDataUrl : null,
        tokenHash: `${prefix}-token-${index}`, tokenExpiresAt: new Date(Date.now() + 60_000)
      }));
      const reports = [
        { id: 'service', projectId: configured.id, reportType: 'RTP', status: 'APPROVED', project: configured },
        { id: 'rdo', projectId: configured.id, reportType: 'RDO', status: 'APPROVED', project: configured }
      ];
      const versions = new Map(reports.map(report => [report.id, {
        id: `${report.id}-version`, reportId: report.id, status: 'ACTIVE', versionNumber: 1,
        sourcePdfUrl: '/relatorios/service.pdf', sourceDocumentHash: sha256Hex(sourceBytes),
        finalDocumentHash: null, signatures: makeSignatures(report.id)
      }]));
      const rdoBefore = structuredClone(versions.get('rdo'));
      const kept = versions.get('service').signatures.find(s => s.signerEmail === (onlyPrimary ? 'primary@example.com' : 'fiscal@example.com'));
      const keptBefore = structuredClone(kept);
      const audit = [];
      const tx = {
        reportSignature: {
          updateMany: async ({ where, data }) => {
            const version = [...versions.values()].find(v => v.id === where.versionId);
            let count = 0;
            for (const signature of version.signatures) {
              if (where.id && !where.id.in.includes(signature.id)) continue;
              if (where.status?.in && !where.status.in.includes(signature.status)) continue;
              if (typeof where.status === 'string' && signature.status !== where.status) continue;
              Object.assign(signature, data);
              count += 1;
            }
            return { count };
          }
        },
        reportVersion: {
          updateMany: async ({ where, data }) => {
            const version = [...versions.values()].find(v => v.id === where.id);
            assert.ok(version.signatures.every(s => !s.isRequired || s.status === 'SIGNED'));
            Object.assign(version, data);
            return { count: 1 };
          },
          findFirst: async ({ where }) => versions.get(where.reportId)
        },
        report: {
          update: async ({ where, data }) => Object.assign(reports.find(r => r.id === where.id), data)
        },
        reportAuditLog: { create: async ({ data }) => { audit.push(data); return data; } }
      };
      const stub = (object, key, implementation) => {
        const original = object[key];
        object[key] = implementation;
        t.after(() => { object[key] = original; });
      };
      stub(prisma, '$transaction', async callback => callback(tx));
      stub(prisma.report, 'findMany', async () => reports);
      stub(prisma.report, 'findUniqueOrThrow', async ({ where }) => reports.find(r => r.id === where.id));
      stub(prisma.reportVersion, 'findFirst', tx.reportVersion.findFirst);
      stub(prisma.reportVersion, 'findUnique', async ({ where }) => (
        where.validationCode ? null : [...versions.values()].find(v => v.id === where.id)
      ));

      const result = await reconcileProjectClientSignatureRequirements(configured.id, {
        userId: 'manager-1', sendReleasedEmails: false
      });
      assert.deepEqual(result, { updatedReports: 1, finalizedReports: alreadySigned ? 1 : 0 });
      assert.equal(reports[0].status, alreadySigned ? 'SIGNED' : 'APPROVED');
      assert.equal(reports[1].status, 'APPROVED');
      assert.deepEqual(versions.get('rdo'), rdoBefore);
      const serviceVersion = versions.get('service');
      const removed = serviceVersion.signatures.find(s => s.id !== kept.id);
      assert.equal(removed.status, 'INVALIDATED');
      assert.equal(removed.isRequired, false);
      assert.equal(removed.tokenHash, null);
      assert.equal(publicSignatureStatus({ ...removed, report: reports[0], version: serviceVersion }), 'INVALIDATED');
      assert.deepEqual({ ...kept, finalDocumentHash: undefined }, { ...keptBefore, finalDocumentHash: undefined });
      const progress = buildInternalSignatureProgress(serviceVersion.signatures);
      assert.equal(progress.total, 1);
      assert.equal(progress.signed, alreadySigned ? 1 : 0);
      if (alreadySigned) {
        const finalBytes = await fs.readFile(path.join(dir, path.basename(serviceVersion.finalPdfUrl)));
        assert.equal(sha256Hex(finalBytes), serviceVersion.finalDocumentHash);
        assert.equal((await PDFDocument.load(finalBytes)).getPageCount(), 2);
        assert.equal(kept.finalDocumentHash, serviceVersion.finalDocumentHash);
        assert.ok(audit.some(event => event.action === 'REPORT_LOCKED'));
      } else {
        assert.equal(serviceVersion.finalDocumentHash, null);
        assert.equal(audit.some(event => event.action === 'REPORT_LOCKED'), false);
      }
    });
  }
}
