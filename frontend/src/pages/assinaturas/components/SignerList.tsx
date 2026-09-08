import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { SignatureSigner } from '../../../api/assinaturas';
import { Button } from '../../../components/ui/Button';

const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do assinante.'),
  email: z.string().trim().email('Informe um e-mail válido.').or(z.literal(''))
});
type Values = z.infer<typeof schema>;

export function SignerList({
  signers,
  account,
  saving,
  onSave
}: {
  signers: SignatureSigner[];
  account?: { name?: string | null; email?: string | null } | null;
  saving: boolean;
  onSave: (signers: Array<{ id?: string; name: string; email: string | null; position: number }>) => Promise<void>;
}) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', email: '' } });

  async function add(values: Values) {
    await onSave([
      ...signers.map(({ id, name, email, position }) => ({ id, name, email, position })),
      { name: values.name, email: values.email || null, position: signers.length + 1 }
    ]);
    form.reset();
  }

  async function remove(id: string) {
    await onSave(signers.filter(item => item.id !== id).map((item, index) => ({
      id: item.id, name: item.name, email: item.email, position: index + 1
    })));
  }

  return (
    <aside className="signature-signer-panel">
      <section className="signature-signer-form-card">
        <h3>Assinante</h3>
        <form className="signature-signer-form" onSubmit={form.handleSubmit(add)}>
          <div className={`field-group ${form.formState.errors.name ? 'field-invalid' : ''}`}>
            <label htmlFor="signature-signer-name">Nome</label>
            <input id="signature-signer-name" aria-invalid={Boolean(form.formState.errors.name)} {...form.register('name')} />
            {form.formState.errors.name ? <div className="field-error">{form.formState.errors.name.message}</div> : null}
          </div>
          <div className={`field-group ${form.formState.errors.email ? 'field-invalid' : ''}`}>
            <label htmlFor="signature-signer-email">E-mail opcional</label>
            <input id="signature-signer-email" type="email" aria-invalid={Boolean(form.formState.errors.email)} {...form.register('email')} />
            {form.formState.errors.email ? <div className="field-error">{form.formState.errors.email.message}</div> : null}
          </div>
          <div className="signature-inline-actions">
            <Button variant="secondary" onClick={() => form.reset({ name: account?.name || '', email: account?.email || '' })}>Sou eu</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Adicionar'}</Button>
          </div>
        </form>
      </section>
      <section className="signature-added-signers">
        <div className="signature-added-signers-heading">
          <h4>Assinantes adicionados</h4>
          <span>{signers.length}</span>
        </div>
        <div className="signature-signer-list">
          {signers.map((signer, index) => (
            <div className={`signature-signer-item signature-signer-color-${index % 6}`} key={signer.id}>
              <div className="signature-signer-identity">
                <strong>{signer.name}</strong><span>{signer.email || 'Sem e-mail'}</span>
              </div>
              <button className="signature-signer-remove" type="button" aria-label={`Remover ${signer.name}`} onClick={() => remove(signer.id)}>×</button>
            </div>
          ))}
        </div>
        {!signers.length ? <p className="signature-empty-signers">Nenhum assinante adicionado.</p> : null}
      </section>
    </aside>
  );
}
