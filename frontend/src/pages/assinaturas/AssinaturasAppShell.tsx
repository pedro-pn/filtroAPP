import { useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { AppShell } from '../../layout/AppShell';
import { createNavigationModel } from '../../layout/navigationModel';
import { hubModulesForUser } from '../hubModules';

export function AssinaturasAppShell({ children, archived, documentTitle, actions }: {
  children: ReactNode;
  archived: boolean;
  documentTitle?: string;
  actions?: ReactNode;
}) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useMemo(() => {
    function listHref(showArchived: boolean) {
      const params = new URLSearchParams(location.search);
      params.delete('doc');
      params.delete('page');
      if (showArchived) params.set('tab', 'archived'); else params.delete('tab');
      const query = params.toString();
      return `/assinaturas${query ? `?${query}` : ''}`;
    }
    return createNavigationModel({
      modules: hubModulesForUser(user),
      pathname: location.pathname,
      subNavigation: {
        parentId: 'assinaturas',
        items: [
          { id: 'active', label: 'Ativos', href: listHref(false), active: !archived },
          { id: 'archived', label: 'Arquivados', href: listHref(true), active: archived }
        ]
      }
    });
  }, [archived, location.pathname, location.search, user]);

  return (
    <AppShell
      navigation={navigation}
      title="Assinaturas"
      contentWidth="fluid"
      breadcrumb={[
        { label: 'Filtrovali', href: '/modulos' },
        { label: 'Assinaturas', href: '/assinaturas' },
        { label: documentTitle || (archived ? 'Arquivados' : 'Ativos') }
      ]}
      topBarActions={actions}
      profile={user ? {
        name: user.name,
        description: user.email || user.username,
        initials: user.name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join(''),
        onOpen: () => navigate('/conta', { state: accountPageStateFromPath(location) })
      } : undefined}
      onLogout={async () => { await logout(); navigate('/', { replace: true }); }}
    >
      {children}
    </AppShell>
  );
}
