import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markAcompanhamentoGroupRenameNoveltySeen,
  shouldShowAcompanhamentoGroupRenameNovelty
} from '../../auth/moduleNavigation';
import type { AuthUser } from '../../types/auth';

const GROUP_RENAME_SELECTOR = '[data-acp-group-rename-start]';

interface ProjectGroupRenameNoveltyProps {
  user?: Pick<AuthUser, 'id'> | null;
  enabled: boolean;
  onSeen: () => void;
}

// Aviso temporário da edição inline de nomes em cards mesclados.
export function ProjectGroupRenameNovelty({ user, enabled, onSeen }: ProjectGroupRenameNoveltyProps) {
  const started = useRef(false);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!enabled || !userId || started.current) return undefined;
    const noveltyUser = { id: userId };
    if (!shouldShowAcompanhamentoGroupRenameNovelty(noveltyUser)) {
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

      if (!shouldShowAcompanhamentoGroupRenameNovelty(noveltyUser)) {
        onSeenRef.current();
        return;
      }

      if (!document.querySelector(GROUP_RENAME_SELECTOR)) {
        if (attempt < 20) retryTimer = window.setTimeout(() => startWhenReady(attempt + 1), 500);
        else onSeenRef.current();
        return;
      }

      const steps: DriveStep[] = [
        {
          popover: {
            title: '✨ Novidade: editar nome do card mesclado',
            description:
              'Gestores agora podem alterar o título do card mesclado sem mudar os nomes originais das missões.'
          }
        },
        {
          element: GROUP_RENAME_SELECTOR,
          popover: {
            title: 'Edição direto no título',
            description:
              'Use o lápis para editar o nome completo do card. Os códigos e nomes dos projetos continuam no subtítulo para referência.',
            side: 'bottom',
            align: 'end'
          }
        }
      ];

      started.current = true;
      markAcompanhamentoGroupRenameNoveltySeen(noveltyUser);
      const driverObj = driver({
        showProgress: false,
        nextBtnText: 'Ver edição',
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
