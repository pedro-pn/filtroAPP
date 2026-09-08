import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ApiCredentialPublic } from '../../../../../shared/schemas/api-credentials.js';
import { rotationDefaults, makeActionConfirmationSchema } from '../../../../../shared/schemas/api-credential-lifecycle.js';
import { apiValidationError } from '../../../../../shared/schemas/api-validation-messages.js';
import { reduceApiCredential, revokeApiCredential, rotateApiCredential, type IssuedApiCredential, type ApiScopeDefinition } from '../../../api/apiCredentials';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Modal } from '../../ui/Modal';
import { ApiCredentialForm } from './ApiCredentialForm';
import { ApiCredentialReductionForm } from './ApiCredentialReductionForm';

type Confirmation = { reason: string; confirmation: string; overlapMinutes?: number };
export function ApiCredentialActions({ credential, scopes, onChanged, onIssued }: {
  credential: ApiCredentialPublic; scopes: ApiScopeDefinition[]; onChanged: () => Promise<unknown>; onIssued: (issued: IssuedApiCredential) => void;
}) {
  const [action, setAction] = useState<'reduce' | 'rotate' | 'revoke' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rotationInput, setRotationInput] = useState(() => rotationDefaults(credential));
  const [actionKey, setActionKey] = useState('');
  const form = useForm<Confirmation>({ resolver: zodResolver(makeActionConfirmationSchema(z, action === 'rotate' ? 'rotate' : 'revoke'), { error: apiValidationError }) as Resolver<Confirmation>, defaultValues: { reason: '', confirmation: '' } });
  const { errors } = form.formState;
  const terminal = ['EXPIRED', 'REVOKED'].includes(credential.effectiveStatus);
  function open(next: 'reduce' | 'rotate' | 'revoke') {
    setError(''); setAction(next); setActionKey(crypto.randomUUID());
    form.reset({ reason: '', confirmation: '', ...(next === 'rotate' ? { overlapMinutes: 0 } : {}) });
    if (next === 'rotate') setRotationInput(rotationDefaults(credential));
  }
  async function complete() { setAction(null); await onChanged(); }
  const confirmationFields = <section className="page-card api-form-section">
    <div className={'field-group ' + (errors.reason ? 'field-invalid' : '')}><label htmlFor="action-reason">Justificativa *</label><textarea id="action-reason" {...form.register('reason')} aria-invalid={Boolean(errors.reason)} aria-describedby="action-reason-error" /><span id="action-reason-error" className="field-error">{errors.reason?.message}</span></div>
    {action === 'rotate' ? <div className={'field-group ' + (errors.overlapMinutes ? 'field-invalid' : '')}><label htmlFor="rotate-overlap">Sobreposição controlada</label><select id="rotate-overlap" {...form.register('overlapMinutes', { valueAsNumber: true })} aria-invalid={Boolean(errors.overlapMinutes)}><option value={0}>Revogar anterior agora</option><option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={60}>60 minutos</option></select><span className="field-error">{errors.overlapMinutes?.message}</span></div> : null}
    <div className={'field-group ' + (errors.confirmation ? 'field-invalid' : '')}><label htmlFor="action-confirmation">Digite {action === 'rotate' ? 'ROTACIONAR' : 'REVOGAR'} para confirmar</label><input id="action-confirmation" {...form.register('confirmation')} autoComplete="off" aria-invalid={Boolean(errors.confirmation)} aria-describedby="action-confirmation-error" /><span id="action-confirmation-error" className="field-error">{errors.confirmation?.message}</span></div>
  </section>;
  return <section className="page-card api-credential-actions">
    <h3>Ações de ciclo de vida</h3><p>Ampliações exigem rotação; reduções têm efeito imediato.</p>
    <div className="api-review-actions"><Button variant="secondary" disabled={terminal} onClick={() => open('reduce')}>Reduzir acesso</Button><Button variant="secondary" disabled={terminal || Boolean(credential.replacementId)} onClick={() => open('rotate')}>Rotacionar</Button><Button variant="danger" disabled={terminal} onClick={() => open('revoke')}>Revogar</Button></div>
    <Modal open={action === 'reduce'} onClose={() => { if (!busy) setAction(null); }} closeOnEscape={!busy} ariaLabelledBy="reduce-token-title" panelClassName="modal-card api-policy-modal">
      <h2 id="reduce-token-title">Reduzir acesso — {credential.name}</h2>
      {action === 'reduce' ? <ApiCredentialReductionForm key={credential.id + ':' + credential.version} credential={credential} scopes={scopes} onCancel={() => setAction(null)} onSubmit={async payload => { setBusy(true); try { await reduceApiCredential(credential.id, payload); await complete(); } finally { setBusy(false); } }} /> : null}
    </Modal>
    <Modal open={action === 'rotate'} onClose={() => { if (!busy) setAction(null); }} closeOnEscape={!busy} ariaLabelledBy="rotate-token-title" panelClassName="modal-card api-policy-modal">
      <h2 id="rotate-token-title">Rotacionar credencial</h2>
      <p>Configure a substituta. A credencial anterior não ganhará as permissões adicionadas.</p>
      {action === 'rotate' ? <ApiCredentialForm key={actionKey} scopes={scopes} title="Política da substituta" initialValues={rotationInput} disabled={busy} onBeforeReview={() => form.trigger(undefined, { shouldFocus: true })} onSubmit={async replacement => {
        const values = makeActionConfirmationSchema(z, 'rotate').parse(form.getValues(), { error: apiValidationError }) as Confirmation;
        setBusy(true);
        try { const issued = await rotateApiCredential(credential.id, { replacement, reason: values.reason, expectedVersion: credential.version, revokePreviousAt: new Date(Date.now() + (values.overlapMinutes || 0) * 60000).toISOString() }, actionKey); onIssued(issued); await complete(); }
        finally { setBusy(false); }
      }}>{confirmationFields}</ApiCredentialForm> : null}
      <div className="api-modal-footer"><Button variant="secondary" disabled={busy} onClick={() => setAction(null)}>Cancelar</Button></div>
    </Modal>
    <ConfirmDialog open={action === 'revoke'} title="Revogar credencial" description="A próxima chamada será recusada. Esta ação é terminal." highlight={credential.name} confirmLabel="Revogar agora" confirmDisabled={busy} onCancel={() => { if (!busy) setAction(null); }} onConfirm={() => void form.handleSubmit(async values => {
      setBusy(true); setError('');
      try { await revokeApiCredential(credential.id, { expectedVersion: credential.version, reason: values.reason }, actionKey); await complete(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível revogar.'); }
      finally { setBusy(false); }
    })()}>{confirmationFields}{error ? <div className="inline-error" role="alert">{error}</div> : null}</ConfirmDialog>
  </section>;
}
