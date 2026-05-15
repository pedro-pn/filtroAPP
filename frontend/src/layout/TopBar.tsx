import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

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
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const canShowModulesButton = Boolean(
    user
    && user.accountType !== 'CLIENT'
    && user.role !== 'CLIENT'
    && location.pathname !== '/'
  );

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
      {canShowModulesButton || actions ? (
        <div className="topbar-actions-react">
          {canShowModulesButton ? (
            <button className="topbar-chip" type="button" onClick={() => navigate('/')}>
              Módulos
            </button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}
