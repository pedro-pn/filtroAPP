import { useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { AppShell } from '../../layout/AppShell';
import { ProjectDatabookHost } from '../../components/projects/ProjectDatabookButton';
import {
  createNavigationModel,
  type NavigationSubItem
} from '../../layout/navigationModel';
import {
  planningSectionHomeParams,
  type EfetivoPlanningSection
} from '../../utils/planningNavigation';
import { hubModulesForUser } from '../hubModules';

export interface EfetivoSectionDefinition {
  id: EfetivoPlanningSection;
  label: string;
  description: string;
}

interface EfetivoAppShellProps {
  children: ReactNode;
  currentSection: EfetivoPlanningSection;
  sections: readonly EfetivoSectionDefinition[];
}

export function EfetivoAppShell({
  children,
  currentSection,
  sections
}: EfetivoAppShellProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const modules = useMemo(() => hubModulesForUser(user), [user]);
  const subNavigation = useMemo<NavigationSubItem[]>(
    () =>
      sections.map(section => {
        const params = planningSectionHomeParams(
          new URLSearchParams(location.search),
          section.id
        );
        const query = params.toString();

        return {
          id: section.id,
          label: section.label,
          href: `${location.pathname}${query ? `?${query}` : ''}`,
          onSelect: () => {
            const latest = planningSectionHomeParams(new URLSearchParams(window.location.search), section.id);
            navigate(`${location.pathname}?${latest.toString()}`);
          },
          active: section.id === currentSection
        };
      }),
    [currentSection, location.pathname, location.search, navigate, sections]
  );
  const navigation = useMemo(
    () =>
      createNavigationModel({
        modules,
        pathname: location.pathname,
        subNavigation: { parentId: 'efetivo', items: subNavigation }
      }),
    [location.pathname, modules, subNavigation]
  );
  const initials = user?.name
    ? user.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join('')
    : 'U';

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  return (
    <AppShell
      navigation={navigation}
      title="Efetivo Operacional"
      breadcrumb={[
        { label: 'Filtrovali', href: '/modulos' },
        { label: 'Efetivo', href: '/efetivo' },
        { label: sections.find(item => item.id === currentSection)?.label || 'Visão geral' }
      ]}
      contentWidth="fluid"
      profile={
        user
          ? {
              name: user.name,
              description: user.email || user.username,
              initials,
              onOpen: () =>
                navigate('/conta', {
                  state: accountPageStateFromPath(location)
                })
            }
          : undefined
      }
      onLogout={handleLogout}
    >
      {children}
      <ProjectDatabookHost />
    </AppShell>
  );
}
