import assert from 'node:assert/strict';
import test from 'node:test';

import { ReportSignatureStatus, ReportStatus, ReportType, ReportVersionStatus } from '@prisma/client';

import {
  canClientSeeReport,
  removedPendingRequiredClientSignatureIds,
  previousRdosSignedForServiceReport,
  projectEmailRecipients,
  releasedServiceReportsAfterRdoSignature,
  sendReleasedServiceReportsEmail
} from '../src/routes/resources/reports.js';

function report(overrides = {}) {
  return {
    id: overrides.id || 'report-1',
    projectId: 'project-1',
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-20',
    deletedAt: null,
    specialConditions: {},
    project: {
      id: 'project-1',
      code: 'P-1',
      name: 'Projeto 1',
      clientCnpj: '12345678000190',
      clientEmailPrimary: 'responsavel@example.com',
      clientEmailCc: [],
      deletedAt: null
    },
    ...overrides
  };
}

function byId(reports) {
  return new Map(reports.map(item => [item.id, item]));
}

test('service report stays hidden while any previous project RDO is not signed', () => {
  const firstRdo = report({
    id: 'rdo-1',
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-20'
  });
  const finalRdo = report({
    id: 'rdo-2',
    status: ReportStatus.SIGNED,
    reportDate: '2026-05-21'
  });
  const serviceReport = report({
    id: 'rcpu-1',
    reportType: ReportType.RCPU,
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-21',
    specialConditions: { parentRdoId: finalRdo.id }
  });

  const reports = byId([firstRdo, finalRdo, serviceReport]);

  assert.equal(previousRdosSignedForServiceReport(serviceReport, finalRdo, reports), false);
  assert.equal(canClientSeeReport(serviceReport, reports), false);
});

test('service report is visible when parent and all previous project RDOs are signed', () => {
  const firstRdo = report({
    id: 'rdo-1',
    status: ReportStatus.SIGNED,
    reportDate: '2026-05-20'
  });
  const finalRdo = report({
    id: 'rdo-2',
    status: ReportStatus.SIGNED,
    reportDate: '2026-05-21'
  });
  const serviceReport = report({
    id: 'rcpu-1',
    reportType: ReportType.RCPU,
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-21',
    specialConditions: { parentRdoId: finalRdo.id }
  });

  const reports = byId([firstRdo, finalRdo, serviceReport]);

  assert.equal(previousRdosSignedForServiceReport(serviceReport, finalRdo, reports), true);
  assert.equal(canClientSeeReport(serviceReport, reports), true);
});

test('removed pending signer no longer blocks an existing RDO signature round', () => {
  const oldRound = report({
    project: {
      id: 'project-1',
      code: 'P-1',
      name: 'Projeto 1',
      clientCnpj: '12345678000190',
      clientEmailPrimary: 'responsavel@example.com',
      clientEmailCc: ['novo@example.com'],
      clientSigners: [{ name: 'Novo signatario', email: 'novo@example.com' }],
      deletedAt: null
    },
    versions: [{
      id: 'version-1',
      status: ReportVersionStatus.ACTIVE,
      signatures: [
        {
          id: 'signature-primary',
          signerEmail: 'responsavel@example.com',
          status: ReportSignatureStatus.SIGNED,
          isRequired: true
        },
        {
          id: 'signature-removed',
          signerEmail: 'removido@example.com',
          status: ReportSignatureStatus.PENDING,
          isRequired: true
        }
      ]
    }]
  });

  assert.deepEqual(removedPendingRequiredClientSignatureIds(oldRound), ['signature-removed']);
});

test('removed pending signer is kept when the old round has no current project signer', () => {
  const oldRound = report({
    project: {
      id: 'project-1',
      code: 'P-1',
      name: 'Projeto 1',
      clientCnpj: '12345678000190',
      clientEmailPrimary: 'novo@example.com',
      clientEmailCc: [],
      clientSigners: [],
      deletedAt: null
    },
    versions: [{
      id: 'version-1',
      status: ReportVersionStatus.ACTIVE,
      signatures: [{
        id: 'signature-old-primary',
        signerEmail: 'antigo@example.com',
        status: ReportSignatureStatus.PENDING,
        isRequired: true
      }]
    }]
  });

  assert.deepEqual(removedPendingRequiredClientSignatureIds(oldRound), []);
});

test('client can see approved reports under archived projects', () => {
  const archivedReport = report({
    status: ReportStatus.APPROVED,
    project: {
      id: 'project-1',
      code: 'P-1',
      name: 'Projeto 1',
      clientCnpj: '12345678000190',
      clientEmailPrimary: 'responsavel@example.com',
      clientEmailCc: [],
      deletedAt: new Date('2026-05-28T12:00:00.000Z')
    }
  });

  assert.equal(canClientSeeReport(archivedReport, byId([archivedReport])), true);
});

test('signing an earlier RDO reports service documents that become visible', async () => {
  const firstRdo = report({
    id: 'rdo-1',
    status: ReportStatus.SIGNED,
    reportDate: '2026-05-20'
  });
  const finalRdo = report({
    id: 'rdo-2',
    status: ReportStatus.SIGNED,
    reportDate: '2026-05-21'
  });
  const serviceReport = report({
    id: 'rcpu-1',
    reportType: ReportType.RCPU,
    sequenceNumber: 7,
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-21',
    specialConditions: { parentRdoId: finalRdo.id }
  });
  const client = {
    report: {
      findMany: async () => [firstRdo, finalRdo, serviceReport]
    }
  };

  const released = await releasedServiceReportsAfterRdoSignature(firstRdo, client);

  assert.deepEqual(released.map(item => ({
    id: item.id,
    projectId: item.projectId,
    reportType: item.reportType,
    sequenceNumber: item.sequenceNumber,
    project: item.project
  })), [{
    id: 'rcpu-1',
    projectId: 'project-1',
    reportType: ReportType.RCPU,
    sequenceNumber: 7,
    project: {
      id: 'project-1',
      code: 'P-1',
      name: 'Projeto 1'
    }
  }]);
});

test('project email recipients include primary and cc without duplicates', () => {
  const recipients = projectEmailRecipients({
    clientEmailPrimary: ' Responsavel@Example.com ',
    clientEmailCc: ['copia@example.com', 'responsavel@example.com', 'COPIA@example.com', ''],
    clientSigners: [
      { name: 'Assinante', email: 'assinante@example.com' },
      { name: 'Duplicado', email: 'copia@example.com' }
    ]
  });

  assert.deepEqual(recipients, {
    to: 'responsavel@example.com',
    cc: ['copia@example.com', 'assinante@example.com'],
    recipients: ['responsavel@example.com', 'copia@example.com', 'assinante@example.com']
  });
});

test('released service reports email sends project recipients with pdf attachments', async () => {
  const rdo = report({
    id: 'rdo-1',
    status: ReportStatus.SIGNED,
    sequenceNumber: 12,
    project: {
      id: 'project-1',
      code: 'P-1',
      name: 'Projeto 1',
      clientCnpj: '12345678000190',
      clientEmailPrimary: 'responsavel@example.com',
      clientEmailCc: ['copia@example.com'],
      deletedAt: null
    }
  });
  const serviceReport = report({
    id: 'rcpu-1',
    reportType: ReportType.RCPU,
    sequenceNumber: 7,
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-21',
    specialConditions: { parentRdoId: rdo.id },
    project: rdo.project
  });
  const sent = [];

  const result = await sendReleasedServiceReportsEmail(rdo, [serviceReport], {
    missingMailerConfig: [],
    mailer: async message => {
      sent.push(message);
      return { messageId: 'mail-1' };
    },
    getPdfDownload: async reportItem => ({
      fileName: `${reportItem.reportType}-${reportItem.sequenceNumber}.pdf`,
      buffer: Buffer.from(`pdf-${reportItem.id}`)
    })
  });

  assert.deepEqual(result, { ok: true, sentCount: 2, attachmentCount: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'responsavel@example.com');
  assert.deepEqual(sent[0].cc, ['copia@example.com']);
  assert.match(sent[0].subject, /Relatórios de serviço liberados/);
  assert.equal(sent[0].attachments.length, 1);
  assert.equal(sent[0].attachments[0].filename, 'RCPU-7.pdf');
  assert.equal(sent[0].attachments[0].content.toString(), 'pdf-rcpu-1');
});
