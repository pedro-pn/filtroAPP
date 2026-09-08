import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markAcompanhamentoStandbyHistoryNoveltySeen,
  shouldShowAcompanhamentoStandbyHistoryNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

const STANDBY_HISTORY_SELECTOR = '[data-acp-standby-history-trigger]';

export function ProjectStandbyHistoryNovelty({
  user,
  enabled,
  onSeen
}: {
  user?: Pick<AuthUser, 'id'> | null;
  enabled: boolean;
  onSeen: () => void;
}) {
  const started = useRef(false);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!enabled || !userId || started.current) return undefined;
    const noveltyUser = { id: userId };
    if (!shouldShowAcompanhamentoStandbyHistoryNovelty(noveltyUser)) {
      onSeenRef.current();
      return undefined;
    }

    let cancelled = false;
    let retryTimer: number | undefined;
    const startWhenReady = (attempt = 0) => {
      if (cancelled || started.current) return;
      if (document.body.classList.contains('driver-active')) {
        if (attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        return;
      }

      const target = document.querySelector(STANDBY_HISTORY_SELECTOR);
      if (!target || !shouldShowAcompanhamentoStandbyHistoryNovelty(noveltyUser)) {
        if (!target && attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        else onSeenRef.current();
        return;
      }

      const steps: DriveStep[] = [
        {
          popover: {
            title: '✨ Novidade: histórico de standby',
            description: 'O dashboard do projeto agora reúne os dias, as horas, o efetivo e os motivos de standby.'
          }
        },
        {
          element: STANDBY_HISTORY_SELECTOR,
          popover: {
            title: 'Consulte o histórico do projeto',
            description: 'Use este botão ao lado do resumo de standby. Dias sem standby são ignorados automaticamente.',
            side: 'top',
            align: 'start'
          }
        }
      ];

      started.current = true;
      markAcompanhamentoStandbyHistoryNoveltySeen(noveltyUser);
      driver({
        showProgress: true,
        nextBtnText: 'Ver botão',
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
