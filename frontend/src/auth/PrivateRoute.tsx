import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from './AuthContext';
import { needsClientPrivacyConsent } from './privacyConsent';
import { ClientPrivacyConsentPage } from '../pages/client/ClientPrivacyConsentPage';
import { BrandLoading } from '../components/brand/BrandLoading';

export function PrivateRoute() {
  const { isAuthenticated, isBootstrapping, token, user } = useAuth();
  const location = useLocation();

  if (isBootstrapping || (token && !user)) return <BrandLoading fullscreen />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (needsClientPrivacyConsent(user)) return <ClientPrivacyConsentPage />;
  return <Outlet />;
}
