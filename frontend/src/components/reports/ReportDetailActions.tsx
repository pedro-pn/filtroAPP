import { useMemo, useState, type FormEvent } from 'react';

import { downloadReportDocx, downloadReportPdf } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { SIGNATURE_RDO_NOTICE_VERSION } from '../../constants/privacy';
import { useReportMutations } from '../../hooks/useReports';
import type { ReportSummary } from '../../types/domain';
import { clientCanSignReport, clientSignerPrefillNameForReport } from '../../utils/clientSignature';
import { downloadBlob } from '../../utils/download';
import { reportDownloadFileName } from '../../utils/reportFileName';
import { REPORT_DETAIL_TEXT as TEXT } from '../../pages/reportDetailText';
import { PrivacyNotice } from '../privacy/PrivacyNotice';
import { Modal } from '../ui/Modal';
import { ReasonDialog } from '../ui/ReasonDialog';
import { useToast } from '../ui/ToastContext';
import { Button, Input, Textarea } from '../ui/ds';
import { SignatureDialog } from './SignatureDialog';

function isManualUploadedReport(report: ReportSummary) {
  const special = report.specialConditions;
  const meta = special && typeof special.__manualUpload === 'object' && special.__manualUpload
    ? special.__manualUpload as Record<string, unknown>
    : {};
  return Boolean(meta.uploadedAt);
}

function hasActiveClientRejection(report: ReportSummary) {
  const special = report.specialConditions || {};
  const rejectedAt = typeof special.__clientRejectedAt === 'string' ? special.__clientRejectedAt : '';
  const resolvedAt = typeof special.__clientRejectionResolvedAt === 'string' ? special.__clientRejectionResolvedAt : '';
  if (!rejectedAt) return false;
  return !resolvedAt || new Date(rejectedAt).getTime() > new Date(resolvedAt).getTime();
}

export function ReportDetailActions({ report, role }: { report: ReportSummary; role?: string }) {
  const { user } = useAuth();
  const reportMutations = useReportMutations();
  const showToast = useToast();
  const [clientRejectOpen, setClientRejectOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [sequenceEditOpen, setSequenceEditOpen] = useState(false);
  const [sequenceEditValue, setSequenceEditValue] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [clientComment, setClientComment] = useState('');
  const manualReport = isManualUploadedReport(report);
  const canDownloadDocx = role === 'MANAGER' && !manualReport;
  const canClientSign = role === 'CLIENT' && clientCanSignReport(report, user, hasActiveClientRejection(report));
  const canEditSequence = role === 'MANAGER' && report.status !== 'SIGNED';

  async function handleDownload(format: 'pdf' | 'docx') {
    showToast(format === 'pdf' ? 'Gerando PDF...' : 'Gerando DOCX...', 'info');
    try {
      const blob = format === 'pdf' ? await downloadReportPdf(report.id) : await downloadReportDocx(report.id);
      downloadBlob(blob, reportDownloadFileName(report, format));
      showToast(format === 'pdf' ? 'PDF gerado com sucesso.' : 'DOCX baixado com sucesso.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.downloadError, 'error');
    }
  }

  const initialSignerName = useMemo(() => clientSignerPrefillNameForReport(report, user), [report, user]);

  async function handleRequestSignature({ signerName, signatureImageDataUrl }: { signerName: string; signatureImageDataUrl: string }) {
    try {
      const response = await reportMutations.requestSignature.mutateAsync({
        id: report.id,
        comment: clientComment.trim() || null,
        signerName,
        signatureImageDataUrl,
        privacyNoticeAccepted: true,
        privacyNoticeVersion: SIGNATURE_RDO_NOTICE_VERSION
      });
      setSignatureOpen(false);
      setPrivacyAccepted(false);
      showToast(response.completed ? 'Relatório assinado e bloqueado.' : 'Assinatura eletrônica registrada.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.requestSignatureError, 'error');
    }
  }

  async function handleClientReject(comment: string) {
    try {
      await reportMutations.clientReview.mutateAsync({ id: report.id, payload: { action: 'REJECTED', comment } });
      setClientRejectOpen(false);
      showToast('Avaliação registrada.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : TEXT.updateError, 'error');
    }
  }

  function openSequenceEdit() {
    setSequenceEditValue(report.sequenceNumber ? String(report.sequenceNumber) : '');
    setSequenceEditOpen(true);
  }

  function closeSequenceEdit() {
    setSequenceEditOpen(false);
    setSequenceEditValue('');
  }

  async function handleSequenceEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedValue = sequenceEditValue.trim();
    const sequenceNumber = /^\d+$/.test(normalizedValue) ? Number.parseInt(normalizedValue, 10) : NaN;
    if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
      showToast('Informe um número maior que zero.', 'error');
      return;
    }
    if (sequenceNumber === report.sequenceNumber) {
      closeSequenceEdit();
      return;
    }
    try {
      await reportMutations.updateSequence.mutateAsync({ id: report.id, payload: { sequenceNumber } });
      closeSequenceEdit();
      showToast('Numeração atualizada.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível alterar a numeração.', 'error');
    }
  }

  return (
    <>
      <div className="rdo-report-detail-actions">
        {canClientSign ? (
          <div className="rdo-report-detail-comment">
            <label htmlFor={`detail-client-review-comment-${report.id}`}>Comentário do cliente</label>
            <Textarea id={`detail-client-review-comment-${report.id}`} size="md" rows={3} placeholder="Comentário opcional que será exibido no relatório final" value={clientComment} onChange={event => setClientComment(event.target.value)} />
          </div>
        ) : null}
        <Button variant="primary" size="sm" type="button" onClick={() => void handleDownload('pdf')}>PDF</Button>
        {canDownloadDocx ? <Button variant="secondary" size="sm" type="button" onClick={() => void handleDownload('docx')}>DOCX</Button> : null}
        {canEditSequence ? <Button variant="secondary" size="sm" type="button" disabled={reportMutations.updateSequence.isPending} onClick={openSequenceEdit}>Alterar nº</Button> : null}
        {canClientSign ? (
          <>
            <Button variant="primary" size="sm" type="button" onClick={() => setSignatureOpen(true)}>Assinar digitalmente</Button>
            <Button variant="danger" size="sm" type="button" onClick={() => setClientRejectOpen(true)}>{TEXT.rejectClient}</Button>
          </>
        ) : null}
      </div>
      <ReasonDialog open={clientRejectOpen} title={TEXT.rejectClient} description={TEXT.rejectClientPrompt} label="Motivo" confirmLabel={TEXT.rejectClient} requiredMessage={TEXT.rejectClientRequired} isSubmitting={reportMutations.clientReview.isPending} appearance="design-system" onCancel={() => setClientRejectOpen(false)} onConfirm={reason => void handleClientReject(reason)} />
      <SignatureDialog
        open={signatureOpen}
        title="Assinar relatório"
        appearance="design-system"
        initialSignerName={initialSignerName}
        allowCachedSignerName={Boolean(initialSignerName)}
        cacheIdentity={user?.email || user?.username || user?.id || ''}
        isSubmitting={reportMutations.requestSignature.isPending}
        confirmDisabled={!privacyAccepted}
        confirmDisabledMessage="Confirme a ciência do aviso de privacidade para assinar."
        notice={<PrivacyNotice variant="signatureRdo" checked={privacyAccepted} onCheckedChange={setPrivacyAccepted} disabled={reportMutations.requestSignature.isPending} />}
        onCancel={() => { setSignatureOpen(false); setPrivacyAccepted(false); }}
        onConfirm={payload => void handleRequestSignature(payload)}
      />
      <Modal open={sequenceEditOpen} onClose={closeSequenceEdit} appearance="design-system" title="Alterar numeração" size="sm" ariaLabelledBy="detail-sequence-edit-title">
        <form className="rdo-report-sequence-form" onSubmit={handleSequenceEditSubmit}>
          <p className="placeholder-copy">Informe o novo número para {report.reportType}{report.sequenceNumber ? ` ${report.sequenceNumber}` : ''}.</p>
          <div className="rdo-report-detail-field">
            <label htmlFor="detail-sequence-edit-input">Novo número</label>
            <Input id="detail-sequence-edit-input" type="number" min={1} step={1} inputMode="numeric" value={sequenceEditValue} onChange={event => setSequenceEditValue(event.target.value)} required />
          </div>
          <div className="rdo-report-sequence-actions">
            <Button variant="secondary" size="sm" type="button" disabled={reportMutations.updateSequence.isPending} onClick={closeSequenceEdit}>Cancelar</Button>
            <Button variant="primary" size="sm" type="submit" disabled={reportMutations.updateSequence.isPending}>{reportMutations.updateSequence.isPending ? 'Salvando...' : 'Salvar número'}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
