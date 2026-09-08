import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import {
  accountPageStateFromPath,
  availableHubModulesForUser,
  hasSeenAcompanhamentoNovelty,
  markAcompanhamentoNoveltySeen,
  markEfetivoHubNoveltySeen,
  markQualidadeNoveltySeen,
  shouldShowEfetivoHubNovelty,
  shouldShowQualidadeNovelty,
  userHasAcompanhamentoModule
} from '../auth/moduleNavigation';
import { HubTutorial } from '../components/HubTutorial';
import { AcompanhamentoHubNovelty } from '../components/AcompanhamentoHubNovelty';
import { QualidadeHubNovelty } from '../components/QualidadeHubNovelty';
import { EfetivoHubNovelty } from '../components/EfetivoHubNovelty';
import { roleHomePath } from '../auth/rolePath';
import { Shell } from '../layout/Shell';
import { TopBar } from '../layout/TopBar';
import { hubModulesForUser, type HubModuleEntry } from './hubModules';
import { canAccessOperationalModule } from '../auth/reportPermissions';
import {
  canStartOperationalReportsNovelty,
  OPERATIONAL_REPORTS_NOVELTY_STORAGE_PREFIX
} from '../utils/operationalReportsNovelty';
import { markApiTokenPlaygroundNoveltySeen, shouldShowApiTokenPlaygroundNovelty } from './admin/apiTokenPlaygroundNovelty';

const DEFAULT_MODULE_ICON = <circle cx="12" cy="12" r="9" />;

const MODULE_ICONS: Partial<Record<HubModuleEntry['id'], ReactNode>> = {
  rdo: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 5a3 3 0 0 1 6 0v1H9z" />
      <path d="M9 11h6" />
      <path d="M9 15h5" />
    </>
  ),
  'maintenance-production': (
    <>
      <path d="M14.7 6.3a4 4 0 0 0-5 5l-6.4 6.4a2.1 2.1 0 0 0 3 3l6.4-6.4a4 4 0 0 0 5-5l-2.4 2.4-3-3z" />
      <path d="M17 3v4" />
      <path d="M15 5h4" />
    </>
  ),
  admin: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.85" />
    </>
  ),
  privacy: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <circle cx="12" cy="16" r="1" />
      <path d="M8 11v-4a4 4 0 0 1 8 0v4" />
    </>
  ),
  romaneio: (
    <path d="M7 10h3v-3l-3.5-3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1-3 3l-6-6a6 6 0 0 1-8-8l3.5 3.5" />
  ),
  epi: (
    <>
      <path d="M9 12l2 2l4-4" />
      <path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1-8.5 15a12 12 0 0 1-8.5-15a12 12 0 0 0 8.5-3" />
    </>
  ),
  equipamentos: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33a1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  estoque: (
    <>
      <path d="M3 7.5L12 3l9 4.5l-9 4.5z" />
      <path d="M3 7.5v9L12 21l9-4.5v-9" />
      <path d="M12 12v9" />
      <path d="M7.5 5.25l9 4.5" />
    </>
  ),
  qualidade: (
    <>
      <path d="M12 3l2.2 1.5l2.7-.2l.8 2.6l2.2 1.6l-1 2.5l1 2.5l-2.2 1.6l-.8 2.6l-2.7-.2L12 20l-2.2-1.5l-2.7.2l-.8-2.6l-2.2-1.6l1-2.5l-1-2.5l2.2-1.6l.8-2.6l2.7.2z" />
      <path d="M8.7 12l2.1 2.1l4.5-4.6" />
    </>
  ),
  acompanhamento: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l3-4l3 3l4-6" />
    </>
  ),
  efetivo: (
    <>
      <path d="M4 20v-2a4 4 0 0 1 4-4h3" />
      <circle cx="9" cy="7" r="4" />
      <path d="M16 11v6" />
      <path d="M13 14h6" />
    </>
  ),
  none: DEFAULT_MODULE_ICON,
};

const MODULE_ACCENTS: Partial<Record<HubModuleEntry['id'], string>> = {
  rdo: '#30503a',
  'maintenance-production': '#526f3d',
  admin: '#4a7c5e',
  privacy: '#3a6a5c',
  romaneio: '#5c7a4a',
  epi: '#30503a',
  equipamentos: '#3f6f55',
  acompanhamento: '#3a6a4a',
  efetivo: '#4f7659',
  none: '#6b7280',
};

const WIDE_MODULES = new Set<HubModuleEntry['id']>(['epi', 'none']);

function operationalNoveltySeen(userId: string) {
  try {
    return window.localStorage.getItem(
      `${OPERATIONAL_REPORTS_NOVELTY_STORAGE_PREFIX}${userId}`
    ) === '1';
  } catch {
    return false;
  }
}

function markOperationalNoveltySeen(userId: string) {
  try {
    window.localStorage.setItem(
      `${OPERATIONAL_REPORTS_NOVELTY_STORAGE_PREFIX}${userId}`,
      '1'
    );
  } catch {
    /* navegador sem armazenamento */
  }
}

function ModuleIcon({ id }: { id: HubModuleEntry['id'] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      stroke="currentColor"
      strokeWidth="1.75"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {MODULE_ICONS[id] || DEFAULT_MODULE_ICON}
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      className="hub-card-arrow"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      stroke="currentColor"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function HubPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const tutorialTrigger = useRef<(() => void) | null>(null);

  const isClient = user?.accountType === 'CLIENT' || user?.role === 'CLIENT';
  const isAdmin = user?.accountType === 'ADMIN';
  const modules = useMemo(() => hubModulesForUser(user), [user]);
  const availableModules = useMemo(() => availableHubModulesForUser(user), [user]);
  const baseShouldRedirect = !isAdmin && availableModules.length === 1;

  // Novidade do módulo Acompanhamento: badge "Novo" + destaque no 1º acesso ao hub.
  const [acompNoveltyActive, setAcompNoveltyActive] = useState(
    () => userHasAcompanhamentoModule(user) && !hasSeenAcompanhamentoNovelty(user)
  );
  const [qualityNoveltyActive, setQualityNoveltyActive] = useState(
    () => shouldShowQualidadeNovelty(user)
  );
  const [efetivoNoveltyActive, setEfetivoNoveltyActive] = useState(
    () => shouldShowEfetivoHubNovelty(user)
  );
  const [operationalNoveltyActive, setOperationalNoveltyActive] = useState(() => {
    const eligible = canAccessOperationalModule(user?.reportEmissionPermissions || []);
    const seen = user ? operationalNoveltySeen(user.id) : false;
    return canStartOperationalReportsNovelty({ user, eligible, seen });
  });
  const [apiTokenNoveltyActive, setApiTokenNoveltyActive] = useState(() => shouldShowApiTokenPlaygroundNovelty(user));
  const shouldRedirect = baseShouldRedirect && !acompNoveltyActive && !qualityNoveltyActive && !efetivoNoveltyActive && !operationalNoveltyActive && !apiTokenNoveltyActive;

  useEffect(() => {
    setAcompNoveltyActive(userHasAcompanhamentoModule(user) && !hasSeenAcompanhamentoNovelty(user));
    setQualityNoveltyActive(shouldShowQualidadeNovelty(user));
    setEfetivoNoveltyActive(shouldShowEfetivoHubNovelty(user));
    setApiTokenNoveltyActive(shouldShowApiTokenPlaygroundNovelty(user));
    const eligible = canAccessOperationalModule(user?.reportEmissionPermissions || []);
    const seen = user ? operationalNoveltySeen(user.id) : false;
    setOperationalNoveltyActive(
      canStartOperationalReportsNovelty({ user, eligible, seen })
    );
  }, [user]);

  const firstName = user?.name?.split(' ')[0] || 'Usuário';
  const initials = user?.name
    ? user.name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join('')
    : 'U';

  useEffect(() => {
    const [module] = availableModules;
    if (shouldRedirect && module.path) {
      navigate(module.path, { replace: true });
    }
  }, [availableModules, navigate, shouldRedirect]);

  if (isClient) {
    return <Navigate to={roleHomePath('CLIENT')} replace />;
  }

  if (shouldRedirect) {
    return null;
  }

  return (
    <Shell>
      <TopBar
        title="Filtrovali App"
        subtitle={user?.name}
        showLogo
        actions={
          <>
            <button
              className="topbar-chip"
              type="button"
              onClick={() => tutorialTrigger.current?.()}
            >
              Ver tutorial
            </button>
            {isAdmin && (
              <button
                className="topbar-chip"
                type="button"
                onClick={() => navigate('/operacoes')}
              >
                Operação
              </button>
            )}
            <button
              className="topbar-chip"
              type="button"
              onClick={() => navigate('/conta', { state: accountPageStateFromPath(location) })}
            >
              Conta
            </button>
            <button
              className="topbar-chip"
              type="button"
              onClick={async () => { await logout(); navigate('/login', { replace: true }); }}
            >
              Sair
            </button>
          </>
        }
      />

      <div className="hub-hero">
        <div className="hub-avatar" aria-hidden="true">{initials}</div>
        <p className="hub-greeting">Olá, {firstName}</p>
        <p className="hub-subgreeting">Bem-vindo de volta ao app Filtrovali</p>
      </div>

      <main className="hub-page">
        <div className="hub-module-grid" aria-label="Módulos disponíveis">
          {modules.map((module, idx) => {
            const isWide = WIDE_MODULES.has(module.id);
            const isFirstWide = isWide && modules.slice(0, idx).every(m => !WIDE_MODULES.has(m.id));
            const path = module.path;
            const accent = MODULE_ACCENTS[module.id] || '#30503a';

            return (
              <Fragment key={module.id}>
                {isFirstWide && idx > 0 && <div className="hub-divider" role="separator" />}
                <button
                  className={`hub-module-card${isWide ? ' hub-module-card--wide' : ''}${module.disabled ? ' is-disabled' : ''}`}
                  data-hub-module-id={module.id}
                  disabled={module.disabled}
                  type="button"
                  onClick={path ? () => {
                    if (module.id === 'acompanhamento') {
                      markAcompanhamentoNoveltySeen(user);
                      setAcompNoveltyActive(false);
                    } else if (module.id === 'qualidade') {
                      markQualidadeNoveltySeen(user);
                      setQualityNoveltyActive(false);
                    } else if (module.id === 'efetivo') {
                      markEfetivoHubNoveltySeen(user);
                      setEfetivoNoveltyActive(false);
                    } else if (module.id === 'maintenance-production' && user) {
                      markOperationalNoveltySeen(user.id);
                      setOperationalNoveltyActive(false);
                    } else if (module.id === 'admin') {
                      markApiTokenPlaygroundNoveltySeen(user);
                      setApiTokenNoveltyActive(false);
                    }
                    navigate(path);
                  } : undefined}
                >
                  {module.id === 'acompanhamento' && acompNoveltyActive && (
                    <span className="hub-card-new" aria-label="Novo módulo">Novo</span>
                  )}
                  {module.id === 'qualidade' && qualityNoveltyActive && (
                    <span className="hub-card-new" aria-label="Novo módulo">Novo</span>
                  )}
                  {module.id === 'efetivo' && efetivoNoveltyActive && (
                    <span className="hub-card-new" aria-label="Novo módulo">Novo</span>
                  )}
                  {module.id === 'maintenance-production' && operationalNoveltyActive && (
                    <span className="hub-card-new" aria-label="Novo módulo">Novo</span>
                  )}
                  {module.id === 'admin' && apiTokenNoveltyActive && (
                    <span className="hub-card-new" aria-label="Novo recurso de tokens de API">Novo</span>
                  )}
                  <div className="hub-card-accent" style={{ background: accent }} />
                  <div className="hub-card-icon">
                    <ModuleIcon id={module.id} />
                  </div>
                  {isWide ? (
                    <div className="hub-card-content">
                      <span className="hub-module-title">{module.title}</span>
                      <span className="hub-module-copy">{module.copy}</span>
                    </div>
                  ) : (
                    <>
                      <span className="hub-module-title">{module.title}</span>
                      <span className="hub-module-copy">{module.copy}</span>
                    </>
                  )}
                  {!module.disabled && <ChevronRight />}
                </button>
              </Fragment>
            );
          })}
        </div>
      </main>
      {user && (
        <HubTutorial
          user={user}
          modules={modules}
          ready={!shouldRedirect}
          triggerRef={tutorialTrigger}
        />
      )}
      {user && (
        <AcompanhamentoHubNovelty
          user={user}
          enabled={!shouldRedirect && acompNoveltyActive}
          onSeen={() => setAcompNoveltyActive(false)}
        />
      )}
      {user && (
        <QualidadeHubNovelty
          user={user}
          enabled={!shouldRedirect && qualityNoveltyActive}
          onSeen={() => setQualityNoveltyActive(false)}
        />
      )}
      {user && (
        <EfetivoHubNovelty
          user={user}
          enabled={!shouldRedirect && efetivoNoveltyActive}
          onSeen={() => setEfetivoNoveltyActive(false)}
        />
      )}
    </Shell>
  );
}
