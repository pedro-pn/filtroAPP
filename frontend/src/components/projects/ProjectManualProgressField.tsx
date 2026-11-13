import { Field, Input, Switch } from '../ui/ds';
import './ProjectManualProgressField.css';

export function ProjectManualProgressField({ id, value, forced, disabled, onValueChange, onForcedChange }: {
  id: string;
  value: string;
  forced: boolean;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  onForcedChange: (forced: boolean) => void;
}) {
  return <Field id={id} label="Avanço manual" optionalText="" disabled={disabled}
    helperText={forced
      ? 'Após salvar, este percentual será usado mesmo com escopo e relatórios cadastrados.'
      : 'Sem forçar, o avanço vem dos relatórios quando há metas; sem metas, usa o percentual manual.'}>
    <div className="acp-manual-progress-input">
      <Input id={`${id}-control`} suffix="%" type="number" min="0" max="100" step="0.01" inputMode="decimal" placeholder="—"
        value={value} onChange={event => onValueChange(event.target.value)} />
      <Switch id={`${id}-force`} label="Forçar manual" role="switch"
        checked={forced} disabled={disabled} aria-label="Forçar avanço manual" aria-describedby={`${id}-helper`}
        onChange={event => onForcedChange(event.target.checked)} />
    </div>
  </Field>;
}
