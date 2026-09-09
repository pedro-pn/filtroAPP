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
          { popover: { title: '✨ Gestão de projetos no Efetivo', description: 'O projeto agora reúne handover, análise, prontidão comercial, documentação antecipada e planejamento da mobilização por área.' } },
          { element: '[data-project-workflow-switch]', popover: { title: 'Duas visões complementares', description: 'Alterne entre o ciclo de gestão do projeto e o Kanban operacional das missões.', side: 'bottom', align: 'start' } },
          { element: '[data-project-workflow-board]', popover: { title: 'Prazos e gates visíveis', description: 'D-90, D-30, D-15, D-7 e D-1 são calculados pela mobilização. Abra um card para acompanhar documentação e as frentes do D-30.', side: 'top', align: 'center' } }
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
