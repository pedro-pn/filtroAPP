import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { SignatureSigner } from '../../../api/assinaturas';
import { Button } from '../../../components/ui/Button';
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
  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="signature-publish-title" panelClassName="modal-card signature-publish-dialog">
      <form className="signature-publish-form" onSubmit={form.handleSubmit(values => onPublish(values.validity === 'custom'
        ? { expiresAt: new Date(values.expiresAt || '').toISOString() }
        : { expiresInDays: Number(values.validity) }))}>
        <h2 id="signature-publish-title">Publicar para assinatura</h2>
        <p>{signers.length} assinante(s) receberão um convite individual.</p>
        <ul className="signature-publish-signers">{signers.map(signer => <li key={signer.id}>{signer.name} — {signer.email || 'link manual'}</li>)}</ul>
        <div className={`field-group ${form.formState.errors.validity ? 'field-invalid' : ''}`}>
          <label htmlFor="signature-expiry">Validade dos links</label>
          <select id="signature-expiry" aria-invalid={Boolean(form.formState.errors.validity)} {...form.register('validity')}>
            <option value="7">7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="custom">Data específica</option>
          </select>
          {form.formState.errors.validity ? <div className="field-error">{form.formState.errors.validity.message}</div> : null}
        </div>
        {validity === 'custom' ? <div className={`field-group ${form.formState.errors.expiresAt ? 'field-invalid' : ''}`}>
          <label htmlFor="signature-expiry-date">Data e hora de validade</label>
          <input id="signature-expiry-date" type="datetime-local" aria-invalid={Boolean(form.formState.errors.expiresAt)} {...form.register('expiresAt')} />
          {form.formState.errors.expiresAt ? <div className="field-error">{form.formState.errors.expiresAt.message}</div> : null}
        </div> : null}
        {issues.length ? <div className="signature-publish-issues"><strong>Corrija antes de publicar:</strong><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div> : null}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button type="submit" disabled={pending}>{pending ? 'Publicando...' : 'Publicar'}</Button>
        </div>
      </form>
    </Modal>
  );
}
