import { Navigate, Outlet } from 'react-router';

import { useAuth } from './AuthContext';
import { preferredEntryPath } from './moduleNavigation';
import { needsClientPrivacyConsent } from './privacyConsent';
import { isRouteAllowed } from './routeAccess';
import type { RouteAccessOptions } from './routeAccess';
import { ClientPrivacyConsentPage } from '../pages/client/ClientPrivacyConsentPage';
import { BrandLoading } from '../components/brand/BrandLoading';

type RoleRouteProps = RouteAccessOptions;

export function RoleRoute({ allowedAccountTypes = [], allowedRoles = [], allowedModuleRoles = [], accessMode = 'all' }: RoleRouteProps) {
  const { user, token, isAuthenticated, isBootstrapping } = useAuth();

  if (isBootstrapping || (token && !user)) return <BrandLoading fullscreen />;
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }
  if (needsClientPrivacyConsent(user)) return <ClientPrivacyConsentPage />;
  if (!isRouteAllowed(user, { allowedAccountTypes, allowedRoles, allowedModuleRoles, accessMode })) {
    return <Navigate to={preferredEntryPath(user)} replace />;
  }
  return <Outlet />;
}
