import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { BrandLogo } from '../components/brand/BrandLogo';
import { AppIcon } from '../components/icons/AppIcon';
import { IconButton } from '../components/ui/ds';
import { ThemeToggle } from '../theme/ThemeToggle';
import { NAVIGATION_CHROME_ICONS } from './navigationIcons';
import type { NavigationProfile } from './Sidebar';

export interface TopBarBreadcrumb {
  label: string;
  href?: string;
}

interface LegacyTopBarProps {
  appearance?: 'legacy';
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  step?: ReactNode;
  leading?: ReactNode;
  showLogo?: boolean;
}

interface DesignSystemTopBarProps {
  appearance: 'design-system';
  title: string;
  breadcrumb?: readonly TopBarBreadcrumb[];
  onOpenMenu?: () => void;
  menuOpen?: boolean;
  search?: ReactNode;
  notifications?: ReactNode;
  profile?: NavigationProfile;
  actions?: ReactNode;
  showThemeToggle?: boolean;
}

export type TopBarProps = LegacyTopBarProps | DesignSystemTopBarProps;

function LegacyTopBar({
  title,
  subtitle,
  actions,
  step,
  leading,
  showLogo = true
}: LegacyTopBarProps) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(
    /\/$/,
    ''
  );
  const headerLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_HEADER.png`;
  const canShowModulesButton = Boolean(
    user &&
    user.accountType !== 'CLIENT' &&
    user.role !== 'CLIENT' &&
    location.pathname !== '/modulos'
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
            <button
              className="topbar-chip"
              type="button"
              onClick={() => navigate('/modulos')}
            >
              Módulos
            </button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}

function DesignSystemTopBar({
  title,
  breadcrumb,
  onOpenMenu,
  menuOpen = false,
  search,
  notifications,
  profile,
  actions,
  showThemeToggle = true
}: DesignSystemTopBarProps) {
  return (
    <header className="fv-ds fv-topbar">
      <div className="fv-topbar__leading">
        {onOpenMenu ? (
          <IconButton
            className="fv-topbar__menu"
            icon={NAVIGATION_CHROME_ICONS.menu}
            label="Abrir menu"
            aria-expanded={menuOpen}
            onClick={onOpenMenu}
          />
        ) : null}
        <BrandLogo variant="adaptive" className="fv-topbar__brand" />
        <div className="fv-topbar__context">
          {breadcrumb?.length ? (
            <nav className="fv-topbar__breadcrumb" aria-label="Breadcrumb">
              <ol>
                {breadcrumb.map((item, index) => (
                  <li key={`${item.label}-${index}`}>
                    {item.href ? (
                      <Link to={item.href}>{item.label}</Link>
                    ) : (
                      item.label
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <strong className="fv-topbar__title">{title}</strong>
        </div>
      </div>

      {search ? <div className="fv-topbar__search">{search}</div> : null}

      <div className="fv-topbar__actions">
        {actions ? (
          <div className="fv-topbar__context-actions">{actions}</div>
        ) : null}
        {notifications}
        {showThemeToggle ? <ThemeToggle /> : null}
        {profile ? (
          <button
            className="fv-topbar-profile"
            type="button"
            onClick={profile.onOpen}
            disabled={!profile.onOpen}
            aria-label={
              profile.onOpen ? `Abrir conta de ${profile.name}` : undefined
            }
          >
            <span className="fv-topbar-profile__avatar" aria-hidden="true">
              {profile.initials || profile.name.charAt(0).toUpperCase() || 'FV'}
            </span>
            <span className="fv-topbar-profile__copy">
              <strong>{profile.name}</strong>
              {profile.description ? <span>{profile.description}</span> : null}
            </span>
            <AppIcon icon={NAVIGATION_CHROME_ICONS.account} size="sm" />
          </button>
        ) : null}
      </div>
    </header>
  );
}

export function TopBar(props: TopBarProps) {
  return props.appearance === 'design-system' ? (
    <DesignSystemTopBar {...props} />
  ) : (
    <LegacyTopBar {...props} />
  );
}
