import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

const STORAGE_KEY_PREFIX = 'filtrovali-tutorial-done';

function normalizeTutorialIdentity(value: string) {
  return value.trim().toLowerCase();
}

function tutorialStorageKey(identity: string) {
  return `${STORAGE_KEY_PREFIX}:${normalizeTutorialIdentity(identity)}`;
}

function tutorialStorageIdentities(identity: string, legacyIdentities: string[] = []) {
  const identities = [identity, ...legacyIdentities]
    .map(normalizeTutorialIdentity)
    .filter(Boolean);
  return Array.from(new Set(identities));
}

function hasDoneTutorial(identity: string, legacyIdentities: string[] = []) {
  try {
    const identities = tutorialStorageIdentities(identity, legacyIdentities);
    const done = identities.some(item => localStorage.getItem(tutorialStorageKey(item)) === '1');
    if (done && identities[0]) {
      try {
        localStorage.setItem(tutorialStorageKey(identities[0]), '1');
      } catch {
        // A leitura já confirmou que o tutorial foi visto; falha ao migrar não deve reexibir.
      }
    }
    return done;
  } catch {
    return false;
  }
}

function markTutorialDone(identity: string, legacyIdentities: string[] = []) {
  try {
    tutorialStorageIdentities(identity, legacyIdentities).forEach(item => {
      localStorage.setItem(tutorialStorageKey(item), '1');
    });
  } catch {
    // ignore
  }
}

function buildSteps() {
  const steps: DriveStep[] = [
    {
      element: '.client-welcome-card',
      popover: {
        title: 'Bem-vindo ao Portal do Cliente',
        description:
          'Aqui você acompanha todos os relatórios liberados pelo gestor e realiza a aprovação ou reprovação de cada um.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '.stats-grid',
      popover: {
        title: 'Seu resumo',
        description:
          'Veja quantos relatórios estão disponíveis, quantos foram aprovados e quantos já possuem assinatura digital.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: 'input[aria-label="Buscar relatórios"]',
      popover: {
        title: 'Busca rápida',
        description:
          'Use este campo para encontrar um relatório pelo número, data ou tipo.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: window.matchMedia('(max-width: 1023px)').matches
        ? '.fv-topbar__menu'
        : '.fv-sidebar__navigation a[href*="?projeto="]',
      popover: {
        title: 'Seus projetos',
        description:
          'Os projetos vinculados à sua conta ficam no menu lateral. No celular, abra o menu para escolher outra obra.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '.det-section',
      popover: {
        title: 'Detalhes do projeto',
        description:
          'Aqui você vê as informações do projeto selecionado: nome, cliente, CNPJ e quantos relatórios estão visíveis.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: window.matchMedia('(max-width: 767px)').matches
        ? '.fv-bottom-bar'
        : '.filter-tabs[aria-label="Tipos de relatório"]',
      popover: {
        title: 'Tipos de relatório',
        description:
          'A barra inferior mostra os tipos existentes neste projeto. Use Mais para ver os demais; tipos em cinza aguardam liberação.',
        side: 'bottom',
        align: 'start',
      },
    },
  ];

  if (document.querySelector('.client-report-card')) steps.push({
    element: '.client-report-card',
    popover: {
      title: 'Card de relatório',
      description: 'Cada card mostra um relatório liberado. Clique para consultar os detalhes.',
      side: 'top',
      align: 'start',
    },
  });

  // Passo de download — sempre presente quando há card
  if (document.querySelector('.client-report-card .fv-button--secondary')) {
    steps.push({
      element: '.client-report-card .fv-button--secondary',
      popover: {
        title: 'Baixar PDF',
        description:
          'Clique aqui para fazer o download do relatório em PDF a qualquer momento, antes ou depois de assinar.',
        side: 'top',
        align: 'start',
      },
    });
  }

  // Passos condicionais — só aparecem quando há RDO aprovado e sigável
  if (document.querySelector('.client-report-comment textarea')) {
    steps.push({
      element: '.client-report-comment textarea',
      popover: {
        title: 'Comentário do cliente',
        description:
          'Antes de aprovar ou reprovar, você pode escrever um comentário. Ele ficará registrado no relatório final.',
        side: 'top',
        align: 'start',
      },
    });
  }

  if (document.querySelector('.client-report-actions .fv-button--primary')) {
    steps.push({
      element: '.client-report-actions .fv-button--primary',
      popover: {
        title: 'Assinar digitalmente',
        description:
          'Clique aqui para aprovar e assinar o RDO pelo sistema interno.',
        side: 'top',
        align: 'start',
      },
    });
  }

  if (document.querySelector('.client-report-actions .fv-button--danger')) {
    steps.push({
      element: '.client-report-actions .fv-button--danger',
      popover: {
        title: 'Reprovar relatório',
        description:
          'Se encontrar algum problema, preencha o comentário acima e clique em "Reprovar". O gestor será notificado e poderá corrigir o relatório.',
        side: 'top',
        align: 'start',
      },
    });
  }

  if (document.querySelector('.signature-progress')) {
    steps.push({
      element: '.signature-progress',
      popover: {
        title: 'Progresso de assinaturas',
        description:
          'Acompanhe quantas assinaturas já foram coletadas e quem já assinou o documento.',
        side: 'top',
        align: 'start',
      },
    });
  }

  if (document.querySelector('.report-batch-toolbar')) {
    steps.push({
      element: '.report-batch-toolbar',
      popover: {
        title: 'Ações em lote',
        description:
          'Selecione vários RDOs de uma vez para baixar todos ou enviar para assinatura em lote — tudo em uma única operação.',
        side: 'top',
        align: 'start',
      },
    });
  }

  // Passo informativo sobre relatórios técnicos (sem elemento)
  steps.push({
    popover: {
      title: 'Relatórios técnicos',
      description:
        'Após a assinatura do RDO, os relatórios técnicos dos serviços (limpeza química, teste de pressão, filtragem etc.) são liberados automaticamente na aba correspondente.',
    },
  });

  // Botão de conta — sempre presente
  if (document.querySelector('.fv-topbar-profile:not(:disabled)')) {
    steps.push({
      element: '.fv-topbar-profile:not(:disabled)',
      popover: {
        title: 'Sua conta',
        description:
          'Acesse aqui para alterar sua senha ou informações de perfil. Use "Sair" para encerrar a sessão.',
        side: 'bottom',
        align: 'end',
      },
    });
  }

  return steps.filter(step => !step.element || (typeof step.element === 'string' && document.querySelector(step.element)));
}

interface ClientTutorialProps {
  userKey: string;
  legacyUserKeys?: string[];
  ready: boolean;
  triggerRef: React.MutableRefObject<(() => void) | null>;
}

export function ClientTutorial({ userKey, legacyUserKeys = [], ready, triggerRef }: ClientTutorialProps) {
  const hasStarted = useRef(false);

  function startTutorial() {
    const steps = buildSteps();
    if (!steps.length) return;
    markTutorialDone(userKey, legacyUserKeys);

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
      onDestroyStarted: (_el, _step, { driver: d }) => {
        d.destroy();
      },
      steps,
    });

    driverObj.drive();
  }

  // Expõe o gatilho manual para o componente pai (botão "Ver tutorial")
  useEffect(() => {
    triggerRef.current = startTutorial;
  });

  // Dispara automaticamente no primeiro acesso
  useEffect(() => {
    if (!ready || hasStarted.current) return;
    if (hasDoneTutorial(userKey, legacyUserKeys)) return;
    hasStarted.current = true;
    // Pequeno delay para garantir que todos os elementos estejam no DOM
    const timer = setTimeout(startTutorial, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyUserKeys, ready, userKey]);

  return null;
}
