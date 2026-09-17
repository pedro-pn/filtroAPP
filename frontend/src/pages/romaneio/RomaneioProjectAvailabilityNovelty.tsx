import { useEffect } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markRomaneioProjectAvailabilityNoveltySeen,
  shouldShowRomaneioProjectAvailabilityNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

export function RomaneioProjectAvailabilityNovelty({
  user,
  enabled
}: {
  user?: Pick<AuthUser, 'id'> | null;
  enabled: boolean;
}) {
  const userId = user?.id || '';

  useEffect(() => {
    if (!enabled || !userId || !shouldShowRomaneioProjectAvailabilityNovelty({ id: userId })) return undefined;
    let cancelled = false;
    let retryTimer: number | undefined;
    let guide: ReturnType<typeof driver> | null = null;

    const start = (attempt = 0) => {
      if (cancelled || !shouldShowRomaneioProjectAvailabilityNovelty({ id: userId })) return;
      const controlsReady = document.querySelector('[data-romaneio-project-type]')
        && document.querySelector('[data-romaneio-project-select]');
      if (!controlsReady || document.body.classList.contains('driver-active')) {
        if (attempt < 20) retryTimer = window.setTimeout(() => start(attempt + 1), 500);
        return;
      }

      markRomaneioProjectAvailabilityNoveltySeen({ id: userId });
      guide = driver({
        showProgress: true,
        progressText: '{{current}} de {{total}}',
        nextBtnText: 'Próximo →',
        prevBtnText: '← Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        overlayOpacity: 0.6,
        steps: [
          {
            popover: {
              title: '✨ Projetos disponíveis por tipo',
              description: 'A lista de obras do romaneio agora acompanha o tipo selecionado e a autorização de mobilização.'
            }
          },
          {
            element: '[data-romaneio-project-type]',
            popover: {
              title: 'Escolha entre Saída e Entrada',
              description: 'Saída mostra obras autorizadas para mobilização e obras antigas ainda abertas. Entrada permanece disponível para todas as obras acessíveis.',
              side: 'bottom',
              align: 'start'
            }
          },
          {
            element: '[data-romaneio-project-select]',
            popover: {
              title: 'Selecione a obra',
              description: 'Ao trocar o tipo, a lista é atualizada e a seleção anterior é limpa para evitar uma movimentação na obra errada.',
              side: 'bottom',
              align: 'start'
            }
          }
        ]
      });
      guide.drive();
    };

    const timer = window.setTimeout(() => start(), 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      guide?.destroy();
    };
  }, [enabled, userId]);

  return null;
}
