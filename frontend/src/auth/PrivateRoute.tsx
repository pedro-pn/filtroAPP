import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from './AuthContext';

export function PrivateRoute() {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const location = useLocation();

  if (isBootstrapping) return null;
  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }
  return <Outlet />;
}
