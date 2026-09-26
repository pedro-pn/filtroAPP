import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markAcompanhamentoWeeklyTargetNoveltySeen,
  shouldShowAcompanhamentoWeeklyTargetNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

const WEEKLY_TARGET_SELECTOR = '[data-acp-weekly-progress-target]';

interface ProjectWeeklyTargetNoveltyProps {
  user?: Pick<AuthUser, 'id'> | null;
  enabled: boolean;
  onSeen: () => void;
}

export function ProjectWeeklyTargetNovelty({ user, enabled, onSeen }: ProjectWeeklyTargetNoveltyProps) {
  const started = useRef(false);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!enabled || !userId || started.current) return undefined;
    const noveltyUser = { id: userId };
    if (!shouldShowAcompanhamentoWeeklyTargetNovelty(noveltyUser)) {
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
      const target = document.querySelector(WEEKLY_TARGET_SELECTOR);
      if (!target || !shouldShowAcompanhamentoWeeklyTargetNovelty(noveltyUser)) {
        if (!target && attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        else onSeenRef.current();
        return;
      }

      const steps: DriveStep[] = [
        {
          popover: {
            title: '✨ Nova meta semanal do projeto',
            description: 'Veja o ritmo físico necessário por semana para entregar o escopo na data prevista.'
          }
        },
        {
          element: WEEKLY_TARGET_SELECTOR,
          popover: {
            title: 'Ritmo necessário',
            description: 'O indicador mostra a necessidade semanal em metros, unidades ou litros para o recorte selecionado.',
            side: 'bottom',
            align: 'start'
          }
        }
      ];

      started.current = true;
      markAcompanhamentoWeeklyTargetNoveltySeen(noveltyUser);
      driver({
        showProgress: true,
        nextBtnText: 'Ver indicador',
        prevBtnText: 'Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        onDestroyed: () => onSeenRef.current(),
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
