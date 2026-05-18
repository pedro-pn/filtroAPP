import { Navigate, Route, Routes } from 'react-router-dom';

import { PrivateRoute } from './auth/PrivateRoute';
import { RoleRoute } from './auth/RoleRoute';
import { AccountPage } from './pages/account/AccountPage';
import { AdminAccountsPage } from './pages/admin/AdminAccountsPage';
import { ClientPage } from './pages/client/ClientPage';
import { HomePage } from './pages/collaborator/HomePage';
import { MyArchivedReportsPage } from './pages/collaborator/MyArchivedReportsPage';
import { MyReportsPage } from './pages/collaborator/MyReportsPage';
import { NewReportPage } from './pages/collaborator/NewReportPage';
import { OngoingServicesPage } from './pages/collaborator/OngoingServicesPage';
import { CoordinatorPage } from './pages/coordinator/CoordinatorPage';
import { HubPage } from './pages/HubPage';
import { ReportDetailPage } from './pages/ReportDetailPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { GestorPage } from './pages/gestor/GestorPage';
import { LoginPage } from './pages/LoginPage';
import { PublicSignaturePage } from './pages/PublicSignaturePage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { NewRomaneioPage } from './pages/romaneio/NewRomaneioPage';
import { RomaneioPage } from './pages/romaneio/RomaneioPage';
import { SignatureValidationPage } from './pages/SignatureValidationPage';
import { SurveyPage } from './pages/SurveyPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/pesquisa/:token" element={<SurveyPage />} />
      <Route path="/assinar/:token" element={<PublicSignaturePage />} />
      <Route path="/validar-assinatura/:validationCode" element={<SignatureValidationPage />} />

      <Route element={<PrivateRoute />}>
        <Route path="/" element={<HubPage />} />
        <Route path="/conta" element={<AccountPage />} />
      </Route>

      <Route element={<RoleRoute allowedRoles={['COLLABORATOR', 'MANAGER', 'COORDINATOR']} allowedModuleRoles={['rdo:collaborator', 'rdo:manager', 'rdo:coordinator']} />}>
        <Route path="/rdo/relatorio/novo" element={<NewReportPage />} />
        <Route path="/rdo/relatorios/novo" element={<NewReportPage />} />
        <Route path="/rdo/relatorios/:id" element={<ReportDetailPage />} />
        <Route path="/relatorio/novo" element={<NewReportPage />} />
        <Route path="/relatorios/novo" element={<NewReportPage />} />
        <Route path="/relatorios/:id" element={<ReportDetailPage />} />
      </Route>

      <Route element={<RoleRoute allowedRoles={['COLLABORATOR']} allowedModuleRoles={['rdo:collaborator']} />}>
        <Route path="/rdo/home" element={<HomePage />} />
        <Route path="/rdo/andamento" element={<OngoingServicesPage />} />
        <Route path="/rdo/meus-relatorios" element={<MyReportsPage />} />
        <Route path="/rdo/meus-relatorios/arquivados" element={<MyArchivedReportsPage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/andamento" element={<OngoingServicesPage />} />
        <Route path="/meus-relatorios" element={<MyReportsPage />} />
        <Route path="/meus-relatorios/arquivados" element={<MyArchivedReportsPage />} />
      </Route>

      <Route element={<RoleRoute allowedRoles={['MANAGER']} allowedModuleRoles={['rdo:manager']} />}>
        <Route path="/rdo/gestor" element={<GestorPage />} />
        <Route path="/rdo/gestor/relatorio/:id" element={<ReportDetailPage />} />
        <Route path="/gestor" element={<GestorPage />} />
        <Route path="/gestor/relatorio/:id" element={<ReportDetailPage />} />
      </Route>

      <Route element={<RoleRoute allowedAccountTypes={['ADMIN']} />}>
        <Route path="/admin/accounts" element={<AdminAccountsPage />} />
      </Route>

      <Route element={<RoleRoute allowedAccountTypes={['ADMIN', 'INTERNAL']} />}>
        <Route path="/romaneio" element={<RomaneioPage />} />
        <Route path="/romaneio/novo" element={<NewRomaneioPage />} />
      </Route>

      <Route element={<RoleRoute allowedRoles={['COORDINATOR']} allowedModuleRoles={['rdo:coordinator']} />}>
        <Route path="/rdo/coordenador" element={<CoordinatorPage />} />
        <Route path="/rdo/coordenador/relatorio/:id" element={<ReportDetailPage />} />
        <Route path="/coordenador" element={<CoordinatorPage />} />
        <Route path="/coordenador/relatorio/:id" element={<ReportDetailPage />} />
      </Route>

      <Route element={<RoleRoute allowedRoles={['CLIENT']} allowedModuleRoles={['rdo:client']} />}>
        <Route path="/rdo/cliente" element={<ClientPage />} />
        <Route path="/rdo/cliente/relatorio/:id" element={<ReportDetailPage />} />
        <Route path="/cliente" element={<ClientPage />} />
        <Route path="/cliente/relatorio/:id" element={<ReportDetailPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
