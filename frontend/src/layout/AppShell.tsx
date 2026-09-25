import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { BottomBar } from './BottomBar';
import { NavigationDrawer } from './NavigationDrawer';
import type { NavigationModel } from './navigationModel';
import { Sidebar, type NavigationProfile } from './Sidebar';
import { TopBar, type TopBarBreadcrumb } from './TopBar';
import './AppShell.css';

const SIDEBAR_COLLAPSED_KEY = 'fv-sidebar-collapsed';

function storedSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export interface AppShellProps {
  children: ReactNode;
  navigation: NavigationModel;
  title: string;
  breadcrumb?: readonly TopBarBreadcrumb[];
  search?: ReactNode;
  notifications?: ReactNode;
  profile?: NavigationProfile;
  utilityActions?: ReactNode;
  topBarActions?: ReactNode;
  onLogout?: () => void | Promise<void>;
  contentPadding?: 'default' | 'none';
  contentWidth?: 'contained' | 'fluid';
}

export function AppShell({
  children,
  navigation,
  title,
  breadcrumb,
  search,
  notifications,
  profile,
  utilityActions,
  topBarActions,
  onLogout,
  contentPadding = 'default',
  contentWidth = 'contained'
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storedSidebarCollapsed);
  const [sidebarHoverExpanded, setSidebarHoverExpanded] = useState(false);
  const effectiveSidebarCollapsed = sidebarCollapsed && !sidebarHoverExpanded;
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleSidebar = useCallback(() => {
    setSidebarHoverExpanded(false);
    setSidebarCollapsed(current => !current);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed)); } catch { /* Private browsing can block storage. */ }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const handleDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) closeDrawer();
    };
    desktop.addEventListener('change', handleDesktop);
    return () => desktop.removeEventListener('change', handleDesktop);
  }, [closeDrawer]);

  return (
    <div className={`fv-app-shell${effectiveSidebarCollapsed ? ' is-sidebar-collapsed' : ''}`} data-testid="fv-app-shell">
      <Sidebar
        navigation={navigation}
        profile={profile}
        utilityActions={utilityActions}
        onLogout={onLogout}
        className="fv-app-shell__sidebar"
        collapsed={effectiveSidebarCollapsed}
        pinnedCollapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        onMouseEnter={() => { if (sidebarCollapsed) setSidebarHoverExpanded(true); }}
        onMouseLeave={() => setSidebarHoverExpanded(false)}
      />

      <div className="fv-app-shell__main">
        <TopBar
          appearance="design-system"
          title={title}
          breadcrumb={breadcrumb}
          search={search}
          notifications={notifications}
          profile={profile}
          actions={topBarActions}
          menuOpen={drawerOpen}
          onOpenMenu={() => setDrawerOpen(true)}
        />

        <div
          className={`fv-app-shell__content fv-app-shell__content--${contentPadding}`}
        >
          <div
            className={`fv-app-shell__content-inner fv-app-shell__content-inner--${contentWidth}`}
          >
            {children}
          </div>
        </div>
      </div>

      <BottomBar
        appearance="design-system"
        navigation={navigation}
        onOpenMenu={() => setDrawerOpen(true)}
      />

      <NavigationDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        navigation={navigation}
        profile={profile}
        utilityActions={utilityActions}
        onLogout={onLogout}
      />
    </div>
  );
}
