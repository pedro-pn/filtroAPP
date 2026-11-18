import { Route } from 'react-router';

import { RoleRoute } from '../auth/RoleRoute';
import { AcompanhamentoPage } from '../pages/acompanhamento/AcompanhamentoPage';
import { AdminAccountsPage } from '../pages/admin/AdminAccountsPage';
import { EpiPage } from '../pages/epi/EpiPage';
import { EquipamentosPage } from '../pages/equipamentos/EquipamentosPage';
import { EstoquePage } from '../pages/estoque/EstoquePage';
import { PrivacyRequestsPage } from '../pages/privacy/PrivacyRequestsPage';
import { QualidadePage } from '../pages/qualidade/QualidadePage';
import { NewRomaneioPage } from '../pages/romaneio/NewRomaneioPage';
import { RomaneioPage } from '../pages/romaneio/RomaneioPage';
import { moduleRouteAccess, moduleRoutePath } from './registry';
import { EfetivoPage } from '../pages/efetivo/EfetivoPage';
import { AssinaturasPage } from '../pages/assinaturas/AssinaturasPage';
// module:scaffold import

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
