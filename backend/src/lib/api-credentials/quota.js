export class ApiQuotaExceededError extends Error {
  constructor(message = 'Limite de uso excedido.', { retryAfterSeconds = 60 } = {}) {
    super(message);
    this.name = 'ApiQuotaExceededError';
    this.code = 'QUOTA_EXCEEDED';
    this.statusCode = 429;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function quotaWindowStarts(now = new Date()) {
  const date = new Date(now);
  const minuteStart = new Date(date);
  minuteStart.setUTCSeconds(0, 0);
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  return { minuteStart, dayStart };
}

export async function reserveCredentialQuota({ store, credentialId, limits, requestedRows = 0, now = new Date() }) {
  if (requestedRows > limits.rowsPerDay) {
    throw new ApiQuotaExceededError('A página solicitada excede a cota diária de linhas. Reduza o limite da página.');
  }
  const windows = quotaWindowStarts(now);
  const reservation = await store.reserve({ credentialId, limits, requestedRows, ...windows });
  if (!reservation) {
    const nextMinute = new Date(windows.minuteStart.getTime() + 60_000);
    throw new ApiQuotaExceededError(undefined, {
      retryAfterSeconds: Math.max(1, Math.ceil((nextMinute.getTime() - new Date(now).getTime()) / 1000))
    });
  }
  return { credentialId, requestedRows, ...windows, ...reservation };
}

export async function settleCredentialQuota({ store, reservation, actualRows = 0, responseBytes = 0 }) {
  const safeRows = Math.max(0, Math.min(reservation.requestedRows, Number(actualRows) || 0));
  const safeBytes = Math.max(0, Number(responseBytes) || 0);
  await store.settle({ reservation, actualRows: safeRows, responseBytes: safeBytes });
}

export function createPrismaQuotaStore(prisma) {
  return {
    async reserve({ credentialId, limits, requestedRows, minuteStart, dayStart }) {
      return prisma.$transaction(async tx => {
        const minute = await tx.apiUsageBucket.upsert({
          where: { credentialId_windowKind_windowStart: { credentialId, windowKind: 'MINUTE', windowStart: minuteStart } },
          create: { credentialId, windowKind: 'MINUTE', windowStart: minuteStart },
          update: {}
        });
        const day = await tx.apiUsageBucket.upsert({
          where: { credentialId_windowKind_windowStart: { credentialId, windowKind: 'DAY', windowStart: dayStart } },
          create: { credentialId, windowKind: 'DAY', windowStart: dayStart },
          update: {}
        });
        const minuteResult = await tx.apiUsageBucket.updateMany({
          where: { id: minute.id, requests: { lt: limits.requestsPerMinute } },
          data: { requests: { increment: 1 } }
        });
        if (minuteResult.count !== 1) throw new ApiQuotaExceededError();
        const dayResult = await tx.apiUsageBucket.updateMany({
          where: {
            id: day.id,
            requests: { lt: limits.requestsPerDay },
            rows: { lte: limits.rowsPerDay - requestedRows }
          },
          data: { requests: { increment: 1 }, rows: { increment: requestedRows } }
        });
        if (dayResult.count !== 1) throw new ApiQuotaExceededError(undefined, { retryAfterSeconds: 3600 });
        return { minuteBucketId: minute.id, dayBucketId: day.id, requestedRows };
      });
    },
    async settle({ reservation, actualRows, responseBytes }) {
      const releaseRows = Math.max(0, reservation.requestedRows - actualRows);
      await prisma.$transaction([
        prisma.apiUsageBucket.update({
          where: { id: reservation.minuteBucketId },
          data: { bytes: { increment: responseBytes } }
        }),
        prisma.apiUsageBucket.update({
          where: { id: reservation.dayBucketId },
          data: { rows: { decrement: releaseRows }, bytes: { increment: responseBytes } }
        })
      ]);
    }
  };
}
