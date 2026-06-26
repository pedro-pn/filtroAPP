import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import { hasSeenHubFirstLoginTutorial, markHubFirstLoginTutorialSeen } from '../auth/moduleNavigation';
import type { AuthUser } from '../types/auth';
import type { HubModuleEntry } from '../pages/hubModules';

const MODULE_TUTORIAL_COPY: Partial<Record<HubModuleEntry['id'], string>> = {
  rdo: 'Use este módulo para criar, acompanhar e aprovar relatórios, acessar projetos, clientes e estatísticas.',
  admin: 'Use este módulo para administrar contas, tipos de acesso e permissões dos usuários do sistema.',
  equipamentos: 'Use este módulo para consultar e manter equipamentos, calibrações, certificados e dados técnicos.',
  romaneio: 'Use este módulo para registrar entradas, saídas e movimentações de equipamentos em romaneios.',
  epi: 'Use este módulo para controlar fichas de entrega, devolução e assinatura de EPIs por colaborador.',
  privacy: 'Use este módulo para acompanhar solicitações LGPD, protocolos e respostas aos titulares.'
};

function availableModules(modules: HubModuleEntry[]) {
  return modules.filter(module => module.path && !module.disabled);
}

function escapeCssSelectorValue(value: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function buildSteps(modules: HubModuleEntry[]) {
  const available = availableModules(modules);
  const steps: DriveStep[] = [
    {
      element: '.hub-module-grid',
      popover: {
        title: 'Seus módulos',
        description: 'Esta tela reúne os módulos liberados para a sua conta. Clique em um card para entrar no módulo correspondente.',
        side: 'top',
        align: 'start'
      }
    }
  ];

  available.forEach(module => {
    steps.push({
      element: `[data-hub-module-id="${escapeCssSelectorValue(module.id)}"]`,
      popover: {
        title: module.title,
        description: MODULE_TUTORIAL_COPY[module.id] || module.copy,
        side: 'bottom',
        align: 'start'
      }
    });
  });

  return steps;
}

interface HubTutorialProps {
  user: AuthUser;
  modules: HubModuleEntry[];
  ready: boolean;
  triggerRef: MutableRefObject<(() => void) | null>;
}

export function HubTutorial({ user, modules, ready, triggerRef }: HubTutorialProps) {
  const hasStarted = useRef(false);
  const availableModuleCount = availableModules(modules).length;

  const startTutorial = useCallback(() => {
    if (document.body.classList.contains('driver-active')) return;
    const steps = buildSteps(modules);
    if (!steps.length) return;

    hasStarted.current = true;
    markHubFirstLoginTutorialSeen(user);

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

    window.setTimeout(() => driverObj.drive(), 250);
  }, [modules, user]);

  useEffect(() => {
    triggerRef.current = startTutorial;
    return () => {
      if (triggerRef.current === startTutorial) {
        triggerRef.current = null;
      }
    };
  }, [startTutorial, triggerRef]);

  useEffect(() => {
    if (!ready || hasStarted.current || availableModuleCount <= 1) return;
    if (hasSeenHubFirstLoginTutorial(user)) return;
    const timer = window.setTimeout(startTutorial, 600);
    return () => window.clearTimeout(timer);
  }, [availableModuleCount, ready, startTutorial, user]);

  return null;
}
