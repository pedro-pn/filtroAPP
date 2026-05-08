const DEFAULT_STALE_CLAIM_MS = 15 * 60 * 1000;

export function staleZapSignClaimBefore(now = new Date(), staleMs = DEFAULT_STALE_CLAIM_MS) {
  return new Date(now.getTime() - staleMs);
}

export async function claimZapSignRequest(prismaClient, reportId, now = new Date()) {
  const claimTime = now;
  const result = await prismaClient.report.updateMany({
    where: {
      id: reportId,
      zapsignDocToken: null,
      zapsignSignedAt: null,
      OR: [
        { zapsignRequestedAt: null },
        { zapsignRequestedAt: { lt: staleZapSignClaimBefore(claimTime) } }
      ]
    },
    data: {
      zapsignRequestedAt: claimTime
    }
  });

  return {
    claimed: result.count === 1,
    claimTime
  };
}

export async function persistZapSignRequest(prismaClient, reportId, claimTime, data) {
  const result = await prismaClient.report.updateMany({
    where: {
      id: reportId,
      zapsignDocToken: null,
      zapsignRequestedAt: claimTime
    },
    data
  });

  return result.count === 1;
}

export async function releaseZapSignRequestClaim(prismaClient, reportId, claimTime) {
  return prismaClient.report.updateMany({
    where: {
      id: reportId,
      zapsignDocToken: null,
      zapsignRequestedAt: claimTime
    },
    data: {
      zapsignRequestedAt: null
    }
  });
}
