import { useCallback, useEffect, useMemo, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import { useAuth } from '../../auth/AuthContext';
import { useUrlParamState } from '../../hooks/useUrlParamState';
import { Button } from '../../components/ui/ds';
import { PageHeader } from '../../layout/PageHeader';
import { OperationalModuleAppShell } from '../OperationalModuleAppShell';
import { QualityNaturesTab } from './QualityNaturesTab';
import { QualityRecordsTab } from './QualityRecordsTab';
import './QualidadePage.ds.css';

type QualidadeTab = 'registros' | 'naturezas';

const TABS: Array<{ key: QualidadeTab; label: string }> = [
  { key: 'registros', label: 'Registros' },
  { key: 'naturezas', label: 'Naturezas' }
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
  const { user } = useAuth();
  const tutorialStarted = useRef(false);
  const [tab, setTab] = useUrlParamState<QualidadeTab>({
    param: 'tab',
    defaultValue: 'registros',
    parse: parseQualidadeTab
  });
  const isManager = Boolean(user?.moduleRoles?.includes('qualidade:manager'));
  const userKey = tutorialIdentity(user, isManager);
  const subNavigation = useMemo(() => TABS.map(item => ({
    id: item.key,
    label: item.label,
    href: `/qualidade?tab=${item.key}`,
    active: tab === item.key,
    onSelect: () => setTab(item.key)
  })), [setTab, tab]);

  const startTutorial = useCallback((force = false) => {
    if (!userKey) return;
    if (!force && hasSeenTutorial(userKey)) return;
    if (document.body.classList.contains('driver-active')) return;

    tutorialStarted.current = true;
    markTutorialSeen(userKey);
    const navSelector = window.matchMedia('(max-width: 767px)').matches
      ? '.fv-bottom-bar'
      : window.matchMedia('(max-width: 1023px)').matches
        ? '.fv-topbar__menu'
        : '.fv-app-shell__sidebar';
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

  return (
    <OperationalModuleAppShell moduleId="qualidade" title="Qualidade" sectionLabel={tab === 'naturezas' ? 'Naturezas' : 'Registros'} subNavigation={subNavigation}>
      <main className="quality-page-v2 fv-ds">
        <PageHeader
          title={tab === 'naturezas' ? 'Naturezas' : 'Registros de qualidade'}
          description={tab === 'naturezas' ? 'Categorias usadas nos registros e na recorrência.' : 'Acompanhe registros, desvios e recorrências do SGQ.'}
          actions={<Button variant="secondary" size="sm" onClick={() => startTutorial(true)}>Ver tutorial</Button>}
        />
        {tab === 'naturezas'
          ? <QualityNaturesTab isManager={isManager} />
          : <QualityRecordsTab isManager={isManager} />}
      </main>
    </OperationalModuleAppShell>
  );
}
