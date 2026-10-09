import { useEffect } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { markDatabookNoveltySeen, shouldShowDatabookNovelty } from '../../utils/databook';

export function ProjectDatabookNovelty({ userId, guide = false }: { userId: string; guide?: boolean }) {
  useEffect(() => {
    if (!shouldShowDatabookNovelty(userId, guide)) return;
    let tour: ReturnType<typeof driver> | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const start = (attempt = 0) => {
      const selector = guide ? '[data-databook-period]' : '[data-project-databook]';
      if (!document.querySelector(selector) || document.body.classList.contains('driver-active')) {
        if (attempt < 30) timer = setTimeout(() => start(attempt + 1), 600);
        return;
      }
      if (!shouldShowDatabookNovelty(userId, guide)) return;
      tour = driver({ allowClose: true, showProgress: guide, nextBtnText: 'Próximo', prevBtnText: 'Voltar', doneBtnText: 'Entendi', steps: guide ? [
        { element: '[data-databook-period]', popover: { title: 'Defina a etapa', description: 'As datas vêm do primeiro e do último RDO. Ajuste o intervalo; os dois dias serão incluídos.' } },
        { element: '[data-databook-sources]', popover: { title: 'Confira as evidências', description: 'Carregue o período para escolher relatórios e fotos, confirmar produtos utilizados e selecionar a FDS conferida.' } },
        { popover: { title: 'Emita e preserve o histórico', description: 'O PDF reúne o conteúdo e o ZIP conserva os originais. Cada etapa e cada revisão ficam guardadas, sem substituir entregas anteriores.' } }
      ] : [
        { popover: { title: 'Novidade: databook por etapa', description: 'Agora você pode reunir relatórios, fotos e FDS em um databook e escolher o período de cada entrega do projeto.' } },
        { element: selector, popover: { title: 'Preparar databook', description: 'Abra aqui para conferir as fontes e emitir o PDF e o pacote de originais.' } }
      ] });
      markDatabookNoveltySeen(userId, guide); tour.drive();
    };
    timer = setTimeout(() => start(), 700);
    return () => { clearTimeout(timer); tour?.destroy(); };
  }, [guide, userId]);
  return null;
}
