import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  hasSeenHubFirstLoginTutorial,
  markEfetivoHubNoveltySeen,
  shouldShowEfetivoHubNovelty
} from '../auth/moduleNavigation';
import type { AuthUser } from '../types/auth';

const MODULE_SELECTOR = '[data-hub-module-id="efetivo"]';

interface Props {
  user: AuthUser;
  enabled: boolean;
  onSeen: () => void;
}

export function EfetivoHubNovelty({ user, enabled, onSeen }: Props) {
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current || !hasSeenHubFirstLoginTutorial(user)) return;
    started.current = true;
    const timer = window.setTimeout(() => {
      if (!shouldShowEfetivoHubNovelty(user)) return onSeen();
      if (!document.querySelector(MODULE_SELECTOR) || document.body.classList.contains('driver-active')) {
        markEfetivoHubNoveltySeen(user);
        return onSeen();
      }
      markEfetivoHubNoveltySeen(user);
      driver({
        showProgress: false,
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        onDestroyed: onSeen,
        steps: [{
          element: MODULE_SELECTOR,
          popover: {
            title: '✨ Novo módulo: Efetivo Operacional',
            description: 'Acompanhe produtividade, improdutividade, pendências de cadastro e férias do efetivo a partir das horas sincronizadas do ponto.',
            side: 'bottom',
            align: 'start'
          }
        }]
      }).drive();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [enabled, onSeen, user]);

  return null;
}
