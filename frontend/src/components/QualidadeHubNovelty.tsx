import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  hasSeenHubFirstLoginTutorial,
  markQualidadeNoveltySeen,
  shouldShowQualidadeNovelty
} from '../auth/moduleNavigation';
import type { AuthUser } from '../types/auth';

const MODULE_SELECTOR = '[data-hub-module-id="qualidade"]';

interface QualidadeHubNoveltyProps {
  user: AuthUser;
  enabled: boolean;
  onSeen: () => void;
}

// Destaque temporário do módulo Qualidade no hub, para contas com acesso ativo.
export function QualidadeHubNovelty({ user, enabled, onSeen }: QualidadeHubNoveltyProps) {
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    if (!hasSeenHubFirstLoginTutorial(user)) return;

    started.current = true;
    const timer = window.setTimeout(() => {
      if (!shouldShowQualidadeNovelty(user)) {
        onSeen();
        return;
      }

      if (!document.querySelector(MODULE_SELECTOR) || document.body.classList.contains('driver-active')) {
        markQualidadeNoveltySeen(user);
        onSeen();
        return;
      }

      markQualidadeNoveltySeen(user);
      const driverObj = driver({
        showProgress: false,
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        onDestroyed: () => onSeen(),
        steps: [
          {
            element: MODULE_SELECTOR,
            popover: {
              title: 'Novo módulo: Qualidade',
              description:
                'Registre desvios, reclamações, incidentes, melhorias e lições aprendidas do SGQ. O módulo também organiza evidências, recorrências e exportação da planilha.',
              side: 'bottom',
              align: 'start'
            }
          }
        ]
      });
      driverObj.drive();
    }, 700);

    return () => window.clearTimeout(timer);
  }, [enabled, onSeen, user]);

  return null;
}
