import { useState } from 'react';

import { recoverSignatureInviteLink, type SignatureSigner } from '../../../api/assinaturas';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/ToastContext';
import { useAssinaturaMutations } from '../../../hooks/useAssinaturas';
import { formatSignatureDateTime } from '../utils/datetime';

const labels: Record<SignatureSigner['status'], string> = {
  PENDENTE: 'Pendente', VISUALIZADO: 'Visualizado', ASSINADO: 'Assinado', EXPIRADO: 'Expirado', REVOGADO: 'Revogado'
};

function emailLabel(signer: SignatureSigner) {
  if (!signer.email || signer.emailStatus === 'NAO_APLICAVEL') return 'Sem e-mail — copie o link';
  if (signer.emailStatus === 'ENVIADO') return 'E-mail enviado';
  if (signer.emailStatus === 'PENDENTE' || signer.emailStatus === 'EM_ENVIO') return 'Envio de e-mail pendente';
  if (signer.emailStatus === 'REVISAO_NECESSARIA') return 'Envio requer revisão — copie o link';
  return 'Falha no envio — copie o link';
}

export function SignerStatusList({ documentId, signers }: { documentId: string; signers: SignatureSigner[] }) {
  const showToast = useToast();
  const mutations = useAssinaturaMutations();
  const [revoking, setRevoking] = useState<SignatureSigner | null>(null);
  async function copyLink(signer: SignatureSigner) {
    try {
      const result = await recoverSignatureInviteLink(documentId, signer.id);
      await navigator.clipboard.writeText(result.url);
      showToast('Link copiado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível copiar o link.', 'error');
    }
  }
  async function renew(signer: SignatureSigner) {
    try {
      const result = await mutations.renewInvite.mutateAsync({ id: documentId, signerId: signer.id });
      await navigator.clipboard.writeText(result.url);
      showToast('Convite renovado e novo link copiado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível renovar o convite.', 'error');
    }
  }
  async function revoke() {
    if (!revoking) return;
    try {
      await mutations.revokeInvite.mutateAsync({ id: documentId, signerId: revoking.id });
      showToast('Convite revogado.', 'success');
      setRevoking(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível revogar o convite.', 'error');
    }
  }
  async function resend(signer: SignatureSigner) {
    try {
      await mutations.resendInvite.mutateAsync({ id: documentId, signerId: signer.id });
      showToast('Reenvio solicitado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível reenviar o convite.', 'error');
    }
  }
  return (
    <>
      <div className="signature-status-list">
        {signers.map(signer => (
          <div className="signature-status-row" key={signer.id}>
            <div className="signature-status-identity">
              <strong>{signer.name}</strong>
              <span>{signer.email || 'Sem e-mail'}</span>
            </div>
            <div className="signature-status-overview">
              <span className={`signature-status signature-status-${signer.status.toLowerCase()}`}>{labels[signer.status]}</span>
              <span className="signature-status-detail">{emailLabel(signer)}</span>
              <span className="signature-status-detail">{signer.signedAt
                ? `Assinado em ${formatSignatureDateTime(signer.signedAt)}`
                : signer.tokenExpiresAt
                  ? `Expira em ${formatSignatureDateTime(signer.tokenExpiresAt)}`
                  : 'Sem validade ativa'}</span>
            </div>
            <div className="signature-row-actions">
              {signer.status !== 'ASSINADO' && signer.status !== 'REVOGADO' ? <Button variant="mini" onClick={() => copyLink(signer)}>Copiar link</Button> : null}
              {['PENDENTE', 'VISUALIZADO', 'EXPIRADO'].includes(signer.status) ? <Button variant="mini" onClick={() => renew(signer)}>Renovar</Button> : null}
              {signer.email && ['PENDENTE', 'VISUALIZADO'].includes(signer.status) ? <Button variant="mini" onClick={() => resend(signer)}>Reenviar e-mail</Button> : null}
              {['PENDENTE', 'VISUALIZADO', 'EXPIRADO'].includes(signer.status) ? <Button variant="mini" title="Invalida somente o convite deste assinante." onClick={() => setRevoking(signer)}>Revogar convite</Button> : null}
            </div>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(revoking)}
        title="Revogar convite?"
        description="O link atual deixará de funcionar imediatamente. Assinaturas já registradas não são alteradas."
        highlight={revoking?.name}
        confirmLabel={mutations.revokeInvite.isPending ? 'Revogando...' : 'Revogar'}
        onConfirm={revoke}
        onCancel={() => setRevoking(null)}
      />
    </>
  );
}
