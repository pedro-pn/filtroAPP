import { useCallback, useEffect, useState } from 'react';

import { ApiClientError } from '../../api/client';
import { confirmPublicSignature, publicSignaturePage, publicSignaturePdf } from '../../api/assinaturas';
import { PrivacyNotice } from '../../components/privacy/PrivacyNotice';
import { SignatureDialog } from '../../components/reports/SignatureDialog';
import { Button } from '../../components/ui/Button';
import { SIGNATURE_AVULSA_NOTICE_VERSION } from '../../constants/privacy';
import { usePublicSignatureInvite } from '../../hooks/useAssinaturas';
import { captureInviteFromFragment, inviteTokenFromFragment } from './utils/coordinates';
import { formatSignatureDateTime } from './utils/datetime';
import { SignatureDocumentPreview } from './components/SignatureDocumentPreview';

export function AssinaturasPublicSignPage() {
  // O inicializador pode ser executado mais de uma vez pelo React. A leitura precisa ser pura;
  // o fragmento só é removido no efeito depois que a montagem foi confirmada.
  const [token, setToken] = useState(() => inviteTokenFromFragment(window.location));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [message, setMessage] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'warning'>('warning');
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
      setMessage('');
      setDialogError('');
      setMessageKind('warning');
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
    setSubmitting(true);
    setMessage('');
    setDialogError('');
    try {
      const result = await confirmPublicSignature(token, {
        ...payload,
        privacyNoticeAccepted: privacyAccepted,
        privacyNoticeVersion: SIGNATURE_AVULSA_NOTICE_VERSION
      });
      setDialogOpen(false);
      setMessage(result.documentStatus === 'FINALIZANDO' ? 'Assinatura recebida. Estamos finalizando o PDF.' : 'Assinatura registrada com sucesso.');
      setMessageKind('success');
      setPolling(result.documentStatus === 'FINALIZANDO');
      await inviteQuery.refetch();
    } catch (error) {
      const errorMessage = error instanceof ApiClientError
        ? error.message
        : 'Não foi possível enviar a assinatura. Verifique sua conexão e tente novamente.';
      setMessage(errorMessage);
      setDialogError(errorMessage);
      setMessageKind('warning');
    } finally {
      setSubmitting(false);
    }
  }

  async function download() {
    try {
      const blob = await publicSignaturePdf(token);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${inviteQuery.data?.document.title || 'documento'}-assinado.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível baixar o documento.');
      setMessageKind('warning');
    }
  }

  const error = inviteQuery.error instanceof ApiClientError ? inviteQuery.error : null;
  if (!token) return <main className="survey-page-shell"><section className="auth-card"><h1>Link inválido</h1><p>Solicite um novo link a quem enviou o documento.</p></section></main>;
  if (inviteQuery.isLoading) return <main className="survey-page-shell"><section className="auth-card"><p>Carregando convite...</p></section></main>;
  if (error || !inviteQuery.data) return <main className="survey-page-shell"><section className="auth-card"><h1>{error?.status === 410 ? 'Link expirado ou indisponível' : 'Link inválido'}</h1><p>{error?.message || 'Solicite um novo link a quem enviou o documento.'}</p></section></main>;

  const invite = inviteQuery.data;
  return (
    <main className="survey-page-shell signature-public-page">
      <section className="auth-card signature-public-card">
        <h1>{invite.document.title}</h1>
        <p>Solicitado por {invite.document.requestedBy}</p>
        <p>{invite.document.progress.signed} de {invite.document.progress.total} assinaturas</p>
        <p>Link válido até {formatSignatureDateTime(invite.expiresAt)}</p>
        <p className="signature-editor-hint">{invite.document.pageCount} página(s) · Role para ler o documento completo.</p>
        <SignatureDocumentPreview
          key={invite.document.sourceDocumentHash}
          pageCount={invite.document.pageCount}
          loadPage={loadPage}
          revision={invite.document.progress.signed}
          renderPage={({ imageUrl, pageNumber, onImageError }) => <div className="signature-public-preview">
            <img src={imageUrl} alt={`Página ${pageNumber} do documento`} onError={onImageError} />
            {invite.signer.status !== 'ASSINADO' ? invite.fields.filter(field => field.pageNumber === pageNumber).map((field, index) => <div className="signature-public-field" key={index} style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%` }}>Seu campo</div>) : null}
          </div>}
        />
        <div className="signature-public-actions">
          {message ? <p className={messageKind === 'success' ? 'signature-inline-success' : 'signature-inline-warning'} role={messageKind === 'success' ? 'status' : 'alert'}>{message}</p> : null}
          {invite.document.status === 'FINALIZANDO' ? <p>Finalizando o PDF assinado...</p> : null}
          {invite.downloadAvailable ? <Button onClick={download}>Baixar PDF assinado</Button> : null}
          {invite.signer.status !== 'ASSINADO' ? <Button onClick={() => { setDialogError(''); setDialogOpen(true); }}>Assinar documento</Button> : null}
        </div>
      </section>
      <SignatureDialog
        open={dialogOpen}
        title="Assinar documento"
        initialSignerName={invite.signer.name}
        allowCachedSignerName={false}
        maxUploadMb={10}
        isSubmitting={submitting}
        submissionError={dialogError}
        confirmDisabled={!privacyAccepted}
        notice={<PrivacyNotice variant="signatureAvulsa" checked={privacyAccepted} onCheckedChange={setPrivacyAccepted} disabled={submitting} />}
        onCancel={() => { setDialogOpen(false); setDialogError(''); }}
        onConfirm={sign}
      />
    </main>
  );
}
