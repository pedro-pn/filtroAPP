import { Field, Input } from '../../../components/ui/ds';

export type MissionPeriodDraft = { mobilizationDate: string; demobilizationDate: string };

/** Shared date controls for project cycles, individual cycles and allocations. */
export function MissionPeriodFields({ id, value, min, max, disabled, startLabel = 'Mobilização', endLabel = 'Desmobilização', optionalEnd = false, onChange }: {
  id: string;
  value: MissionPeriodDraft;
  min: string;
  max: string;
  disabled?: boolean;
  startLabel?: string;
  endLabel?: string;
  optionalEnd?: boolean;
  onChange: (value: MissionPeriodDraft) => void;
}) {
  return <div className="efetivo-team-period-fields">
    <Field id={`${id}-mobilization`} label={startLabel} required>
      <Input size="sm" type="date" min={min} max={max} value={value.mobilizationDate} disabled={disabled} onChange={event => onChange({ ...value, mobilizationDate: event.target.value })} />
    </Field>
    <Field id={`${id}-demobilization`} label={endLabel} required={!optionalEnd} optionalText=""
      helperText={optionalEnd ? 'Opcional enquanto mobilizado.' : undefined}>
      <Input size="sm" type="date" min={value.mobilizationDate || min} max={max} value={value.demobilizationDate} disabled={disabled} onChange={event => onChange({ ...value, demobilizationDate: event.target.value })} />
    </Field>
  </div>;
}
