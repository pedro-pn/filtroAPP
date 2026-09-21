import { useEffect, useMemo, useRef, useState } from 'react';
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
import { HubModuleCard } from '../components/hub/HubModuleCard';
import { AppIcon } from '../components/icons/AppIcon';
import { Button } from '../components/ui/ds';
import { roleHomePath } from '../auth/rolePath';
import { canAccessOperationalModule } from '../auth/reportPermissions';
import { canStartOperationalReportsNovelty, OPERATIONAL_REPORTS_NOVELTY_STORAGE_PREFIX } from '../utils/operationalReportsNovelty';
import { markApiTokenPlaygroundNoveltySeen, shouldShowApiTokenPlaygroundNovelty } from './admin/apiTokenPlaygroundNovelty';
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

import { AppShell } from '../layout/AppShell';
import { NAVIGATION_CHROME_ICONS } from '../layout/navigationIcons';
import { createNavigationModel } from '../layout/navigationModel';
import { PageHeader } from '../layout/PageHeader';
import { hubModulesForUser } from './hubModules';
import './HubPage.css';

function greetingForHour(hour: number) {
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function formatHubDate(date: Date) {
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(date);

  return formatted.charAt(0).toLocaleUpperCase('pt-BR') + formatted.slice(1);
}

export function HubPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const tutorialTrigger = useRef<(() => void) | null>(null);
  const hubDate = useMemo(() => new Date(), []);

  const isClient = user?.accountType === 'CLIENT' || user?.role === 'CLIENT';
  const isAdmin = user?.accountType === 'ADMIN';
  const modules = useMemo(() => hubModulesForUser(user), [user]);
  const navigation = useMemo(
    () => createNavigationModel({ modules, pathname: location.pathname }),
    [location.pathname, modules]
  );
  const availableModules = useMemo(
    () => availableHubModulesForUser(user),
    [user]
  );
  const baseShouldRedirect = !isAdmin && availableModules.length === 1;

  // Novidade do módulo Acompanhamento: badge "Novo" + destaque no 1º acesso ao hub.
  const [acompNoveltyActive, setAcompNoveltyActive] = useState(
    () =>
      userHasAcompanhamentoModule(user) && !hasSeenAcompanhamentoNovelty(user)
  );
  const [qualityNoveltyActive, setQualityNoveltyActive] = useState(() =>
    shouldShowQualidadeNovelty(user)
  );
  const [efetivoNoveltyActive, setEfetivoNoveltyActive] = useState(() =>
    shouldShowEfetivoHubNovelty(user)
  );
  const [operationalNoveltyActive, setOperationalNoveltyActive] = useState(() => {
    const eligible = canAccessOperationalModule(user?.reportEmissionPermissions || []);
    const seen = user ? operationalNoveltySeen(user.id) : false;
    return canStartOperationalReportsNovelty({ user, eligible, seen });
  });
  const [apiTokenNoveltyActive, setApiTokenNoveltyActive] = useState(() => shouldShowApiTokenPlaygroundNovelty(user));
  const shouldRedirect = baseShouldRedirect && !acompNoveltyActive && !qualityNoveltyActive && !efetivoNoveltyActive && !operationalNoveltyActive && !apiTokenNoveltyActive;
  const availableModuleCount = modules.filter(
    (module) => module.path && !module.disabled
  ).length;

  useEffect(() => {
    setAcompNoveltyActive(
      userHasAcompanhamentoModule(user) && !hasSeenAcompanhamentoNovelty(user)
    );
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
    ? user.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((n) => n[0].toUpperCase())
        .join('')
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
    <AppShell
      navigation={navigation}
      title="Visão geral"
      breadcrumb={[{ label: 'Filtrovali' }, { label: 'Visão geral' }]}
      profile={
        user
          ? {
              name: user.name,
              description: user.email || user.username,
              initials,
              onOpen: () =>
                navigate('/conta', {
                  state: accountPageStateFromPath(location)
                })
            }
          : undefined
      }
      utilityActions={
        <>
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            iconLeft={<AppIcon icon={NAVIGATION_CHROME_ICONS.help} size="sm" />}
            onClick={() => tutorialTrigger.current?.()}
          >
            Ver tutorial
          </Button>
          {isAdmin ? (
            <Button
              variant="ghost"
              size="sm"
              fullWidth
              iconLeft={
                <AppIcon icon={NAVIGATION_CHROME_ICONS.operations} size="sm" />
              }
              onClick={() => navigate('/operacoes')}
            >
              Operação
            </Button>
          ) : null}
        </>
      }
      onLogout={async () => {
        await logout();
        navigate('/login', { replace: true });
      }}
    >
      <main className="fv-ds hub-dashboard">
        <PageHeader
          title={`${greetingForHour(hubDate.getHours())}, ${firstName}`}
          description={`${formatHubDate(hubDate)}. Bem-vindo de volta ao app Filtrovali.`}
        />

        <section
          className="hub-dashboard__modules"
          aria-labelledby="hub-modules-title"
        >
          <header className="hub-dashboard__section-header">
            <h2 id="hub-modules-title">Módulos</h2>
            <p>
              {availableModuleCount === 1
                ? '1 módulo disponível para sua conta.'
                : `${availableModuleCount} módulos disponíveis para sua conta.`}
            </p>
          </header>

          <div className="hub-module-grid">
            {modules.map((module) => {
              const path = module.path;
              const isNew =
                (module.id === 'acompanhamento' && acompNoveltyActive) ||
                (module.id === 'qualidade' && qualityNoveltyActive) ||
                (module.id === 'efetivo' && efetivoNoveltyActive) ||
                (module.id === 'maintenance-production' && operationalNoveltyActive) ||
                (module.id === 'admin' && apiTokenNoveltyActive);

              return (
                <HubModuleCard
                  key={module.id}
                  module={module}
                  isNew={isNew}
                  onActivate={
                    path
                      ? () => {
                          if (module.id === 'acompanhamento') {
                            markAcompanhamentoNoveltySeen(user);
                            setAcompNoveltyActive(false);
                          } else if (module.id === 'qualidade') {
                            markQualidadeNoveltySeen(user);
                            setQualityNoveltyActive(false);
                          } else if (module.id === 'efetivo') {
                            markEfetivoHubNoveltySeen(user);
                            setEfetivoNoveltyActive(false);
                          }
                          if (module.id === 'maintenance-production' && user) {
                            markOperationalNoveltySeen(user.id);
                            setOperationalNoveltyActive(false);
                          } else if (module.id === 'admin') {
                            markApiTokenPlaygroundNoveltySeen(user);
                            setApiTokenNoveltyActive(false);
                          }
                          navigate(path);
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        </section>
      </main>
      {user ? (
        <HubTutorial
          user={user}
          modules={modules}
          ready={!shouldRedirect}
          triggerRef={tutorialTrigger}
        />
      ) : null}
      {user ? (
        <AcompanhamentoHubNovelty
          user={user}
          enabled={!shouldRedirect && acompNoveltyActive}
          onSeen={() => setAcompNoveltyActive(false)}
        />
      ) : null}
      {user ? (
        <QualidadeHubNovelty
          user={user}
          enabled={!shouldRedirect && qualityNoveltyActive}
          onSeen={() => setQualityNoveltyActive(false)}
        />
      ) : null}
      {user ? (
        <EfetivoHubNovelty
          user={user}
          enabled={!shouldRedirect && efetivoNoveltyActive}
          onSeen={() => setEfetivoNoveltyActive(false)}
        />
      ) : null}
    </AppShell>
  );
}
