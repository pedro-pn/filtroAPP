import { ReportStatus, ReportType, ReportVersionStatus } from '@prisma/client';

// RDO aprovado enquanto o projeto não tinha signatário cliente fica sem rodada de assinatura
// (a aprovação só registra um aviso). A reconciliação de signatários só olha relatórios que já
// têm versão ativa, então, quando o signatário é cadastrado depois, esses RDOs nunca entravam no
// link único do cliente. Aqui eles ganham a rodada (PDF-base + token + e-mail), em ordem cronológica.
export async function ensureApprovedRdoSignatureRounds(projectId, {
  database, include, isUnavailable, shouldCreateRound, ensureRound, userId = null, evidence = {}
}) {
  if (!projectId) return { createdRounds: 0 };
  const reports = await database.report.findMany({
    where: {
      projectId,
      deletedAt: null,
      reportType: ReportType.RDO,
      status: ReportStatus.APPROVED,
      physicalSignedAt: null,
      zapsignDocToken: null,
      versions: { none: { status: ReportVersionStatus.ACTIVE } }
    },
    include,
    orderBy: [{ reportDate: 'asc' }, { sequenceNumber: 'asc' }]
  });

  let createdRounds = 0;
  for (const report of reports) {
    if (isUnavailable(report) || !shouldCreateRound(report)) continue;
    try {
      const preparation = await ensureRound(report, userId, evidence);
      if (preparation?.version) createdRounds += 1;
    } catch (error) {
      // Um PDF que falhe não pode impedir os demais nem desfazer o cadastro já salvo do projeto.
      console.error('Falha ao criar rodada de assinatura de RDO aprovado sem rodada.', {
        reportId: report.id,
        projectId,
        error: error?.message || error
      });
    }
  }
  return { createdRounds };
}
