import { useEffect, useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { roleHomePath } from '../auth/rolePath';
import { Shell } from '../layout/Shell';
import { TopBar } from '../layout/TopBar';
import { hubModulesForUser } from './hubModules';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const logoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_LOGIN.png`;

export function HubPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const isClient = user?.accountType === 'CLIENT' || user?.role === 'CLIENT';
  const isAdmin = user?.accountType === 'ADMIN';
  const modules = useMemo(() => hubModulesForUser(user), [user]);
  const availableModules = useMemo(() => modules.filter(module => module.path && !module.disabled), [modules]);
  const shouldRedirect = !isAdmin && availableModules.length === 1;
  const firstName = user?.name?.split(' ')[0] || 'Usuario';

  useEffect(() => {
    const [module] = availableModules;
    if (shouldRedirect && module.path) {
      navigate(module.path, { replace: true });
    }
  }, [availableModules, navigate, shouldRedirect]);

  if (isClient) {
    return <Navigate to={roleHomePath('CLIENT')} replace />;
  }

  if (shouldRedirect) {
    return null;
  }

  return (
    <Shell>
      <TopBar
        title="Filtrovali App"
        subtitle={user?.name}
        showLogo
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta')}>
              Conta
            </button>
            <button
              className="topbar-chip"
              type="button"
              onClick={async () => { await logout(); navigate('/login', { replace: true }); }}
            >
              Sair
            </button>
          </>
        }
      />
      <main className="hub-page">
        <section className="hub-logo-block" aria-label="Filtrovali App">
          <img className="hub-logo" src={logoUrl} alt="Filtrovali" />
          <p className="hub-greeting">Olá, {firstName}</p>
        </section>

        <section className="hub-module-grid" aria-label="Módulos disponíveis">
          {modules.map(module => {
            const path = module.path;
            return (
              <button
                className={`hub-module-card${module.disabled ? ' is-disabled' : ''}`}
                disabled={module.disabled}
                key={module.id}
                type="button"
                onClick={path ? () => navigate(path) : undefined}
              >
                <span className="hub-module-title">{module.title}</span>
                <span className="hub-module-copy">{module.copy}</span>
              </button>
            );
          })}
        </section>
      </main>
    </Shell>
  );
}
