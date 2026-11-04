import { useEffect } from 'react';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

import { markAllocationReviewNoveltySeen, shouldShowAllocationReviewNovelty } from '../../utils/allocationReviewNovelty';
import { releaseEfetivoGuide, reserveEfetivoGuide } from '../../utils/efetivoGuideCoordinator';

// Novidade + tutorial guiado da Conferência de alocação (feature 037), só no primeiro acesso
// dentro da janela de 10 dias e só para quem tem acesso à seção.
export function AllocationReviewNovelty({ userId, enabled }: { userId: string; enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !shouldShowAllocationReviewNovelty(userId)) return;
    let cancelled = false;
    let timer: number | undefined;
    let guide: ReturnType<typeof driver> | null = null;
    const start = (attempt = 0) => {
      if (cancelled || !shouldShowAllocationReviewNovelty(userId)) return;
      if (!document.querySelector('[data-allocation-review]') || !reserveEfetivoGuide()) {
        if (attempt < 20) timer = window.setTimeout(() => start(attempt + 1), 400);
        return;
      }
      markAllocationReviewNoveltySeen(userId);
      const allSteps: DriveStep[] = [
        { popover: { title: '✨ Conferência de alocação', description: 'O app já traz a semana preenchida com o cruzamento de ponto, RDO e planejamento do Efetivo. Aqui você só confere e corrige o que não bate. Semana não conferida continua valendo pela alocação automática.' } },
        { element: '[data-allocation-review-summary]', popover: { title: 'Onde olhar primeiro', description: 'Divergências e dias sem informação são as pendências; clique nelas para ver só quem tem pendência. A barra mostra quantos colaboradores já foram conferidos.', side: 'bottom', align: 'start' } },
        { element: '[data-allocation-review-cell]', popover: { title: 'Cada dia', description: 'Mostra o projeto e o cliente (o CNPJ aparece ao abrir o dia), ou Sede, Folga e ausências. Os três pontinhos indicam se Ponto, RDO e Efetivo confirmam (verde) ou divergem (laranja). Clique para ver as fontes e corrigir.', side: 'right', align: 'start' } },
        { element: '[data-allocation-review-select]', popover: { title: 'Vários dias de uma vez', description: 'No computador, segure Shift e clique nos dias. No celular, use Selecionar dias. Depois escolha Sede, Folga, Férias ou um projeto na barra que aparece embaixo.', side: 'bottom', align: 'end' } },
        { element: '[data-allocation-review-confirm]', popover: { title: 'Conferir a linha', description: 'Sem pendências, confira a semana do colaborador. A partir daí ela vale no custo HH e no relatório Alocação dos colaboradores. Folga ou férias sem cadastro avisam os administradores do Efetivo.', side: 'left', align: 'center' } },
        { element: '[data-allocation-review-close]', popover: { title: 'Fechar a semana', description: 'Com todos conferidos e a semana encerrada, feche-a. O relatório mensal para o DP espera as semanas fecharem, até o 3º dia útil do mês seguinte.', side: 'bottom', align: 'end' } }
      ];
      // Passos cujo controle não está na tela (ex.: semana fechada) são pulados.
      const steps = allSteps.filter(step => typeof step.element !== 'string' || Boolean(document.querySelector(step.element)));
      guide = driver({
        popoverClass: 'efetivo-guide-popover',
        showProgress: true,
        nextBtnText: 'Próximo',
        prevBtnText: 'Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        overlayOpacity: 0.6,
        onDestroyed: () => releaseEfetivoGuide(),
        steps
      });
      guide.drive();
    };
    timer = window.setTimeout(() => start(), 700);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      guide?.destroy();
    };
  }, [enabled, userId]);
  return null;
}
