import env from '../../config/env.js';
import {
  addNotificationPreferencesLink, buildReleasedServiceReportsEmailTemplate,
  buildReportSignatureCompletedEmailTemplate, buildReportSignatureReceivedEmailTemplate,
  buildSignedReportCopiesEmailTemplate
} from '../email-templates.js';
import { coordinatorNotificationEmails, NotificationEmailCategory, notificationRecipientsForEmails } from '../notification-preferences.js';
import { buildReportFileName } from '../report-filename.js';
import { enqueueReportEmail } from './email-jobs.js';
import { isManualClientReleaseActive } from './client-visibility.js';

const dateLabel = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value));
const unavailable = report => !report || report.deletedAt || report.project?.deletedAt || report.project?.managerOnly;
const sameTime = (left, right) => new Date(left).getTime() === new Date(right).getTime();

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
    const signature = await database.reportSignature.findUnique({
      where: { id: payload.signatureId },
      include: { report: { include }, version: { include: { signatures: true } } }
    });
    if (!signature || unavailable(signature.report) || signature.version.status !== 'ACTIVE'
      || signature.status === 'INVALIDATED' || !sameTime(signature.signedAt, payload.signedAt)) return;
    if (signature.status !== 'SIGNED') throw new Error('Assinatura ainda não concluída.');
    const report = signature.report;
    if (!['APPROVED', 'SIGNED'].includes(report.status)) return;
    const version = signature.version;
    const required = version.signatures.filter(item => item.isRequired !== false);
    const completed = required.length > 0 && required.every(item => item.status === 'SIGNED');
    if (completed && !version.finalDocumentHash) {
      // Recover a crash between committing the signature and finalizing its PDF.
      if (finalizeSignature) await finalizeSignature(report, version);
      throw new Error('Aguardando PDF final da assinatura.');
    }
    if (job.kind === 'SIGNED_COPY') {
      const pdf = await getSignedPdf(signature);
      const template = buildSignedReportCopiesEmailTemplate({
        signerName: signature.declaredSignerName || signature.signerName, project: report.project,
        reports: [report], pendingSignatures: !version.finalDocumentHash
      });
      await deliver(signature.signerEmail, { to: signature.signerEmail, ...template, attachments: [{
        filename: buildReportFileName(report, 'pdf'), content: pdf.buffer, contentType: 'application/pdf'
      }] });
      return;
    }
    const common = {
      projectCode: report.project.code, projectName: report.project.name, reportType: report.reportType,
      reportNumber: String(report.sequenceNumber || ''), reportDate: dateLabel(report.reportDate),
      signerName: signature.signerName, signerEmail: signature.signerEmail, appUrl: env.appUrl || ''
    };
    const template = completed
      ? buildReportSignatureCompletedEmailTemplate({ ...common, finalDocumentHash: version.finalDocumentHash })
      : buildReportSignatureReceivedEmailTemplate({ ...common, signedCount: required.filter(item => item.status === 'SIGNED').length, requiredCount: required.length });
    const manager = report.reviewedBy?.email || (report.createdBy?.role === 'MANAGER' ? report.createdBy.email : '');
    const list = await recipients([manager, ...await coordinators({ client: database })].filter(Boolean), NotificationEmailCategory.SIGNATURES);
    await sendTo(deliver, list, template);
  };
}
