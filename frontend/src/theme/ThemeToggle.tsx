import { Monitor, Moon, Sun } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

import { AppIcon } from '../components/icons/AppIcon';
import { useTheme } from './useTheme';
import type { ThemePreference } from './theme';
import './ThemeToggle.css';

const THEME_ORDER: ThemePreference[] = ['light', 'dark', 'system'];
const THEME_LABELS: Record<ThemePreference, string> = {
  light: 'claro',
  dark: 'escuro',
  system: 'automático'
};
const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor
} as const;

export type ThemeToggleProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'type'
>;

export function ThemeToggle({
  className,
  'aria-label': ariaLabel,
  title,
  ...props
}: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const nextTheme =
    THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  const Icon = THEME_ICONS[theme];
  const actionLabel = `Tema ${THEME_LABELS[theme]}. Alterar para ${THEME_LABELS[nextTheme]}.`;

  return (
    <button
      {...props}
      type="button"
      className={[
        'fv-theme-toggle border-line-strong bg-surface text-ink shadow-e1 rounded-md',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={ariaLabel || actionLabel}
      title={title || actionLabel}
      onClick={() => setTheme(nextTheme)}
    >
      <AppIcon icon={Icon} />
    </button>
  );
}
