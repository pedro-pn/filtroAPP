// O encerramento oficial usa o mesmo arquivamento de projetos do módulo Relatórios.
export async function synchronizeProjectReportArchive(tx, projectId, previousStage, stage, now = new Date()) {
  if (previousStage === stage || (previousStage !== 'FINISHED' && stage !== 'FINISHED')) return;
  await tx.project.update({
    where: { id: projectId },
    data: stage === 'FINISHED'
      ? { isActive: false, acompanhamentoReviewedAt: null, acompanhamentoReportArchivedAt: now }
      : { isActive: true, acompanhamentoReportArchivedAt: null }
  });
}
