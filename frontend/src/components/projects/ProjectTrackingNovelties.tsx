import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markAcompanhamentoFinalizedNoveltySeen,
  markAcompanhamentoReviewNoveltySeen,
  markAcompanhamentoTrackingNoveltySeen,
  shouldShowAcompanhamentoFinalizedNovelty,
  shouldShowAcompanhamentoReviewNovelty,
  shouldShowAcompanhamentoTrackingNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

export function ProjectTrackingNovelties({
  user,
  canManage,
  hasFinalizedNotice,
  hasReviewAction
}: {
  user?: Pick<AuthUser, 'id'> | null;
  canManage: boolean;
  hasFinalizedNotice: boolean;
  hasReviewAction: boolean;
}) {
  const started = useRef(false);

  useEffect(() => {
    if (!user?.id || started.current) return undefined;
    let cancelled = false;
    let retryTimer: number | undefined;

    const startWhenReady = (attempt = 0) => {
      if (cancelled || started.current) return;
      if (document.body.classList.contains('driver-active')) {
        if (attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        return;
      }

      const tracking = canManage && shouldShowAcompanhamentoTrackingNovelty(user);
      const finalized = hasFinalizedNotice && shouldShowAcompanhamentoFinalizedNovelty(user);
      const review = canManage && hasReviewAction && shouldShowAcompanhamentoReviewNovelty(user);
      if (!tracking && !finalized && !review) return;

      const steps: DriveStep[] = [];
      if (tracking) {
        steps.push({
          popover: {
            title: '✨ Novidade: organização dos arquivados',
            description: 'Gestores agora podem arquivar uma missão somente no Acompanhamento e marcar projetos arquivados como conferidos.'
          }
        });
        if (document.querySelector('[data-acp-tracking-action]')) {
          steps.push({
            element: '[data-acp-tracking-action]',
            popover: {
              title: 'Ações do acompanhamento',
              description: 'O arquivamento daqui não altera Relatórios. Depois da revisão, marque a missão como conferida para movê-la à aba Conferidas.',
              side: 'top',
              align: 'end'
            }
          });
        }
      }
      if (finalized && document.querySelector('[data-acp-finalized-notice]')) {
        steps.push({
          element: '[data-acp-finalized-notice]',
          popover: {
            title: 'Missão finalizada recentemente',
            description: 'Este destaque indica que a missão foi arquivada pelo módulo Relatórios. Ele permanece até o card ser aberto.',
            side: 'bottom',
            align: 'start'
          }
        });
      }
      if (review && document.querySelector('[data-acp-review-action]')) {
        steps.push({
          element: '[data-acp-review-action]',
          popover: {
            title: '✨ Novidade: marcar como conferido',
            description: 'Depois da verificação semanal, marque o projeto como conferido. O card irá para a aba Conferidas e poderá ser desmarcado se precisar de uma nova revisão.',
            side: 'top',
            align: 'end'
          }
        });
      }
      started.current = true;
      if (tracking) markAcompanhamentoTrackingNoveltySeen(user);
      if (finalized) markAcompanhamentoFinalizedNoveltySeen(user);
      if (review) markAcompanhamentoReviewNoveltySeen(user);
      driver({
        showProgress: steps.length > 1,
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
  }, [canManage, hasFinalizedNotice, hasReviewAction, user]);

  return null;
}
