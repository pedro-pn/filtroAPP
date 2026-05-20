import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { confirmEpiPublicSignature, epiPublicSignaturePdfUrl, getEpiPublicSignature } from '../../api/epi';
import { SignatureConsentDialog } from '../../components/reports/SignatureConsentDialog';
import { useToast } from '../../components/ui/Toast';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const logoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_VERDE.png`;

const statusText: Record<string, string> = {
  ACTIVE: 'Disponível para assinatura',
  SIGNED: 'Link de assinatura encerrado',
  EXPIRED: 'Link expirado',
  INVALID: 'Link inválido'
};

export function EpiPublicSignaturePage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [signatureOpen, setSignatureOpen] = useState(false);

  const signatureQuery = useQuery({
    queryKey: ['epi-public-signature', token],
    queryFn: () => getEpiPublicSignature(token),
    enabled: !!token
  });

  const confirmMutation = useMutation({
    mutationFn: (payload: { signerName: string; signatureImageDataUrl: string }) => confirmEpiPublicSignature(token, payload),
    onSuccess: () => {
      setSignatureOpen(false);
      showToast('Assinatura registrada.', 'success');
      queryClient.invalidateQueries({ queryKey: ['epi-public-signature', token] });
    },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível assinar.', 'error')
  });

  const payload = signatureQuery.data;
  const status = payload?.status || 'INVALID';
  const canSign = status === 'ACTIVE';

  return (
    <main className="survey-page-shell public-signature-page">
      <header className="survey-header">
        <img src={logoUrl} alt="Filtrovali" />
      </header>
      <section className="auth-card public-signature-card">
        <div className="section-title">Assinatura de EPI</div>
        {signatureQuery.isLoading ? <p className="placeholder-copy">Carregando ficha...</p> : null}
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
            {payload?.collaborator ? (
              <div className="det-section">
                <div className="det-row"><span className="det-label">Colaborador</span><span className="det-val">{payload.collaborator.name}</span></div>
                <div className="det-row"><span className="det-label">Cargo</span><span className="det-val">{payload.collaborator.role || '-'}</span></div>
                <div className="det-row"><span className="det-label">EPIs</span><span className="det-val">{payload.records.length}</span></div>
                <div className="det-row"><span className="det-label">Expira em</span><span className="det-val">{formatDateOnlyPtBr(payload.expiresAt || '')}</span></div>
              </div>
            ) : (
              <p className="placeholder-copy">Não foi possível localizar uma solicitação ativa para este link.</p>
            )}

            {payload?.records?.length ? (
              <div className="epi-public-list">
                {payload.records.map(record => (
                  <div className="epi-public-row" key={record.id}>
                    <strong>{record.epiName}</strong>
                    <small>C.A {record.ca} · Qtd. {record.quantity}</small>
                  </div>
                ))}
              </div>
            ) : null}

            {payload?.collaborator || status === 'SIGNED' ? (
              <div className="public-signature-actions">
                {canSign ? (
                  <a className="secondary-button" href={epiPublicSignaturePdfUrl(token)} target="_blank" rel="noopener noreferrer">
                    Abrir PDF
                  </a>
                ) : null}
                {canSign ? (
                  <button className="primary-button" type="button" onClick={() => setSignatureOpen(true)}>
                    Assinar
                  </button>
                ) : status === 'SIGNED' ? (
                  <a className="primary-button" href={epiPublicSignaturePdfUrl(token)} target="_blank" rel="noopener noreferrer">
                    Baixar PDF assinado
                  </a>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>
      <SignatureConsentDialog
        open={signatureOpen}
        title="Assinar EPIs"
        initialSignerName={payload?.collaborator?.name || ''}
        cacheIdentity={payload?.collaborator?.id || token}
        isSubmitting={confirmMutation.isPending}
        onCancel={() => setSignatureOpen(false)}
        onConfirm={form => confirmMutation.mutate(form)}
      />
    </main>
  );
}
