import { useEffect, useRef } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';

import { markSignatureBatchNoveltySeen, shouldShowSignatureBatchNovelty } from './utils/batchNovelty';

export function AssinaturasBatchNovelty({ userId, enabled }: { userId: string; enabled: boolean }) {
  const shownForUser = useRef('');

  useEffect(() => {
    if (!enabled || shownForUser.current === userId || !shouldShowSignatureBatchNovelty(userId)) return;
    let timer: number | undefined;
    let guide: Driver | undefined;
    let disposed = false;

    const startWhenReady = () => {
      if (disposed || !shouldShowSignatureBatchNovelty(userId)) return;
      const anchor = document.querySelector<HTMLElement>('[data-signature-new-document]');
      const modalOpen = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'))
        .some(element => !element.closest('[aria-hidden="true"], [hidden], [inert]')
          && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      if (!anchor?.getClientRects().length || document.body.classList.contains('driver-active')
        || modalOpen) {
        timer = window.setTimeout(startWhenReady, 1000);
        return;
      }

      guide = driver({
        showProgress: true,
        progressText: '{{current}} de {{total}}',
        nextBtnText: 'Próximo →',
        prevBtnText: '← Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        onHighlighted: () => {
          if (disposed || !guide?.isActive()) return;
          shownForUser.current = userId;
          markSignatureBatchNoveltySeen(userId);
        },
        steps: [
          {
            element: anchor,
            popover: {
              title: '✨ Novidade: assinatura em lote',
              description: 'Em Novo documento, selecione vários PDFs de uma vez para preparar um lote de assinaturas. São até 200 MB por arquivo, sem limite de quantidade.',
              side: 'bottom',
              align: 'end'
            }
          },
          {
            popover: {
              title: 'Um convite por assinante',
              description: 'Cadastre as pessoas uma vez e posicione as assinaturas nos PDFs desejados. Cada pessoa recebe um único link com seus documentos e assina todos de uma vez.'
            }
          },
          {
            popover: {
              title: 'Acompanhe o lote',
              description: 'O lote aparece em um único card na biblioteca. Ao abrir, você acompanha as assinaturas e copia, reenvia ou renova os links de cada pessoa. Os PDFs finais continuam separados.'
            }
          }
        ]
      });
      guide.drive();
    };

    // O tutorial inicial começa antes. Se estiver aberto, o aviso aguarda sua conclusão.
    timer = window.setTimeout(startWhenReady, 1200);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      guide?.destroy();
    };
  }, [enabled, userId]);

  return null;
}
