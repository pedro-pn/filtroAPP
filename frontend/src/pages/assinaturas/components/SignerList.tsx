import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { SignatureSigner } from '../../../api/assinaturas';
import { AppIcon } from '../../../components/icons/AppIcon';
import { Alert, Badge, Button, Card, Field, IconButton, Input } from '../../../components/ui/ds';
import { DS_ICONS } from '../../../components/ui/ds/icons';

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
  const [saveError, setSaveError] = useState('');
  const busy = saving || form.formState.isSubmitting;

  async function add(values: Values) {
    setSaveError('');
    try {
      await onSave([
        ...signers.map(({ id, name, email, position }) => ({ id, name, email, position })),
        { name: values.name, email: values.email || null, position: signers.length + 1 }
      ]);
      form.reset();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível adicionar o assinante.');
    }
  }

  async function remove(id: string) {
    setSaveError('');
    try {
      await onSave(signers.filter(item => item.id !== id).map((item, index) => ({
        id: item.id, name: item.name, email: item.email, position: index + 1
      })));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível remover o assinante.');
    }
  }

  return (
    <aside className="signature-signer-panel">
      <Card className="assinaturas-setup__signer-form" padding="md" title={<h2>Adicionar assinante</h2>}>
        <form className="signature-signer-form" onSubmit={form.handleSubmit(add)} aria-busy={busy || undefined}>
          <Field id="signature-signer-name" label="Nome" required errorText={form.formState.errors.name?.message} disabled={busy}>
            <Input size="sm" {...form.register('name')} />
          </Field>
          <Field id="signature-signer-email" label="E-mail" errorText={form.formState.errors.email?.message} helperText="Sem e-mail, você compartilha o link manualmente." disabled={busy}>
            <Input size="sm" type="email" {...form.register('email')} />
          </Field>
          <div className="assinaturas-setup__signer-actions">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => form.reset({ name: account?.name || '', email: account?.email || '' })}>Sou eu</Button>
            <Button variant="primary" size="sm" type="submit" disabled={busy} loading={busy} iconLeft={<AppIcon icon={DS_ICONS.plus} size="sm" />}>{busy ? 'Salvando...' : 'Adicionar'}</Button>
          </div>
        </form>
      </Card>
      {saveError ? <Alert tone="danger">{saveError}</Alert> : null}
      <section className="assinaturas-setup__added-signers" aria-label="Assinantes adicionados">
        <div className="assinaturas-setup__section-heading"><h2>Assinantes adicionados</h2><Badge tone="neutral">{signers.length}</Badge></div>
        <div className="signature-signer-list">
          {signers.map((signer, index) => (
            <div className={`signature-signer-item signature-signer-color-${index % 6}`} key={signer.id}>
              <div className="signature-signer-identity">
                <strong>{index + 1}. {signer.name}</strong><span>{signer.email || 'Sem e-mail · link manual'}</span>
              </div>
              <IconButton className="assinaturas-setup__remove-signer" variant="secondary" size="sm" icon={DS_ICONS.trash} label={`Remover ${signer.name}`} disabled={busy} onClick={() => void remove(signer.id)} />
            </div>
          ))}
        </div>
        {!signers.length ? <p className="signature-empty-signers">Nenhum assinante adicionado.</p> : null}
      </section>
    </aside>
  );
}
