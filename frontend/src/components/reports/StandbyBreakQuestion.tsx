import { useId, useState } from 'react';
import type { StandbyBreak } from '../../utils/standbySuggestion';
import { formatReportMinutes, parseDurationToMinutes } from '../../utils/reportOvertime';
import { Input } from '../ui/ds';

export function StandbyBreakQuestion({ option, onChange }: {
  option: StandbyBreak;
  onChange: (minutes: number | undefined) => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState('');
  const [partial, setPartial] = useState('');
  const partialMinutes = /^\d{2}:[0-5]\d$/.test(partial) ? parseDurationToMinutes(partial) : 0;
  const validPartial = partialMinutes > 0 && partialMinutes <= option.maxOverlapMinutes;
  const question = option.id === 'day'
    ? 'O período parado incluiu o intervalo de almoço?'
    : 'O período parado incluiu o intervalo noturno?';
  const choices = [
    { value: 'all', label: `Sim, incluiu todo o intervalo (${formatReportMinutes(option.minutes)})`, disabled: option.minutes > option.maxOverlapMinutes },
    { value: 'none', label: 'Não incluiu o intervalo', disabled: false },
    { value: 'partial', label: 'Incluiu apenas parte do intervalo', disabled: false }
  ];
  return (
    <fieldset className="standby-break-question">
      <legend>{question}</legend>
      <p>Intervalo informado no relatório: {formatReportMinutes(option.minutes)}. Desconte apenas o tempo que ocorreu dentro da paralisação.</p>
      {choices.map(item => (
        <label className="standby-break-question__option" key={item.value}>
          <input type="radio" name={id} value={item.value} checked={choice === item.value} disabled={item.disabled}
            onChange={() => {
              setChoice(item.value);
              onChange(item.value === 'all' ? option.minutes : item.value === 'none' ? 0 : validPartial ? partialMinutes : undefined);
            }} />
          <span>{item.label}</span>
        </label>
      ))}
      {choice === 'partial' ? (
        <div className="field-group">
          <label htmlFor={`${id}-partial`}>Tempo do intervalo dentro da paralisação</label>
          <Input id={`${id}-partial`} type="time" step={60} min="00:01" max={formatReportMinutes(option.maxOverlapMinutes)} value={partial}
            onChange={event => {
              const value = event.target.value;
              setPartial(value);
              const minutes = parseDurationToMinutes(value);
              onChange(/^\d{2}:[0-5]\d$/.test(value) && minutes > 0 && minutes <= option.maxOverlapMinutes ? minutes : undefined);
            }} />
          {partial && !validPartial ? <span role="alert">Informe até {formatReportMinutes(option.maxOverlapMinutes)}, sem exceder o intervalo nem o período parado.</span> : null}
        </div>
      ) : null}
    </fieldset>
  );
}
