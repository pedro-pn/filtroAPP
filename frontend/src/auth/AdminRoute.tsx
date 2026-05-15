import { Navigate, Outlet } from 'react-router-dom';

import { useAuth } from './AuthContext';

export function AdminRoute() {
  const { user, token, isAuthenticated, isBootstrapping } = useAuth();

  if (isBootstrapping || (token && !user)) return null;
  if (!isAuthenticated || !user) return <Navigate to="/" replace />;
  if (user.accountType !== 'ADMIN') return <Navigate to="/hub" replace />;

  return <Outlet />;
}
