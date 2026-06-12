const LEGACY_EXTERNAL_SIGNATURE_KEYS = [
  '__zapSignSigners',
  '__zapSignSignatureProgress',
  '__zapSignBatchMainDocToken',
  '__zapSignBatchDocTokens'
];

export function shouldProvisionProjectClientAccounts(project) {
  return !project?.managerOnly && !project?.registrationPending;
}

export function withoutProjectLegacyExternalSignatureState(specialConditions) {
  const next = { ...(specialConditions || {}) };
  for (const key of LEGACY_EXTERNAL_SIGNATURE_KEYS) delete next[key];
  return next;
}

export async function clearPendingProjectLegacyExternalSignatureState(tx, projectId) {
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
        specialConditions: withoutProjectLegacyExternalSignatureState(report.specialConditions)
      }
    });
  }

  return reports.length;
}
