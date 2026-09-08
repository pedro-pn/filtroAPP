import { useEffect } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

import { releaseEfetivoGuide, reserveEfetivoGuide } from '../../utils/efetivoGuideCoordinator';
import { markEfetivoPlanningNoveltySeen, shouldShowEfetivoPlanningNovelty } from '../../utils/efetivoPlanningNovelty';

export function EfetivoPlanningNovelty({ userId }: { userId: string }) {
  useEffect(() => {
    if (!shouldShowEfetivoPlanningNovelty(userId)) return;
    const timer = window.setTimeout(() => {
      if (!document.querySelector('[data-efetivo-content]') || !reserveEfetivoGuide()) return;
      markEfetivoPlanningNoveltySeen(userId);
      try {
        driver({ showProgress: false, doneBtnText: 'Conhecer o planejamento', allowClose: true, overlayOpacity: 0.6, onDestroyed: () => releaseEfetivoGuide(), steps: [{ element: '[data-efetivo-content]', popover: { title: '✨ Planejamento completo do Efetivo', description: 'Capacidade, calendário, missões, evolução, simulações e administração agora trabalham sobre a mesma programação oficial.', side: 'bottom', align: 'center' } }] }).drive();
      } catch (error) {
        releaseEfetivoGuide();
        throw error;
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [userId]);
  return null;
}
