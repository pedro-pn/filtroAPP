import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { AppIcon } from '../../icons/AppIcon';
import { Button } from './Button';
import { DS_ICONS } from './icons';
import { joinClassNames } from './utils';
import './styles.css';

export type EmptyStateVariant = 'default' | 'search' | 'error' | 'create';

const EMPTY_STATE_ICONS: Record<EmptyStateVariant, LucideIcon> = {
  default: DS_ICONS.emptyDefault,
  search: DS_ICONS.emptySearch,
  error: DS_ICONS.emptyError,
  create: DS_ICONS.emptyCreate
};

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title'
> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode | EmptyStateAction;
  icon?: LucideIcon | null;
  visual?: ReactNode;
  variant?: EmptyStateVariant;
}

function isEmptyStateAction(
  action: ReactNode | EmptyStateAction
): action is EmptyStateAction {
  return Boolean(
    action &&
    typeof action === 'object' &&
    'label' in action &&
    'onClick' in action
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  visual,
  variant = 'default',
  className,
  role,
  ...props
}: EmptyStateProps) {
  const defaultIcon = EMPTY_STATE_ICONS[variant];
  const resolvedVisual =
    visual ??
    (icon === null ? null : <AppIcon icon={icon ?? defaultIcon} size="lg" />);

  return (
    <div
      {...props}
      className={joinClassNames(
        'fv-empty-state',
        `fv-empty-state--${variant}`,
        className
      )}
      role={role ?? (variant === 'error' ? 'alert' : 'status')}
    >
      {resolvedVisual ? (
        <div className="fv-empty-state__visual" aria-hidden="true">
          {resolvedVisual}
        </div>
      ) : null}
      <div className="fv-empty-state__title">{title}</div>
      {description ? (
        <div className="fv-empty-state__description">{description}</div>
      ) : null}
      {action ? (
        <div className="fv-empty-state__action">
          {isEmptyStateAction(action) ? (
            <Button variant="primary" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : (
            action
          )}
        </div>
      ) : null}
    </div>
  );
}
