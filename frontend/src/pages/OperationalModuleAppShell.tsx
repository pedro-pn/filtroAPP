import { useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { accountPageStateFromPath } from '../auth/moduleNavigation';
import { AppShell } from '../layout/AppShell';
import { createNavigationModel, type NavigationSubItem } from '../layout/navigationModel';
import { hubModulesForUser } from './hubModules';

interface OperationalModuleAppShellProps {
  children: ReactNode;
  moduleId: 'equipamentos' | 'maintenance-production' | 'estoque' | 'romaneio' | 'qualidade' | 'epi';
  title: string;
  sectionLabel: string;
  subNavigation: readonly NavigationSubItem[];
  actions?: ReactNode;
}

export function OperationalModuleAppShell({
  children,
  moduleId,
  title,
  sectionLabel,
  subNavigation,
  actions
}: OperationalModuleAppShellProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useMemo(() => createNavigationModel({
    modules: hubModulesForUser(user),
    pathname: location.pathname,
    subNavigation: { parentId: moduleId, items: [...subNavigation] }
  }), [location.pathname, moduleId, subNavigation, user]);
  const initials = user?.name
    ? user.name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('')
    : 'U';
  const moduleHomePath = moduleId === 'maintenance-production' ? '/manutencao-producao' : `/${moduleId}`;

  return (
    <AppShell
      navigation={navigation}
      title={title}
      contentWidth="fluid"
      breadcrumb={[
        { label: 'Filtrovali', href: '/modulos' },
        { label: title, href: moduleHomePath },
        { label: sectionLabel }
      ]}
      topBarActions={actions}
      profile={user ? {
        name: user.name,
        description: user.email || user.username,
        initials,
        onOpen: () => navigate('/conta', { state: accountPageStateFromPath(location) })
      } : undefined}
      onLogout={async () => { await logout(); navigate('/', { replace: true }); }}
    >
      {children}
    </AppShell>
  );
}
