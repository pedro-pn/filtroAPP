import { useEffect, useRef } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markSignatureSharingNoveltySeen,
  shouldShowSignatureSharingNovelty,
  SIGNATURE_SHARING_NOVELTY_EXPIRES_AT
} from './utils/sharingNovelty';

export function AssinaturasSharingNovelty({ userId, enabled }: { userId: string; enabled: boolean }) {
  const shownForUser = useRef('');

  useEffect(() => {
    if (!enabled || shownForUser.current === userId || !shouldShowSignatureSharingNovelty(userId)) return;
    let timer: number | undefined;
    let guide: Driver | undefined;
    let disposed = false;
    const visible = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))
      .find(element => !element.closest('[hidden], [inert], [aria-hidden="true"]')
        && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');

    const stop = () => {
      disposed = true;
      window.clearTimeout(timer);
      if (document.querySelector('.signature-sharing-novelty')) guide?.destroy();
    };

    const startWhenReady = () => {
      if (disposed || !shouldShowSignatureSharingNovelty(userId)) return;
      const shareButton = visible('[data-signature-share]');
      const library = visible('.assinaturas-library');
      if ((!shareButton && !library) || document.body.classList.contains('driver-active') || visible('[aria-modal="true"]')) {
        timer = window.setTimeout(startWhenReady, 1000);
        return;
      }
      const documentCard = visible('[data-signature-share-document]');
      const entry = shareButton || documentCard || visible('[data-signature-new-document]');
      guide = driver({
        popoverClass: 'signature-sharing-novelty',
        showProgress: true,
        progressText: '{{current}} de {{total}}',
        nextBtnText: 'Próximo →',
        prevBtnText: '← Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        disableActiveInteraction: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        onHighlighted: () => {
          if (disposed || !guide?.isActive() || shownForUser.current === userId) return;
          shownForUser.current = userId;
          markSignatureSharingNoveltySeen(userId);
        },
        steps: [
          { popover: {
            title: '✨ Novidade: compartilhar documentos',
            description: 'Agora você pode compartilhar um PDF com outros usuários que também têm acesso a Assinaturas. O documento aparece na biblioteca de quem recebe.'
          } },
          { ...(entry ? { element: entry } : {}), popover: {
            title: shareButton ? 'Use o botão Compartilhar' : documentCard ? 'Abra um documento seu' : 'Comece com um PDF',
            description: shareButton
              ? 'Clique em Compartilhar para selecionar um usuário e definir a permissão. Você também pode alterar a permissão ou remover o acesso por esse botão.'
              : documentCard
                ? 'Abra o documento e use Compartilhar. Em lotes, o botão aparece ao lado de cada PDF: compartilhar um deles mantém os demais restritos.'
                : 'Envie um PDF em Novo documento. Depois, abra o documento e use Compartilhar para escolher quem terá acesso.',
            side: 'bottom', align: 'start'
          } },
          { popover: {
            title: 'Você define o acesso',
            description: '<strong>Apenas visualizar:</strong> permite consultar e baixar o PDF.<br><strong>Pode editar:</strong> permite ajustar o rascunho e os campos de assinatura. Publicação, convites e exclusão continuam com o proprietário. Você pode mudar a permissão ou remover o acesso depois.'
          } }
        ]
      });
      guide.drive();
    };

    const expiryTimer = window.setTimeout(stop, SIGNATURE_SHARING_NOVELTY_EXPIRES_AT.getTime() - Date.now());
    // O onboarding do módulo começa antes; a campanha aguarda tutoriais e formulários.
    timer = window.setTimeout(startWhenReady, 1200);
    return () => {
      stop();
      window.clearTimeout(expiryTimer);
    };
  }, [enabled, userId]);

  return null;
}
