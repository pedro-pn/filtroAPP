import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

import { saveCargoHhAdjustment, type CargoCostProfile } from '../../api/acompanhamentoCusto';
import { todayDateOnly } from '../../utils/dateOnly';
import { useToast } from '../ui/ToastContext';
import { Button, Field, Input } from '../ui/ds';

export function CargoHhAdjustmentPanel({ cargos, onSaved }: {
  cargos: CargoCostProfile[];
  onSaved: () => Promise<unknown>;
}) {
  const showToast = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [percent, setPercent] = useState('10');
  const [effectiveDate, setEffectiveDate] = useState(todayDateOnly());
  const selected = cargos.filter(cargo => cargo.profileId && selectedIds.includes(cargo.jobRoleId));
  const mutation = useMutation({
    mutationFn: () => saveCargoHhAdjustment(selected.map(cargo => cargo.jobRoleId), Number(percent) / 100, effectiveDate),
    onSuccess: async () => {
      showToast('Reajuste do HH salvo para os cargos selecionados.');
      setSelectedIds([]);
      await onSaved();
    }
  });
  const error = mutation.error
    ? (isAxiosError(mutation.error) && typeof mutation.error.response?.data?.error === 'string'
      ? mutation.error.response.data.error : 'Não foi possível salvar o reajuste do HH.')
    : null;

  return (
    <section className="acp-cost-ds__subsection" aria-label="Reajuste de HH em vários cargos">
      <h3>Reajustar HH de vários cargos</h3>
      <p className="acp-cost-ds__copy">
        Selecione os cargos que receberão o reajuste e deixe os cargos de confiança desmarcados.
        O percentual substitui o reajuste anterior de cada cargo, preservando o salário e o modelo
        vigentes na data escolhida. Configure primeiro os cargos sem custo.
      </p>
      <form className="acp-cost-ds__hh-bulk" onSubmit={event => {
        event.preventDefault();
        if (selected.length) mutation.mutate();
      }}>
        <fieldset className="acp-cost-ds__hh-roles" disabled={mutation.isPending}>
          <legend>Cargos que receberão o reajuste</legend>
          {cargos.map(cargo => (
            <label className="acp-cost-ds__checkbox" key={cargo.jobRoleId}>
              <input type="checkbox" disabled={!cargo.profileId} checked={selectedIds.includes(cargo.jobRoleId)}
                onChange={event => setSelectedIds(ids => event.target.checked
                  ? [...ids, cargo.jobRoleId] : ids.filter(id => id !== cargo.jobRoleId))} />
              <span>{cargo.name}{cargo.profileId ? '' : ' — sem custo'}</span>
            </label>
          ))}
        </fieldset>
        <div className="acp-cost-ds__fields">
          <Field label="Reajuste do HH dos cargos selecionados (%)" required>
            <Input type="number" min="0" max="100" step="any" required disabled={mutation.isPending}
              value={percent} onChange={event => setPercent(event.target.value)} />
          </Field>
          <Field label="Vigência do reajuste dos cargos selecionados" required>
            <Input type="date" required disabled={mutation.isPending} value={effectiveDate}
              onChange={event => setEffectiveDate(event.target.value)} />
          </Field>
        </div>
        <p className="acp-cost-ds__copy" aria-live="polite">
          {selected.length} cargo(s) selecionado(s){selected.length ? `: ${selected.map(cargo => cargo.name).join(', ')}` : ''}.
        </p>
        {error ? <p className="acp-cost-ds__error" role="alert">{error}</p> : null}
        <div className="acp-cost-ds__actions">
          <Button type="submit" variant="primary" size="sm" loading={mutation.isPending} disabled={!selected.length || !effectiveDate}>
            Aplicar reajuste aos cargos selecionados
          </Button>
        </div>
      </form>
    </section>
  );
}
