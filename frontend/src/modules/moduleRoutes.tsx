/* eslint-disable react-refresh/only-export-components -- route-level lazy components intentionally share this route registry */
import { lazy } from 'react';
import { Route } from 'react-router';

import { RoleRoute } from '../auth/RoleRoute';
import { moduleRouteAccess, moduleRoutePath } from './registry';
// module:scaffold import

const AcompanhamentoPage = lazy(() => import('../pages/acompanhamento/AcompanhamentoPage').then(module => ({ default: module.AcompanhamentoPage })));
const AdminAccountsPage = lazy(() => import('../pages/admin/AdminAccountsPage').then(module => ({ default: module.AdminAccountsPage })));
const AdminTokensPage = lazy(() => import('../pages/admin/AdminTokensPage').then(module => ({ default: module.AdminTokensPage })));
const EpiPage = lazy(() => import('../pages/epi/EpiPage').then(module => ({ default: module.EpiPage })));
const EquipamentosPage = lazy(() => import('../pages/equipamentos/EquipamentosPage').then(module => ({ default: module.EquipamentosPage })));
const EstoquePage = lazy(() => import('../pages/estoque/EstoquePage').then(module => ({ default: module.EstoquePage })));
const PrivacyRequestsPage = lazy(() => import('../pages/privacy/PrivacyRequestsPage').then(module => ({ default: module.PrivacyRequestsPage })));
const QualidadePage = lazy(() => import('../pages/qualidade/QualidadePage').then(module => ({ default: module.QualidadePage })));
const NewRomaneioPage = lazy(() => import('../pages/romaneio/NewRomaneioPage').then(module => ({ default: module.NewRomaneioPage })));
const RomaneioPage = lazy(() => import('../pages/romaneio/RomaneioPage').then(module => ({ default: module.RomaneioPage })));
const EfetivoPage = lazy(() => import('../pages/efetivo/EfetivoPage').then(module => ({ default: module.EfetivoPage })));
const AssinaturasPage = lazy(() => import('../pages/assinaturas/AssinaturasPage').then(module => ({ default: module.AssinaturasPage })));

const ADMIN_ACCOUNTS_ACCESS = moduleRouteAccess('admin', 'accounts');
const PRIVACY_ACCESS = moduleRouteAccess('privacy');
const ROMANEIO_ACCESS = moduleRouteAccess('romaneio');
const EPI_ACCESS = moduleRouteAccess('epi');
const EQUIPAMENTOS_ACCESS = moduleRouteAccess('equipamentos');
const ESTOQUE_ACCESS = moduleRouteAccess('estoque');
const QUALIDADE_ACCESS = moduleRouteAccess('qualidade');
const ACOMPANHAMENTO_ACCESS = moduleRouteAccess('acompanhamento');
const EFETIVO_ACCESS = moduleRouteAccess('efetivo');
const ASSINATURAS_ACCESS = moduleRouteAccess('assinaturas');
// module:scaffold access

export const moduleRouteElements = (
  <>
    <Route element={<RoleRoute {...ADMIN_ACCOUNTS_ACCESS} />}>
      <Route path={moduleRoutePath('admin', 'accounts')} element={<AdminAccountsPage />} />
    </Route>
    <Route element={<RoleRoute allowedAccountTypes={['ADMIN']} />}>
      <Route path="/admin/tokens" element={<AdminTokensPage />} />
    </Route>

    <Route element={<RoleRoute {...PRIVACY_ACCESS} />}>
      <Route path={moduleRoutePath('privacy', 'requests')} element={<PrivacyRequestsPage />} />
    </Route>

    <Route element={<RoleRoute {...ROMANEIO_ACCESS} />}>
      <Route path={moduleRoutePath('romaneio', 'index')} element={<RomaneioPage />} />
      <Route path={moduleRoutePath('romaneio', 'new')} element={<NewRomaneioPage />} />
    </Route>

    <Route element={<RoleRoute {...EPI_ACCESS} />}>
      <Route path={moduleRoutePath('epi', 'index')} element={<EpiPage />} />
    </Route>

    <Route element={<RoleRoute {...EQUIPAMENTOS_ACCESS} />}>
      <Route path={moduleRoutePath('equipamentos', 'index')} element={<EquipamentosPage />} />
    </Route>

    <Route element={<RoleRoute {...ESTOQUE_ACCESS} />}>
      <Route path={moduleRoutePath('estoque', 'index')} element={<EstoquePage />} />
    </Route>

    <Route element={<RoleRoute {...QUALIDADE_ACCESS} />}>
      <Route path={moduleRoutePath('qualidade', 'index')} element={<QualidadePage />} />
    </Route>

    <Route element={<RoleRoute {...ACOMPANHAMENTO_ACCESS} />}>
      <Route path={moduleRoutePath('acompanhamento', 'index')} element={<AcompanhamentoPage />} />
    </Route>

    <Route element={<RoleRoute {...EFETIVO_ACCESS} />}>
      <Route path={moduleRoutePath('efetivo', 'root')} element={<EfetivoPage />} />
    </Route>

    <Route element={<RoleRoute {...ASSINATURAS_ACCESS} />}>
      <Route path={moduleRoutePath('assinaturas', 'index')} element={<AssinaturasPage />} />
    </Route>

    {/* module:scaffold routes */}
  </>
);
