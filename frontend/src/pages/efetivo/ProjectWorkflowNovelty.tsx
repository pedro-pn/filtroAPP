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
          { popover: { title: '✨ Acompanhamento da execução', description: 'A gestão do projeto agora continua depois da mobilização, com avanço, RDOs, relatórios técnicos e desvios no mesmo card.' } },
          { element: '[data-project-workflow-switch]', popover: { title: 'Duas visões complementares', description: 'Alterne entre o ciclo de gestão do projeto e o Kanban operacional das missões.', side: 'bottom', align: 'start' } },
          { element: '[data-project-workflow-board]', popover: { title: 'Prazos e gates visíveis', description: 'D-90, D-30, D-15, D-7 e D-1 são calculados pela mobilização. A autorização vigente libera a equipe no Efetivo, romaneios de saída e retiradas do Estoque.', side: 'top', align: 'center' } },
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
