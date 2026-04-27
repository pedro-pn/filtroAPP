import { Navigate, Outlet } from 'react-router-dom';

import { useAuth } from './AuthContext';
import { roleHomePath } from './rolePath';
import type { UserRole } from '../types/auth';

interface RoleRouteProps {
  allowedRoles: UserRole[];
}

export function RoleRoute({ allowedRoles }: RoleRouteProps) {
  const { user, isAuthenticated, isBootstrapping } = useAuth();

  if (isBootstrapping) return null;
  if (!isAuthenticated || !user) {
    return <Navigate to="/" replace />;
  }
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={roleHomePath(user.role)} replace />;
  }
  return <Outlet />;
}
