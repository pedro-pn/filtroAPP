import { useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  confirmPublicSignature,
  getPublicReport,
  getPublicSignature,
  type PublicSignatureConfirmPayload,
  type PublicSignaturePayload,
  type PublicSignatureReportPayload,
  publicSignaturePdfUrl,
  publicReportPdfUrl,
  rejectPublicSignature
} from '../api/publicSignatures';
import { PrivacyNotice } from '../components/privacy/PrivacyNotice';
import { SignatureDialog } from '../components/reports/SignatureDialog';
import { PublicReportDocumentPreview } from '../components/reports/PublicReportDocumentPreview';
import { BrandLogo } from '../components/brand/BrandLogo';
import { Alert, Button, Card, Field, Skeleton, StatusPill, Textarea, type SemanticTone } from '../components/ui/ds';
import { useToast } from '../components/ui/ToastContext';
import { SIGNATURE_RDO_NOTICE_VERSION } from '../constants/privacy';
import { formatDateOnlyPtBr } from '../utils/dateOnly';
import previewRdoPdf from '../assets/previews/rdo-assinatura-exemplo.pdf?url';

import './RdoPublicPage.css';

const statusText: Record<string, string> = {
  ACTIVE: 'Disponível para assinatura',
  SIGNED: 'Assinatura já registrada',
  REJECTED: 'Relatório reprovado',
  INVALIDATED: 'Link invalidado',
  EXPIRED: 'Link expirado',
  UNAVAILABLE: 'Relatório indisponível',
  INVALID: 'Link inválido'
};

const statusTone: Record<string, SemanticTone> = {
  ACTIVE: 'info',
  SIGNED: 'brand',
  REJECTED: 'danger',
  INVALIDATED: 'danger',
  EXPIRED: 'warning',
  UNAVAILABLE: 'neutral',
  INVALID: 'danger'
};

const previewSignature: PublicSignaturePayload = {
  status: 'ACTIVE',
  expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  signer: { signatureId: 'visual-preview', name: 'Marina Costa', prefillName: true, email: 'marina@exemplo.com', status: 'PENDING' },
  report: { id: 'visual-preview', reportType: 'RDO', sequenceNumber: 42, reportDate: '2026-10-20', status: 'APPROVED', sourceDocumentHash: 'visual-preview', project: { code: '5800', name: 'Projeto de demonstração', clientName: 'Cliente Exemplo' } }
};

export function PublicSignaturePage({ readOnly = false }: { readOnly?: boolean }) {
  const { token = '' } = useParams();
  const location = useLocation();
  const preview = !readOnly && import.meta.env.DEV && new URLSearchParams(location.search).get('visualizar') === '1';
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | undefined>();
  const [rejectionReason, setRejectionReason] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [previewSigned, setPreviewSigned] = useState(false);

  const signatureQuery = useQuery({
    queryKey: [readOnly ? 'public-report' : 'public-signature', token],
    queryFn: async (): Promise<PublicSignaturePayload> => {
      if (!readOnly) return getPublicSignature(token);
      const data = await getPublicReport(token);
      return { ...data, report: data.report ? { ...data.report, sourceDocumentHash: '' } : undefined };
    },
    enabled: !!token && !preview
  });

  const confirmMutation = useMutation({
    mutationFn: (payload: PublicSignatureConfirmPayload) => confirmPublicSignature(token, payload),
    onSuccess: data => {
      setSignatureOpen(false);
      showToast(data.completed ? 'Relatório assinado.' : 'Assinatura registrada.', 'success');
      queryClient.invalidateQueries({ queryKey: ['public-signature', token] });
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível assinar.', 'error')
  });

  const rejectMutation = useMutation({
    mutationFn: ({ comment, signatureId }: { comment: string; signatureId?: string }) => rejectPublicSignature(token, comment, signatureId),
    onSuccess: () => {
      setRejectOpen(false);
      setSelectedSignatureId(undefined);
      setRejectionReason('');
      showToast('Reprovação registrada.', 'success');
      queryClient.invalidateQueries({ queryKey: ['public-signature', token] });
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível reprovar.', 'error')
  });

  const payload = preview ? previewSignature : signatureQuery.data;
  const status = previewSigned ? 'SIGNED' : payload?.status || 'INVALID';
  const report = payload?.report;
  const signer = payload?.signer;
  const reportItems: PublicSignatureReportPayload[] = payload?.batch?.reports?.length
    ? payload.batch.reports
    : report && signer
      ? [{
          signatureId: signer.signatureId,
          status,
          expiresAt: payload.expiresAt || null,
          signer,
          report
        }]
      : [];
  const batchMode = reportItems.length > 1;
  const selectedItem = reportItems.find(item => item.signatureId === selectedSignatureId) || reportItems[0];
  const canSign = !readOnly && !previewSigned && reportItems.some(item => item.status === 'ACTIVE');

  function handleRejectSubmit(event: FormEvent) {
    event.preventDefault();
    const reason = rejectionReason.trim();
    if (!reason) {
      showToast('Informe o motivo da reprovação.', 'error');
      return;
    }
    if (preview) { setRejectOpen(false); showToast('Reprovação simulada.', 'info'); return; }
    rejectMutation.mutate({ comment: reason, signatureId: selectedSignatureId });
  }

  function openSignatureDialog(signatureId?: string) {
    if (!privacyAccepted) {
      showToast('Confirme a ciência do aviso de privacidade antes de assinar.', 'error');
      return;
    }
    setSelectedSignatureId(signatureId);
    setSignatureOpen(true);
  }

  function openRejectForm(signatureId?: string) {
    setSelectedSignatureId(signatureId);
    setRejectOpen(true);
  }

  function reportLabel(item?: PublicSignatureReportPayload) {
    if (!item) return 'Relatório';
    return `${item.report.reportType} ${item.report.sequenceNumber || ''}`.trim();
  }

  function initialPublicSignerName(item?: PublicSignatureReportPayload) {
    if (item?.signer.prefillName) return item.signer.name || '';
    if (!item && signer?.prefillName) return signer.name || '';
    return '';
  }

  return (
    <main className="fv-ds rdo-public-shell public-signature-page" data-fv-ds>
      <header className="rdo-public-header">
        <BrandLogo className="rdo-public-logo" />
      </header>
      <Card className="rdo-public-card public-signature-card" padding="lg" title={readOnly ? 'Consulta do RDO' : 'Assinatura eletrônica'}>
        {preview ? <Alert tone="info">Demonstração visual · nenhuma assinatura será enviada.</Alert> : null}
        {!preview && signatureQuery.isLoading ? <Skeleton variant="text" lines={5} label={readOnly ? 'Carregando RDO' : 'Carregando assinatura'} /> : null}
        {!preview && signatureQuery.isError ? (
          <Alert tone="danger" title={readOnly ? 'Não foi possível carregar o RDO' : 'Não foi possível carregar a assinatura'}>
            {signatureQuery.error instanceof Error ? signatureQuery.error.message : 'Não foi possível carregar o link.'}
          </Alert>
        ) : null}
        {(preview || (!signatureQuery.isLoading && !signatureQuery.isError)) ? (
          <>
            <StatusPill className="rdo-public-status" status={status} label={readOnly && status === 'ACTIVE' ? 'Disponível para consulta' : statusText[status] || status} tone={statusTone[status] || 'neutral'} />
            {report ? (
              <dl className="rdo-public-details">
                <div><dt>Projeto</dt><dd>{report.project.code} - {report.project.name}</dd></div>
                {batchMode ? (
                  <div><dt>Pendências</dt><dd>{reportItems.length} RDOs para assinatura</dd></div>
                ) : (
                  <>
                    <div><dt>Relatório</dt><dd>{report.reportType} {report.sequenceNumber || ''}</dd></div>
                    <div><dt>Data</dt><dd>{formatDateOnlyPtBr(report.reportDate || '')}</dd></div>
                  </>
                )}
                {!readOnly ? <div><dt>Signatário</dt><dd>{signer?.name || '-'} ({signer?.email || '-'})</dd></div> : null}
                {readOnly && payload?.expiresAt ? <div><dt>Link válido até</dt><dd>{new Date(payload.expiresAt).toLocaleString('pt-BR')}</dd></div> : null}
              </dl>
            ) : (
              <Alert tone="warning">{readOnly ? 'O link de consulta está inválido, expirado ou indisponível.' : 'Não foi possível localizar uma assinatura ativa para este link.'}</Alert>
            )}
            {status === 'ACTIVE' && report ? (
              readOnly ? <PublicReportDocumentPreview key={token} pdfUrl={publicReportPdfUrl(token)} title={`${report.reportType} ${report.sequenceNumber || ''}`.trim()} />
                : reportItems.filter(item => item.status === 'ACTIVE').map(item => (
                  <PublicReportDocumentPreview key={item.signatureId || item.report.id}
                    pdfUrl={preview ? previewRdoPdf : publicSignaturePdfUrl(token, item.signatureId)}
                    title={reportLabel(item)} />
                ))
            ) : null}
            {readOnly && status === 'ACTIVE' && report ? (
              <>
                <p>Acesso para consulta e download, sem necessidade de assinatura.</p>
                <div className="public-signature-actions public-report-actions">
                  <a className="fv-button fv-button--primary" href={publicReportPdfUrl(token)} target="_blank" rel="noopener noreferrer">
                    Baixar PDF do RDO
                  </a>
                </div>
              </>
            ) : null}
            {canSign ? (
              <>
                <PrivacyNotice
                  variant="signatureRdo"
                  checked={privacyAccepted}
                  onCheckedChange={setPrivacyAccepted}
                  disabled={confirmMutation.isPending}
                />
                <div className={batchMode ? 'public-signature-report-list' : 'public-signature-single-container'}>
                  {reportItems.map(item => (
                    <Card className={batchMode ? 'public-signature-report-card' : 'public-signature-single-actions'} padding="sm" variant="flat" key={item.signatureId || item.report.id}>
                      {batchMode ? (
                        <div className="public-signature-report-meta">
                          <strong>{reportLabel(item)}</strong>
                          <span>{formatDateOnlyPtBr(item.report.reportDate || '')}</span>
                        </div>
                      ) : null}
                      <div className="public-signature-actions">
                        <a className="fv-button fv-button--secondary fv-button--sm" href={preview ? previewRdoPdf : publicSignaturePdfUrl(token, item.signatureId)} target="_blank" rel="noopener noreferrer">
                          Abrir PDF
                        </a>
                        <Button size="sm" variant="primary" type="button" onClick={() => openSignatureDialog(item.signatureId)} disabled={!privacyAccepted || item.status !== 'ACTIVE'}>
                          Assinar
                        </Button>
                        <Button size="sm" variant="danger" type="button" onClick={() => openRejectForm(item.signatureId)} disabled={item.status !== 'ACTIVE'}>
                          Reprovar
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
                {rejectOpen ? (
                  <form className="public-signature-reject" onSubmit={handleRejectSubmit}>
                    <Field id="public-signature-reason" label={`Motivo da reprovação de ${reportLabel(selectedItem)}`} required optionalText={null}>
                      <Textarea
                        id="public-signature-reason-control"
                        rows={4}
                        value={rejectionReason}
                        onChange={event => setRejectionReason(event.target.value)}
                        required
                      />
                    </Field>
                    <Button size="sm" variant="danger" type="submit" loading={rejectMutation.isPending}>
                      Confirmar reprovação
                    </Button>
                  </form>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </Card>
      <SignatureDialog
        open={signatureOpen}
        title={`Assinar ${reportLabel(selectedItem)}`}
        appearance="design-system"
        initialSignerName={initialPublicSignerName(selectedItem)}
        allowCachedSignerName={Boolean(initialPublicSignerName(selectedItem))}
        cacheIdentity={`${selectedItem?.signer.email || signer?.email || token}:${selectedItem?.signatureId || ''}`}
        isSubmitting={confirmMutation.isPending}
        onCancel={() => setSignatureOpen(false)}
        onConfirm={payload => {
          if (preview) { setSignatureOpen(false); setPreviewSigned(true); showToast('Assinatura simulada.', 'success'); return; }
          confirmMutation.mutate({ ...payload, signatureId: selectedSignatureId, privacyNoticeAccepted: true, privacyNoticeVersion: SIGNATURE_RDO_NOTICE_VERSION });
        }}
      />
    </main>
  );
}
