import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markProjectIntakeNoveltySeen,
  shouldShowProjectIntakeNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

const PENDING_PROJECTS_SELECTOR = '[data-project-intake-pending]';

interface ProjectIntakeWebhookNoveltyProps {
  user?: Pick<AuthUser, 'id'> | null;
  enabled: boolean;
}

export function ProjectIntakeWebhookNovelty({ user, enabled }: ProjectIntakeWebhookNoveltyProps) {
  const started = useRef(false);
  const userId = user?.id || '';

  useEffect(() => {
    if (!enabled || !userId || started.current) return undefined;
    const noveltyUser = { id: userId };
    if (!shouldShowProjectIntakeNovelty(noveltyUser)) return undefined;

    let cancelled = false;
    let retryTimer: number | undefined;

    const startWhenReady = (attempt = 0) => {
      if (cancelled) return;
      if (document.body.classList.contains('driver-active') || !document.querySelector(PENDING_PROJECTS_SELECTOR)) {
        if (attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        return;
      }
      if (!shouldShowProjectIntakeNovelty(noveltyUser)) return;

      const steps: DriveStep[] = [
        {
          popover: {
            title: '✨ Novidade: projetos automáticos',
            description: 'Projetos recebidos pelo webhook agora ficam destacados e aguardam sua verificação antes de entrar no fluxo de relatórios.'
          }
        },
        {
          element: PENDING_PROJECTS_SELECTOR,
          popover: {
            title: 'Revise antes de liberar',
            description: 'Confira número, nome, cliente, CNPJ, proposta e local. O botão “Confirmar e salvar” encerra a pendência.',
            side: 'top',
            align: 'start'
          }
        }
      ];

      started.current = true;
      markProjectIntakeNoveltySeen(noveltyUser);
      driver({
        showProgress: false,
        nextBtnText: 'Ver pendências',
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
