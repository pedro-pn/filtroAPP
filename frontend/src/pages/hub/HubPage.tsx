import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import type { AuthUser } from '../../types/auth';

interface ModuleCard {
  id: string;
  label: string;
  description: string;
  path: string;
}

const ALL_MODULES: ModuleCard[] = [
  {
    id: 'RDO',
    label: 'Relatórios',
    description: 'Controle de projetos e relatórios diários de obra',
    path: '/gestor'
  },
  {
    id: 'ROMANEIO',
    label: 'Romaneio',
    description: 'Controle de movimentação de equipamentos',
    path: '/romaneio'
  },
  {
    id: 'EPI',
    label: 'EPI',
    description: 'Fichas de liberação de equipamentos de proteção',
    path: '/epi'
  }
];

function rdoPathForRole(role: string | undefined) {
  if (role === 'MANAGER') return '/gestor';
  if (role === 'COORDINATOR') return '/coordenador';
  return '/home';
}

function getAccessibleModules(user: AuthUser | null): ModuleCard[] {
  if (!user) return [];

  // After migration: use moduleRoles
  if (user.moduleRoles.length > 0) {
    const moduleIds = new Set(user.moduleRoles.map(mr => mr.module));
    return ALL_MODULES
      .filter(m => moduleIds.has(m.id as 'RDO' | 'ROMANEIO' | 'EPI'))
      .map(m => m.id === 'RDO' ? { ...m, path: rdoPathForRole(user.role) } : m);
  }

  // Fallback pre-migration: infer from legacy role
  if (['MANAGER', 'COORDINATOR', 'COLLABORATOR'].includes(user.role)) {
    return [{ ...ALL_MODULES[0], path: rdoPathForRole(user.role) }];
  }

  return [];
}

export function HubPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const accessibleModules = getAccessibleModules(user);

  // ADMIN always sees the hub even with a single module (needs access to /admin/accounts)
  const isAdmin = user?.accountType === 'ADMIN';
  const shouldRedirect = !isAdmin && accessibleModules.length === 1;

  useEffect(() => {
    if (!user) return;
    if (user.accountType === 'CLIENT') {
      navigate('/cliente', { replace: true });
      return;
    }
    if (shouldRedirect) {
      navigate(accessibleModules[0].path, { replace: true });
    }
  }, [user, shouldRedirect, accessibleModules, navigate]);

  if (!user) return null;
  if (user.accountType === 'CLIENT') return null;
  if (shouldRedirect) return null;

  return (
    <Shell>
      <TopBar
        title="Filtrovali"
        subtitle={user.name}
        showLogo
        actions={
          <>
            {isAdmin && (
              <button className="topbar-chip" type="button" onClick={() => navigate('/admin/accounts')}>
                Contas
              </button>
            )}
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta')}>
              Minha conta
            </button>
            <button className="topbar-chip" type="button" onClick={logout}>
              Sair
            </button>
          </>
        }
      />

      <div className="page-scroll">
        <section className="page-card">
          <div className="section-title">Módulos disponíveis</div>

          <div className="admin-stack" style={{ marginTop: 12 }}>
            {accessibleModules.map(mod => (
              <button
                key={mod.id}
                className="card admin-card"
                type="button"
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: 'var(--wh)' }}
                onClick={() => navigate(mod.path)}
              >
                <div className="admin-item-title">{mod.label}</div>
                <div className="admin-item-sub">{mod.description}</div>
              </button>
            ))}
          </div>

          {accessibleModules.length === 0 && (
            <p className="placeholder-copy">Nenhum módulo disponível para esta conta.</p>
          )}
        </section>
      </div>
    </Shell>
  );
}
