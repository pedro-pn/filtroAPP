import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  confirmPublicSignature,
  getPublicSignature,
  type PublicSignatureConfirmPayload,
  publicSignaturePdfUrl,
  rejectPublicSignature
} from '../api/publicSignatures';
import { PrivacyNotice } from '../components/privacy/PrivacyNotice';
import { SignatureDialog } from '../components/reports/SignatureDialog';
import { useToast } from '../components/ui/Toast';
import { SIGNATURE_RDO_NOTICE_VERSION } from '../constants/privacy';
import { formatDateOnlyPtBr } from '../utils/dateOnly';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const logoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_VERDE.png`;

const statusText: Record<string, string> = {
  ACTIVE: 'Disponível para assinatura',
  SIGNED: 'Assinatura já registrada',
  REJECTED: 'Relatório reprovado',
  INVALIDATED: 'Link invalidado',
  EXPIRED: 'Link expirado',
  UNAVAILABLE: 'Relatório indisponível',
  INVALID: 'Link inválido'
};

export function PublicSignaturePage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const signatureQuery = useQuery({
    queryKey: ['public-signature', token],
    queryFn: () => getPublicSignature(token),
    enabled: !!token
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
    mutationFn: (comment: string) => rejectPublicSignature(token, comment),
    onSuccess: () => {
      setRejectOpen(false);
      setRejectionReason('');
      showToast('Reprovação registrada.', 'success');
      queryClient.invalidateQueries({ queryKey: ['public-signature', token] });
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível reprovar.', 'error')
  });

  const payload = signatureQuery.data;
  const status = payload?.status || 'INVALID';
  const report = payload?.report;
  const signer = payload?.signer;
  const canSign = status === 'ACTIVE';

  function handleRejectSubmit(event: FormEvent) {
    event.preventDefault();
    const reason = rejectionReason.trim();
    if (!reason) {
      showToast('Informe o motivo da reprovação.', 'error');
      return;
    }
    rejectMutation.mutate(reason);
  }

  function openSignatureDialog() {
    if (!privacyAccepted) {
      showToast('Confirme a ciência do aviso de privacidade antes de assinar.', 'error');
      return;
    }
    setSignatureOpen(true);
  }

  return (
    <main className="survey-page-shell public-signature-page">
      <header className="survey-header">
        <img src={logoUrl} alt="Filtrovali" />
      </header>
      <section className="auth-card public-signature-card">
        <div className="section-title">Assinatura eletrônica</div>
        {signatureQuery.isLoading ? <p className="placeholder-copy">Carregando assinatura...</p> : null}
        {signatureQuery.isError ? (
          <p className="inline-error">
            {signatureQuery.error instanceof Error ? signatureQuery.error.message : 'Não foi possível carregar o link.'}
          </p>
        ) : null}
        {!signatureQuery.isLoading && !signatureQuery.isError ? (
          <>
            <div className={`public-signature-status status-${status.toLowerCase()}`}>
              {statusText[status] || status}
            </div>
            {report ? (
              <div className="det-section">
                <div className="det-row"><span className="det-label">Projeto</span><span className="det-val">{report.project.code} - {report.project.name}</span></div>
                <div className="det-row"><span className="det-label">Relatório</span><span className="det-val">{report.reportType} {report.sequenceNumber || ''}</span></div>
                <div className="det-row"><span className="det-label">Data</span><span className="det-val">{formatDateOnlyPtBr(report.reportDate || '')}</span></div>
                <div className="det-row"><span className="det-label">Signatário</span><span className="det-val">{signer?.name || '-'} ({signer?.email || '-'})</span></div>
              </div>
            ) : (
              <p className="placeholder-copy">Não foi possível localizar uma assinatura ativa para este link.</p>
            )}
            {canSign ? (
              <>
                <PrivacyNotice
                  variant="signatureRdo"
                  checked={privacyAccepted}
                  onCheckedChange={setPrivacyAccepted}
                  disabled={confirmMutation.isPending}
                />
                <div className="public-signature-actions">
                  <a className="secondary-button" href={publicSignaturePdfUrl(token)} target="_blank" rel="noopener noreferrer">
                    Abrir PDF
                  </a>
                  <button className="primary-button" type="button" onClick={openSignatureDialog} disabled={!privacyAccepted}>
                    Assinar
                  </button>
                  <button className="secondary-button" type="button" onClick={() => setRejectOpen(current => !current)}>
                    Reprovar
                  </button>
                </div>
                {rejectOpen ? (
                  <form className="public-signature-reject" onSubmit={handleRejectSubmit}>
                    <div className="field-group">
                      <label htmlFor="public-signature-reason">Motivo da reprovação</label>
                      <textarea
                        id="public-signature-reason"
                        rows={4}
                        value={rejectionReason}
                        onChange={event => setRejectionReason(event.target.value)}
                        required
                      />
                    </div>
                    <button className="danger-button" type="submit" disabled={rejectMutation.isPending}>
                      Confirmar reprovação
                    </button>
                  </form>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </section>
      <SignatureDialog
        open={signatureOpen}
        title="Assinar relatório"
        initialSignerName={signer?.name || ''}
        cacheIdentity={signer?.email || token}
        isSubmitting={confirmMutation.isPending}
        onCancel={() => setSignatureOpen(false)}
        onConfirm={payload => confirmMutation.mutate({
          ...payload,
          privacyNoticeAccepted: true,
          privacyNoticeVersion: SIGNATURE_RDO_NOTICE_VERSION
        })}
      />
    </main>
  );
}
