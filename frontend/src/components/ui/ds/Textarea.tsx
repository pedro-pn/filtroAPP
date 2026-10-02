import {
  forwardRef,
  type ForwardedRef,
  type TextareaHTMLAttributes
} from 'react';

import { useFieldContext } from './field-context';
import type { ControlSize } from './types';
import { joinClassNames, joinIds } from './utils';
import './styles.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: ControlSize;
  invalid?: boolean;
}

function TextareaComponent(
  {
    size = 'md',
    invalid,
    className,
    id,
    disabled,
    required,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    rows = 4,
    ...props
  }: TextareaProps,
  ref: ForwardedRef<HTMLTextAreaElement>
) {
  const field = useFieldContext();
  const isInvalid = invalid ?? field?.invalid ?? false;
  const isDisabled = disabled ?? field?.disabled;

  return (
    <textarea
      {...props}
      ref={ref}
      id={id ?? field?.controlId}
      className={joinClassNames(
        'fv-textarea',
        `fv-textarea--${size}`,
        className
      )}
      disabled={isDisabled}
      required={required ?? field?.required}
      rows={rows}
      aria-invalid={ariaInvalid ?? (isInvalid || undefined)}
      aria-describedby={joinIds(ariaDescribedBy, field?.describedBy)}
    />
  );
}

export const Textarea = forwardRef(TextareaComponent);
