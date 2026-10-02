import { BrandLoading } from '../brand/BrandLoading';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  portal?: boolean;
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
  variant = 'default',
  portal = false
}: Props) {
  const generatedId = useId();
  const inputId = id || `combobox-${generatedId}`;
  const listId = `${inputId}-listbox`;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const clearedByTyping = useRef(false);
  const selected = options.find(option => option.value === value);
  const [query, setQuery] = useState(selected?.label || (allowCustomValue ? value : ''));
  const [open, setOpen] = useState(false);
  const [showAllOptions, setShowAllOptions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(allowCustomValue ? -1 : 0);
  const [listPosition, setListPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    above: boolean;
  } | null>(null);

  const updateListPosition = useCallback(() => {
    const control = controlRef.current;
    if (!control) return;
    const bounds = control.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const margin = 8;
    const gap = 4;
    const width = Math.max(0, Math.min(bounds.width, viewportWidth - margin * 2));
    const left = Math.max(viewportLeft + margin, Math.min(bounds.left, viewportLeft + viewportWidth - margin - width));
    const below = viewportTop + viewportHeight - bounds.bottom - margin - gap;
    const above = bounds.top - viewportTop - margin - gap;
    const opensAbove = below < 120 && above > below;
    const available = opensAbove ? above : below;
    setListPosition({
      top: opensAbove ? bounds.top - gap : bounds.bottom + gap,
      left,
      width,
      maxHeight: Math.max(0, Math.min(240, available)),
      above: opensAbove
    });
  }, []);

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
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  useLayoutEffect(() => {
    if (!open || !portal) return;
    updateListPosition();
    const reposition = () => updateListPosition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition);
    if (controlRef.current) observer?.observe(controlRef.current);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
    };
  }, [open, portal, updateListPosition]);

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

  const list = open && !disabled ? (
    <div
      id={listId}
      ref={listRef}
      className={`app-combobox-list${portal ? ' app-combobox-list--portal' : ''}`}
      role="listbox"
      style={portal && listPosition ? {
        top: listPosition.top,
        left: listPosition.left,
        width: listPosition.width,
        maxHeight: listPosition.maxHeight,
        transform: listPosition.above ? 'translateY(-100%)' : undefined
      } : undefined}
    >
      {loading ? <span className="app-combobox-empty"><BrandLoading label="Carregando" inline size="sm" /></span>
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
  ) : null;

  return (
    <div ref={wrapperRef} className={`field-group app-combobox ${variant === 'select' ? 'app-combobox-select' : ''} ${error ? 'field-invalid' : ''}`}
      onBlur={event => {
        const next = event.relatedTarget;
        if (next && (event.currentTarget.contains(next) || listRef.current?.contains(next))) return;
        if (!portal || next) setOpen(false);
      }}>
      {!hideLabel ? <label htmlFor={inputId}>{label}{required ? ' *' : ''}</label> : null}
      <div className="app-combobox-control" ref={controlRef}>
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
            } else if (event.key === 'Tab') {
              setOpen(false);
            }
          }}
        />
        <button type="button" tabIndex={-1} disabled={disabled} aria-label={toggleLabel || (open ? 'Fechar opções' : 'Abrir opções')}
          aria-expanded={open} aria-controls={listId} onMouseDown={event => event.preventDefault()}
          onClick={() => { setActiveIndex(allowCustomValue ? -1 : 0); setShowAllOptions(true); setOpen(current => !current); }} />
      </div>
      {portal && typeof document !== 'undefined' && list && listPosition
        ? createPortal(<div className={variant === 'select' ? 'app-combobox-select' : undefined}>{list}</div>, document.body)
        : portal ? null : list}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
    </div>
  );
}
