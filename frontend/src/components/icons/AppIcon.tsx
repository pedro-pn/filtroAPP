import type { LucideIcon, LucideProps } from 'lucide-react';

import './AppIcon.css';

const ICON_SIZES = {
  sm: 16,
  md: 20,
  lg: 24
} as const;

export type AppIconSize = keyof typeof ICON_SIZES;

export interface AppIconProps extends Omit<
  LucideProps,
  'aria-hidden' | 'children' | 'size' | 'strokeWidth'
> {
  icon: LucideIcon;
  size?: AppIconSize;
  label?: string;
}

export function AppIcon({
  icon: Icon,
  size = 'md',
  label,
  className,
  ...props
}: AppIconProps) {
  return (
    <Icon
      {...props}
      className={['fv-icon', className].filter(Boolean).join(' ')}
      size={ICON_SIZES[size]}
      strokeWidth={1.75}
      absoluteStrokeWidth
      aria-hidden={label ? undefined : true}
      aria-label={label}
      focusable="false"
      role={label ? 'img' : undefined}
    />
  );
}
