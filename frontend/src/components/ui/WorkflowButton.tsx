import type { ButtonHTMLAttributes } from 'react';

import { Button as LegacyButton } from './Button';
import { Button, type ButtonProps } from './ds';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  loading?: boolean;
  workflowAppearance?: boolean;
  workflowVariant?: 'primary' | 'secondary' | 'danger' | 'mini';
};

/** Shared panels keep the planning dialog's established action styles. */
export function WorkflowButton({ workflowAppearance = false, workflowVariant, size, variant = 'secondary', loading, disabled, children, ...props }: Props) {
  if (!workflowAppearance) return <Button {...props} size={size} variant={variant} loading={loading} disabled={disabled}>{children}</Button>;

  const legacyVariant = workflowVariant ?? (variant === 'primary' || variant === 'danger' ? variant : 'secondary');
  return <LegacyButton {...props} variant={legacyVariant} disabled={disabled || loading} aria-busy={loading || undefined}>{children}</LegacyButton>;
}
