import { Navigate, Outlet } from 'react-router-dom';

import { useAuth } from './AuthContext';
import { preferredEntryPath } from './moduleNavigation';
import { isRouteAllowed } from './routeAccess';
import type { RouteAccessOptions } from './routeAccess';

type RoleRouteProps = RouteAccessOptions;

export function RoleRoute({ allowedAccountTypes = [], allowedRoles = [], allowedModuleRoles = [] }: RoleRouteProps) {
  const { user, token, isAuthenticated, isBootstrapping } = useAuth();

  if (isBootstrapping || (token && !user)) return null;
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }
  if (!isRouteAllowed(user, { allowedAccountTypes, allowedRoles, allowedModuleRoles })) {
    return <Navigate to={preferredEntryPath(user)} replace />;
  }
  return <Outlet />;
}
