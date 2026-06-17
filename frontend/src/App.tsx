import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { modulePathForUser, rememberModuleAccess, preferredEntryPath } from './auth/moduleNavigation';
import { PrivateRoute } from './auth/PrivateRoute';
import { RoleRoute } from './auth/RoleRoute';
import { useAuth } from './auth/AuthContext';
import { AccountPage } from './pages/account/AccountPage';
import { AdminAccountsPage } from './pages/admin/AdminAccountsPage';
import { ClientPage } from './pages/client/ClientPage';
import { ConfirmEmailChangePage } from './pages/ConfirmEmailChangePage';
import { HomePage } from './pages/collaborator/HomePage';
import { MyArchivedReportsPage } from './pages/collaborator/MyArchivedReportsPage';
import { MyReportsPage } from './pages/collaborator/MyReportsPage';
import { NewReportPage } from './pages/collaborator/NewReportPage';
import { OngoingServicesPage } from './pages/collaborator/OngoingServicesPage';
import { CoordinatorPage } from './pages/coordinator/CoordinatorPage';
import { EpiPage } from './pages/epi/EpiPage';
import { EpiPublicSignaturePage } from './pages/epi/EpiPublicSignaturePage';
import { EquipamentosPage } from './pages/equipamentos/EquipamentosPage';
import { HubPage } from './pages/HubPage';
import { NotificationPreferencesPage } from './pages/NotificationPreferencesPage';
import { ReportDetailPage } from './pages/ReportDetailPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { GestorPage } from './pages/gestor/GestorPage';
import { LoginPage } from './pages/LoginPage';
import { PublicSignaturePage } from './pages/PublicSignaturePage';
import { PrivacyPage } from './pages/PrivacyPage';
import { PrivacyRightsPage } from './pages/PrivacyRightsPage';
import { PrivacyRequestsPage } from './pages/privacy/PrivacyRequestsPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { NewRomaneioPage } from './pages/romaneio/NewRomaneioPage';
import { RomaneioPage } from './pages/romaneio/RomaneioPage';
import { SignatureValidationPage } from './pages/SignatureValidationPage';
import { SurveyPage } from './pages/SurveyPage';

function ModuleAccessTracker() {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    rememberModuleAccess(user, location.pathname);
  }, [location.pathname, user]);

  return null;
}

function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={preferredEntryPath(user)} replace />;
}

function RdoModuleRedirect() {
  const { user } = useAuth();
  return <Navigate to={modulePathForUser(user, 'rdo') || preferredEntryPath(user)} replace />;
}

export default function App() {
  return (
    <>
      <ModuleAccessTracker />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/privacidade" element={<PrivacyPage />} />
        <Route path="/privacidade/direitos" element={<PrivacyRightsPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/confirmar-email" element={<ConfirmEmailChangePage />} />
        <Route path="/notificacoes/:token" element={<NotificationPreferencesPage />} />
        <Route path="/pesquisa/:token" element={<SurveyPage />} />
        <Route path="/assinar/:token" element={<PublicSignaturePage />} />
        <Route path="/epi/assinar/:token" element={<EpiPublicSignaturePage />} />
        <Route path="/validar-assinatura/:validationCode" element={<SignatureValidationPage />} />

        <Route element={<PrivateRoute />}>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/modulos" element={<HubPage />} />
          <Route path="/conta" element={<AccountPage />} />
        </Route>

        <Route element={<RoleRoute allowedRoles={['COLLABORATOR', 'MANAGER', 'COORDINATOR']} allowedModuleRoles={['rdo:collaborator', 'rdo:manager', 'rdo:coordinator']} />}>
          <Route path="/rdo" element={<RdoModuleRedirect />} />
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

        <Route element={<RoleRoute allowedModuleRoles={['privacy:admin']} />}>
          <Route path="/privacidade/solicitacoes" element={<PrivacyRequestsPage />} />
        </Route>

        <Route element={<RoleRoute allowedAccountTypes={['ADMIN', 'INTERNAL']} allowedModuleRoles={['romaneio:manager', 'romaneio:operator']} />}>
          <Route path="/romaneio" element={<RomaneioPage />} />
          <Route path="/romaneio/novo" element={<NewRomaneioPage />} />
        </Route>

        <Route element={<RoleRoute allowedAccountTypes={['ADMIN', 'INTERNAL']} allowedModuleRoles={['epi:technician', 'epi:collaborator']} />}>
          <Route path="/epi" element={<EpiPage />} />
        </Route>

        <Route element={<RoleRoute allowedAccountTypes={['ADMIN', 'INTERNAL']} allowedModuleRoles={['equipamentos:manager', 'equipamentos:viewer']} />}>
          <Route path="/equipamentos" element={<EquipamentosPage />} />
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
    </>
  );
}
