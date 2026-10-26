import AdmZip from 'adm-zip';
import { buildReportFileName, safePath } from '../report-filename.js';
import { buildSignedReportCopiesEmailTemplate } from '../email-templates.js';
import { clientEmailsEnabled, sendClientMail } from '../mailer.js';
import { reportSourcePdfPath } from '../internal-report-signatures.js';

export function createPublicSignaturePdfDownload({
  currentSourceVersion, verifiedFinalPdfBuffer, verifiedSourcePdfBuffer, currentSignatureEvidencePdfDownload
}) {
  return async signature => {
    // Serve the immutable final PDF without regenerating the report.
    if (signature.version.finalDocumentHash) {
      const finalPath = reportSourcePdfPath(signature.version.finalPdfUrl);
      if (!finalPath) {
        const error = new Error('PDF assinado não encontrado.');
        error.statusCode = 404;
        throw error;
      }
      return { buffer: await verifiedFinalPdfBuffer(finalPath, signature.version) };
    }
    const version = await currentSourceVersion(signature.version);
    const sourcePath = reportSourcePdfPath(version.sourcePdfUrl);
    // A signer can keep their copy while the other required signatures are pending.
    if (signature.status === 'SIGNED') {
      return currentSignatureEvidencePdfDownload(signature.report, version, sourcePath);
    }
    return { buffer: await verifiedSourcePdfBuffer(sourcePath, version) };
  };
}

export function signedReportArchive(files, project) {
  const zip = new AdmZip();
  const names = new Set();
  for (const file of files) {
    let name = file.fileName;
    let suffix = 2;
    while (names.has(name)) name = `${file.fileName.replace(/\.pdf$/i, '')} (${suffix++}).pdf`;
    names.add(name);
    zip.addFile(name, file.buffer);
  }
  return {
    fileName: `RDOs assinados - ${safePath(project?.code || 'projeto')}.zip`,
    contentType: 'application/zip',
    buffer: zip.toBuffer()
  };
}

export function createPublicSignatureFiles({
  loadSignature, getPdfDownload, mailer = sendClientMail, emailsEnabled = clientEmailsEnabled
}) {
  async function download(token, signatureId) {
    const signature = await loadSignature(token, signatureId);
    const file = await getPdfDownload(signature);
    return { ...file, fileName: buildReportFileName(signature.report, 'pdf'), contentType: 'application/pdf' };
  }

  async function sendSignedCopies(token, signatureIds) {
    if (!signatureIds.length || !emailsEnabled()) return { status: 'skipped' };
    try {
      // Resolve every selected report again after signing, using the same token scope as downloads.
      const signatures = [];
      for (const id of new Set(signatureIds)) {
        const signature = await loadSignature(token, id);
        if (signature.status !== 'SIGNED') throw new Error('A assinatura do relatório ainda não foi registrada.');
        signatures.push(signature);
      }
      const recipient = signatures[0].signerEmail;
      const files = [];
      for (const signature of signatures) {
        if (signature.signerEmail.trim().toLowerCase() !== recipient.trim().toLowerCase()) {
          throw new Error('Os relatórios pertencem a signatários diferentes.');
        }
        files.push({
          ...await getPdfDownload(signature),
          fileName: buildReportFileName(signature.report, 'pdf'),
          contentType: 'application/pdf'
        });
      }
      const attachment = files.length === 1 ? files[0] : signedReportArchive(files, signatures[0].report.project);
      const template = buildSignedReportCopiesEmailTemplate({
        signerName: signatures[0].declaredSignerName || signatures[0].signerName,
        project: signatures[0].report.project,
        reports: signatures.map(signature => signature.report),
        pendingSignatures: signatures.some(signature => !signature.version.finalDocumentHash)
      });
      const delivery = await mailer({
        to: recipient,
        ...template,
        attachments: [{ filename: attachment.fileName, content: attachment.buffer, contentType: attachment.contentType }]
      });
      return { status: delivery?.skipped ? 'skipped' : 'sent', reportCount: signatures.length };
    } catch (error) {
      console.error('Falha ao enviar cópias dos RDOs assinados.', { signatureIds, error: error?.message });
      // Email failure must never turn a persisted signature into a failed confirmation.
      return { status: 'failed' };
    }
  }

  return { download, sendSignedCopies };
}
