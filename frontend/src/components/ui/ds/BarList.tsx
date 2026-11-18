import type { HTMLAttributes, ReactNode } from 'react';
import { joinClassNames } from './utils';
import './BarList.css';

export interface BarListItem {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  valueLabel: ReactNode;
  percentage: number;
}

export interface BarListProps extends HTMLAttributes<HTMLOListElement> {
  items: readonly BarListItem[];
  'aria-label': string;
}

/** Exact values remain text; the proportional bars are only a visual aid. */
export function BarList({ items, className, ...props }: BarListProps) {
  return (
    <ol {...props} className={joinClassNames('fv-bar-list', className)}>
      {items.map(item => (
        <li key={item.id} className="fv-bar-list__item">
          <div className="fv-bar-list__heading">
            <div className="fv-bar-list__copy">
              <strong>{item.label}</strong>
              {item.description ? <span>{item.description}</span> : null}
            </div>
            <span className="fv-bar-list__value">{item.valueLabel}</span>
          </div>
          <span className="fv-bar-list__track" aria-hidden="true">
            <span style={{ width: `${Number.isFinite(item.percentage) ? Math.max(0, Math.min(100, item.percentage)) : 0}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}
