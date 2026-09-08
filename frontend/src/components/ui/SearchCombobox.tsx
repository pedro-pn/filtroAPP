import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface SearchComboboxOption {
  value: string;
  label: string;
  description?: string;
}

interface Props {
  id?: string;
  label: string;
  value: string;
  options: SearchComboboxOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  loading?: boolean;
  disabled?: boolean;
  required?: boolean;
  error?: string;
}

export function SearchCombobox({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = 'Pesquise e selecione',
  emptyText = 'Nenhuma opção encontrada.',
  loading = false,
  disabled = false,
  required = false,
  error
}: Props) {
  const generatedId = useId();
  const inputId = id || `combobox-${generatedId}`;
  const listId = `${inputId}-listbox`;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const clearedByTyping = useRef(false);
  const selected = options.find(option => option.value === value);
  const [query, setQuery] = useState(selected?.label || '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    // Clearing a selected value while typing must not erase the new search.
    if (clearedByTyping.current && !value) {
      clearedByTyping.current = false;
      return;
    }
    clearedByTyping.current = false;
    setQuery(selected?.label || '');
  }, [value, selected?.label]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized || selected?.label === query) return options;
    return options.filter(option => `${option.label} ${option.description || ''}`.toLocaleLowerCase('pt-BR').includes(normalized));
  }, [options, query, selected?.label]);

  function choose(option: SearchComboboxOption) {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className={`field-group app-combobox ${error ? 'field-invalid' : ''}`}>
      <label htmlFor={inputId}>{label}{required ? ' *' : ''}</label>
      <div className="app-combobox-control">
        <input
          id={inputId}
          role="combobox"
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[activeIndex] ? `${inputId}-option-${activeIndex}` : undefined}
          onFocus={() => setOpen(true)}
          onChange={event => {
            setQuery(event.target.value);
            if (value) {
              clearedByTyping.current = true;
              onChange('');
            }
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex(index => Math.min(filtered.length - 1, index + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(index => Math.max(0, index - 1));
            } else if (event.key === 'Enter' && open && filtered[activeIndex]) {
              event.preventDefault();
              choose(filtered[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false);
              setQuery(selected?.label || '');
            }
          }}
        />
        <button type="button" tabIndex={-1} disabled={disabled} aria-label={open ? 'Fechar opções' : 'Abrir opções'} onClick={() => setOpen(current => !current)}>⌄</button>
      </div>
      {open ? (
        <div id={listId} className="app-combobox-list" role="listbox">
          {loading ? <span className="app-combobox-empty">Carregando…</span>
            : filtered.length === 0 ? <span className="app-combobox-empty">{emptyText}</span>
            : filtered.map((option, index) => (
              <button
                id={`${inputId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={index === activeIndex ? 'active' : ''}
                key={option.value}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <strong>{option.label}</strong>
                {option.description ? <small>{option.description}</small> : null}
              </button>
            ))}
        </div>
      ) : null}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
    </div>
  );
}
