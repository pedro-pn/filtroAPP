import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { SignatureSigner } from '../../../api/assinaturas';
import { Alert, Button, Field, Input, Select } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';

const schema = z.object({
  validity: z.enum(['7', '15', '30', '60', 'custom']),
  expiresAt: z.string().optional()
}).superRefine((values, ctx) => {
  if (values.validity === 'custom' && (!values.expiresAt || Number.isNaN(new Date(values.expiresAt).getTime()))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Informe uma data de validade.' });
  }
});
type Values = z.infer<typeof schema>;

export function PublishDialog({ open, signers, pending, issues, onClose, onPublish }: {
  open: boolean;
  signers: SignatureSigner[];
  pending: boolean;
  issues: string[];
  onClose: () => void;
  onPublish: (expiry: { expiresInDays: number } | { expiresAt: string }) => Promise<void>;
}) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { validity: '15', expiresAt: '' } });
  const validity = form.watch('validity');
  const busy = pending || form.formState.isSubmitting;
  return (
    <Modal open={open} onClose={onClose} appearance="design-system" title="Publicar para assinatura" size="md"
      fullscreenOnMobile={false} backdropClassName="assinaturas-dialog-backdrop" panelClassName="assinaturas-publish-dialog"
      closeOnEscape={!busy} showCloseButton={!busy}
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button variant="primary" size="sm" type="submit" form="signature-publish-form" disabled={busy} loading={busy}>{busy ? 'Publicando...' : 'Publicar'}</Button>
      </>}
    >
      <form id="signature-publish-form" className="signature-publish-form" aria-busy={busy || undefined} onSubmit={form.handleSubmit(values => onPublish(values.validity === 'custom'
        ? { expiresAt: new Date(values.expiresAt || '').toISOString() }
        : { expiresInDays: Number(values.validity) }))}>
        <p>{signers.length} assinante(s) receberão um convite individual.</p>
        <ul className="assinaturas-publish-dialog__signers">{signers.map(signer => <li key={signer.id}><strong>{signer.name}</strong><span>{signer.email || 'Link manual'}</span></li>)}</ul>
        <Field id="signature-expiry" label="Validade dos links" optionalText={null} errorText={form.formState.errors.validity?.message} disabled={busy}>
          <Select size="sm" {...form.register('validity')}>
            <option value="7">7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="custom">Data específica</option>
          </Select>
        </Field>
        {validity === 'custom' ? <Field id="signature-expiry-date" label="Data e hora de validade" required errorText={form.formState.errors.expiresAt?.message} disabled={busy}>
          <Input size="sm" type="datetime-local" {...form.register('expiresAt')} />
        </Field> : null}
        {issues.length ? <Alert tone="danger" title="Corrija antes de publicar:"><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></Alert> : null}
      </form>
    </Modal>
  );
}
