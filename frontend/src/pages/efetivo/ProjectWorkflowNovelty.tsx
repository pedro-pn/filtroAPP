import { useEffect } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

import { releaseEfetivoGuide, reserveEfetivoGuide } from '../../utils/efetivoGuideCoordinator';
import { markProjectWorkflowNoveltySeen, shouldShowProjectWorkflowNovelty } from '../../utils/projectWorkflowNovelty';

export function ProjectWorkflowNovelty({ userId, enabled }: { userId: string; enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !shouldShowProjectWorkflowNovelty(userId)) return;
    let cancelled = false;
    let timer: number | undefined;
    let guide: ReturnType<typeof driver> | null = null;
    const start = (attempt = 0) => {
      if (cancelled || !shouldShowProjectWorkflowNovelty(userId)) return;
      if (!document.querySelector('[data-project-workflow-board]') || !reserveEfetivoGuide()) {
        if (attempt < 20) timer = window.setTimeout(() => start(attempt + 1), 400);
        return;
      }
      markProjectWorkflowNoveltySeen(userId);
      guide = driver({
        showProgress: true,
        nextBtnText: 'Próximo',
        prevBtnText: 'Voltar',
        doneBtnText: 'Entendi',
        allowClose: true,
        overlayOpacity: 0.6,
        onDestroyed: () => releaseEfetivoGuide(),
        steps: [
          { popover: { title: '✨ Um único fluxo do projeto', description: 'O mesmo card percorre handover, planejamento, mobilização e execução. Equipe, ciclos e datas continuam sendo configurados em Missões.' } },
          { element: '[data-project-workflow-board]', popover: { title: 'Kanban unificado', description: 'Prazos, checklists, gates e situação operacional agora aparecem na mesma evolução. A autorização libera a equipe no Efetivo, romaneios de saída e retiradas do Estoque.', side: 'top', align: 'center' } },
          { element: '[data-project-workflow-execution]', popover: { title: 'Em execução', description: 'Depois de autorizar a mobilização, avance o card para esta coluna. Abra o projeto para acompanhar avanço, documentos e registrar desvios compartilhados com a Qualidade.', side: 'left', align: 'start' } }
        ]
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
