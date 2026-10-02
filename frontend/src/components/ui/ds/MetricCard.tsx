import type { HTMLAttributes, ReactNode } from 'react';

import type { SemanticTone } from './types';
import { joinClassNames } from './utils';
import './styles.css';

export interface MetricCardProps extends HTMLAttributes<HTMLElement> {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: SemanticTone;
}

export function MetricCard({
  label,
  value,
  description,
  icon,
  tone = 'neutral',
  className,
  ...props
}: MetricCardProps) {
  return (
    <article
      {...props}
      className={joinClassNames(
        'fv-metric-card',
        `fv-tone--${tone}`,
        className
      )}
    >
      {icon ? (
        <span className="fv-metric-card__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="fv-metric-card__copy">
        <span className="fv-metric-card__label">{label}</span>
        <strong className="fv-metric-card__value">{value}</strong>
        {description ? (
          <span className="fv-metric-card__description">{description}</span>
        ) : null}
      </div>
    </article>
  );
}
