import { useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { AppShell } from '../../layout/AppShell';
import { createNavigationModel } from '../../layout/navigationModel';
import { hubModulesForUser } from '../hubModules';
import { ACOMPANHAMENTO_SECTIONS, sectionSearchParams, type AcompanhamentoSection } from './navigation';

export function AcompanhamentoAppShell({ children, section, isManager, pendencyTotal, actions }: {
  children: ReactNode;
  section: AcompanhamentoSection;
  isManager: boolean;
  pendencyTotal: number;
  actions?: ReactNode;
}) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useMemo(() => createNavigationModel({
    modules: hubModulesForUser(user),
    pathname: location.pathname,
    subNavigation: {
      parentId: 'acompanhamento',
      items: ACOMPANHAMENTO_SECTIONS.filter(item => item.id !== 'custo' || isManager).map(item => {
        const query = sectionSearchParams(new URLSearchParams(location.search), item.id).toString();
        return { id: item.id, label: item.label, href: `/acompanhamento${query ? `?${query}` : ''}`,
          active: item.id === section,
          badge: item.id === 'custo' && pendencyTotal > 0 ? (pendencyTotal > 99 ? '99+' : pendencyTotal) : undefined };
      })
    }
  }), [isManager, location.pathname, location.search, pendencyTotal, section, user]);

  return (
    <AppShell navigation={navigation} title="Acompanhamento" contentWidth="fluid"
      breadcrumb={[
        { label: 'Filtrovali', href: '/modulos' },
        { label: 'Acompanhamento', href: '/acompanhamento' },
        { label: ACOMPANHAMENTO_SECTIONS.find(item => item.id === section)?.label ?? 'Dashboard' }
      ]}
      topBarActions={actions}
      profile={user ? {
        name: user.name, description: user.email || user.username,
        initials: user.name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join(''),
        onOpen: () => navigate('/conta', { state: accountPageStateFromPath(location) })
      } : undefined}
      onLogout={async () => { await logout(); navigate('/', { replace: true }); }}
    >
      {children}
    </AppShell>
  );
}
