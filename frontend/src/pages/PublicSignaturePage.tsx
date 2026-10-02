import { useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  confirmPublicSignature,
  getPublicSignature,
  type PublicSignatureConfirmPayload,
  type PublicSignaturePayload,
  type PublicSignatureReportPayload,
  publicSignaturePdfUrl,
  rejectPublicSignature
} from '../api/publicSignatures';
import { PrivacyNotice } from '../components/privacy/PrivacyNotice';
import { SignatureDialog } from '../components/reports/SignatureDialog';
import { BrandLogo } from '../components/brand/BrandLogo';
import { Alert, Button, Card, Field, Skeleton, StatusPill, Textarea, type SemanticTone } from '../components/ui/ds';
import { useToast } from '../components/ui/ToastContext';
import { SIGNATURE_RDO_NOTICE_VERSION } from '../constants/privacy';
import { formatDateOnlyPtBr } from '../utils/dateOnly';

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
  expiresAt: '2030-12-31T00:00:00.000Z',
  signer: { signatureId: 'visual-preview', name: 'Marina Costa', prefillName: true, email: 'marina@exemplo.com', status: 'PENDING' },
  report: { id: 'visual-preview', reportType: 'RDO', sequenceNumber: 5824, reportDate: '2026-09-30', status: 'APPROVED', sourceDocumentHash: 'visual-preview', project: { code: '5917', name: 'Ilha Solteira', clientName: 'Cliente de demonstração' } }
};

export function PublicSignaturePage() {
  const { token = '' } = useParams();
  const location = useLocation();
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).get('visualizar') === '1';
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | undefined>();
  const [rejectionReason, setRejectionReason] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [previewSigned, setPreviewSigned] = useState(false);

  const signatureQuery = useQuery({
    queryKey: ['public-signature', token],
    queryFn: () => getPublicSignature(token),
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
  const canSign = !previewSigned && reportItems.some(item => item.status === 'ACTIVE');

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
      <Card className="rdo-public-card public-signature-card" padding="lg" title="Assinatura eletrônica">
        {preview ? <Alert tone="info">Demonstração visual · nenhuma assinatura será enviada.</Alert> : null}
        {!preview && signatureQuery.isLoading ? <Skeleton variant="text" lines={5} label="Carregando assinatura" /> : null}
        {!preview && signatureQuery.isError ? (
          <Alert tone="danger" title="Não foi possível carregar a assinatura">
            {signatureQuery.error instanceof Error ? signatureQuery.error.message : 'Não foi possível carregar o link.'}
          </Alert>
        ) : null}
        {(preview || (!signatureQuery.isLoading && !signatureQuery.isError)) ? (
          <>
            <StatusPill className="rdo-public-status" status={status} label={statusText[status] || status} tone={statusTone[status] || 'neutral'} />
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
                <div><dt>Signatário</dt><dd>{signer?.name || '-'} ({signer?.email || '-'})</dd></div>
              </dl>
            ) : (
              <Alert tone="warning">Não foi possível localizar uma assinatura ativa para este link.</Alert>
            )}
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
                        <a className="fv-button fv-button--secondary fv-button--sm" href={preview ? '#' : publicSignaturePdfUrl(token, item.signatureId)} onClick={preview ? event => event.preventDefault() : undefined} aria-disabled={preview || undefined} target="_blank" rel="noopener noreferrer">
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
