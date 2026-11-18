import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markAcompanhamentoCollaboratorsNoveltySeen,
  shouldShowAcompanhamentoCollaboratorsNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

const TAXA_GERAL_SELECTOR = '[data-acp-colab-taxa-geral]';
const YEAR_SELECTOR = '[data-acp-colab-year]';
const AVAILABLE_SELECTOR = '[data-acp-colab-available]';

interface CollaboratorsNoveltyProps {
  user?: Pick<AuthUser, 'id'> | null;
  enabled: boolean;
  onSeen: () => void;
}

export function CollaboratorsNovelty({ user, enabled, onSeen }: CollaboratorsNoveltyProps) {
  const started = useRef(false);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!enabled || !userId || started.current) return undefined;
    const noveltyUser = { id: userId };
    if (!shouldShowAcompanhamentoCollaboratorsNovelty(noveltyUser)) {
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

      if (!shouldShowAcompanhamentoCollaboratorsNovelty(noveltyUser)) {
        onSeenRef.current();
        return;
      }

      const steps: DriveStep[] = [
        {
          popover: {
            title: 'Nova aba: Colaboradores',
            description:
              'Gestores agora acompanham a Taxa Geral de Improdutividade, a média mensal de HH produtivas e a alocação da equipe operacional.'
          }
        }
      ];

      if (document.querySelector(TAXA_GERAL_SELECTOR)) {
        steps.push({
          element: TAXA_GERAL_SELECTOR,
          popover: {
            title: 'Taxa Geral',
            description:
              'Este indicador resume a média das taxas individuais dos colaboradores operacionais com ponto no ano.',
            side: 'bottom',
            align: 'start'
          }
        });
      }

      if (document.querySelector(YEAR_SELECTOR)) {
        steps.push({
          element: YEAR_SELECTOR,
          popover: {
            title: 'Ano analisado',
            description:
              'Troque o ano para recalcular HH acumuladas, médias mensais e o detalhe mês a mês.',
            side: 'bottom',
            align: 'start'
          }
        });
      }

      if (document.querySelector(AVAILABLE_SELECTOR)) {
        steps.push({
          element: AVAILABLE_SELECTOR,
          popover: {
            title: 'Disponíveis',
            description:
              'Use este filtro para ver apenas colaboradores cuja situação atual é sede.',
            side: 'bottom',
            align: 'start'
          }
        });
      }

      started.current = true;
      markAcompanhamentoCollaboratorsNoveltySeen(noveltyUser);
      const driverObj = driver({
        showProgress: false,
        nextBtnText: 'Ver recurso',
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
