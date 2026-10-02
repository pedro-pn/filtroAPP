import type { HTMLAttributes, MouseEventHandler, ReactNode } from 'react';

import type { SemanticTone } from './types';
import { joinClassNames } from './utils';
import './styles.css';

export type CardVariant = 'default' | 'interactive' | 'flat' | 'accent';
export type CardPadding = 'sm' | 'md' | 'lg';
export type CardElevation = 'none' | 'sm' | 'md';

export interface CardProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'onClick' | 'title'
> {
  variant?: CardVariant;
  padding?: CardPadding;
  elevation?: CardElevation;
  accentTone?: Exclude<SemanticTone, 'neutral'>;
  header?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  selected?: boolean;
  /** Clickable surface with independent embedded controls (no nested buttons). */
  surfaceAction?: { label: string; onClick: () => void; pressed?: boolean };
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  children: ReactNode;
}

export function Card({
  variant = 'default',
  padding = 'md',
  elevation,
  accentTone = 'brand',
  header,
  title,
  actions,
  footer,
  selected = false,
  surfaceAction,
  href,
  onClick,
  className,
  children,
  ...props
}: CardProps) {
  const resolvedVariant = surfaceAction || href || onClick ? 'interactive' : variant;
  const classes = joinClassNames(
    'fv-card',
    `fv-card--${resolvedVariant}`,
    `fv-card--padding-${padding}`,
    elevation && `fv-card--elevation-${elevation}`,
    resolvedVariant === 'accent' && `fv-tone--${accentTone}`,
    selected && 'fv-card--selected',
    surfaceAction && 'fv-card--surface-action',
    className
  );
  const content = (
    <>
      {header || title || actions ? (
        <div className="fv-card__header">
          <div className="fv-card__heading">{header ?? title}</div>
          {actions ? <div className="fv-card__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="fv-card__body">{children}</div>
      {footer ? <div className="fv-card__footer">{footer}</div> : null}
    </>
  );

  if (surfaceAction) {
    return <section {...props} className={classes}>
      <button type="button" className="fv-card__surface-action" aria-label={surfaceAction.label}
        aria-pressed={surfaceAction.pressed} onClick={surfaceAction.onClick} />
      {content}
    </section>;
  }

  if (href) {
    return (
      <a
        {...props}
        className={classes}
        href={href}
        onClick={onClick as MouseEventHandler<HTMLAnchorElement>}
        aria-current={selected ? 'true' : undefined}
      >
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        {...props}
        className={classes}
        type="button"
        onClick={onClick as MouseEventHandler<HTMLButtonElement>}
        aria-pressed={selected || undefined}
      >
        {content}
      </button>
    );
  }

  return (
    <section {...props} className={classes}>
      {content}
    </section>
  );
}
