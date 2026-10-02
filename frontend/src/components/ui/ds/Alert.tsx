import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { AppIcon } from '../../icons/AppIcon';
import { Button, IconButton } from './Button';
import { DS_ICONS } from './icons';
import type { FeedbackTone } from './types';
import { joinClassNames } from './utils';
import './styles.css';

const ALERT_ICONS: Record<FeedbackTone, LucideIcon> = {
  success: DS_ICONS.alertSuccess,
  warning: DS_ICONS.alertWarning,
  danger: DS_ICONS.alertDanger,
  info: DS_ICONS.alertInfo
};

export interface AlertAction {
  label: string;
  onClick: () => void;
}

export interface AlertProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title'
> {
  tone?: FeedbackTone;
  title?: ReactNode;
  icon?: LucideIcon | null;
  action?: ReactNode | AlertAction;
  onDismiss?: () => void;
  dismissLabel?: string;
  children?: ReactNode;
}

function isAlertAction(action: ReactNode | AlertAction): action is AlertAction {
  return Boolean(
    action &&
    typeof action === 'object' &&
    'label' in action &&
    'onClick' in action
  );
}

export function Alert({
  tone = 'info',
  title,
  icon,
  action,
  onDismiss,
  dismissLabel = 'Dispensar aviso',
  className,
  children,
  role,
  ...props
}: AlertProps) {
  const Icon = icon === undefined ? ALERT_ICONS[tone] : icon;
  const liveRole =
    role ?? (tone === 'danger' || tone === 'warning' ? 'alert' : 'status');

  return (
    <div
      {...props}
      className={joinClassNames('fv-alert', `fv-tone--${tone}`, className)}
      role={liveRole}
    >
      {Icon ? (
        <span className="fv-alert__icon" aria-hidden="true">
          <AppIcon icon={Icon} />
        </span>
      ) : null}
      <div className="fv-alert__content">
        {title ? <div className="fv-alert__title">{title}</div> : null}
        {children ? (
          <div className="fv-alert__description">{children}</div>
        ) : null}
        {action ? (
          <div className="fv-alert__action">
            {isAlertAction(action) ? (
              <Button variant="link" size="sm" onClick={action.onClick}>
                {action.label}
              </Button>
            ) : (
              action
            )}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <IconButton
          className="fv-alert__dismiss"
          icon={DS_ICONS.close}
          label={dismissLabel}
          size="sm"
          onClick={onDismiss}
        />
      ) : null}
    </div>
  );
}
