import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { createReportEmailProcessor } from '../src/lib/reports/email-delivery.js';

const revision = '2026-10-30T16:41:27.444Z';
function fixture() {
  const project = { id: 'project', code: '5856', name: 'Marinha', clientEmailPrimary: 'stored@example.com' };
  const rdo = { id: 'rdo', projectId: project.id, project, reportType: 'RDO', sequenceNumber: 4, reportDate: revision, status: 'SIGNED' };
  const service = { id: 'rcpu2', projectId: project.id, project, reportType: 'RCPU', sequenceNumber: 2, reportDate: revision, status: 'APPROVED', updatedAt: revision, specialConditions: { parentRdoId: rdo.id } };
  const jobs = new Map();
  const database = {
    report: { findUnique: async ({ where }) => [rdo, service].find(item => item.id === where.id), findMany: async () => [rdo, service] },
    reportEmailJob: { upsert: async ({ create }) => { if (!jobs.has(create.id)) jobs.set(create.id, create); } }
  };
  const options = { database, canClientSeeReport: report => !report.deletedAt && rdo.status === 'SIGNED',
    releasedServiceReportsAfterRdoSignature: async () => [service],
    recipientsForEmails: async emails => [...new Set(emails)].map(email => ({ email })),
    getReportPdfDownload: async () => ({ buffer: Buffer.from('PDF') }), ensureSignatureRound: async () => {} };
  return { rdo, service, project, database, jobs, options };
}

test('signing several RDOs enqueues each released service revision only once', async () => {
  const f = fixture();
  const process = createReportEmailProcessor(f.options);
  await process({ kind: 'RELEASE_SCAN', payload: { rdoId: f.rdo.id } });
  await process({ kind: 'RELEASE_SCAN', payload: { rdoId: f.rdo.id } });
  assert.equal(f.jobs.size, 1);
  assert.equal([...f.jobs.values()][0].payload.reportId, 'rcpu2');
});

test('release retries propagate PDF errors and recheck current authorization and revision', async () => {
  const f = fixture();
  const job = { kind: 'SERVICE_RELEASE', payload: { reportId: 'rcpu2', revision } };
  const messages = [];
  const deliver = async (key, message) => messages.push(message);
  let busy = true;
  const process = createReportEmailProcessor({ ...f.options, getReportPdfDownload: async () => {
    if (busy) throw new Error('PDF ocupado');
    return { buffer: Buffer.from('PDF') };
  } });
  await assert.rejects(process(job, deliver), /PDF ocupado/);
  assert.equal(messages.length, 0);
  busy = false;
  await process(job, deliver);
  assert.equal(messages[0].to, 'stored@example.com');
  assert.equal(messages[0].attachments[0].content.toString(), 'PDF');
  f.rdo.status = 'APPROVED';
  await assert.rejects(process(job, deliver), /Aguardando assinatura/);
  assert.equal(messages.length, 1);
  f.rdo.status = 'SIGNED';
  f.service.updatedAt = '2026-10-30T17:00:00Z';
  await process(job, deliver);
  assert.equal(messages.length, 1);
});

test('manual releases revoked before a retry are not emailed', async () => {
  const f = fixture();
  const process = createReportEmailProcessor(f.options);
  const job = { kind: 'MANUAL_RELEASE', payload: { reportId: 'rcpu2', revision } };
  const sent = [];
  const deliver = async key => sent.push(key);
  f.service.clientReleasedAt = revision;
  await process(job, deliver);
  assert.equal(sent.length, 1);
  f.service.clientReleasedAt = null;
  await process(job, deliver);
  assert.equal(sent.length, 1);
});

test('signed copies wait for finalization and use the persisted signer address and verified PDF', async () => {
  const f = fixture();
  const signature = { id: 'sig', status: 'SIGNED', signedAt: revision, signerEmail: 'signer@example.com', signerName: 'Cliente', report: f.rdo,
    version: { status: 'ACTIVE', signatures: [{ status: 'SIGNED', isRequired: true }], finalDocumentHash: null } };
  f.database.reportSignature = { findUnique: async () => signature };
  const process = createReportEmailProcessor({ ...f.options, getSignedPdf: async () => ({ buffer: Buffer.from('verified') }) });
  const job = { kind: 'SIGNED_COPY', payload: { signatureId: signature.id, signedAt: revision } };
  const sent = [];
  const deliver = async (key, message) => sent.push(message);
  await assert.rejects(process(job, deliver), /Aguardando PDF final/);
  signature.version.finalDocumentHash = 'hash';
  await process(job, deliver);
  assert.equal(sent[0].to, 'signer@example.com');
  assert.equal(sent[0].attachments[0].content.toString(), 'verified');
  signature.version.status = 'SUPERSEDED';
  await process(job, deliver);
  assert.equal(sent.length, 1);
});

test('a persisted last signature recovers finalization after an HTTP process crash', async () => {
  const f = fixture();
  const signature = { id: 'sig', status: 'SIGNED', signedAt: revision, signerEmail: 'signer@example.com', report: f.rdo,
    version: { status: 'ACTIVE', signatures: [{ status: 'SIGNED', isRequired: true }], finalDocumentHash: null } };
  f.database.reportSignature = { findUnique: async () => signature };
  let finalized = 0;
  const process = createReportEmailProcessor({ ...f.options,
    finalizeSignature: async report => { assert.equal(report.id, 'rdo'); finalized += 1; signature.version.finalDocumentHash = 'recovered'; },
    getSignedPdf: async () => ({ buffer: Buffer.from('recovered-pdf') }) });
  const job = { kind: 'SIGNED_COPY', payload: { signatureId: 'sig', signedAt: revision } };
  const sent = [];
  await assert.rejects(process(job, async () => assert.fail('must wait for recovered finalization')), /Aguardando PDF final/);
  await process(job, async (key, message) => sent.push(message));
  assert.equal(finalized, 1);
  assert.equal(sent[0].attachments[0].content.toString(), 'recovered-pdf');
});

function signedFixture() {
  const f = fixture();
  const signatures = new Map();
  for (let number = 1; number <= 3; number++) {
    const report = { ...f.rdo, id: `report-${number}`, sequenceNumber: number,
      reviewedBy: { email: number === 3 ? 'other@example.com' : 'manager@example.com' } };
    signatures.set(`sig-${number}`, { id: `sig-${number}`, status: 'SIGNED', signedAt: revision,
      signerName: 'Cliente', signerEmail: 'signer@example.com', report,
      version: { status: 'ACTIVE', signatures: [{ status: 'SIGNED', isRequired: true }], finalDocumentHash: `hash-${number}` } });
  }
  f.database.reportSignature = { findUnique: async ({ where }) => signatures.get(where.id) };
  const job = { kind: 'SIGNATURE_NOTICE', payload: { projectId: f.project.id,
    signatures: [...signatures.values()].map(signature => ({ signatureId: signature.id, signedAt: revision })) } };
  return { ...f, signatures, job };
}

test('one project digest per recipient contains only their reports and respects email preferences', async () => {
  const f = signedFixture();
  f.signatures.get('sig-2').version = { status: 'ACTIVE', finalDocumentHash: null,
    signatures: [{ status: 'SIGNED', isRequired: true }, { status: 'PENDING', isRequired: true }] };
  let lookups = 0;
  const process = createReportEmailProcessor({ ...f.options,
    coordinators: async () => ['coordinator@example.com', 'coordinator@example.com', 'disabled@example.com'],
    recipientsForEmails: async (emails, category) => {
      lookups++;
      assert.equal(category, 'signatures');
      return emails.filter(email => email !== 'disabled@example.com')
        .map(email => ({ email, notificationPreferencesUrl: `https://example.com/preferences/${email}` }));
    } });
  const sent = [];
  await process(f.job, async (key, message) => sent.push({ key, ...message }));
  assert.equal(lookups, 1);
  assert.equal(sent.length, 3);
  const manager = sent.find(message => message.to === 'manager@example.com');
  assert.match(manager.subject, /2 relatórios/);
  assert.match(manager.text, /RDO 1/);
  assert.match(manager.text, /RDO 2/);
  assert.doesNotMatch(manager.text, /RDO 3/);
  assert.match(manager.text, /1\/2 assinaturas obrigatórias/);
  assert.match(manager.text, /Hash PDF final: hash-1/);
  assert.match(manager.text, /https:\/\/example.com\/preferences\/manager@example.com/);
  assert.match(sent.find(message => message.to === 'coordinator@example.com').subject, /3 relatórios/);
  const other = sent.find(message => message.to === 'other@example.com');
  assert.match(other.subject, /RDO 3 assinado/);
  assert.doesNotMatch(other.text, /RDO [12]/);
});

test('copy digest attaches one ZIP with all verified PDFs and deduplicates repeated reports', async () => {
  const f = signedFixture();
  f.job.kind = 'SIGNED_COPY';
  f.job.payload.recipientEmail = 'signer@example.com';
  f.job.payload.signatures.push(f.job.payload.signatures[0]);
  const process = createReportEmailProcessor({ ...f.options,
    getSignedPdf: async signature => ({ buffer: Buffer.from(`verified-${signature.id}`) }) });
  const sent = [];
  await process(f.job, async (key, message) => sent.push(message));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'signer@example.com');
  assert.match(sent[0].subject, /3 relatórios assinados/);
  assert.equal(sent[0].attachments.length, 1);
  const attachment = sent[0].attachments[0];
  assert.equal(attachment.contentType, 'application/zip');
  const entries = new AdmZip(attachment.content).getEntries();
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(entry => entry.getData().toString()).sort(), ['verified-sig-1', 'verified-sig-2', 'verified-sig-3']);
});

test('digest retries PDF failures before delivery and filters invalidated, superseded and deleted reports', async () => {
  const f = signedFixture();
  f.job.kind = 'SIGNED_COPY';
  f.job.payload.recipientEmail = 'signer@example.com';
  let failing = true;
  const process = createReportEmailProcessor({ ...f.options, getSignedPdf: async signature => {
    if (failing && signature.id === 'sig-2') throw new Error('PDF ocupado');
    return { buffer: Buffer.from('PDF') };
  } });
  const sent = [];
  const deliver = async (key, message) => sent.push(message);
  await assert.rejects(process(f.job, deliver), /PDF ocupado/);
  assert.equal(sent.length, 0);
  failing = false;
  f.signatures.get('sig-1').status = 'INVALIDATED';
  f.signatures.get('sig-2').version.status = 'SUPERSEDED';
  f.signatures.get('sig-3').report.deletedAt = revision;
  await process(f.job, deliver);
  assert.equal(sent.length, 0);
});

test('digest excludes stale signature events, other projects and other signer addresses', async () => {
  const f = signedFixture();
  f.job.kind = 'SIGNED_COPY';
  f.job.payload.recipientEmail = 'signer@example.com';
  f.signatures.get('sig-1').signedAt = '2026-10-31T16:00:00Z';
  f.signatures.get('sig-2').report.projectId = 'another-project';
  f.signatures.get('sig-3').signerEmail = 'someone-else@example.com';
  const process = createReportEmailProcessor({ ...f.options, getSignedPdf: async () => assert.fail('no authorized copy') });
  await process(f.job, async () => assert.fail('no authorized recipient'));
});
