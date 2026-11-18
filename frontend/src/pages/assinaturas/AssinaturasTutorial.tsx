import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

const STORAGE_KEY_PREFIX = 'filtrovali:assinaturas-tutorial:v1:';

function storageKey(userKey: string) {
  return `${STORAGE_KEY_PREFIX}${userKey}`;
}

function hasSeen(userKey: string) {
  try {
    return localStorage.getItem(storageKey(userKey)) === '1';
  } catch {
    return false;
  }
}

function markSeen(userKey: string) {
  try {
    localStorage.setItem(storageKey(userKey), '1');
  } catch {
    // O tutorial continua utilizável em sessões sem armazenamento local.
  }
}

const steps: DriveStep[] = [
  {
    element: '[data-signature-new-document]',
    popover: {
      title: '1. Envie o PDF',
      description: 'Crie um documento e selecione um PDF de até 20 MB. O arquivo original recebe uma verificação de integridade.',
      side: 'bottom',
      align: 'end'
    }
  },
  {
    element: '.signature-signer-panel',
    popover: {
      title: '2. Adicione os assinantes',
      description: 'Informe nome e, se quiser envio automático, e-mail. A ordem de assinatura é a ordem de criação.',
      side: 'right',
      align: 'start'
    }
  },
  {
    element: '.signature-pdf-canvas',
    popover: {
      title: '3. Posicione os campos',
      description: 'Selecione um assinante, toque ou clique no PDF e ajuste a caixa. Salve os campos antes de publicar.',
      side: 'top',
      align: 'start'
    }
  },
  {
    element: '[data-signature-publish]',
    popover: {
      title: '4. Publique',
      description: 'Defina a validade dos links e confirme. Depois da publicação, o PDF e a lista de assinantes ficam bloqueados para edição.',
      side: 'top',
      align: 'end'
    }
  },
  {
    element: '.signature-status-list',
    popover: {
      title: '5. Copie ou reenvie os links',
      description: 'Cada assinante tem um link individual. Você pode copiar, reenviar, renovar ou revogar conforme o estado do convite.',
      side: 'top',
      align: 'start'
    }
  },
  {
    element: '.signature-tabs',
    popover: {
      title: '6. Acompanhe e audite',
      description: 'Veja o progresso das assinaturas, baixe o PDF concluído e consulte a trilha completa na aba Auditoria.',
      side: 'bottom',
      align: 'start'
    }
  }
];

export function AssinaturasTutorial({
  userKey,
  ready,
  triggerRef
}: {
  userKey: string;
  ready: boolean;
  triggerRef: MutableRefObject<(() => void) | null>;
}) {
  const started = useRef(false);
  const startTutorial = useCallback(() => {
    if (!userKey || document.body.classList.contains('driver-active')) return;
    started.current = true;
    markSeen(userKey);
    driver({
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
    }).drive();
  }, [userKey]);

  useEffect(() => {
    triggerRef.current = startTutorial;
    return () => {
      if (triggerRef.current === startTutorial) triggerRef.current = null;
    };
  }, [startTutorial, triggerRef]);

  useEffect(() => {
    if (!ready || !userKey || started.current || hasSeen(userKey)) return;
    const timer = window.setTimeout(startTutorial, 700);
    return () => window.clearTimeout(timer);
  }, [ready, startTutorial, userKey]);

  return null;
}
