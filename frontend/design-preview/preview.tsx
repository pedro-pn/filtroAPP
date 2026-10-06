import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { Activity, Home } from 'lucide-react';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { ToastProvider } from '../src/components/ui/Toast';
import { AppShell } from '../src/layout/AppShell';
import type { NavigationModel } from '../src/layout/navigationModel';
import { Button, Badge } from '../src/components/ui/ds';
import { ProjectCardsBoard as CurrentProjectCardsBoard } from '../src/components/projects/ProjectCardsBoard';
import { ProjectCardsBoard as ReorganizedProjectCardsBoard } from './components/ProjectCardsBoard';
import { installPreviewAdapter } from './previewData';
import { BRAND_LOGO_ASSETS } from '../src/components/brand/brandAssets';
import logo from '../../backend/assets/Logo/LOGO_COLORIDO.png';
import whiteLogo from '../../backend/assets/Logo/LOGO_BRANCA.png';
import symbol from '../../backend/assets/Logo/LOGO_TAB.png';
import '../src/styles/variables.css';
import '../src/styles/foundation.css';
import '../src/styles/base.css';
import './preview.css';

// Same shell, board, cards, queries, dialogs and theme as the production app.
// The adapter keeps all requests inside this illustrative preview.
installPreviewAdapter();
Object.assign(BRAND_LOGO_ASSETS.color, { src: logo });
Object.assign(BRAND_LOGO_ASSETS.white, { src: whiteLogo });
Object.assign(BRAND_LOGO_ASSETS.symbol, { src: symbol });
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const auth: AuthContextValue = {
  user: { id: 'preview-manager', username: 'preview', name: 'Gestor de exemplo', email: 'gestor@example.com', role: 'MANAGER', accountType: 'INTERNAL', moduleRoles: ['acompanhamento:manager', 'rdo:manager'], reportEmissionPermissions: [], isActive: true },
  token: null, isBootstrapping: false, isAuthenticated: true,
  login: async () => {}, logout: async () => {}, refreshUser: async () => {}, replaceUser: () => {},
};
const navigation: NavigationModel = { groups: [
  { id: 'principal', label: 'Principal', items: [{ id: 'hub', label: 'Visão geral', group: 'principal', icon: Home, href: '/modulos', active: false }] },
  { id: 'modules', label: 'Módulos', items: [{ id: 'acompanhamento', label: 'Acompanhamento', group: 'modules', icon: Activity, active: true, expanded: true, href: '/acompanhamento', children: [
    { id: 'dashboard', label: 'Dashboard', href: '/acompanhamento', active: false },
    { id: 'projetos', label: 'Projetos', href: '/acompanhamento?section=projetos', active: true },
    { id: 'sede', label: 'Sede', href: '/acompanhamento?section=sede', active: false },
    { id: 'custo', label: 'Custo', href: '/acompanhamento?section=custo', active: false },
  ] }] },
] };

function Preview() {
  const params = new URLSearchParams(window.location.search);
  const [current, setCurrent] = useState(params.get('version') !== 'referencia');
  const [listing, setListing] = useState(params.get('view') === 'cards');
  const Board = current ? CurrentProjectCardsBoard : ReorganizedProjectCardsBoard;
  return <MemoryRouter key={`${current}-${listing}`} initialEntries={[`/acompanhamento?section=projetos${listing ? '' : '&project=p1'}`]}>
    <AppShell navigation={navigation} title="Acompanhamento" contentWidth="fluid"
      breadcrumb={[{ label: 'Filtrovali', href: '/modulos' }, { label: 'Acompanhamento', href: '/acompanhamento' }, { label: 'Projetos' }]}
      profile={{ name: 'Gestor de exemplo', description: 'Prévia com dados ilustrativos', initials: 'GE' }}>
      <div className="fv-ds preview-controls"><div><Badge tone="info">Prévia</Badge><small>Mesmos dados e componentes do app</small></div><div>
        <Button size="sm" variant={current ? 'primary' : 'secondary'} aria-pressed={current} onClick={() => setCurrent(true)}>App integrado</Button>
        <Button size="sm" variant={!current ? 'primary' : 'secondary'} aria-pressed={!current} onClick={() => setCurrent(false)}>Prévia aprovada</Button>
        <Button size="sm" aria-pressed={listing} onClick={() => setListing(!listing)}>{listing ? 'Ver dashboard' : 'Comparar cards'}</Button>
      </div></div>
      <div className={current ? 'preview-current' : 'preview-reorganized'}><Board canManage canManageGroups canManageManualCosts canManageProjectNotes /></div>
    </AppShell>
  </MemoryRouter>;
}

const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<ThemeProvider><QueryClientProvider client={queryClient}><AuthContext.Provider value={auth}><ToastProvider><Preview /></ToastProvider></AuthContext.Provider></QueryClientProvider></ThemeProvider>);
