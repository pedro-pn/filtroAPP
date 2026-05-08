import {
  ZAPSIGN_BATCH_DOC_TOKENS_KEY,
  ZAPSIGN_BATCH_MAIN_DOC_TOKEN_KEY,
  ZAPSIGN_SIGNATURE_PROGRESS_KEY,
  ZAPSIGN_SIGNERS_KEY
} from './zapsign-progress.js';

export function shouldProvisionProjectClientAccounts(project) {
  return !project?.managerOnly;
}

export function shouldIgnoreExternalSigningForReport(report) {
  return !!report?.project?.managerOnly;
}

export function withoutProjectZapSignState(specialConditions) {
  const next = { ...(specialConditions || {}) };
  delete next[ZAPSIGN_SIGNERS_KEY];
  delete next[ZAPSIGN_SIGNATURE_PROGRESS_KEY];
  delete next[ZAPSIGN_BATCH_MAIN_DOC_TOKEN_KEY];
  delete next[ZAPSIGN_BATCH_DOC_TOKENS_KEY];
  return next;
}

export async function clearPendingProjectZapSignState(tx, projectId) {
  if (!projectId) return 0;

  const reports = await tx.report.findMany({
    where: {
      projectId,
      zapsignSignedAt: null,
      OR: [
        { zapsignDocToken: { not: null } },
        { zapsignSignerToken: { not: null } },
        { zapsignRequestedAt: { not: null } },
        { zapsignDocUrl: { not: null } }
      ]
    },
    select: {
      id: true,
      specialConditions: true
    }
  });

  for (const report of reports) {
    await tx.report.update({
      where: { id: report.id },
      data: {
        zapsignDocToken: null,
        zapsignSignerToken: null,
        zapsignRequestedAt: null,
        zapsignSignedAt: null,
        zapsignDocUrl: null,
        specialConditions: withoutProjectZapSignState(report.specialConditions)
      }
    });
  }

  return reports.length;
}
