import { useEffect, useState } from 'react';

import { ApiClientError } from '../../api/client';
import { confirmPublicSignature, publicSignaturePage, publicSignaturePdf } from '../../api/assinaturas';
import { PrivacyNotice } from '../../components/privacy/PrivacyNotice';
import { SignatureDialog } from '../../components/reports/SignatureDialog';
import { Button } from '../../components/ui/Button';
import { SIGNATURE_AVULSA_NOTICE_VERSION } from '../../constants/privacy';
import { usePublicSignatureInvite } from '../../hooks/useAssinaturas';
import { captureInviteFromFragment } from './utils/coordinates';
import { formatSignatureDateTime } from './utils/datetime';

export function AssinaturasPublicSignPage() {
  const [token] = useState(() => captureInviteFromFragment(window.location, window.history));
  const [pageNumber, setPageNumber] = useState(1);
  const [imageUrl, setImageUrl] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [message, setMessage] = useState('');
  const inviteQuery = usePublicSignatureInvite(token, polling);

  useEffect(() => {
    if (!token || !inviteQuery.data || pageNumber > inviteQuery.data.document.pageCount) return;
    let disposed = false;
    let currentUrl = '';
    publicSignaturePage(token, pageNumber).then(blob => {
      if (disposed) return;
      currentUrl = URL.createObjectURL(blob);
      setImageUrl(currentUrl);
    }).catch(() => setImageUrl(''));
    return () => { disposed = true; if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [inviteQuery.data, pageNumber, token]);

  useEffect(() => {
    const status = inviteQuery.data?.document.status;
    if (status === 'FINALIZANDO') setPolling(true);
    if (status === 'CONCLUIDO') setPolling(false);
  }, [inviteQuery.data?.document.status]);

  async function sign(payload: { signerName: string; signatureImageDataUrl: string }) {
    setSubmitting(true);
    setMessage('');
    try {
      const result = await confirmPublicSignature(token, {
        ...payload,
        privacyNoticeAccepted: privacyAccepted,
        privacyNoticeVersion: SIGNATURE_AVULSA_NOTICE_VERSION
      });
      setDialogOpen(false);
      setMessage(result.documentStatus === 'FINALIZANDO' ? 'Assinatura recebida. Estamos finalizando o PDF.' : 'Assinatura registrada com sucesso.');
      setPolling(result.documentStatus === 'FINALIZANDO');
      await inviteQuery.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível registrar a assinatura.');
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
        <div className="signature-public-preview">
          {imageUrl ? <img src={imageUrl} alt={`Página ${pageNumber}`} /> : <span>Carregando página...</span>}
          {invite.fields.filter(field => field.pageNumber === pageNumber).map((field, index) => <div className="signature-public-field" key={index} style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%` }}>Seu campo</div>)}
        </div>
        <div className="signature-public-navigation"><Button variant="secondary" disabled={pageNumber <= 1} onClick={() => setPageNumber(value => value - 1)}>Anterior</Button><span>{pageNumber}/{invite.document.pageCount}</span><Button variant="secondary" disabled={pageNumber >= invite.document.pageCount} onClick={() => setPageNumber(value => value + 1)}>Próxima</Button></div>
        {message ? <p className="signature-inline-warning">{message}</p> : null}
        {invite.document.status === 'FINALIZANDO' ? <p>Finalizando o PDF assinado...</p> : null}
        {invite.downloadAvailable ? <Button onClick={download}>Baixar PDF assinado</Button> : null}
        {invite.signer.status !== 'ASSINADO' ? <Button onClick={() => setDialogOpen(true)}>Assinar documento</Button> : null}
      </section>
      <SignatureDialog
        open={dialogOpen}
        title="Assinar documento"
        initialSignerName={invite.signer.name}
        allowCachedSignerName={false}
        isSubmitting={submitting}
        confirmDisabled={!privacyAccepted}
        notice={<PrivacyNotice variant="signatureAvulsa" checked={privacyAccepted} onCheckedChange={setPrivacyAccepted} disabled={submitting} />}
        onCancel={() => setDialogOpen(false)}
        onConfirm={sign}
      />
    </main>
  );
}
