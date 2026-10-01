import { useEffect, useState, type FormEvent } from 'react';

import type { QualityNature, QualityNaturePayload } from '../../api/qualidade';
import { Modal } from '../../components/ui/Modal';
import { Button, Field, Input } from '../../components/ui/ds';

interface Props {
  open: boolean;
  nature: QualityNature | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: QualityNaturePayload) => void;
}

export function QualityNatureFormModal({ open, nature, saving, onClose, onSubmit }: Props) {
  const [name, setName] = useState(nature?.name || '');
  const [submitted, setSubmitted] = useState(false);
  const nameError = submitted && !name.trim() ? 'Informe o nome da Natureza.' : '';

  useEffect(() => {
    if (!open) return;
    setName(nature?.name || '');
    setSubmitted(false);
  }, [nature, open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!name.trim()) return;
    onSubmit({ name: name.trim() });
  }

  return (
    <Modal open={open} onClose={onClose} appearance="design-system" size="sm" title={nature ? 'Editar Natureza' : 'Nova Natureza'} closeLabel="Fechar Natureza">
      <form className="quality-nature-form-v2" onSubmit={handleSubmit} noValidate>
        <Field id="quality-nature-name" label="Nome" required errorText={nameError || undefined}>
          <Input
            type="text"
            value={name}
            disabled={saving}
            onChange={event => setName(event.target.value)}
          />
        </Field>

        <div className="quality-nature-form-v2__actions">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" type="submit" loading={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  );
}
