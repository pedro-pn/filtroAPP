import { useId } from 'react';
import type { PauseResponsibility } from '../../utils/standbySuggestion';
import { formatReportMinutes, parseDurationToMinutes } from '../../utils/reportOvertime';
import { Input } from '../ui/ds';

const OPTIONS: { value: PauseResponsibility; label: string; hint: string }[] = [
  {
    value: 'client',
    label: 'Por conta do cliente',
    hint: 'Aguardando PT, APR, documentação, liberação, energia, frente de serviço etc. Entra como standby no RDO.'
  },
  {
    value: 'internal',
    label: 'Por nossa conta',
    hint: 'Falha em nosso equipamento, acidente, falta de recurso nosso etc. Registro interno, não aparece no RDO.'
  },
  {
    value: 'both',
    label: 'Parte de cada',
    hint: 'Informe quanto do tempo total foi por nossa conta; o restante entra como standby do cliente.'
  }
];

/** Pergunta obrigatória: de quem foi a responsabilidade pela pausa identificada. */
export function StandbyResponsibilityQuestion({ value, suggested, totalMinutes, internalDuration, onChange, onInternalDurationChange }: {
  value: PauseResponsibility | null;
  suggested: PauseResponsibility | null;
  totalMinutes: number;
  internalDuration: string;
  onChange: (value: PauseResponsibility) => void;
  onInternalDurationChange: (value: string) => void;
}) {
  const id = useId();
  const internalMinutes = /^\d{2}:[0-5]\d$/.test(internalDuration) ? parseDurationToMinutes(internalDuration) : 0;
  const invalidSplit = value === 'both' && internalDuration !== '' && !(internalMinutes > 0 && internalMinutes < totalMinutes);
  return (
    <fieldset className="standby-responsibility-question" data-standby-responsibility>
      <legend>De quem foi a responsabilidade pela pausa?</legend>
      {suggested ? (
        <p>Identificado automaticamente pelas anotações: <strong>{OPTIONS.find(item => item.value === suggested)?.label.toLowerCase()}</strong>. Confirme ou corrija.</p>
      ) : (
        <p>Não foi possível identificar o motivo pelas anotações. Selecione a opção correta.</p>
      )}
      {OPTIONS.map(item => (
        <label className="standby-break-question__option" key={item.value}>
          <input type="radio" name={id} value={item.value} checked={value === item.value} onChange={() => onChange(item.value)} />
          <span><strong>{item.label}</strong> — {item.hint}</span>
        </label>
      ))}
      {value === 'both' ? (
        <div className="field-group">
          <label htmlFor={`${id}-internal`}>Tempo por nossa conta</label>
          <Input id={`${id}-internal`} type="time" step={60} min="00:01" value={internalDuration}
            onChange={event => onInternalDurationChange(event.target.value)} />
          {invalidSplit ? <span role="alert">Informe um tempo maior que zero e menor que o total ({formatReportMinutes(totalMinutes)}).</span>
            : internalMinutes > 0 && internalMinutes < totalMinutes
              ? <span>Standby do cliente (RDO): {formatReportMinutes(totalMinutes - internalMinutes)}.</span> : null}
        </div>
      ) : null}
    </fieldset>
  );
}
