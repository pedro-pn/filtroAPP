import assert from 'node:assert/strict';
import test from 'node:test';

import { reportApprovalAccessLink, reportClientAccessStatus } from '../src/lib/reports/client-access.js';
import { encryptSignatureToken, signatureTokenHash } from '../src/lib/signature-token.js';
import { sendApprovedReportNotifications } from '../src/routes/resources/reports.js';

const approvalDate = new Date('2026-10-20T12:00:00Z');

function reportFixture() {
  return {
    id: 'report-1', reportType: 'RDO', status: 'APPROVED', approvedAt: approvalDate,
    sequenceNumber: 42, reportDate: approvalDate,
    project: {
      code: '5800', name: 'Projeto', clientName: 'Cliente',
      clientEmailPrimary: 'cliente@example.com', clientEmailCc: ['copia@example.com', 'outra@example.com'],
      clientSigners: [{ name: 'Fiscal', email: 'fiscal@example.com' }]
    },
    versions: [{ id: 'version-1', status: 'ACTIVE' }],
    reportSignatures: []
  };
}

function pendingSignature(email = 'cliente@example.com') {
  const token = `signature-token-${email}`;
  return {
    id: `signature-${email}`, signerEmail: email, status: 'PENDING',
    tokenHash: signatureTokenHash(token), ...encryptSignatureToken(token),
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000)
  };
}

test('approval links reuse the individual signature invite without rotating it', async () => {
  const report = reportFixture();
  const signature = pendingSignature();
  report.reportSignatures = [signature];
  const link = await reportApprovalAccessLink(report, 'CLIENTE@example.com', {});
  assert.equal(link.canSign, true);
  assert.ok(link.accessUrl.endsWith('/assinar/signature-token-cliente%40example.com'));
  assert.equal(link.expiresAt, signature.tokenExpiresAt);
});

test('approval issues a 30-day signature token when the first invite delivery failed', async () => {
  const report = reportFixture();
  const signature = pendingSignature();
  signature.tokenHash = null;
  signature.tokenExpiresAt = null;
  report.reportSignatures = [signature];
  let saved;
  const before = Date.now();
  const link = await reportApprovalAccessLink(report, signature.signerEmail, {
    reportSignature: { async update({ data }) { saved = data; } }
  });
  const token = decodeURIComponent(link.accessUrl.split('/').pop());
  assert.equal(link.canSign, true);
  assert.equal(saved.tokenHash, signatureTokenHash(token));
  assert.ok(saved.tokenExpiresAt.getTime() >= before + 30 * 86_400_000);
  assert.ok(saved.tokenExpiresAt.getTime() <= Date.now() + 30 * 86_400_000);
});

test('each non-signer receives a unique 30-day token stored only as a hash', async () => {
  const report = reportFixture();
  const records = [];
  const client = { reportClientAccess: { async create({ data }) { records.push(data); } } };
  const before = Date.now();
  const links = await Promise.all(['copia@example.com', 'outra@example.com'].map(email =>
    reportApprovalAccessLink(report, email, client)
  ));
  assert.notEqual(links[0].accessUrl, links[1].accessUrl);
  for (const [index, link] of links.entries()) {
    const token = link.accessUrl.split('/').pop();
    assert.equal(link.canSign, false);
    assert.match(link.accessUrl, /\/rdo-publico\/[a-f0-9]{64}$/);
    assert.equal(records[index].tokenHash, signatureTokenHash(token));
    assert.notEqual(records[index].tokenHash, token);
    assert.equal(records[index].reportId, report.id);
    assert.equal(records[index].versionId, 'version-1');
    assert.equal(records[index].approvedAt, approvalDate);
    assert.ok(link.expiresAt.getTime() >= before + 30 * 86_400_000);
    assert.ok(link.expiresAt.getTime() <= Date.now() + 30 * 86_400_000);
  }
});

test('approval and reapproval emails send only the appropriate recipient link', async () => {
  for (const reapproved of [false, true]) {
    const report = reportFixture();
    report.reportSignatures = [pendingSignature(), pendingSignature('fiscal@example.com')];
    const emails = [];
    const accesses = [];
    await sendApprovedReportNotifications(report, {
      reapproved, missingMailerConfig: [], mailer: async email => emails.push(email),
      client: {
        report: { async findUnique() { return report; } },
        reportClientAccess: { async create({ data }) { accesses.push(data); } }
      }
    });
    assert.equal(emails.length, 4);
    assert.equal(accesses.length, 2);
    for (const email of emails) {
      const signer = ['cliente@example.com', 'fiscal@example.com'].includes(email.to);
      assert.match(email.text, /validade de 30 dias/);
      assert.match(email.html, /display:inline-block;background:#30503a/);
      assert.match(email.text, signer ? /Conferir e assinar RDO: .*\/assinar\// : /Consultar e baixar RDO: .*\/rdo-publico\//);
      assert.doesNotMatch(email.text, signer ? /\/rdo-publico\// : /\/assinar\//);
      for (const other of emails.filter(item => item.to !== email.to)) {
        const otherLink = other.text.match(/(?:Conferir e assinar RDO|Consultar e baixar RDO): (\S+)/)[1];
        assert.ok(!email.text.includes(otherLink));
      }
    }
  }
});

test('approval respects report email preferences before creating access tokens', async () => {
  const report = reportFixture();
  const emails = [];
  const accesses = [];
  await sendApprovedReportNotifications(report, {
    missingMailerConfig: [], mailer: async email => emails.push(email),
    client: {
      report: { async findUnique() { return report; } },
      user: { async findMany() { return [{ email: 'copia@example.com', notifyReportsByEmail: false }]; } },
      reportClientAccess: { async create({ data }) { accesses.push(data); } }
    }
  });
  assert.equal(emails.length, 3);
  assert.ok(!emails.some(email => email.to === 'copia@example.com'));
  assert.ok(!accesses.some(access => access.recipientEmail === 'copia@example.com'));
});

test('view-only access expires exactly at 30 days, including after signing', () => {
  const access = { report: reportFixture(), approvedAt: approvalDate, versionId: 'version-1', expiresAt: new Date(approvalDate.getTime() + 30 * 86_400_000) };
  assert.equal(reportClientAccessStatus(access, new Date(access.expiresAt.getTime() - 1)), 'ACTIVE');
  assert.equal(reportClientAccessStatus(access, access.expiresAt), 'EXPIRED');
  access.report.status = 'SIGNED';
  assert.equal(reportClientAccessStatus(access, approvalDate), 'ACTIVE');
  assert.equal(reportClientAccessStatus(access, access.expiresAt), 'EXPIRED');
});

test('view-only access is blocked after removal, revision, reapproval or return to pending', () => {
  const access = () => ({ report: reportFixture(), approvedAt: approvalDate, versionId: 'version-1', expiresAt: new Date('2026-11-20') });
  for (const mutate of [
    item => { item.report.deletedAt = approvalDate; },
    item => { item.report.project.deletedAt = approvalDate; },
    item => { item.report.project.managerOnly = true; },
    item => { item.report.status = 'PENDING'; },
    item => { item.report.reportType = 'RTP'; }
  ]) {
    const item = access();
    mutate(item);
    assert.equal(reportClientAccessStatus(item, approvalDate), 'UNAVAILABLE');
  }
  const revised = access();
  revised.report.versions[0].status = 'SUPERSEDED';
  assert.equal(reportClientAccessStatus(revised, approvalDate), 'INVALIDATED');
  const reapproved = access();
  reapproved.report.approvedAt = new Date(approvalDate.getTime() + 1);
  assert.equal(reportClientAccessStatus(reapproved, approvalDate), 'INVALIDATED');
  assert.equal(reportClientAccessStatus(null, approvalDate), 'INVALID');
});
