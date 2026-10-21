import { useEffect, useState, type FormEvent } from 'react';

import type { QualityNature, QualityNaturePayload } from '../../api/qualidade';
import { Modal } from '../../components/ui/Modal';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
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
  const [subnatures, setSubnatures] = useState<{ id?: string; name: string; inUse?: boolean }[]>(() => nature?.subnatures || []);
  const [submitted, setSubmitted] = useState(false);
  const nameError = submitted && !name.trim() ? 'Informe o nome da Natureza.' : '';
  const subnatureErrors = subnatures.map((item, index) => {
    if (!submitted) return '';
    if (!item.name.trim()) return 'Informe o nome da Subnatureza.';
    if (subnatures.some((other, otherIndex) => otherIndex !== index && other.name.trim().toLocaleLowerCase('pt-BR') === item.name.trim().toLocaleLowerCase('pt-BR'))) return 'Subnatureza repetida nesta Natureza.';
    return '';
  });

  useEffect(() => {
    if (!open) return;
    setName(nature?.name || '');
    setSubnatures(nature?.subnatures || []);
    setSubmitted(false);
  }, [nature, open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const names = subnatures.map(item => item.name.trim().toLocaleLowerCase('pt-BR'));
    if (!name.trim() || names.some(item => !item) || new Set(names).size !== names.length) return;
    onSubmit({ name: name.trim(), subnatures: subnatures.map(item => ({ id: item.id, name: item.name.trim() })) });
  }

  return (
    <Modal open={open} onClose={onClose} appearance="design-system" size="md" title={nature ? 'Editar Natureza' : 'Nova Natureza'} closeLabel="Fechar Natureza" panelClassName="quality-nature-modal-v2">
      <form className="quality-nature-form-v2" onSubmit={handleSubmit} noValidate>
        <Field id="quality-nature-name" label="Nome" required errorText={nameError || undefined}>
          <Input
            type="text"
            value={name}
            maxLength={180}
            disabled={saving}
            onChange={event => setName(event.target.value)}
          />
        </Field>

        <fieldset className="quality-subnatures-editor" disabled={saving}>
          <legend>Subnaturezas</legend>
          <p className="rel-meta">Cadastre os detalhes que poderão ser selecionados dentro desta Natureza.</p>
          {subnatures.map((item, index) => (
            <div className="quality-subnature-edit-row" key={item.id || `new-${index}`}>
              <Field id={`quality-subnature-name-${index}`} label={`Subnatureza ${index + 1}`} required errorText={subnatureErrors[index] || undefined}>
                <Input value={item.name} maxLength={180} disabled={saving} onChange={event => setSubnatures(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))} />
              </Field>
              <RemoveIconButton disabled={saving || item.inUse} label={item.inUse ? `Subnatureza ${index + 1} vinculada a registros` : `Remover Subnatureza ${index + 1}`} onClick={() => setSubnatures(current => current.filter((_, rowIndex) => rowIndex !== index))} />
            </div>
          ))}
          {!subnatures.length ? <p className="rel-meta">Nenhuma Subnatureza cadastrada.</p> : null}
          <Button variant="secondary" size="sm" disabled={saving || subnatures.length >= 300} onClick={() => setSubnatures(current => [...current, { name: '' }])}>Adicionar Subnatureza</Button>
        </fieldset>

        <div className="quality-nature-form-v2__actions">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" type="submit" loading={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  );
}
