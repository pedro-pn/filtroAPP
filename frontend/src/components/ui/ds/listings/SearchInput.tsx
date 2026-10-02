import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type ForwardedRef,
  type InputHTMLAttributes,
  type KeyboardEvent
} from 'react';

import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { AppIcon } from '../../../icons/AppIcon';
import { DS_ICONS } from '../icons';
import { Spinner } from '../Spinner';
import type { ControlSize } from '../types';
import { joinClassNames } from '../utils';
import './listings.css';

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'size' | 'type' | 'value'
> {
  value: string;
  onChange: (value: string) => void;
  onDebouncedChange?: (value: string) => void;
  debounceMs?: number;
  loading?: boolean;
  loadingLabel?: string;
  label?: string;
  clearLabel?: string;
  resultCount?: { shown: number; total: number };
  size?: ControlSize;
  fullWidth?: boolean;
}

function SearchInputComponent(
  {
    value,
    onChange,
    onDebouncedChange,
    debounceMs = 300,
    loading = false,
    loadingLabel = 'Buscando…',
    label = 'Buscar',
    clearLabel = 'Limpar busca',
    resultCount,
    size = 'md',
    fullWidth = true,
    disabled,
    readOnly,
    className,
    onCompositionStart,
    onCompositionEnd,
    onKeyDown,
    ...props
  }: SearchInputProps,
  ref: ForwardedRef<HTMLInputElement>
) {
  const [isComposing, setIsComposing] = useState(false);
  const debouncedValue = useDebouncedValue(value, Math.max(0, debounceMs));
  const lastEmittedValue = useRef(value);

  useEffect(() => {
    if (
      !isComposing &&
      onDebouncedChange &&
      debouncedValue === value &&
      lastEmittedValue.current !== debouncedValue
    ) {
      lastEmittedValue.current = debouncedValue;
      onDebouncedChange(debouncedValue);
    }
  }, [debouncedValue, isComposing, onDebouncedChange, value]);

  function emitImmediately(nextValue: string) {
    lastEmittedValue.current = nextValue;
    onDebouncedChange?.(nextValue);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
  }

  function handleCompositionStart(event: CompositionEvent<HTMLInputElement>) {
    setIsComposing(true);
    onCompositionStart?.(event);
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    setIsComposing(false);
    onCompositionEnd?.(event);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      emitImmediately(event.currentTarget.value);
    }
    onKeyDown?.(event);
  }

  function handleClear() {
    onChange('');
    emitImmediately('');
  }

  return (
    <span
      className={joinClassNames(
        'fv-search-input',
        'fv-control-shell',
        `fv-control-shell--${size}`,
        fullWidth && 'fv-search-input--full',
        className
      )}
      data-disabled={disabled || undefined}
      data-readonly={readOnly || undefined}
      aria-busy={loading || undefined}
    >
      <span className="fv-search-input__leading" aria-hidden="true">
        {loading ? (
          <Spinner size="sm" decorative />
        ) : (
          <AppIcon icon={DS_ICONS.search} size="sm" />
        )}
      </span>
      <input
        {...props}
        ref={ref}
        className="fv-input fv-search-input__control"
        type="search"
        role="searchbox"
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={props['aria-label'] ?? label}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
      />
      {value && !disabled && !readOnly ? (
        <button
          className="fv-search-input__clear"
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={handleClear}
        >
          <AppIcon icon={DS_ICONS.close} size="sm" />
        </button>
      ) : null}
      {loading ? <span className="fv-sr-only">{loadingLabel}</span> : null}
      {resultCount ? (
        <span className="fv-sr-only" role="status" aria-live="polite">
          {resultCount.shown} de {resultCount.total} resultados exibidos
        </span>
      ) : null}
    </span>
  );
}

export const SearchInput = forwardRef(SearchInputComponent);
