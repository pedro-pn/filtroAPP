import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markPhotoCaptureNoveltySeen,
  shouldShowPhotoCaptureNovelty,
  type PhotoCaptureNoveltyPlacement
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

const PHOTO_CAPTURE_SELECTOR = '[data-photo-capture]';
const RETRY_MS = 1500;

const DESCRIPTIONS: Record<PhotoCaptureNoveltyPlacement, string> = {
  'rdo-new': 'Agora, ao adicionar fotos ao RDO, você pode abrir a câmera do aparelho e fotografar na hora, sem sair do relatório.',
  'rdo-edit': 'Agora, ao adicionar fotos ao RDO, você pode abrir a câmera do aparelho e fotografar na hora, sem sair do relatório.',
  maintenance: 'Agora, ao adicionar fotos à manutenção, você pode abrir a câmera do aparelho e fotografar na hora, sem sair do relatório.'
};

function firstVisibleCaptureButton() {
  return Array.from(document.querySelectorAll<HTMLElement>(PHOTO_CAPTURE_SELECTOR))
    .find(button => !button.hasAttribute('disabled') && button.getClientRects().length > 0) ?? null;
}

interface PhotoCaptureNoveltyProps {
  user?: Pick<AuthUser, 'id'> | null;
  placement: PhotoCaptureNoveltyPlacement;
  enabled?: boolean;
}

// Destaque temporário (5 dias) do botão "Tirar foto". Espera o botão aparecer na tela — ele pode estar
// numa etapa ainda não aberta do formulário — e não sobrepõe outro destaque em andamento.
export function PhotoCaptureNovelty({ user, placement, enabled = true }: PhotoCaptureNoveltyProps) {
  const started = useRef(false);
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!enabled || !userId || started.current) return undefined;
    const noveltyUser = { id: userId };
    if (!shouldShowPhotoCaptureNovelty(noveltyUser, placement)) return undefined;

    let timer: number | undefined;
    const startWhenReady = () => {
      if (started.current) return;
      if (!shouldShowPhotoCaptureNovelty(noveltyUser, placement)) return;
      const button = firstVisibleCaptureButton();
      if (!button || document.body.classList.contains('driver-active')) {
        timer = window.setTimeout(startWhenReady, RETRY_MS);
        return;
      }

      const steps: DriveStep[] = [
        {
          popover: {
            title: '✨ Novidade: tire a foto na hora',
            description: DESCRIPTIONS[placement]
          }
        },
        {
          element: button,
          popover: {
            title: 'Tirar foto',
            description: 'Toque aqui para abrir a câmera. Você pode tirar várias fotos seguidas, descartar as que não ficaram boas e adicionar todas de uma vez. Continua dando para escolher fotos da galeria pela área acima.',
            side: 'top',
            align: 'start'
          }
        }
      ];

      started.current = true;
      markPhotoCaptureNoveltySeen(noveltyUser, placement);
      driver({
        showProgress: false,
        nextBtnText: 'Ver onde fica',
        prevBtnText: 'Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        steps
      }).drive();
    };

    timer = window.setTimeout(startWhenReady, 700);
    return () => window.clearTimeout(timer);
  }, [enabled, placement, userId]);

  return null;
}
