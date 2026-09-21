import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const COMMIT_DELAY_MS = 900;

function isCommittableDate(value: string) {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: string;
  onCommit: (value: string) => void;
};

/**
 * Campo de data para valores que disparam efeitos a cada alteração (salvamento automático, filtro na URL).
 * Ao digitar, cada combinação de dia, mês e ano já forma uma data válida ("0002-…", "2026-01-…"); confirmar
 * cada uma travaria o campo no meio da digitação. Por isso o valor fica em rascunho e só é confirmado
 * quando a digitação pausa, o campo perde o foco ou uma data é escolhida no calendário.
 */
export function DateInput({ value, onCommit, onBlur, max = `${MAX_YEAR}-12-31`, ...rest }: DateInputProps) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };
  const cancelPending = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const commit = (next: string) => {
    cancelPending();
    if (next !== latest.current.value && (next === '' || isCommittableDate(next))) latest.current.onCommit(next);
  };
  useEffect(() => setDraft(value), [value]);
  useEffect(() => cancelPending, []);
  return (
    <input
      {...rest}
      type="date"
      max={max}
      value={draft}
      onChange={event => {
        const next = event.target.value;
        setDraft(next);
        cancelPending();
        if (isCommittableDate(next)) timer.current = setTimeout(() => commit(next), COMMIT_DELAY_MS);
      }}
      onBlur={event => {
        onBlur?.(event);
        cancelPending();
        if (event.currentTarget.validity.badInput || (draft !== '' && !isCommittableDate(draft))) setDraft(value);
        else commit(draft);
      }}
    />
  );
}
