import { useId, type HTMLAttributes, type ReactNode } from 'react';

import { FieldContext } from './field-context';
import { joinClassNames } from './utils';
import './styles.css';

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'id'> {
  children: ReactNode;
  label?: ReactNode;
  helperText?: ReactNode;
  errorText?: ReactNode;
  additionalContent?: ReactNode;
  optionalText?: ReactNode;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Field({
  children,
  label,
  helperText,
  errorText,
  additionalContent,
  optionalText = 'Opcional',
  id,
  required,
  disabled,
  className,
  ...props
}: FieldProps) {
  const reactId = useId();
  const baseId = id ?? `fv-field-${reactId.replace(/:/g, '')}`;
  const controlId = `${baseId}-control`;
  const helperId = helperText ? `${baseId}-helper` : undefined;
  const errorId = errorText ? `${baseId}-error` : undefined;
  const describedBy = errorId ?? helperId;

  return (
    <FieldContext.Provider
      value={{
        controlId,
        describedBy,
        disabled,
        invalid: Boolean(errorText),
        required
      }}
    >
      <div
        {...props}
        className={joinClassNames('fv-field', className)}
        data-disabled={disabled || undefined}
        data-invalid={Boolean(errorText) || undefined}
      >
        {label ? (
          <div className="fv-field__heading">
            <label className="fv-field__label" htmlFor={controlId}>
              {label}
              {required ? (
                <span className="fv-field__required" aria-hidden="true">
                  {' '}
                  *
                </span>
              ) : null}
            </label>
            {!required && optionalText ? (
              <span className="fv-field__optional">{optionalText}</span>
            ) : null}
            {additionalContent ? (
              <span className="fv-field__additional">{additionalContent}</span>
            ) : null}
          </div>
        ) : null}
        {children}
        {errorText ? (
          <p
            className="fv-field__message fv-field__message--error"
            id={errorId}
          >
            {errorText}
          </p>
        ) : helperText ? (
          <p className="fv-field__message" id={helperId}>
            {helperText}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
