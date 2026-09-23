import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';

import { modulePathForUser, rememberModuleAccess, preferredEntryPath } from './auth/moduleNavigation';
import { PrivateRoute } from './auth/PrivateRoute';
import { RoleRoute } from './auth/RoleRoute';
import { useAuth } from './auth/AuthContext';
import { usePageScrollRestoration } from './hooks/usePageScrollRestoration';
import { moduleRouteElements } from './modules/moduleRoutes';
import { moduleRouteAccess, moduleRoutePath } from './modules/registry';

const AccountPage = lazy(() => import('./pages/account/AccountPage').then(module => ({ default: module.AccountPage })));
const ClientPage = lazy(() => import('./pages/client/ClientPage').then(module => ({ default: module.ClientPage })));
const ConfirmEmailChangePage = lazy(() => import('./pages/ConfirmEmailChangePage').then(module => ({ default: module.ConfirmEmailChangePage })));
const HomePage = lazy(() => import('./pages/collaborator/HomePage').then(module => ({ default: module.HomePage })));
const MyArchivedReportsPage = lazy(() => import('./pages/collaborator/MyArchivedReportsPage').then(module => ({ default: module.MyArchivedReportsPage })));
const MyReportsPage = lazy(() => import('./pages/collaborator/MyReportsPage').then(module => ({ default: module.MyReportsPage })));
const NewReportPage = lazy(() => import('./pages/collaborator/NewReportPage').then(module => ({ default: module.NewReportPage })));
const OngoingServicesPage = lazy(() => import('./pages/collaborator/OngoingServicesPage').then(module => ({ default: module.OngoingServicesPage })));
const CoordinatorPage = lazy(() => import('./pages/coordinator/CoordinatorPage').then(module => ({ default: module.CoordinatorPage })));
const EpiPublicSignaturePage = lazy(() => import('./pages/epi/EpiPublicSignaturePage').then(module => ({ default: module.EpiPublicSignaturePage })));
const HubPage = lazy(() => import('./pages/HubPage').then(module => ({ default: module.HubPage })));
const NotificationPreferencesPage = lazy(() => import('./pages/NotificationPreferencesPage').then(module => ({ default: module.NotificationPreferencesPage })));
const OperationsPage = lazy(() => import('./pages/OperationsPage').then(module => ({ default: module.OperationsPage })));
const ReportDetailPage = lazy(() => import('./pages/ReportDetailPage').then(module => ({ default: module.ReportDetailPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then(module => ({ default: module.ForgotPasswordPage })));
const GestorPage = lazy(() => import('./pages/gestor/GestorPage').then(module => ({ default: module.GestorPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })));
const PublicSignaturePage = lazy(() => import('./pages/PublicSignaturePage').then(module => ({ default: module.PublicSignaturePage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then(module => ({ default: module.PrivacyPage })));
const PrivacyRightsPage = lazy(() => import('./pages/PrivacyRightsPage').then(module => ({ default: module.PrivacyRightsPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then(module => ({ default: module.ResetPasswordPage })));
const SignatureValidationPage = lazy(() => import('./pages/SignatureValidationPage').then(module => ({ default: module.SignatureValidationPage })));
const SurveyPage = lazy(() => import('./pages/SurveyPage').then(module => ({ default: module.SurveyPage })));
const AssinaturasPublicSignPage = lazy(() => import('./pages/assinaturas/AssinaturasPublicSignPage').then(module => ({ default: module.AssinaturasPublicSignPage })));
const MaintenanceProductionPage = lazy(() => import('./pages/MaintenanceProductionPage').then(module => ({ default: module.MaintenanceProductionPage })));

const RDO_REPORT_WRITE_ACCESS = moduleRouteAccess('rdo', 'reportWrite');
const RDO_COLLABORATOR_ACCESS = moduleRouteAccess('rdo', 'collaborator');
const RDO_MANAGER_ACCESS = moduleRouteAccess('rdo', 'manager');
const RDO_COORDINATOR_ACCESS = moduleRouteAccess('rdo', 'coordinator');
const RDO_CLIENT_ACCESS = moduleRouteAccess('rdo', 'client');
const MAINTENANCE_PRODUCTION_ACCESS = moduleRouteAccess(
  'maintenance-production'
);

function ModuleAccessTracker() {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    rememberModuleAccess(user, location.pathname);
  }, [location.pathname, user]);

  return null;
}

function PageScrollRestorationTracker() {
  const { user } = useAuth();
  const location = useLocation();
  const identity = user?.id || user?.username || 'anonymous';

  usePageScrollRestoration({ location, identity });

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
      <PageScrollRestorationTracker />
      <Suspense fallback={<div className="page-loading" role="status">Carregando...</div>}>
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
        <Route path="/assinaturas/assinar" element={<AssinaturasPublicSignPage />} />
        <Route path="/validar-assinatura/:validationCode" element={<SignatureValidationPage />} />
        <Route path="/validar-documento/:validationCode" element={<SignatureValidationPage source="standalone" />} />

        <Route element={<PrivateRoute />}>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/modulos" element={<HubPage />} />
          <Route path="/conta" element={<AccountPage />} />
        </Route>

        <Route element={<RoleRoute allowedAccountTypes={['ADMIN']} />}>
          <Route path="/operacoes" element={<OperationsPage />} />
        </Route>

        <Route element={<RoleRoute allowedAccountTypes={['ADMIN', 'INTERNAL']} />}>
          <Route path="/rdo/relatorio/novo" element={<NewReportPage />} />
          <Route path="/rdo/relatorios/novo" element={<NewReportPage />} />
          <Route path="/rdo/relatorios-operacionais" element={<Navigate to="/manutencao-producao" replace />} />
        </Route>

        <Route element={<RoleRoute {...MAINTENANCE_PRODUCTION_ACCESS} />}>
          <Route
            path={moduleRoutePath('maintenance-production', 'index')}
            element={<MaintenanceProductionPage />}
          />
          <Route
            path={moduleRoutePath('maintenance-production', 'newReport')}
            element={<NewReportPage />}
          />
        </Route>

        <Route element={<RoleRoute {...RDO_REPORT_WRITE_ACCESS} />}>
          <Route path={moduleRoutePath('rdo', 'root')} element={<RdoModuleRedirect />} />
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
          <Route
            path={moduleRoutePath('rdo', 'managerReportDetail', {
              legacy: true
            })}
            element={<ReportDetailPage />}
          />
        </Route>

        {moduleRouteElements}

        <Route element={<RoleRoute {...RDO_COORDINATOR_ACCESS} />}>
          <Route path={moduleRoutePath('rdo', 'coordinatorHome')} element={<CoordinatorPage />} />
          <Route path={moduleRoutePath('rdo', 'coordinatorReportDetail')} element={<ReportDetailPage />} />
          <Route path={moduleRoutePath('rdo', 'coordinatorHome', { legacy: true })} element={<CoordinatorPage />} />
          <Route
            path={moduleRoutePath('rdo', 'coordinatorReportDetail', {
              legacy: true
            })}
            element={<ReportDetailPage />}
          />
        </Route>

        <Route element={<RoleRoute {...RDO_CLIENT_ACCESS} />}>
          <Route path={moduleRoutePath('rdo', 'clientHome')} element={<ClientPage />} />
          <Route path={moduleRoutePath('rdo', 'clientReportDetail')} element={<ReportDetailPage />} />
          <Route path={moduleRoutePath('rdo', 'clientHome', { legacy: true })} element={<ClientPage />} />
          <Route
            path={moduleRoutePath('rdo', 'clientReportDetail', {
              legacy: true
            })}
            element={<ReportDetailPage />}
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}
