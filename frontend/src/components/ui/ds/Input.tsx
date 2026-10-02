import {
  forwardRef,
  type ForwardedRef,
  type InputHTMLAttributes,
  type ReactNode
} from 'react';

import { useFieldContext } from './field-context';
import type { ControlSize } from './types';
import { joinClassNames, joinIds } from './utils';
import './styles.css';

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'prefix'
> {
  size?: ControlSize;
  prefix?: ReactNode;
  suffix?: ReactNode;
  invalid?: boolean;
  containerClassName?: string;
}

function InputComponent(
  {
    size = 'md',
    prefix,
    suffix,
    invalid,
    containerClassName,
    className,
    id,
    disabled,
    required,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    readOnly,
    ...props
  }: InputProps,
  ref: ForwardedRef<HTMLInputElement>
) {
  const field = useFieldContext();
  const isInvalid = invalid ?? field?.invalid ?? false;
  const isDisabled = disabled ?? field?.disabled;

  return (
    <span
      className={joinClassNames(
        'fv-control-shell',
        `fv-control-shell--${size}`,
        containerClassName
      )}
      data-disabled={isDisabled || undefined}
      data-invalid={isInvalid || undefined}
      data-readonly={readOnly || undefined}
    >
      {prefix ? (
        <span className="fv-control-shell__adornment" aria-hidden="true">
          {prefix}
        </span>
      ) : null}
      <input
        {...props}
        ref={ref}
        id={id ?? field?.controlId}
        className={joinClassNames('fv-input', className)}
        disabled={isDisabled}
        required={required ?? field?.required}
        readOnly={readOnly}
        aria-invalid={ariaInvalid ?? (isInvalid || undefined)}
        aria-describedby={joinIds(ariaDescribedBy, field?.describedBy)}
      />
      {suffix ? (
        <span className="fv-control-shell__adornment" aria-hidden="true">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}

export const Input = forwardRef(InputComponent);
