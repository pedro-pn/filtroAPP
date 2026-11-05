import env from '../../config/env.js';
import {
  addNotificationPreferencesLink, buildReleasedServiceReportsEmailTemplate,
  buildReportSignatureCompletedEmailTemplate, buildReportSignatureReceivedEmailTemplate,
  buildReportSignatureDigestEmailTemplate, buildSignedReportCopiesEmailTemplate
} from '../email-templates.js';
import { coordinatorNotificationEmails, NotificationEmailCategory, notificationRecipientsForEmails } from '../notification-preferences.js';
import { buildReportFileName } from '../report-filename.js';
import { enqueueReportEmail } from './email-jobs.js';
import { isManualClientReleaseActive } from './client-visibility.js';
import { signedReportArchive } from './public-signature-files.js';

const dateLabel = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value));
const unavailable = report => !report || report.deletedAt || report.project?.deletedAt || report.project?.managerOnly;
const sameTime = (left, right) => new Date(left).getTime() === new Date(right).getTime();
const normalizeEmail = value => String(value || '').trim().toLowerCase();

export function createReportEmailProcessor({
  database, include, canClientSeeReport, releasedServiceReportsAfterRdoSignature,
  getReportPdfDownload, getSignedPdf, ensureSignatureRound, finalizeSignature,
  recipientsForEmails = notificationRecipientsForEmails, coordinators = coordinatorNotificationEmails
}) {
  async function recipients(emails, category) {
    return recipientsForEmails(emails, category, { client: database });
  }
  async function sendTo(deliver, list, template, attachments = []) {
    for (const recipient of list) {
      await deliver(recipient.email, {
        to: recipient.email,
        ...addNotificationPreferencesLink(template, recipient.notificationPreferencesUrl), attachments
      });
    }
  }
  return async (job, deliver) => {
    const payload = job.payload;
    if (job.kind === 'RELEASE_SCAN') {
      const rdo = await database.report.findUnique({ where: { id: payload.rdoId }, include });
      if (unavailable(rdo) || rdo.status !== 'SIGNED') return;
      for (const service of await releasedServiceReportsAfterRdoSignature(rdo, database)) {
        const report = await database.report.findUnique({ where: { id: service.id } });
        if (!report || report.deletedAt) continue;
        const revision = new Date(report.updatedAt).toISOString();
        await enqueueReportEmail(database, `service-release:${report.id}:${new Date(report.updatedAt).getTime()}`, 'SERVICE_RELEASE', {
          reportId: report.id, revision
        });
      }
      return;
    }
    if (job.kind === 'SERVICE_RELEASE' || job.kind === 'MANUAL_RELEASE') {
      const report = await database.report.findUnique({ where: { id: payload.reportId }, include });
      if (unavailable(report) || !['APPROVED', 'SIGNED'].includes(report.status)) return;
      if (!sameTime(report.updatedAt, payload.revision)) return;
      const manual = job.kind === 'MANUAL_RELEASE';
      if (manual && !isManualClientReleaseActive(report)) return;
      const projectReports = await database.report.findMany({ where: { projectId: report.projectId, deletedAt: null }, include });
      if (!canClientSeeReport(report, new Map(projectReports.map(item => [item.id, item])))) {
        throw new Error('Aguardando assinatura dos RDOs para liberar o relatório.');
      }
      const rdo = projectReports.find(item => item.id === report.specialConditions?.parentRdoId);
      if (unavailable(rdo)) return;
      if (report.project.requireServiceReportSignatures) {
        const preparation = await ensureSignatureRound(report);
        if (preparation?.emailDelivery?.ok === false) throw new Error('Convites de assinatura pendentes.');
      }
      const project = report.project;
      const emails = [project.clientEmailPrimary, ...(project.clientEmailCc || []), ...(project.clientSigners || []).map(item => item.email)];
      if (!emails.some(Boolean)) throw new Error('Projeto sem destinatário de e-mail configurado.');
      const list = await recipients(emails.filter(Boolean), NotificationEmailCategory.REPORTS);
      if (!list.length) return;
      const pdf = await getReportPdfDownload(report);
      const template = buildReleasedServiceReportsEmailTemplate({
        projectCode: project.code, projectName: project.name, rdoNumber: String(rdo.sequenceNumber || ''),
        rdoDate: dateLabel(rdo.reportDate), reports: [report], appUrl: env.appUrl || '', manualRelease: manual
      });
      await sendTo(deliver, list, template, [{
        filename: buildReportFileName(report, 'pdf'), content: pdf.buffer, contentType: 'application/pdf'
      }]);
      return;
    }
    if (!['SIGNATURE_NOTICE', 'SIGNED_COPY'].includes(job.kind)) throw new Error(`Unknown report email kind: ${job.kind}`);
    const reports = new Map();
    for (const event of payload.signatures || [payload]) {
      const signature = await database.reportSignature.findUnique({
        where: { id: event.signatureId },
        include: { report: { include }, version: { include: { signatures: true } } }
      });
      if (!signature || unavailable(signature.report) || signature.version.status !== 'ACTIVE'
        || signature.status === 'INVALIDATED' || !sameTime(signature.signedAt, event.signedAt)) continue;
      const report = signature.report;
      if (payload.projectId && report.projectId !== payload.projectId) continue;
      if (job.kind === 'SIGNED_COPY' && payload.recipientEmail
        && normalizeEmail(signature.signerEmail) !== payload.recipientEmail) continue;
      if (signature.status !== 'SIGNED') throw new Error('Assinatura ainda não concluída.');
      if (!['APPROVED', 'SIGNED'].includes(report.status)) continue;
      const version = signature.version;
      const required = version.signatures.filter(item => item.isRequired !== false);
      const completed = required.length > 0 && required.every(item => item.status === 'SIGNED');
      if (completed && !version.finalDocumentHash) {
        // Recover a crash between committing the signature and finalizing its PDF.
        if (finalizeSignature) await finalizeSignature(report, version);
        throw new Error('Aguardando PDF final da assinatura.');
      }
      reports.set(report.id, { signature, report, version, required, completed });
    }
    const entries = [...reports.values()];
    if (!entries.length) return;
    if (job.kind === 'SIGNED_COPY') {
      const { signature, report } = entries[0];
      const files = [];
      for (const entry of entries) {
        const pdf = await getSignedPdf(entry.signature);
        files.push({ fileName: buildReportFileName(entry.report, 'pdf'), buffer: pdf.buffer, contentType: 'application/pdf' });
      }
      const attachment = files.length === 1 ? files[0] : signedReportArchive(files, report.project);
      const template = buildSignedReportCopiesEmailTemplate({
        signerName: signature.declaredSignerName || signature.signerName, project: report.project,
        reports: entries.map(entry => entry.report), pendingSignatures: entries.some(entry => !entry.version.finalDocumentHash)
      });
      const emailTo = normalizeEmail(signature.signerEmail);
      await deliver(emailTo, { to: emailTo, ...template, attachments: [{
        filename: attachment.fileName, content: attachment.buffer, contentType: attachment.contentType
      }] });
      return;
    }
    const coordinatorEmails = await coordinators({ client: database });
    const byEmail = new Map();
    for (const entry of entries) {
      const report = entry.report;
      const manager = report.reviewedBy?.email || (report.createdBy?.role === 'MANAGER' ? report.createdBy.email : '');
      for (const email of new Set([manager, ...coordinatorEmails].map(normalizeEmail).filter(Boolean))) {
        if (!byEmail.has(email)) byEmail.set(email, []);
        byEmail.get(email).push(entry);
      }
    }
    const list = await recipients([...byEmail.keys()], NotificationEmailCategory.SIGNATURES);
    for (const recipient of list) {
      const selected = byEmail.get(normalizeEmail(recipient.email));
      const details = selected.map(({ signature, report, version, required, completed }) => ({
        projectCode: report.project.code, projectName: report.project.name, reportType: report.reportType,
        reportNumber: String(report.sequenceNumber || ''), reportDate: dateLabel(report.reportDate),
        signerName: signature.declaredSignerName || signature.signerName, signerEmail: signature.signerEmail,
        finalDocumentHash: version.finalDocumentHash, completed,
        signedCount: required.filter(item => item.status === 'SIGNED').length, requiredCount: required.length,
        appUrl: env.appUrl || ''
      }));
      const first = details[0];
      const template = details.length > 1
        ? buildReportSignatureDigestEmailTemplate({ projectCode: first.projectCode, projectName: first.projectName, reports: details, appUrl: env.appUrl || '' })
        : first.completed ? buildReportSignatureCompletedEmailTemplate(first) : buildReportSignatureReceivedEmailTemplate(first);
      await sendTo(deliver, [recipient], template);
    }
  };
}
