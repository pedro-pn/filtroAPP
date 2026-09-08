import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import {
  markAcompanhamentoGroupingNoveltySeen,
  shouldShowAcompanhamentoGroupingNovelty
} from '../auth/moduleNavigation';
import type { AuthUser } from '../types/auth';

const STORAGE_KEY_PREFIX = 'filtrovali-acompanhamento-tutorial-done';

type Section = 'dashboard' | 'projetos' | 'sede' | 'custo';

function storageKey(identity: string) {
  return `${STORAGE_KEY_PREFIX}:${identity}`;
}

function hasDoneTutorial(identity: string) {
  try {
    return localStorage.getItem(storageKey(identity)) === '1';
  } catch {
    return false;
  }
}

function markTutorialDone(identity: string) {
  try {
    localStorage.setItem(storageKey(identity), '1');
  } catch {
    // localStorage pode estar indisponível; o guard em memória evita reabrir na mesma sessão.
  }
}

interface AcompanhamentoTutorialProps {
  userKey: string;
  ready: boolean;
  goToSection: (section: Section) => void;
  triggerRef: MutableRefObject<(() => void) | null>;
  groupingNoveltyEnabled?: boolean;
  groupingNoveltyUser?: Pick<AuthUser, 'id'> | null;
  projectSectionActive?: boolean;
}

export function AcompanhamentoTutorial({
  userKey,
  ready,
  goToSection,
  triggerRef,
  groupingNoveltyEnabled = false,
  groupingNoveltyUser = null,
  projectSectionActive = false
}: AcompanhamentoTutorialProps) {
  const groupingNoveltyStarted = useRef(false);
  const groupingNoveltyUserId = groupingNoveltyUser?.id ?? '';

  const startTutorial = useCallback(() => {
    if (!userKey) return;
    if (document.body.classList.contains('driver-active')) return;

    markTutorialDone(userKey);
    goToSection('dashboard');

    // Constrói os passos após a troca para o Dashboard renderizar (detecção correta dos alvos).
    window.setTimeout(() => {
    const hasDashboard = Boolean(document.querySelector('[data-acp-dashboard-filters]'));
    const navSelector = window.matchMedia('(max-width: 900px)').matches ? '[data-acp-mobile-nav]' : '[data-acp-nav]';

    const steps: DriveStep[] = [];
    steps.push({
      element: navSelector,
      popover: {
        title: 'Abas do módulo',
        description: 'Alterne entre Dashboard, Projetos e Sede. Gestores também têm a aba Custo (motor de custo operacional).',
        side: 'right',
        align: 'start',
        // Sem dashboard (ainda carregando/sem dados): já pula direto para a aba Projetos.
        ...(hasDashboard ? {} : {
          onNextClick: (_element, _step, { driver: driverObj }) => {
            goToSection('projetos');
            window.setTimeout(() => driverObj.moveNext(), 200);
          }
        })
      }
    });

    if (hasDashboard) {
      steps.push({
        element: '[data-acp-dashboard-filters]',
        popover: {
          title: 'Filtros',
          description: 'Busca, modalidade, situação (em andamento / arquivados / todos), categoria de gasto e o indicador exibido no gráfico.',
          side: 'bottom',
          align: 'start'
        }
      });
      steps.push({
        element: '[data-acp-kpis]',
        popover: {
          title: 'Indicadores',
          description: 'Totais dos projetos filtrados: quantidade, venda e custo previstos, e a soma do indicador escolhido.',
          side: 'bottom',
          align: 'start'
        }
      });
      steps.push({
        element: '[data-acp-dashboard-table]',
        popover: {
          title: 'Tabela de projetos',
          description: 'Previsto × realizado por projeto (venda, custo, margem, dias, RDOs e avanço). Clique numa linha para abrir o cronograma.',
          side: 'top',
          align: 'start',
          onNextClick: (_element, _step, { driver: driverObj }) => {
            goToSection('projetos');
            window.setTimeout(() => driverObj.moveNext(), 200);
          }
        }
      });
    }

    steps.push({
      element: '[data-acp-cards-seg]',
      popover: {
        title: 'Em andamento × Arquivados',
        description: 'Separe os projetos pela situação nos relatórios. A busca opera dentro da situação selecionada.',
        side: 'bottom',
        align: 'start'
      }
    });
    steps.push({
      element: '[data-acp-cards]',
      popover: {
        title: 'Cards de projeto',
        description: 'Cada card mostra dias trabalhados/consumidos, avanço do escopo, status do último dia, colaboradores e prazos. Clique para abrir o dashboard do projeto.',
        side: 'top',
        align: 'start'
      }
    });

    const driverObj = driver({
      showProgress: true,
      progressText: '{{current}} de {{total}}',
      nextBtnText: 'Próximo →',
      prevBtnText: '← Anterior',
      doneBtnText: 'Concluir',
      allowClose: true,
      animate: true,
      smoothScroll: true,
      overlayOpacity: 0.6,
      steps
    });

    driverObj.drive();
    }, 250);
  }, [goToSection, userKey]);

  const startGroupingTutorial = useCallback((includeNoveltyIntro = false) => {
    if (document.body.classList.contains('driver-active')) return;

    goToSection('projetos');

    const buildAndStart = (attempt = 0) => {
      const steps: DriveStep[] = [];
      const segmentSelector = '[data-acp-cards-seg]';
      const startSelector = '[data-acp-group-start]';
      const cardsSelector = '[data-acp-cards]';
      const toolbarSelector = '[data-acp-group-toolbar]';

      if (includeNoveltyIntro) {
        steps.push({
          popover: {
            title: '✨ Novidade: unificar projetos',
            description:
              'Agora dá para agrupar missões do mesmo cliente no Acompanhamento. O card agrupado consolida custos, faturamento, colaboradores, impostos, progresso e cronograma, mantendo as propostas originais separadas.'
          }
        });
      }

      if (document.querySelector(segmentSelector)) {
        steps.push({
          element: segmentSelector,
          popover: {
            title: 'Aba Projetos',
            description: 'O agrupamento começa aqui. A busca e os filtros ajudam a deixar na tela apenas as missões que serão unificadas.',
            side: 'bottom',
            align: 'start'
          }
        });
      }

      if (document.querySelector(startSelector)) {
        steps.push({
          element: startSelector,
          popover: {
            title: 'Iniciar unificação',
            description: 'Clique em Unificar projetos para abrir o modo de seleção dos cards.',
            side: 'bottom',
            align: 'start',
            onNextClick: (_element, _step, { driver: driverObj }) => {
              const button = document.querySelector<HTMLButtonElement>(startSelector);
              button?.click();
              window.setTimeout(() => driverObj.moveNext(), 180);
            }
          }
        });
      }

      if (document.querySelector(cardsSelector)) {
        steps.push({
          element: cardsSelector,
          popover: {
            title: 'Selecionar missões',
            description: 'Com o modo de seleção aberto, marque dois ou mais cards do mesmo cliente. A validação usa o CNPJ para confirmar que pertencem ao mesmo cliente.',
            side: 'top',
            align: 'start'
          }
        });
      }

      if (document.querySelector(toolbarSelector)) {
        steps.push({
          element: toolbarSelector,
          popover: {
            title: 'Confirmar ou desfazer',
            description: 'Depois de confirmar, o card agrupado abre o dashboard consolidado. O botão Desmesclar no card agrupado reverte a operação sem alterar os dados originais.',
            side: 'bottom',
            align: 'end'
          }
        });
      }

      const minimumSteps = includeNoveltyIntro ? 2 : 1;
      if (steps.length < minimumSteps && attempt < 10) {
        window.setTimeout(() => buildAndStart(attempt + 1), 300);
        return;
      }

      if (steps.length === 0) return;

      const driverObj = driver({
        showProgress: !includeNoveltyIntro,
        progressText: '{{current}} de {{total}}',
        nextBtnText: includeNoveltyIntro ? 'Ver como agrupar' : 'Próximo →',
        prevBtnText: '← Anterior',
        doneBtnText: includeNoveltyIntro ? 'Entendi' : 'Concluir',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        steps
      });

      driverObj.drive();
    };

    window.setTimeout(() => buildAndStart(), 350);
  }, [goToSection]);

  // Gatilho manual (botão "Ver tutorial").
  useEffect(() => {
    triggerRef.current = startTutorial;
    return () => {
      if (triggerRef.current === startTutorial) triggerRef.current = null;
    };
  }, [startTutorial, triggerRef]);

  useEffect(() => {
    if (!groupingNoveltyEnabled || !projectSectionActive || !groupingNoveltyUserId || groupingNoveltyStarted.current) return undefined;
    const noveltyUser = { id: groupingNoveltyUserId };
    if (!shouldShowAcompanhamentoGroupingNovelty(noveltyUser)) return undefined;

    let cancelled = false;
    let retryTimer: number | undefined;
    const startWhenAvailable = (attempt = 0) => {
      if (cancelled) return;
      if (document.body.classList.contains('driver-active')) {
        if (attempt < 20) {
          retryTimer = window.setTimeout(() => startWhenAvailable(attempt + 1), 500);
        }
        return;
      }

      if (!shouldShowAcompanhamentoGroupingNovelty(noveltyUser)) return;
      groupingNoveltyStarted.current = true;
      markAcompanhamentoGroupingNoveltySeen(noveltyUser);
      startGroupingTutorial(true);
    };

    const timer = window.setTimeout(startWhenAvailable, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [groupingNoveltyEnabled, groupingNoveltyUserId, projectSectionActive, startGroupingTutorial]);

  // Auto-inicia no primeiro acesso ao módulo.
  useEffect(() => {
    if (!ready || !userKey || hasDoneTutorial(userKey)) return;
    const timer = window.setTimeout(startTutorial, 800);
    return () => window.clearTimeout(timer);
  }, [ready, startTutorial, userKey]);

  return null;
}
