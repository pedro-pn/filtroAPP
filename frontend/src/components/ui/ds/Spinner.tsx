import type { HTMLAttributes } from 'react';

import { BrandLoading } from '../../brand/BrandLoading';

import type { ControlSize } from './types';
import { joinClassNames } from './utils';
import './styles.css';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: ControlSize;
  label?: string;
  decorative?: boolean;
}

export function Spinner({
  size = 'md',
  label = 'Carregando…',
  decorative = false,
  className,
  ...props
}: SpinnerProps) {
  return (
    <span
      {...props}
      className={joinClassNames('fv-spinner', `fv-spinner--${size}`, className)}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      role={decorative ? undefined : 'status'}
    >
      <BrandLoading inline size="sm" decorative />
    </span>
  );
}
