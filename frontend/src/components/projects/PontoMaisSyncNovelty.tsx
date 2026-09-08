import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markPontoMaisSyncNoveltySeen,
  shouldShowPontoMaisSyncNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

const AUTOMATION_STATUS_SELECTOR = '[data-pontomais-automation-status]';
const EMPLOYEE_TAB_SELECTOR = '[data-pontomais-employees-tab]';

interface PontoMaisSyncNoveltyProps {
  user?: Pick<AuthUser, 'id'> | null;
  enabled: boolean;
}

export function PontoMaisSyncNovelty({ user, enabled }: PontoMaisSyncNoveltyProps) {
  const started = useRef(false);
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!enabled || !userId || started.current) return undefined;
    const noveltyUser = { id: userId };
    if (!shouldShowPontoMaisSyncNovelty(noveltyUser)) return undefined;

    let cancelled = false;
    let retryTimer: number | undefined;
    const startWhenReady = (attempt = 0) => {
      if (cancelled) return;
      const employeeTabReady = document.querySelector(EMPLOYEE_TAB_SELECTOR);
      if (document.body.classList.contains('driver-active') || !employeeTabReady) {
        if (attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        return;
      }
      if (!shouldShowPontoMaisSyncNovelty(noveltyUser)) return;

      const steps: DriveStep[] = [
        {
          popover: {
            title: '✨ Jornada direto do VR Ponto Mais',
            description: 'A jornada agora é atualizada automaticamente pela API, sem exportar planilhas nem abrir esta tela. As etiquetas das batidas também ajudam a apropriar o custo por projeto.'
          }
        },
        {
          element: EMPLOYEE_TAB_SELECTOR,
          popover: {
            title: 'Escolha quem entra no acompanhamento',
            description: 'Nesta aba você pode ignorar pessoas fora da operação. A escolha é reversível e vale tanto para novas sincronizações quanto para o cálculo com o histórico já carregado.',
            side: 'bottom',
            align: 'start'
          }
        },
        ...(document.querySelector(AUTOMATION_STATUS_SELECTOR) ? [{
          element: AUTOMATION_STATUS_SELECTOR,
          popover: {
            title: 'Acompanhe a cobertura',
            description: 'Na primeira execução, o sistema busca todo o histórico em lotes. Depois, revisa automaticamente os últimos 31 dias todos os dias, sem duplicar horas ou custo.',
            side: 'bottom' as const,
            align: 'start' as const
          }
        }] : [])
      ];

      started.current = true;
      markPontoMaisSyncNoveltySeen(noveltyUser);
      driver({
        showProgress: true,
        nextBtnText: 'Próximo',
        prevBtnText: 'Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        steps
      }).drive();
    };

    const timer = window.setTimeout(startWhenReady, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [enabled, userId]);

  return null;
}
