import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markEfetivoControlNoveltySeen,
  shouldShowEfetivoControlNovelty,
  type EfetivoControlNoveltyId
} from '../auth/moduleNavigation';
import type { AuthUser } from '../types/auth';

const CONTENT: Record<EfetivoControlNoveltyId, { title: string; description: string }> = {
  'operational-role': {
    title: '✨ Nova definição de função operacional',
    description: 'Defina quais cargos entram no indicador oficial do Efetivo. Apenas gestores do módulo podem alterar esta marcação.'
  },
  'termination-date': {
    title: '✨ Nova data de desligamento',
    description: 'Informe o último dia do vínculo para o cálculo considerar somente a fração trabalhada no mês de desligamento.'
  }
};

interface Props {
  user?: Pick<AuthUser, 'id'> | null;
  control: EfetivoControlNoveltyId;
  selector: string;
}

export function EfetivoControlNovelty({ user, control, selector }: Props) {
  const started = useRef(false);
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!userId || started.current) return;
    const noveltyUser = { id: userId };
    if (!shouldShowEfetivoControlNovelty(noveltyUser, control)) return;

    const start = () => {
      const target = document.querySelector(selector);
      if (!target || document.body.classList.contains('driver-active') || started.current) return;
      started.current = true;
      window.clearInterval(retryTimer);
      markEfetivoControlNoveltySeen(noveltyUser, control);
      driver({
        showProgress: false,
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        steps: [{ element: selector, popover: { ...CONTENT[control], side: 'bottom', align: 'start' } }]
      }).drive();
    };

    const timer = window.setTimeout(start, 700);
    const retryTimer = window.setInterval(start, 500);
    const observer = new MutationObserver(start);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(retryTimer);
      observer.disconnect();
    };
  }, [control, selector, userId]);

  return null;
}
