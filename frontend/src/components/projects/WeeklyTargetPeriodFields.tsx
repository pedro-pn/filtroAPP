import { WEEKLY_TARGET_WORKDAYS, weeklyTargetCountingPeriod, weekStartKey } from '../../../../shared/modules/mission-weekly-progress.js';
import { Field, Select } from '../ui/ds';
import { formatDateOnly } from '../../utils/dateOnly';
import type { TargetDraft } from './weeklyTargetDraft';

const dayOptions = [1, 2, 3, 4, 5, 6, 0].map(day => ({ value: String(day), label: WEEKLY_TARGET_WORKDAYS[day] }));

export function WeeklyTargetPeriodFields({ id, draft, disabled, onChange }: {
  id: string; draft: TargetDraft; disabled: boolean; onChange: (draft: TargetDraft) => void;
}) {
  const period = weekStartKey(draft.weekStartDate) ? weeklyTargetCountingPeriod(draft.weekStartDate, draft) : null;
  return <fieldset className="mission-weekly-counting-period" disabled={disabled}>
    <legend>Período de contagem</legend>
    <Field id={`${id}-counting-start`} label="Início da contagem" required>
      <Select value={draft.countingStartDay} options={dayOptions} onChange={event => onChange({ ...draft, countingStartDay: Number(event.target.value) })} />
    </Field>
    <Field id={`${id}-counting-end`} label="Fim da contagem" required>
      <Select value={draft.countingEndDay} options={dayOptions} onChange={event => onChange({ ...draft, countingEndDay: Number(event.target.value) })} />
    </Field>
    <p className="mission-weekly-progress-hint">Os dois dias entram na contagem. Se o dia final vier antes do inicial, o período termina na semana seguinte.
      {period ? ` Nesta meta: ${formatDateOnly(period.periodStartDate)} a ${formatDateOnly(period.periodEndDate)}.` : ''}</p>
  </fieldset>;
}
