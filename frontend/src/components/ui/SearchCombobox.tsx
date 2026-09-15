import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createSearchMatcher } from '../../utils/search';

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
  allowCustomValue?: boolean;
  hideLabel?: boolean;
  inputClassName?: string;
  maxLength?: number;
  toggleLabel?: string;
  variant?: 'default' | 'select';
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
  error,
  allowCustomValue = false,
  hideLabel = false,
  inputClassName,
  maxLength,
  toggleLabel,
  variant = 'default'
}: Props) {
  const generatedId = useId();
  const inputId = id || `combobox-${generatedId}`;
  const listId = `${inputId}-listbox`;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const clearedByTyping = useRef(false);
  const selected = options.find(option => option.value === value);
  const [query, setQuery] = useState(selected?.label || (allowCustomValue ? value : ''));
  const [open, setOpen] = useState(false);
  const [showAllOptions, setShowAllOptions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(allowCustomValue ? -1 : 0);

  useEffect(() => {
    // Clearing a selected value while typing must not erase the new search.
    if (clearedByTyping.current && !value) {
      clearedByTyping.current = false;
      return;
    }
    clearedByTyping.current = false;
    setQuery(selected?.label || (allowCustomValue ? value : ''));
  }, [value, selected?.label, allowCustomValue]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const filtered = useMemo(() => {
    if (allowCustomValue && showAllOptions) return options;
    if (!query.trim() || selected?.label === query) return options;
    const matches = createSearchMatcher(query);
    return options.filter(option => matches([option.label, option.description]));
  }, [options, query, selected?.label, allowCustomValue, showAllOptions]);

  function choose(option: SearchComboboxOption) {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
    setShowAllOptions(false);
  }

  return (
    <div ref={wrapperRef} className={`field-group app-combobox ${variant === 'select' ? 'app-combobox-select' : ''} ${error ? 'field-invalid' : ''}`}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      {!hideLabel ? <label htmlFor={inputId}>{label}{required ? ' *' : ''}</label> : null}
      <div className="app-combobox-control">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-label={hideLabel ? label : undefined}
          className={inputClassName}
          maxLength={maxLength}
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[activeIndex] ? `${inputId}-option-${activeIndex}` : undefined}
          onFocus={() => { setOpen(true); if (allowCustomValue) { setShowAllOptions(true); setActiveIndex(-1); } }}
          onChange={event => {
            setQuery(event.target.value);
            setShowAllOptions(false);
            if (allowCustomValue) onChange(event.target.value);
            else if (value) {
              clearedByTyping.current = true;
              onChange('');
            }
            setActiveIndex(allowCustomValue ? -1 : 0);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex(index => open ? Math.min(filtered.length - 1, index + 1) : 0);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(index => Math.max(0, index - 1));
            } else if (event.key === 'Enter' && open && filtered[activeIndex]) {
              event.preventDefault();
              choose(filtered[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false);
              setQuery(selected?.label || (allowCustomValue ? value : ''));
            }
          }}
        />
        <button type="button" tabIndex={-1} disabled={disabled} aria-label={toggleLabel || (open ? 'Fechar opções' : 'Abrir opções')}
          aria-expanded={open} aria-controls={listId} onMouseDown={event => event.preventDefault()}
          onClick={() => { setActiveIndex(allowCustomValue ? -1 : 0); setShowAllOptions(true); setOpen(current => !current); }}>{variant === 'select' ? null : '⌄'}</button>
      </div>
      {open && !disabled ? (
        <div id={listId} className="app-combobox-list" role="listbox">
          {loading ? <span className="app-combobox-empty">Carregando…</span>
            : filtered.length === 0 ? <span className="app-combobox-empty">{emptyText}</span>
            : filtered.map((option, index) => (
              <button
                id={`${inputId}-option-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
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
