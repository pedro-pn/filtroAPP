import { useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { AppShell } from '../../layout/AppShell';
import { createNavigationModel } from '../../layout/navigationModel';
import { hubModulesForUser } from '../hubModules';

export function AdminModuleAppShell({ children, sectionLabel }: { children: ReactNode; sectionLabel: string }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useMemo(() => createNavigationModel({
    modules: hubModulesForUser(user),
    pathname: location.pathname,
    subNavigation: {
      parentId: 'admin',
      items: [
        { id: 'accounts', label: 'Contas', href: '/admin/accounts', active: location.pathname === '/admin/accounts' },
        { id: 'tokens', label: 'Tokens de API', shortLabel: 'Tokens', href: '/admin/tokens', active: location.pathname === '/admin/tokens' }
      ]
    }
  }), [location.pathname, user]);

  return <AppShell
    navigation={navigation}
    title="Administração"
    contentWidth="fluid"
    breadcrumb={[
      { label: 'Filtrovali', href: '/modulos' },
      { label: 'Administração', href: '/admin/accounts' },
      { label: sectionLabel }
    ]}
    profile={user ? {
      name: user.name,
      description: user.email || user.username,
      onOpen: () => navigate('/conta', { state: accountPageStateFromPath(location) })
    } : undefined}
    onLogout={async () => { await logout(); navigate('/', { replace: true }); }}
  >{children}</AppShell>;
}
