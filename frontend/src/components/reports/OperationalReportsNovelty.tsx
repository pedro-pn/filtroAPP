import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import type { AuthUser } from '../../types/auth';
import {
  canStartOperationalModuleTutorial,
  OPERATIONAL_MODULE_TUTORIAL_STORAGE_PREFIX
} from '../../utils/operationalReportsNovelty';

function storageKey(user: Pick<AuthUser, 'id'>) {
  return `${OPERATIONAL_MODULE_TUTORIAL_STORAGE_PREFIX}${user.id}`;
}

function shouldShowOperationalReportsNovelty(
  user: AuthUser | null | undefined,
  eligible: boolean
) {
  if (!user) return false;
  try {
    return canStartOperationalModuleTutorial({
      user,
      eligible,
      seen: window.localStorage.getItem(storageKey(user)) === '1'
    });
  } catch {
    return canStartOperationalModuleTutorial({ user, eligible });
  }
}

function markSeen(user: Pick<AuthUser, 'id'>) {
  try {
    window.localStorage.setItem(storageKey(user), '1');
  } catch {
    /* navegador sem armazenamento */
  }
}

export function OperationalReportsNovelty({
  user,
  enabled = true,
  eligible = Boolean(user.reportEmissionPermissions?.length)
}: {
  user: AuthUser;
  enabled?: boolean;
  eligible?: boolean;
}) {
  const started = useRef(false);

  useEffect(() => {
    if (
      !enabled ||
      started.current ||
      !shouldShowOperationalReportsNovelty(user, eligible)
    )
      return;
    const timer = window.setTimeout(() => {
      started.current = true;
      if (document.body.classList.contains('driver-active')) return;
      markSeen(user);
      const steps: DriveStep[] = [
        {
          popover: {
            title: 'Módulo Manutenção e produção',
            description:
              'Aqui ficam os relatórios, aprovações e históricos liberados para a sua conta.'
          }
        }
      ];
      if (document.querySelector('[data-operational-module-tabs]'))
        steps.push({
          element: '[data-operational-module-tabs]',
          popover: {
            title: 'Áreas autorizadas',
            description:
              'As abas de manutenção, produção e histórico aparecem conforme as permissões da sua conta.',
            side: 'bottom',
            align: 'start'
          }
        });
      if (document.querySelector('[data-operational-new-report]'))
        steps.push({
          element: '[data-operational-new-report]',
          popover: {
            title: 'Preencha o relatório certo',
            description:
              'Cada aba abre diretamente o formulário correspondente, sem misturar com o RDO de obra.',
            side: 'bottom',
            align: 'start'
          }
        });
      if (document.querySelector('[data-operational-standalone]'))
        steps.push({
          element: '[data-operational-standalone]',
          popover: {
            title: 'Manutenção avulsa',
            description:
              'Registre uma manutenção de equipamento sem precisar abrir um RDO.',
            side: 'bottom',
            align: 'start'
          }
        });
      if (document.querySelector('[data-operational-schedule-tab]'))
        steps.push({
          element: '[data-operational-schedule-tab]',
          popover: {
            title: 'Programação preventiva',
            description:
              'Veja a última e a próxima manutenção de cada equipamento e identifique os prazos vencidos.',
            side: 'bottom',
            align: 'start'
          }
        });
      driver({
        showProgress: true,
        progressText: '{{current}} de {{total}}',
        nextBtnText: 'Próximo →',
        prevBtnText: '← Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        steps
      }).drive();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [eligible, enabled, user]);

  return null;
}
