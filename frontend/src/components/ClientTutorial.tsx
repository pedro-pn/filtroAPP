import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const STORAGE_KEY_PREFIX = 'filtrovali-tutorial-done';

function tutorialStorageKey(userId: string) {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

function hasDoneTutorial(userId: string) {
  try {
    return localStorage.getItem(tutorialStorageKey(userId)) === '1';
  } catch {
    return false;
  }
}

function markTutorialDone(userId: string) {
  try {
    localStorage.setItem(tutorialStorageKey(userId), '1');
  } catch {
    // ignore
  }
}

function buildSteps() {
  const steps: Parameters<typeof driver>[0]['steps'] = [
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
      element: '.filter-tabs[aria-label="Projetos do cliente"]',
      popover: {
        title: 'Seus projetos',
        description:
          'Cada aba representa um projeto vinculado à sua conta. Clique para alternar entre eles e ver os relatórios de cada obra.',
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
      element: '.filter-tabs[aria-label="Tipos de relatório"]',
      popover: {
        title: 'Tipos de relatório',
        description:
          'Um projeto pode ter RDOs (Relatório Diário de Obra) e relatórios técnicos de serviço. Use estas abas para navegar entre eles.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '.client-report-card',
      popover: {
        title: 'Card de relatório',
        description:
          'Cada card representa um relatório. O status aparece no canto direito: Pendente, Aprovado, Assinado ou Reprovado. Clique no card para ver todos os detalhes.',
        side: 'top',
        align: 'start',
      },
    },
  ];

  // Passo de download — sempre presente quando há card
  if (document.querySelector('.client-report-card .secondary-button')) {
    steps.push({
      element: '.client-report-card .secondary-button',
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

  if (document.querySelector('.client-report-actions .primary-button')) {
    steps.push({
      element: '.client-report-actions .primary-button',
      popover: {
        title: 'Assinar digitalmente',
        description:
          'Clique aqui para aprovar e assinar o RDO digitalmente via ZapSign. Você será redirecionado para concluir a assinatura.',
        side: 'top',
        align: 'start',
      },
    });
  }

  if (document.querySelector('.client-report-actions .danger-button')) {
    steps.push({
      element: '.client-report-actions .danger-button',
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
  if (document.querySelector('.topbar-chip')) {
    steps.push({
      element: '.topbar-chip',
      popover: {
        title: 'Sua conta',
        description:
          'Acesse aqui para alterar sua senha ou informações de perfil. Use "Sair" para encerrar a sessão.',
        side: 'bottom',
        align: 'end',
      },
    });
  }

  return steps;
}

interface ClientTutorialProps {
  userId: string;
  ready: boolean;
  triggerRef: React.MutableRefObject<(() => void) | null>;
}

export function ClientTutorial({ userId, ready, triggerRef }: ClientTutorialProps) {
  const hasStarted = useRef(false);

  function startTutorial() {
    const steps = buildSteps();
    if (!steps.length) return;

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
        markTutorialDone(userId);
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
    if (hasDoneTutorial(userId)) return;
    hasStarted.current = true;
    // Pequeno delay para garantir que todos os elementos estejam no DOM
    const timer = setTimeout(startTutorial, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userId]);

  return null;
}
