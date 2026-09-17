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
          { popover: { title: '✨ Documentos dentro do projeto', description: 'O detalhe do card agora reúne propostas, contratos, desenhos, certificados e outros arquivos. Cada documento mantém versões, aceite, assinatura e sua finalidade no fluxo.' } },
          { element: '[data-project-workflow-board]', popover: { title: 'Kanban unificado', description: 'Arraste o card para a etapa permitida. Se houver bloqueio, o detalhe abre com o motivo. Categorias concluídas ficam recolhidas. A autorização libera a equipe no Efetivo, romaneios de saída e retiradas do Estoque.', side: 'top', align: 'center' } },
          { element: '[data-project-documents]', popover: { title: 'Catálogo e histórico', description: 'Abra um projeto e use esta categoria para consultar documentos vigentes, versões anteriores, arquivos do CRM e os RDOs e relatórios que já existem no sistema.', side: 'top', align: 'center' } },
          { element: '[data-project-document-add]', popover: { title: 'Adicionar documento', description: 'Informe tipo, responsável e arquivo. Só escolha uma exigência de handover, mobilização ou encerramento quando o documento realmente precisar bloquear essa passagem.', side: 'left', align: 'start' } },
          { element: '[data-project-document-version]', popover: { title: 'Nova versão', description: 'Cada revisão cria uma versão imutável e passa a ser a vigente. Aceites e assinaturas anteriores continuam registrados no histórico.', side: 'left', align: 'start' } },
          { element: '[data-project-document-acceptance]', popover: { title: 'Aceite e prontidão', description: 'Registre a decisão na versão vigente. Uma nova revisão volta a exigir aceite e, quando afeta a mobilização, suspende a autorização para revalidação.', side: 'left', align: 'start' } },
          { element: '[data-project-workflow-execution]', popover: { title: 'Em execução', description: 'Depois de autorizar a mobilização, avance o card para esta coluna. Abra o projeto para acompanhar avanço, documentos e registrar desvios compartilhados com a Qualidade.', side: 'left', align: 'start' } },
          { element: '[data-project-kanban-stage="DEMOBILIZATION"]', popover: { title: 'Desmobilização', description: 'Ao concluir o campo, mova o mesmo card para controlar conferências, retorno da equipe e equipamentos, avarias e as datas efetivas.', side: 'left', align: 'start' } },
          { element: '[data-project-kanban-stage="POST_JOB"]', popover: { title: 'Pós-job', description: 'Registre feedbacks, problemas, soluções e lições aprendidas. O histórico fica disponível para projetos futuros do mesmo cliente ou serviço.', side: 'left', align: 'start' } },
          { element: '[data-project-kanban-stage="FINAL_MEASUREMENT"]', popover: { title: 'Documentação e medição', description: 'Confira RDOs e relatórios, consolide quantitativos e registre os valores executado, medido e aprovado sem misturá-los ao faturamento do Omie.', side: 'left', align: 'start' } },
          { element: '[data-project-kanban-stage="FINISHED"]', popover: { title: 'Encerramento', description: 'O gate final confere documentação, medição, pós-job, ativos e pendências. O encerramento registra autor e data; para reabrir, informe uma justificativa no detalhe.', side: 'left', align: 'start' } }
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
