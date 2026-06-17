import { type ChangeEvent } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  /** Contagem opcional "X de Y" exibida quando há texto digitado. */
  count?: { shown: number; total: number } | null;
}

export function SearchBar({ value, onChange, placeholder, ariaLabel, id, count }: SearchBarProps) {
  return (
    <div className="app-search">
      <div className="app-search-field">
        <input
          id={id}
          className="app-search-input"
          type="search"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel || placeholder}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        />
        {value ? (
          <button type="button" className="app-search-clear" aria-label="Limpar busca" onClick={() => onChange('')}>×</button>
        ) : null}
      </div>
      {count && value.trim() ? (
        <span className="app-search-count">{count.shown} de {count.total}</span>
      ) : null}
    </div>
  );
}
