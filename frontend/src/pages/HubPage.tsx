import { useEffect, useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { roleHomePath } from '../auth/rolePath';
import { Shell } from '../layout/Shell';
import { TopBar } from '../layout/TopBar';
import { hubModulesForUser } from './hubModules';

export function HubPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const isClient = user?.accountType === 'CLIENT' || user?.role === 'CLIENT';
  const modules = useMemo(() => hubModulesForUser(user), [user]);
  const availableModules = useMemo(() => modules.filter(module => module.path && !module.disabled), [modules]);

  useEffect(() => {
    const [module] = availableModules;
    if (availableModules.length === 1 && module.path) {
      navigate(module.path, { replace: true });
    }
  }, [availableModules, navigate]);

  if (isClient) {
    return <Navigate to={roleHomePath('CLIENT')} replace />;
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
      <main className="page-scroll hub-page">
        <section className="hub-header">
          <div>
            <h1>Filtrovali App</h1>
            <p>Acesse os módulos liberados para sua conta.</p>
          </div>
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
                <span className="hub-module-badge">{module.badge}</span>
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
