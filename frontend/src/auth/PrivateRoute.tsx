import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from './AuthContext';
import { needsClientPrivacyConsent } from './privacyConsent';
import { ClientPrivacyConsentPage } from '../pages/client/ClientPrivacyConsentPage';

export function PrivateRoute() {
  const { isAuthenticated, isBootstrapping, token, user } = useAuth();
  const location = useLocation();

  if (isBootstrapping || (token && !user)) return null;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (needsClientPrivacyConsent(user)) return <ClientPrivacyConsentPage />;
  return <Outlet />;
}
