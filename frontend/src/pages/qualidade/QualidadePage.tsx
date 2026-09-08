import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { useUrlParamState } from '../../hooks/useUrlParamState';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { QualityNaturesTab } from './QualityNaturesTab';
import { QualityRecordsTab } from './QualityRecordsTab';

type QualidadeTab = 'registros' | 'naturezas';

const TABS: Array<{ key: QualidadeTab; label: string; icon: string }> = [
  { key: 'registros', label: 'Registros', icon: '▤' },
  { key: 'naturezas', label: 'Naturezas', icon: '◇' }
];
const TAB_KEYS = TABS.map(tab => tab.key);
const TUTORIAL_KEY_PREFIX = 'filtrovali:qualidade-tutorial:v1:';

function parseQualidadeTab(value: string | null): QualidadeTab {
  return TAB_KEYS.includes(value as QualidadeTab) ? value as QualidadeTab : 'registros';
}

function tutorialIdentity(user: ReturnType<typeof useAuth>['user'], isManager: boolean) {
  const identity = String(user?.email || user?.username || user?.id || '').trim().toLowerCase();
  return identity ? `${isManager ? 'manager' : 'viewer'}:${identity}` : '';
}

function tutorialStorageKey(identity: string) {
  return `${TUTORIAL_KEY_PREFIX}${identity}`;
}

function hasSeenTutorial(identity: string) {
  try {
    return window.localStorage.getItem(tutorialStorageKey(identity)) === '1';
  } catch {
    return false;
  }
}

function markTutorialSeen(identity: string) {
  try {
    window.localStorage.setItem(tutorialStorageKey(identity), '1');
  } catch {
    // Ignore localStorage errors.
  }
}

export function QualidadePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const tutorialStarted = useRef(false);
  const [tab, setTab] = useUrlParamState<QualidadeTab>({
    param: 'tab',
    defaultValue: 'registros',
    parse: parseQualidadeTab
  });
  const isManager = Boolean(user?.moduleRoles?.includes('qualidade:manager'));
  const userKey = tutorialIdentity(user, isManager);

  const startTutorial = useCallback((force = false) => {
    if (!userKey) return;
    if (!force && hasSeenTutorial(userKey)) return;
    if (document.body.classList.contains('driver-active')) return;

    tutorialStarted.current = true;
    markTutorialSeen(userKey);
    const navSelector = window.matchMedia('(max-width: 860px)').matches ? '[data-quality-mobile-nav]' : '[data-quality-nav]';
    const steps: DriveStep[] = [
      {
        popover: {
          title: 'Modulo Qualidade',
          description: 'Use este modulo para registrar eventos de qualidade, consultar recorrencia e manter as Naturezas padronizadas.'
        }
      },
      {
        element: navSelector,
        popover: {
          title: 'Abas do modulo',
          description: 'Registros concentra a tabela operacional. Naturezas mantem as categorias usadas no formulario e no calculo de recorrencia.',
          side: 'right',
          align: 'start'
        }
      },
      {
        element: '[data-quality-records]',
        popover: {
          title: 'Registros de qualidade',
          description: isManager
            ? 'Cadastre, filtre, edite, exclua e exporte os registros daqui.'
            : 'Consulte e exporte os registros liberados para o modulo.',
          side: 'top',
          align: 'start'
        }
      }
    ];

    const driverObj = driver({
      showProgress: true,
      progressText: '{{current}} de {{total}}',
      nextBtnText: 'Proximo',
      prevBtnText: 'Voltar',
      doneBtnText: 'Entendi',
      allowClose: true,
      animate: true,
      smoothScroll: true,
      overlayOpacity: 0.6,
      steps
    });
    driverObj.drive();
  }, [isManager, userKey]);

  useEffect(() => {
    if (!userKey || tutorialStarted.current || hasSeenTutorial(userKey)) return;
    const timer = window.setTimeout(() => startTutorial(), 700);
    return () => window.clearTimeout(timer);
  }, [startTutorial, userKey]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <Shell>
      <TopBar
        title="Qualidade"
        subtitle="Registros, desvios e recorrencias do SGQ"
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => startTutorial(true)}>Ver tutorial</button>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location) })}>Conta</button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>Sair</button>
          </>
        }
      />

      <main className="page-scroll equip-page quality-page">
        <div className="equip-layout">
          <nav className="equip-nav" aria-label="Áreas de Qualidade" data-quality-nav>
            {TABS.map(item => (
              <button
                key={item.key}
                className={`equip-nav-item ${tab === item.key ? 'active' : ''}`}
                type="button"
                aria-current={tab === item.key}
                onClick={() => setTab(item.key)}
              >
                <span className="equip-nav-ico" aria-hidden="true">{item.icon}</span>
                <span className="equip-nav-label">{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="equip-mobile-nav" data-quality-mobile-nav>
            <label className="equip-mobile-nav-label" htmlFor="quality-tab-select">Seção do módulo</label>
            <select
              id="quality-tab-select"
              className="equip-nav-select"
              value={tab}
              onChange={event => setTab(event.target.value as QualidadeTab)}
            >
              {TABS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </div>

          <section className="equip-content">
            {tab === 'naturezas'
              ? <QualityNaturesTab isManager={isManager} />
              : <QualityRecordsTab isManager={isManager} />}
          </section>
        </div>
      </main>
    </Shell>
  );
}
