import type { HTMLAttributes, ReactNode } from 'react';

import { AppIcon } from '../../icons/AppIcon';
import { DS_ICONS } from './icons';
import { resolveStatusTone, type StatusToneMap } from './status';
import type { SemanticTone } from './types';
import { humanizeStatus, joinClassNames } from './utils';
import './styles.css';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: SemanticTone;
  dot?: boolean;
  multiline?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  children: ReactNode;
}

export function Badge({
  tone = 'neutral',
  dot = false,
  multiline = false,
  onRemove,
  removeLabel = 'Remover',
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={joinClassNames(
        'fv-badge',
        `fv-tone--${tone}`,
        onRemove && 'fv-badge--removable',
        multiline && 'fv-badge--multiline',
        className
      )}
    >
      {dot ? <span className="fv-badge__dot" aria-hidden="true" /> : null}
      <span className="fv-badge__label">{children}</span>
      {onRemove ? (
        <button
          className="fv-badge__remove"
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
        >
          <AppIcon icon={DS_ICONS.close} size="sm" />
        </button>
      ) : null}
    </span>
  );
}

export interface StatusPillProps extends Omit<BadgeProps, 'children' | 'tone'> {
  status: string;
  label?: ReactNode;
  tone?: SemanticTone;
  toneMap?: StatusToneMap;
}

export function StatusPill({
  status,
  label,
  tone,
  toneMap,
  dot = true,
  ...props
}: StatusPillProps) {
  return (
    <Badge
      {...props}
      tone={tone ?? resolveStatusTone(status, toneMap)}
      dot={dot}
      data-status={status}
    >
      {label ?? humanizeStatus(status)}
    </Badge>
  );
}
