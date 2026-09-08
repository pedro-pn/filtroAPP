import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import type { AuthUser } from '../../types/auth';
import { isApiTokenPlaygroundNoveltyActive } from './apiTokenPlaygroundNovelty';

const TOUR_KEY_PREFIX = 'filtrovali:api-token-playground-tour:v1:';

function tourKey(user: Pick<AuthUser, 'id'>) {
  return `${TOUR_KEY_PREFIX}${user.id}`;
}

function hasSeenTour(user: Pick<AuthUser, 'id'>, storage: Pick<Storage, 'getItem'>) {
  try {
    return storage.getItem(tourKey(user)) === '1';
  } catch {
    return true;
  }
}

function markTourSeen(user: Pick<AuthUser, 'id'>, storage: Pick<Storage, 'setItem'>) {
  try {
    storage.setItem(tourKey(user), '1');
  } catch {
    // O tutorial não deve bloquear a página quando storage estiver indisponível.
  }
}

export interface ApiTokenPlaygroundTourOptions {
  user: Pick<AuthUser, 'id'> | null | undefined;
  force?: boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: number;
}

export function startApiTokenPlaygroundTour({
  user,
  force = false,
  storage = typeof window === 'undefined' ? null : window.localStorage,
  now = Date.now()
}: ApiTokenPlaygroundTourOptions) {
  if (!user || !storage || !isApiTokenPlaygroundNoveltyActive(now)) return false;
  if (!force && hasSeenTour(user, storage)) return false;
  if (document.body.classList.contains('driver-active')) return false;

  const steps: DriveStep[] = [
    {
      element: '[data-api-token-hero]',
      popover: {
        title: '✨ Novo API Playground',
        description: 'Crie e acompanhe credenciais de integração sem compartilhar usuário, senha ou acesso direto ao banco.'
      }
    },
    {
      element: '[data-api-workflow="credentials"]',
      popover: {
        title: '1. Credenciais e revogação',
        description: 'Use filtros e paginação para localizar tokens. Nos detalhes, veja responsáveis e histórico, reduza a política, configure uma substituta por rotação ou revogue o acesso. Abra o token no Playground para testá-lo.',
        side: 'bottom'
      }
    },
    {
      element: '[data-api-workflow="configure"]',
      popover: {
        title: '2. Menor privilégio e validade',
        description: 'Escolha somente os escopos e projetos necessários, defina cotas, IPs e vencimento. O segredo completo aparece uma única vez.',
        side: 'bottom'
      }
    },
    {
      element: '[data-api-workflow="playground"]',
      popover: {
        title: '3. Teste seguro',
        description: 'Escolha explicitamente a credencial, a permissão e a operação de qualquer módulo implementado. Listagens não exigem ID individual. A seleção é preservada ao atualizar a página; o console mostra sucesso ou erro com requestId. Downloads verificam acesso sem transferir arquivos; o cURL permite o teste real. O painel nunca recupera o segredo do token.',
        side: 'bottom'
      }
    }
  ];

  markTourSeen(user, storage);
  driver({
    showProgress: true,
    progressText: '{{current}} de {{total}}',
    nextBtnText: 'Próximo',
    prevBtnText: 'Voltar',
    doneBtnText: 'Concluir',
    allowClose: true,
    animate: true,
    smoothScroll: true,
    overlayOpacity: 0.62,
    steps
  }).drive();
  return true;
}
