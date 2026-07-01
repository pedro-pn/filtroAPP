import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { modulePathForUser, rememberModuleAccess, preferredEntryPath } from './auth/moduleNavigation';
import { PrivateRoute } from './auth/PrivateRoute';
import { RoleRoute } from './auth/RoleRoute';
import { useAuth } from './auth/AuthContext';
import { AccountPage } from './pages/account/AccountPage';
import { ClientPage } from './pages/client/ClientPage';
import { ConfirmEmailChangePage } from './pages/ConfirmEmailChangePage';
import { HomePage } from './pages/collaborator/HomePage';
import { MyArchivedReportsPage } from './pages/collaborator/MyArchivedReportsPage';
import { MyReportsPage } from './pages/collaborator/MyReportsPage';
import { NewReportPage } from './pages/collaborator/NewReportPage';
import { OngoingServicesPage } from './pages/collaborator/OngoingServicesPage';
import { CoordinatorPage } from './pages/coordinator/CoordinatorPage';
import { EpiPublicSignaturePage } from './pages/epi/EpiPublicSignaturePage';
import { HubPage } from './pages/HubPage';
import { moduleRouteElements } from './modules/moduleRoutes';
import { moduleRouteAccess, moduleRoutePath } from './modules/registry';
import { NotificationPreferencesPage } from './pages/NotificationPreferencesPage';
import { ReportDetailPage } from './pages/ReportDetailPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { GestorPage } from './pages/gestor/GestorPage';
import { LoginPage } from './pages/LoginPage';
import { PublicSignaturePage } from './pages/PublicSignaturePage';
import { PrivacyPage } from './pages/PrivacyPage';
import { PrivacyRightsPage } from './pages/PrivacyRightsPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SignatureValidationPage } from './pages/SignatureValidationPage';
import { SurveyPage } from './pages/SurveyPage';

const RDO_REPORT_WRITE_ACCESS = moduleRouteAccess('rdo', 'reportWrite');
const RDO_COLLABORATOR_ACCESS = moduleRouteAccess('rdo', 'collaborator');
const RDO_MANAGER_ACCESS = moduleRouteAccess('rdo', 'manager');
const RDO_COORDINATOR_ACCESS = moduleRouteAccess('rdo', 'coordinator');
const RDO_CLIENT_ACCESS = moduleRouteAccess('rdo', 'client');

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

        <Route element={<RoleRoute {...RDO_REPORT_WRITE_ACCESS} />}>
          <Route path={moduleRoutePath('rdo', 'root')} element={<RdoModuleRedirect />} />
          <Route path={moduleRoutePath('rdo', 'newReport')} element={<NewReportPage />} />
          <Route path={moduleRoutePath('rdo', 'newReportsAlias')} element={<NewReportPage />} />
          <Route path={moduleRoutePath('rdo', 'reportDetail')} element={<ReportDetailPage />} />
          <Route path={moduleRoutePath('rdo', 'newReport', { legacy: true })} element={<NewReportPage />} />
          <Route path={moduleRoutePath('rdo', 'newReportsAlias', { legacy: true })} element={<NewReportPage />} />
          <Route path={moduleRoutePath('rdo', 'reportDetail', { legacy: true })} element={<ReportDetailPage />} />
        </Route>

        <Route element={<RoleRoute {...RDO_COLLABORATOR_ACCESS} />}>
          <Route path={moduleRoutePath('rdo', 'collaboratorHome')} element={<HomePage />} />
          <Route path={moduleRoutePath('rdo', 'ongoingServices')} element={<OngoingServicesPage />} />
          <Route path={moduleRoutePath('rdo', 'myReports')} element={<MyReportsPage />} />
          <Route path={moduleRoutePath('rdo', 'myArchivedReports')} element={<MyArchivedReportsPage />} />
          <Route path={moduleRoutePath('rdo', 'collaboratorHome', { legacy: true })} element={<HomePage />} />
          <Route path={moduleRoutePath('rdo', 'ongoingServices', { legacy: true })} element={<OngoingServicesPage />} />
          <Route path={moduleRoutePath('rdo', 'myReports', { legacy: true })} element={<MyReportsPage />} />
          <Route path={moduleRoutePath('rdo', 'myArchivedReports', { legacy: true })} element={<MyArchivedReportsPage />} />
        </Route>

        <Route element={<RoleRoute {...RDO_MANAGER_ACCESS} />}>
          <Route path={moduleRoutePath('rdo', 'managerHome')} element={<GestorPage />} />
          <Route path={moduleRoutePath('rdo', 'managerReportDetail')} element={<ReportDetailPage />} />
          <Route path={moduleRoutePath('rdo', 'managerHome', { legacy: true })} element={<GestorPage />} />
          <Route path={moduleRoutePath('rdo', 'managerReportDetail', { legacy: true })} element={<ReportDetailPage />} />
        </Route>

        {moduleRouteElements}

        <Route element={<RoleRoute {...RDO_COORDINATOR_ACCESS} />}>
          <Route path={moduleRoutePath('rdo', 'coordinatorHome')} element={<CoordinatorPage />} />
          <Route path={moduleRoutePath('rdo', 'coordinatorReportDetail')} element={<ReportDetailPage />} />
          <Route path={moduleRoutePath('rdo', 'coordinatorHome', { legacy: true })} element={<CoordinatorPage />} />
          <Route path={moduleRoutePath('rdo', 'coordinatorReportDetail', { legacy: true })} element={<ReportDetailPage />} />
        </Route>

        <Route element={<RoleRoute {...RDO_CLIENT_ACCESS} />}>
          <Route path={moduleRoutePath('rdo', 'clientHome')} element={<ClientPage />} />
          <Route path={moduleRoutePath('rdo', 'clientReportDetail')} element={<ReportDetailPage />} />
          <Route path={moduleRoutePath('rdo', 'clientHome', { legacy: true })} element={<ClientPage />} />
          <Route path={moduleRoutePath('rdo', 'clientReportDetail', { legacy: true })} element={<ReportDetailPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
