import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markAcompanhamentoAdditionalProposalsNoveltySeen,
  shouldShowAcompanhamentoAdditionalProposalsNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

const PROPOSAL_CONTRIBUTIONS_SELECTOR = '[data-acp-proposal-contributions]';

interface ProjectAdditionalProposalsNoveltyProps {
  user?: Pick<AuthUser, 'id'> | null;
  enabled: boolean;
  onSeen: () => void;
}

// Aviso temporário das propostas adicionais no dashboard do projeto.
export function ProjectAdditionalProposalsNovelty({ user, enabled, onSeen }: ProjectAdditionalProposalsNoveltyProps) {
  const started = useRef(false);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!enabled || !userId || started.current) return undefined;
    const noveltyUser = { id: userId };
    if (!shouldShowAcompanhamentoAdditionalProposalsNovelty(noveltyUser)) {
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

      if (!shouldShowAcompanhamentoAdditionalProposalsNovelty(noveltyUser)) {
        onSeenRef.current();
        return;
      }

      if (!document.querySelector(PROPOSAL_CONTRIBUTIONS_SELECTOR)) {
        if (attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        else onSeenRef.current();
        return;
      }

      const steps: DriveStep[] = [
        {
          popover: {
            title: '✨ Novidade: propostas adicionais',
            description:
              'O dashboard agora soma as propostas adicionais selecionadas no comercial junto da proposta principal do projeto.'
          }
        },
        {
          element: PROPOSAL_CONTRIBUTIONS_SELECTOR,
          popover: {
            title: 'Composição por proposta',
            description:
              'Abra esta seção para conferir quanto da venda, custo, lucro e impostos vem da proposta original e de cada adicional.',
            side: 'bottom',
            align: 'start'
          }
        }
      ];

      started.current = true;
      markAcompanhamentoAdditionalProposalsNoveltySeen(noveltyUser);
      const driverObj = driver({
        showProgress: false,
        nextBtnText: 'Ver composição',
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
