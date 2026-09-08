import { useCallback, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import { releaseEfetivoGuide, reserveEfetivoGuide } from '../../utils/efetivoGuideCoordinator';
import type { EfetivoPlanningSection } from '../../utils/planningNavigation';

const STORAGE_KEY_PREFIX = 'filtrovali:efetivo-tutorial-done:v2:';
function storageKey(userKey: string) { return `${STORAGE_KEY_PREFIX}${userKey}`; }
function hasDone(userKey: string) { try { return localStorage.getItem(storageKey(userKey)) === '1'; } catch { return false; } }
function markDone(userKey: string) { try { localStorage.setItem(storageKey(userKey), '1'); } catch { /* sessão sem armazenamento */ } }

export function EfetivoTutorial({ userKey, ready, goToSection, triggerRef }: {
  userKey: string;
  ready: boolean;
  goToSection: (section: EfetivoPlanningSection) => void;
  triggerRef: MutableRefObject<(() => void) | null>;
}) {
  const startTutorial = useCallback(() => {
    if (!userKey || !reserveEfetivoGuide()) return;
    markDone(userKey);
    goToSection('visao-geral');
    window.setTimeout(() => {
      const navigateNext = (section: EfetivoPlanningSection) => (_element: Element | undefined, _step: unknown, options: { driver: { moveNext: () => void } }) => { goToSection(section); window.setTimeout(() => options.driver.moveNext(), 300); };
      const steps: DriveStep[] = [
        { element: '[data-efetivo-nav]', popover: { title: 'Oito áreas integradas', description: 'Visão geral, calendário, pessoas, missões, evolução, simulações, produtividade e administração compartilham a mesma base.', side: 'right', align: 'start' } },
        { element: '[data-efetivo-planning-filters]', popover: { title: 'Posição do planejamento', description: 'A data e a função ficam na URL e sobrevivem ao refresh.', side: 'bottom', align: 'start' } },
        { element: '[data-efetivo-planning-kpis]', popover: { title: 'Capacidade diária', description: 'Veja ativos, alocados, indisponíveis, livres, déficit e utilização futura.', side: 'bottom', align: 'start', onNextClick: navigateNext('calendario') } },
        { element: '[data-efetivo-calendar]', popover: { title: 'Calendário integrado', description: 'Alterne entre dia, semana e mês e abra qualquer data para ver missões e ausências.', side: 'top', align: 'start', onNextClick: navigateNext('missoes') } },
        { element: '[data-efetivo-missions]', popover: { title: 'Missões e equipes', description: 'As missões vêm dos projetos cadastrados: abra os cards amarelos para completar cronologia, responsável e selecionar colaboradores pelo nome ou cargo.', side: 'top', align: 'start', onNextClick: navigateNext('evolucao') } },
        { element: '[data-efetivo-kanban]', popover: { title: 'Evolução acessível', description: 'Cada etapa tem sua cor. Arraste o card por qualquer área — no celular, segure para pegar — ou use o seletor de etapa; cancelar restaura a ordem anterior.', side: 'top', align: 'start', onNextClick: navigateNext('simulacoes') } },
        { element: '[data-efetivo-scenarios]', popover: { title: 'Simule antes de aplicar', description: 'Compare capacidade e déficit; o oficial só muda após validação transacional.', side: 'top', align: 'start' } }
      ];
      try {
        driver({ showProgress: true, progressText: '{{current}} de {{total}}', nextBtnText: 'Próximo →', prevBtnText: '← Anterior', doneBtnText: 'Concluir', allowClose: true, animate: true, smoothScroll: true, overlayOpacity: 0.6, onDestroyed: () => releaseEfetivoGuide(), steps }).drive();
      } catch (error) {
        releaseEfetivoGuide();
        throw error;
      }
    }, 350);
  }, [goToSection, userKey]);
  useEffect(() => { triggerRef.current = startTutorial; return () => { if (triggerRef.current === startTutorial) triggerRef.current = null; }; }, [startTutorial, triggerRef]);
  useEffect(() => { if (!ready || !userKey || hasDone(userKey)) return; const timer = window.setTimeout(startTutorial, 800); return () => window.clearTimeout(timer); }, [ready, startTutorial, userKey]);
  return null;
}
