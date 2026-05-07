import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'mini';

const variantClassNames: Record<ButtonVariant, string> = {
  primary: 'primary-button',
  secondary: 'secondary-button',
  danger: 'danger-button',
  mini: 'mini-btn'
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonProps) {
  const classes = [variantClassNames[variant], className].filter(Boolean).join(' ');
  return <button className={classes} type={type} {...props} />;
}
