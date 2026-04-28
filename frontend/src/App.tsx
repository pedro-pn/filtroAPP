import { Navigate, Route, Routes } from 'react-router-dom';

import { PrivateRoute } from './auth/PrivateRoute';
import { RoleRoute } from './auth/RoleRoute';
import { AccountPage } from './pages/account/AccountPage';
import { ClientPage } from './pages/client/ClientPage';
import { HomePage } from './pages/collaborator/HomePage';
import { MyArchivedReportsPage } from './pages/collaborator/MyArchivedReportsPage';
import { MyReportsPage } from './pages/collaborator/MyReportsPage';
import { NewReportPage } from './pages/collaborator/NewReportPage';
import { CoordinatorPage } from './pages/coordinator/CoordinatorPage';
import { ReportDetailPage } from './pages/ReportDetailPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { GestorPage } from './pages/gestor/GestorPage';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<PrivateRoute />}>
        <Route path="/conta" element={<AccountPage />} />
      </Route>

      <Route element={<RoleRoute allowedRoles={['COLLABORATOR', 'MANAGER']} />}>
        <Route path="/relatorios/novo" element={<NewReportPage />} />
        <Route path="/relatorios/:id" element={<ReportDetailPage />} />
      </Route>

      <Route element={<RoleRoute allowedRoles={['COLLABORATOR']} />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/meus-relatorios" element={<MyReportsPage />} />
        <Route path="/meus-relatorios/arquivados" element={<MyArchivedReportsPage />} />
      </Route>

      <Route element={<RoleRoute allowedRoles={['MANAGER']} />}>
        <Route path="/gestor" element={<GestorPage />} />
        <Route path="/gestor/relatorio/:id" element={<ReportDetailPage />} />
      </Route>

      <Route element={<RoleRoute allowedRoles={['COORDINATOR']} />}>
        <Route path="/coordenador" element={<CoordinatorPage />} />
        <Route path="/coordenador/relatorio/:id" element={<ReportDetailPage />} />
      </Route>

      <Route element={<RoleRoute allowedRoles={['CLIENT']} />}>
        <Route path="/cliente" element={<ClientPage />} />
        <Route path="/cliente/relatorio/:id" element={<ReportDetailPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
