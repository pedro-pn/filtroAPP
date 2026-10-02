import {
  forwardRef,
  type ForwardedRef,
  type SelectHTMLAttributes
} from 'react';

import { AppIcon } from '../../icons/AppIcon';
import { DS_ICONS } from './icons';
import { useFieldContext } from './field-context';
import type { ControlSize } from './types';
import { joinClassNames, joinIds } from './utils';
import './styles.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'size'
> {
  size?: ControlSize;
  invalid?: boolean;
  placeholder?: string;
  options?: readonly SelectOption[];
  containerClassName?: string;
}

function SelectComponent(
  {
    size = 'md',
    invalid,
    placeholder,
    options,
    containerClassName,
    className,
    id,
    disabled,
    required,
    children,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    ...props
  }: SelectProps,
  ref: ForwardedRef<HTMLSelectElement>
) {
  const field = useFieldContext();
  const isInvalid = invalid ?? field?.invalid ?? false;
  const isDisabled = disabled ?? field?.disabled;

  return (
    <span
      className={joinClassNames(
        'fv-control-shell',
        'fv-select-shell',
        `fv-control-shell--${size}`,
        containerClassName
      )}
      data-disabled={isDisabled || undefined}
      data-invalid={isInvalid || undefined}
    >
      <select
        {...props}
        ref={ref}
        id={id ?? field?.controlId}
        className={joinClassNames('fv-select', className)}
        disabled={isDisabled}
        required={required ?? field?.required}
        aria-invalid={ariaInvalid ?? (isInvalid || undefined)}
        aria-describedby={joinIds(ariaDescribedBy, field?.describedBy)}
      >
        {placeholder ? (
          <option value="" disabled={required ?? field?.required}>
            {placeholder}
          </option>
        ) : null}
        {options?.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <span className="fv-select-shell__icon" aria-hidden="true">
        <AppIcon icon={DS_ICONS.chevronDown} size="sm" />
      </span>
    </span>
  );
}

export const Select = forwardRef(SelectComponent);
