import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markAcompanhamentoLaborPolicyNoveltySeen,
  shouldShowAcompanhamentoLaborPolicyNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

const LABOR_POLICY_SELECTOR = '[data-acp-labor-policy]';

export function ProjectLaborPolicyNovelty({
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
    if (!shouldShowAcompanhamentoLaborPolicyNovelty(noveltyUser)) {
      onSeenRef.current();
      return undefined;
    }

    let cancelled = false;
    let retryTimer: number | undefined;
    const startWhenReady = (attempt = 0) => {
      if (cancelled) return;
      if (document.body.classList.contains('driver-active') || !document.querySelector(LABOR_POLICY_SELECTOR)) {
        if (attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        else onSeenRef.current();
        return;
      }
      const steps: DriveStep[] = [
        {
          popover: {
            title: '✨ Nova apropriação de mão de obra',
            description: 'A folha mensal continua única, enquanto os cards podem mostrar o custo integral de cada missão executada ao mesmo tempo.'
          }
        },
        {
          element: LABOR_POLICY_SELECTOR,
          popover: {
            title: 'Escolha a regra do grupo',
            description: 'Use “Repetir jornada” para frentes simultâneas ou “Consolidar” para a exceção em que todos os RDOs devem ir a uma missão principal.',
            side: 'top',
            align: 'start'
          }
        }
      ];
      started.current = true;
      markAcompanhamentoLaborPolicyNoveltySeen(noveltyUser);
      driver({
        showProgress: false,
        nextBtnText: 'Ver controle',
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
