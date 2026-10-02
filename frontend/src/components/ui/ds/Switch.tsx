import {
  useId,
  type ChangeEventHandler,
  type InputHTMLAttributes,
  type ReactNode
} from 'react';

import { joinClassNames } from './utils';
import './form.css';

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'children' | 'onChange' | 'type'
> {
  label: ReactNode;
  description?: ReactNode;
  onChange: ChangeEventHandler<HTMLInputElement>;
  containerClassName?: string;
}

export function Switch({
  label,
  description,
  containerClassName,
  id,
  checked,
  disabled,
  onChange,
  ...props
}: SwitchProps) {
  const generatedId = useId().replace(/:/g, '');
  const controlId = id ?? `fv-switch-${generatedId}`;

  return (
    <label
      className={joinClassNames('fv-switch', containerClassName)}
      htmlFor={controlId}
      data-disabled={disabled || undefined}
    >
      <span className="fv-switch__copy">
        <span className="fv-switch__label">{label}</span>
        {description ? (
          <span className="fv-switch__description">{description}</span>
        ) : null}
      </span>
      <span className="fv-switch__control">
        <input
          {...props}
          id={controlId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
        <span className="fv-switch__track" aria-hidden="true">
          <span className="fv-switch__thumb" />
        </span>
      </span>
    </label>
  );
}
