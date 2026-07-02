import { Route } from 'react-router-dom';

import { RoleRoute } from '../auth/RoleRoute';
import { AcompanhamentoPage } from '../pages/acompanhamento/AcompanhamentoPage';
import { AdminAccountsPage } from '../pages/admin/AdminAccountsPage';
import { EpiPage } from '../pages/epi/EpiPage';
import { EquipamentosPage } from '../pages/equipamentos/EquipamentosPage';
import { PrivacyRequestsPage } from '../pages/privacy/PrivacyRequestsPage';
import { NewRomaneioPage } from '../pages/romaneio/NewRomaneioPage';
import { RomaneioPage } from '../pages/romaneio/RomaneioPage';
import { moduleRouteAccess, moduleRoutePath } from './registry';
// module:scaffold import

const ADMIN_ACCOUNTS_ACCESS = moduleRouteAccess('admin', 'accounts');
const PRIVACY_ACCESS = moduleRouteAccess('privacy');
const ROMANEIO_ACCESS = moduleRouteAccess('romaneio');
const EPI_ACCESS = moduleRouteAccess('epi');
const EQUIPAMENTOS_ACCESS = moduleRouteAccess('equipamentos');
const ACOMPANHAMENTO_ACCESS = moduleRouteAccess('acompanhamento');
// module:scaffold access

export const moduleRouteElements = (
  <>
    <Route element={<RoleRoute {...ADMIN_ACCOUNTS_ACCESS} />}>
      <Route path={moduleRoutePath('admin', 'accounts')} element={<AdminAccountsPage />} />
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

    <Route element={<RoleRoute {...ACOMPANHAMENTO_ACCESS} />}>
      <Route path={moduleRoutePath('acompanhamento', 'index')} element={<AcompanhamentoPage />} />
    </Route>

    {/* module:scaffold routes */}
  </>
);
