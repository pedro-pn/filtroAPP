import type { ReactNode } from 'react';

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  step?: ReactNode;
  leading?: ReactNode;
}

export function TopBar({ title, subtitle, actions, step, leading }: TopBarProps) {
  return (
    <header className="topbar-react">
      {leading}
      <div className="topbar-info">
        <div className="topbar-title">{title}</div>
        {subtitle ? <div className="topbar-subtitle">{subtitle}</div> : null}
      </div>
      {step ? <div className="topbar-step">{step}</div> : null}
      {actions ? <div className="topbar-actions-react">{actions}</div> : null}
    </header>
  );
}
