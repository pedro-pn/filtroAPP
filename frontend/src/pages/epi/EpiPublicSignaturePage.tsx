import { useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { confirmEpiPublicSignature, epiPublicSignaturePdfUrl, getEpiPublicSignature } from '../../api/epi';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { PrivacyNotice } from '../../components/privacy/PrivacyNotice';
import { SignatureDialog } from '../../components/reports/SignatureDialog';
import { Alert, Button, Card, Skeleton, StatusPill, type SemanticTone } from '../../components/ui/ds';
import { useToast } from '../../components/ui/ToastContext';
import { SIGNATURE_EPI_NOTICE_VERSION } from '../../constants/privacy';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';
import '../RdoPublicPage.css';
import './EpiPublicSignaturePage.ds.css';

const statusText: Record<string, string> = {
  ACTIVE: 'Disponível para assinatura',
  SIGNED: 'Link de assinatura encerrado',
  EXPIRED: 'Link expirado',
  INVALID: 'Link inválido'
};

const statusTone: Record<string, SemanticTone> = {
  ACTIVE: 'info', SIGNED: 'success', EXPIRED: 'warning', INVALID: 'danger'
};

type EpiPublicSignatureConfirmPayload = Parameters<typeof confirmEpiPublicSignature>[1];

export function EpiPublicSignaturePage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const signatureQuery = useQuery({
    queryKey: ['epi-public-signature', token],
    queryFn: () => getEpiPublicSignature(token),
    enabled: !!token
  });

  const confirmMutation = useMutation({
    mutationFn: (payload: EpiPublicSignatureConfirmPayload) => confirmEpiPublicSignature(token, payload),
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

  function openSignatureDialog() {
    if (!privacyAccepted) {
      showToast('Confirme a ciência do aviso de privacidade antes de assinar.', 'error');
      return;
    }
    setSignatureOpen(true);
  }

  return (
    <main className="fv-ds rdo-public-shell epi-public-page" data-fv-ds>
      <header className="rdo-public-header">
        <BrandLogo className="rdo-public-logo" />
      </header>
      <Card className="rdo-public-card epi-public-card" padding="lg" title="Assinatura de EPI">
        {signatureQuery.isLoading ? <Skeleton variant="text" lines={5} label="Carregando ficha de EPI" /> : null}
        {signatureQuery.isError ? (
          <Alert tone="danger" title="Não foi possível carregar a ficha">
            {signatureQuery.error instanceof Error ? signatureQuery.error.message : 'Não foi possível carregar o link.'}
          </Alert>
        ) : null}
        {!signatureQuery.isLoading && !signatureQuery.isError ? (
          <>
            <StatusPill className="rdo-public-status" status={status} label={statusText[status] || status} tone={statusTone[status] || 'neutral'} />
            {payload?.collaborator ? (
              <dl className="rdo-public-details">
                <div><dt>Colaborador</dt><dd>{payload.collaborator.name}</dd></div>
                <div><dt>Cargo</dt><dd>{payload.collaborator.role || 'Não informado'}</dd></div>
                <div><dt>EPIs</dt><dd>{payload.records.length}</dd></div>
                <div><dt>Expira em</dt><dd>{formatDateOnlyPtBr(payload.expiresAt || '')}</dd></div>
              </dl>
            ) : (
              <Alert tone="warning">Não foi possível localizar uma solicitação ativa para este link.</Alert>
            )}

            {payload?.records?.length ? (
              <div className="epi-public-list">
                {payload.records.map(record => (
                  <Card className="epi-public-row" variant="flat" padding="sm" key={record.id}>
                    <strong>{record.epiName}</strong>
                    <small>C.A {record.ca} · Qtd. {record.quantity}</small>
                  </Card>
                ))}
              </div>
            ) : null}

            {payload?.collaborator || status === 'SIGNED' ? (
              <>
                {canSign ? (
                  <PrivacyNotice
                    variant="signatureEpi"
                    checked={privacyAccepted}
                    onCheckedChange={setPrivacyAccepted}
                    disabled={confirmMutation.isPending}
                  />
                ) : null}
                <div className="public-signature-actions">
                  {canSign ? (
                    <a className="fv-button fv-button--secondary fv-button--sm" href={epiPublicSignaturePdfUrl(token)} target="_blank" rel="noopener noreferrer">
                      Abrir PDF
                    </a>
                  ) : null}
                  {canSign ? (
                    <Button variant="primary" size="sm" onClick={openSignatureDialog} disabled={!privacyAccepted}>
                      Assinar
                    </Button>
                  ) : status === 'SIGNED' ? (
                    <a className="fv-button fv-button--primary fv-button--sm" href={epiPublicSignaturePdfUrl(token)} target="_blank" rel="noopener noreferrer">
                      Baixar PDF assinado
                    </a>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </Card>
      <SignatureDialog
        open={signatureOpen}
        title="Assinar EPIs"
        initialSignerName={payload?.collaborator?.name || ''}
        cacheIdentity={payload?.collaborator?.id || token}
        isSubmitting={confirmMutation.isPending}
        onCancel={() => setSignatureOpen(false)}
        onConfirm={form => confirmMutation.mutate({
          ...form,
          privacyNoticeAccepted: true,
          privacyNoticeVersion: SIGNATURE_EPI_NOTICE_VERSION
        })}
      />
    </main>
  );
}
