import { useState, type FormEvent } from 'react';

import type { EquipmentTechnicalStandard, MeasurementDimension, TechnicalFieldDefinition, TechnicalStandardPayload } from '../../api/equipamentos';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { useToast } from '../../components/ui/ToastContext';
import { Button, EmptyState } from '../../components/ui/ds';
import { useEquipamentoMutations } from '../../hooks/useEquipamentos';
import { TechnicalSchemaBuilder } from './TechnicalSchemaBuilder';

interface Props {
  standards: EquipmentTechnicalStandard[];
  unitsCatalog: MeasurementDimension[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}

function StandardForm({ standard, unitsCatalog, saving, onClose, onSubmit }: {
  standard: EquipmentTechnicalStandard | null;
  unitsCatalog: MeasurementDimension[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: TechnicalStandardPayload) => void;
}) {
  const [name, setName] = useState(standard?.name || '');
  const [fields, setFields] = useState<TechnicalFieldDefinition[]>(standard?.technicalSchema || []);
  const [error, setError] = useState('');
  const categories = standard?.categories || [];
  const equipmentCount = categories.reduce((total, category) => total + category._count.equipment, 0);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fields.some(field => !field.label.trim() || field.itemSchema?.some(item => !item.label.trim()))) {
      setError('Preencha o rótulo de todos os campos e subcampos.');
      return;
    }
    onSubmit({ name: name.trim(), technicalSchema: fields.map((field, order) => ({ ...field, order })) });
  }

  return (
    <Modal open onClose={() => { if (!saving) onClose(); }} title={standard ? 'Editar padrão de dados técnicos' : 'Novo padrão de dados técnicos'} appearance="design-system" size="lg" panelClassName="equip-config-category-modal" showCloseButton={!saving} closeOnBackdrop={false} closeOnEscape={false}>
      <form className="equip-form equip-config-form" onSubmit={submit}>
        <fieldset className="equip-standard-fieldset" disabled={saving}>
          <div className="field-group">
            <label htmlFor="standard-name">Nome do padrão *</label>
            <input id="standard-name" value={name} required maxLength={150} onChange={event => setName(event.target.value)} />
          </div>
          <p className="rel-meta">{categories.length ? `Este padrão é usado por ${categories.length} categoria(s) e ${equipmentCount} equipamento(s). Alterações nos campos serão aplicadas a todos eles.` : 'Selecione este padrão ao editar uma categoria para aplicar seus campos aos equipamentos.'} Os valores já preenchidos são preservados, inclusive ao remover campos.</p>
          <TechnicalSchemaBuilder value={fields} onChange={setFields} unitsCatalog={unitsCatalog} />
          {error && <p className="field-error" role="alert">{error}</p>}
        </fieldset>
        <div className="admin-form-actions equip-form-actions">
          <Button variant="secondary" size="sm" type="button" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" type="submit" loading={saving}>Salvar padrão</Button>
        </div>
      </form>
    </Modal>
  );
}

export function TechnicalStandardsManager({ standards, unitsCatalog, loading, failed, onRetry }: Props) {
  const mutations = useEquipamentoMutations();
  const showToast = useToast();
  const [form, setForm] = useState<{ standard: EquipmentTechnicalStandard | null } | null>(null);
  const [removing, setRemoving] = useState<EquipmentTechnicalStandard | null>(null);
  const saving = mutations.createStandard.isPending || mutations.updateStandard.isPending;
  const onError = (error: unknown) => showToast(error instanceof Error ? error.message : 'Não foi possível salvar o padrão.', 'error');

  function submit(payload: TechnicalStandardPayload) {
    const options = {
      onSuccess: () => { showToast('Padrão salvo. Os campos das categorias vinculadas foram atualizados.', 'success'); setForm(null); },
      onError
    };
    if (form?.standard) mutations.updateStandard.mutate({ id: form.standard.id, payload }, options);
    else mutations.createStandard.mutate(payload, options);
  }

  return (
    <section className="page-card equip-category-manager equip-technical-standards">
      <div className="admin-toolbar">
        <div className="sec">Padrões de dados técnicos</div>
        <Button variant="primary" size="sm" type="button" onClick={() => setForm({ standard: null })}>Novo padrão</Button>
      </div>
      <p className="rel-meta">Compartilhe campos entre categorias. As alterações no padrão atualizam todos os equipamentos vinculados.</p>
      {loading && <p className="rel-meta" role="status">Carregando padrões…</p>}
      {failed && <div role="alert"><p className="field-error">Não foi possível carregar os padrões.</p><Button variant="secondary" size="sm" onClick={onRetry}>Tentar novamente</Button></div>}
      {!loading && !failed && !standards.length && <EmptyState title="Nenhum padrão cadastrado" description="Crie um padrão para reutilizar os campos técnicos dos equipamentos." variant="create" action={{ label: 'Novo padrão', onClick: () => setForm({ standard: null }) }} />}
      <div className="equip-technical-standards__list">
        {standards.map(standard => {
          const fieldCount = standard.technicalSchema.length;
          const equipmentCount = standard.categories.reduce((total, category) => total + category._count.equipment, 0);
          const categoryNames = standard.categories.map(category => `${category.name}${category.isActive ? '' : ' (inativa)'}`).join(', ');
          return (
            <article className="equip-technical-standards__item" key={standard.id}>
              <div className="equip-technical-standards__summary">
                <strong title={standard.name}>{standard.name}</strong>
                <span className="rel-meta">{fieldCount} {fieldCount === 1 ? 'campo' : 'campos'} · {equipmentCount} {equipmentCount === 1 ? 'equipamento' : 'equipamentos'}</span>
              </div>
              <p className="rel-meta equip-technical-standards__categories" title={categoryNames || undefined}>
                <span className="fv-sr-only">Categorias vinculadas: </span>
                {categoryNames || 'Sem categorias vinculadas'}
              </p>
              <div className="equip-category-manager__actions equip-technical-standards__actions">
                <Button variant="secondary" size="sm" type="button" aria-label={`Editar padrão ${standard.name}`} onClick={() => setForm({ standard })}>Editar</Button>
                <RemoveIconButton type="button" label={`Remover padrão ${standard.name}`} disabled={mutations.removeStandard.isPending} onClick={() => setRemoving(standard)} />
              </div>
            </article>
          );
        })}
      </div>
      {form && <StandardForm standard={form.standard} unitsCatalog={unitsCatalog} saving={saving} onClose={() => setForm(null)} onSubmit={submit} />}
      <ConfirmDialog open={Boolean(removing)} title="Remover padrão de dados técnicos" description={removing?.categories.length
        ? `Este padrão é usado por ${removing.categories.length} categoria(s). Ele será removido da lista de padrões, mas as categorias manterão seus campos e os equipamentos manterão os dados já preenchidos.`
        : 'O padrão será removido da lista de padrões de dados técnicos.'} highlight={removing?.name} appearance="design-system" confirmLabel={mutations.removeStandard.isPending ? 'Removendo…' : 'Remover'} confirmDisabled={mutations.removeStandard.isPending} onCancel={() => { if (!mutations.removeStandard.isPending) setRemoving(null); }} onConfirm={() => {
        if (removing) mutations.removeStandard.mutate(removing.id, {
          onSuccess: () => { showToast('Padrão excluído.', 'success'); setRemoving(null); },
          onError
        });
      }} />
    </section>
  );
}
