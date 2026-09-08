import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markAcompanhamentoProjectDeviationsNoveltySeen,
  shouldShowAcompanhamentoProjectDeviationsNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

const DEVIATIONS_SELECTOR = '[data-quality-project-deviations]';

interface ProjectQualityDeviationsNoveltyProps {
  user?: Pick<AuthUser, 'id'> | null;
  enabled: boolean;
  onSeen: () => void;
}

export function ProjectQualityDeviationsNovelty({ user, enabled, onSeen }: ProjectQualityDeviationsNoveltyProps) {
  const started = useRef(false);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!enabled || !userId || started.current) return undefined;
    const noveltyUser = { id: userId };
    if (!shouldShowAcompanhamentoProjectDeviationsNovelty(noveltyUser)) {
      onSeenRef.current();
      return undefined;
    }

    let cancelled = false;
    let retryTimer: number | undefined;

    const startWhenReady = (attempt = 0) => {
      if (cancelled) return;
      if (document.body.classList.contains('driver-active')) {
        if (attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        return;
      }
      if (!shouldShowAcompanhamentoProjectDeviationsNovelty(noveltyUser)) {
        onSeenRef.current();
        return;
      }

      const steps: DriveStep[] = [
        {
          popover: {
            title: 'Novo recurso: lista de desvios',
            description: 'O card do projeto agora mostra uma lista com os desvios de qualidade vinculados a esta missão.'
          }
        }
      ];

      if (document.querySelector(DEVIATIONS_SELECTOR)) {
        steps.push({
          element: DEVIATIONS_SELECTOR,
          popover: {
            title: 'Lista de desvios',
            description: 'A lista traz somente registros do tipo Desvio deste projeto, com status, impacto, recorrência e link para o módulo Qualidade.',
            side: 'top',
            align: 'start'
          }
        });
      }

      started.current = true;
      markAcompanhamentoProjectDeviationsNoveltySeen(noveltyUser);
      const driverObj = driver({
        showProgress: false,
        nextBtnText: 'Ver lista',
        prevBtnText: 'Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        onDestroyed: () => onSeenRef.current(),
        steps
      });
      driverObj.drive();
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
