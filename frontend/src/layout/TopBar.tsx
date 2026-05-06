import type { ReactNode } from 'react';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const headerLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_HEADER.png`;

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  step?: ReactNode;
  leading?: ReactNode;
  showLogo?: boolean;
}

export function TopBar({ title, subtitle, actions, step, leading, showLogo = false }: TopBarProps) {
  return (
    <header className="topbar-react">
      {leading}
      {showLogo ? (
        <div className="topbar-brand">
          <img className="header-logo" src={headerLogoUrl} alt="Filtrovali" />
          {subtitle ? <div className="topbar-subtitle">{subtitle}</div> : null}
        </div>
      ) : (
        <div className="topbar-info">
          <div className="topbar-title">{title}</div>
          {subtitle ? <div className="topbar-subtitle">{subtitle}</div> : null}
        </div>
      )}
      {step ? <div className="topbar-step">{step}</div> : null}
      {actions ? <div className="topbar-actions-react">{actions}</div> : null}
    </header>
  );
}
