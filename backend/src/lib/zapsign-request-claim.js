import { ReportStatus } from '@prisma/client';

const DEFAULT_STALE_CLAIM_MS = 15 * 60 * 1000;

export function staleZapSignClaimBefore(now = new Date(), staleMs = DEFAULT_STALE_CLAIM_MS) {
  return new Date(now.getTime() - staleMs);
}

export async function claimZapSignRequest(prismaClient, reportId, now = new Date()) {
  const claimTime = now;
  const result = await prismaClient.report.updateMany({
    where: {
      id: reportId,
      status: ReportStatus.APPROVED,
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

export async function claimZapSignRequests(prismaClient, reportIds, now = new Date()) {
  const ids = Array.from(new Set((reportIds || []).map(id => String(id || '').trim()).filter(Boolean)));
  const claimTime = now;
  if (!ids.length) {
    return { claimed: true, claimTime, claimedCount: 0 };
  }

  const result = await prismaClient.report.updateMany({
    where: {
      id: { in: ids },
      status: ReportStatus.APPROVED,
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
    claimed: result.count === ids.length,
    claimTime,
    claimedCount: result.count
  };
}

export async function persistZapSignRequest(prismaClient, reportId, claimTime, data) {
  const result = await prismaClient.report.updateMany({
    where: {
      id: reportId,
      status: ReportStatus.APPROVED,
      zapsignDocToken: null,
      zapsignSignedAt: null,
      zapsignRequestedAt: claimTime
    },
    data
  });

  return result.count === 1;
}

export async function releaseZapSignRequestClaims(prismaClient, reportIds, claimTime) {
  const ids = Array.from(new Set((reportIds || []).map(id => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) return { count: 0 };

  return prismaClient.report.updateMany({
    where: {
      id: { in: ids },
      zapsignDocToken: null,
      zapsignRequestedAt: claimTime
    },
    data: {
      zapsignRequestedAt: null
    }
  });
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
