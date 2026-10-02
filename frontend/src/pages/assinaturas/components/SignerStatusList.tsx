import { useRef, useState } from 'react';

import { recoverSignatureInviteLink, type SignatureSigner } from '../../../api/assinaturas';
import { Badge, Button, Card, EmptyState, StatusPill } from '../../../components/ui/ds';
import type { SemanticTone } from '../../../components/ui/ds';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/ToastContext';
import { useAssinaturaMutations } from '../../../hooks/useAssinaturas';
import { formatSignatureDateTime } from '../utils/datetime';
import '../AssinaturasTracking.ds.css';

const labels: Record<SignatureSigner['status'], string> = {
  PENDENTE: 'Pendente', VISUALIZADO: 'Visualizado', ASSINADO: 'Assinado', EXPIRADO: 'Expirado', REVOGADO: 'Revogado'
};

function emailDelivery(signer: SignatureSigner): { label: string; tone: SemanticTone } {
  if (!signer.email || signer.emailStatus === 'NAO_APLICAVEL') return { label: 'Link manual', tone: 'neutral' };
  if (signer.emailStatus === 'ENVIADO') return { label: 'E-mail enviado', tone: 'info' };
  if (signer.emailStatus === 'PENDENTE' || signer.emailStatus === 'EM_ENVIO') return { label: 'Envio pendente', tone: 'warning' };
  if (signer.emailStatus === 'REVISAO_NECESSARIA') return { label: 'Envio requer revisão', tone: 'warning' };
  return { label: 'Falha no envio', tone: 'danger' };
}

type InviteAction = 'copy' | 'renew' | 'resend' | 'revoke';

export function SignerStatusList({ documentId, signers }: { documentId: string; signers: SignatureSigner[] }) {
  const showToast = useToast();
  const mutations = useAssinaturaMutations();
  const [revoking, setRevoking] = useState<SignatureSigner | null>(null);
  const [pending, setPending] = useState<{ signerId: string; action: InviteAction } | null>(null);
  const signerHeadings = useRef(new Map<string, HTMLHeadingElement>());
  const busy = Boolean(pending);
  async function copyLink(signer: SignatureSigner) {
    if (busy) return;
    setPending({ signerId: signer.id, action: 'copy' });
    try {
      const result = await recoverSignatureInviteLink(documentId, signer.id);
      await navigator.clipboard.writeText(result.url);
      showToast('Link copiado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível copiar o link.', 'error');
    } finally {
      setPending(null);
    }
  }
  async function renew(signer: SignatureSigner) {
    if (busy) return;
    setPending({ signerId: signer.id, action: 'renew' });
    try {
      const result = await mutations.renewInvite.mutateAsync({ id: documentId, signerId: signer.id });
      await navigator.clipboard.writeText(result.url);
      showToast('Convite renovado e novo link copiado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível renovar o convite.', 'error');
    } finally {
      setPending(null);
    }
  }
  async function revoke() {
    if (!revoking || busy) return;
    setPending({ signerId: revoking.id, action: 'revoke' });
    try {
      await mutations.revokeInvite.mutateAsync({ id: documentId, signerId: revoking.id });
      showToast('Convite revogado.', 'success');
      setRevoking(null);
      // The triggering action disappears after revocation; keep focus on this signer.
      requestAnimationFrame(() => signerHeadings.current.get(revoking.id)?.focus({ preventScroll: true }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível revogar o convite.', 'error');
    } finally {
      setPending(null);
    }
  }
  async function resend(signer: SignatureSigner) {
    if (busy) return;
    setPending({ signerId: signer.id, action: 'resend' });
    try {
      await mutations.resendInvite.mutateAsync({ id: documentId, signerId: signer.id });
      showToast('Reenvio solicitado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível reenviar o convite.', 'error');
    } finally {
      setPending(null);
    }
  }
  return (
    <section className="fv-ds assinaturas-tracking" aria-label="Assinantes e convites">
      <div className="assinaturas-tracking__heading"><h2>Assinantes</h2><Badge tone="neutral">{signers.length}</Badge></div>
      <div className="signature-status-list">
        {signers.map(signer => {
          const delivery = emailDelivery(signer);
          const loading = (action: InviteAction) => pending?.signerId === signer.id && pending.action === action;
          return <Card className="assinaturas-signer-card" padding="md" key={signer.id} aria-label={`Assinante ${signer.name}`}>
            <div className="assinaturas-signer-card__heading">
              <h3 tabIndex={-1} ref={node => { if (node) signerHeadings.current.set(signer.id, node); else signerHeadings.current.delete(signer.id); }}>{signer.name}</h3>
              <StatusPill status={labels[signer.status]} toneMap={{ visualizado: 'info', revogado: 'neutral' }} />
            </div>
            <p className="assinaturas-signer-card__email">{signer.email || 'Sem e-mail cadastrado'}</p>
            <div className="signature-status-overview">
              <Badge tone={delivery.tone}>{delivery.label}</Badge>
              <span className="signature-status-detail">{signer.signedAt
                ? `Assinado em ${formatSignatureDateTime(signer.signedAt)}`
                : signer.tokenExpiresAt
                  ? `${signer.status === 'REVOGADO' ? 'Validade original:' : signer.status === 'EXPIRADO' ? 'Expirou em' : 'Expira em'} ${formatSignatureDateTime(signer.tokenExpiresAt)}`
                  : 'Sem validade ativa'}</span>
            </div>
            <div className="signature-row-actions">
              {signer.status !== 'ASSINADO' && signer.status !== 'REVOGADO' ? <Button variant="secondary" size="sm" disabled={busy} loading={loading('copy')} aria-label={`Copiar link de ${signer.name}`} title="Copiar link" onClick={() => copyLink(signer)}>Copiar<span className="assinaturas-tracking__wide-label"> link</span></Button> : null}
              {['PENDENTE', 'VISUALIZADO', 'EXPIRADO'].includes(signer.status) ? <Button variant="secondary" size="sm" disabled={busy} loading={loading('renew')} aria-label={`Renovar convite de ${signer.name}`} onClick={() => renew(signer)}>Renovar</Button> : null}
              {signer.email && ['PENDENTE', 'VISUALIZADO'].includes(signer.status) ? <Button variant="secondary" size="sm" disabled={busy} loading={loading('resend')} aria-label={`Reenviar e-mail para ${signer.name}`} title="Reenviar e-mail" onClick={() => resend(signer)}>Reenviar<span className="assinaturas-tracking__wide-label"> e-mail</span></Button> : null}
              {['PENDENTE', 'VISUALIZADO', 'EXPIRADO'].includes(signer.status) ? <Button variant="secondary" size="sm" disabled={busy} loading={loading('revoke')} aria-label={`Revogar convite de ${signer.name}`} title="Invalida somente o convite deste assinante." onClick={() => setRevoking(signer)}>Revogar<span className="assinaturas-tracking__wide-label"> convite</span></Button> : null}
            </div>
          </Card>;
        })}
      </div>
      {!signers.length ? <EmptyState title="Nenhum assinante neste documento." description="Os convites aparecerão aqui quando houver assinantes cadastrados." /> : null}
      <ConfirmDialog
        appearance="design-system"
        confirmDisabled={busy}
        open={Boolean(revoking)}
        title="Revogar convite?"
        description="O link atual deixará de funcionar imediatamente. Assinaturas já registradas não são alteradas."
        highlight={revoking?.name}
        confirmLabel={mutations.revokeInvite.isPending ? 'Revogando...' : 'Revogar'}
        onConfirm={revoke}
        onCancel={() => { if (!busy) setRevoking(null); }}
      />
    </section>
  );
}
