import { useCallback, useEffect, useState } from 'react';

import { ApiClientError } from '../../api/client';
import { confirmPublicSignature, publicSignaturePage, publicSignaturePdf } from '../../api/assinaturas';
import { PrivacyNotice } from '../../components/privacy/PrivacyNotice';
import { SignatureDialog } from '../../components/reports/SignatureDialog';
import { Alert } from '../../components/ui/ds';
import { SIGNATURE_AVULSA_NOTICE_VERSION } from '../../constants/privacy';
import { usePublicSignatureInvite } from '../../hooks/useAssinaturas';
import { captureInviteFromFragment, inviteTokenFromFragment } from './utils/coordinates';
import { PublicSignatureShell, PublicSignatureState, PublicSignatureView } from './components/PublicSignatureView';

export function AssinaturasPublicSignPage() {
  const [token, setToken] = useState(() => inviteTokenFromFragment(window.location));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'danger' } | null>(null);
  const inviteQuery = usePublicSignatureInvite(token, polling);
  const loadPage = useCallback((page: number, signal: AbortSignal) => publicSignaturePage(token, page, signal), [token]);

  useEffect(() => {
    const captureRenewedInvite = () => {
      const nextToken = captureInviteFromFragment(window.location, window.history);
      if (!nextToken) return;
      setToken(nextToken);
      setDialogOpen(false);
      setPrivacyAccepted(false);
      setSubmitting(false);
      setPolling(false);
      setMessage(null);
    };
    window.addEventListener('hashchange', captureRenewedInvite);
    captureRenewedInvite();
    return () => window.removeEventListener('hashchange', captureRenewedInvite);
  }, []);

  useEffect(() => {
    const status = inviteQuery.data?.document.status;
    if (status === 'FINALIZANDO') setPolling(true);
    if (status === 'CONCLUIDO') setPolling(false);
  }, [inviteQuery.data?.document.status]);

  async function sign(payload: { signerName: string; signatureImageDataUrl: string }) {
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await confirmPublicSignature(token, {
        ...payload,
        privacyNoticeAccepted: privacyAccepted,
        privacyNoticeVersion: SIGNATURE_AVULSA_NOTICE_VERSION
      });
      setDialogOpen(false);
      setMessage({ tone: 'info', text: result.documentStatus === 'FINALIZANDO' ? 'Assinatura recebida. Estamos finalizando o PDF.' : 'Assinatura registrada com sucesso.' });
      setPolling(result.documentStatus === 'FINALIZANDO');
      await inviteQuery.refetch();
      requestAnimationFrame(() => document.getElementById('assinaturas-public-title')?.focus({ preventScroll: true }));
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Não foi possível registrar a assinatura.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function download() {
    if (downloading) return;
    setDownloading(true);
    setMessage(null);
    try {
      const blob = await publicSignaturePdf(token);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${inviteQuery.data?.document.title || 'documento'}-assinado.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Não foi possível baixar o documento.' });
    } finally {
      setDownloading(false);
    }
  }

  const error = inviteQuery.error instanceof ApiClientError ? inviteQuery.error : null;
  if (!token) return <PublicSignatureShell><PublicSignatureState title="Link inválido" description="Solicite um novo link a quem enviou o documento." /></PublicSignatureShell>;
  if (inviteQuery.isLoading) return <PublicSignatureShell><PublicSignatureState loading title="Carregando convite..." /></PublicSignatureShell>;
  if (inviteQuery.isError || !inviteQuery.data) {
    const retryable = !error?.status || error.status >= 500 || error.status === 429;
    const title = error?.status === 410 ? 'Link expirado ou indisponível' : retryable ? 'Não foi possível carregar o convite' : 'Link indisponível';
    return <PublicSignatureShell><PublicSignatureState title={title}
      description={error?.message || (retryable ? 'Verifique sua conexão e tente novamente.' : 'Solicite um novo link a quem enviou o documento.')}
      onRetry={retryable ? () => { void inviteQuery.refetch(); } : undefined} retrying={inviteQuery.isFetching} /></PublicSignatureShell>;
  }

  const invite = inviteQuery.data;
  return (
    <PublicSignatureShell>
      <PublicSignatureView invite={invite} loadPage={loadPage}
        downloading={downloading} onDownload={download}
        onSign={() => { setMessage(null); setDialogOpen(true); }}
        feedback={message && !dialogOpen && (message.tone === 'danger' || invite.signer.status !== 'ASSINADO') ? <Alert tone={message.tone}>{message.text}</Alert> : null} />
      <SignatureDialog
        open={dialogOpen}
        appearance="design-system"
        fullscreenOnMobile={false}
        backdropClassName="assinaturas-public__dialog-backdrop"
        title="Assinar documento"
        initialSignerName={invite.signer.name}
        allowCachedSignerName={false}
        isSubmitting={submitting}
        loadingLabel="Assinando documento"
        confirmDisabled={!privacyAccepted}
        notice={<div className="assinaturas-public__consent">
          <PrivacyNotice variant="signatureAvulsa" checked={privacyAccepted} onCheckedChange={setPrivacyAccepted} disabled={submitting} />
          {message?.tone === 'danger' ? <Alert tone="danger" title="Não foi possível assinar">{message.text}</Alert> : null}
        </div>}
        onCancel={() => { if (!submitting) { setDialogOpen(false); setMessage(null); } }}
        onConfirm={sign}
      />
    </PublicSignatureShell>
  );
}
