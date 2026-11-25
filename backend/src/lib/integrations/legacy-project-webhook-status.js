import { COUNTER_KINDS } from '../abuse/usage-counters.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Uso do caminho antigo do webhook do ComercialAPP (/api/webhooks/projects), para
// decidir quando desligá-lo (spec 042, 7.6, D5: 60 dias depois que o ComercialAPP
// passar a chamar /api/webhooks/v1/projects). Informativo: não vira problema nem alerta.
export async function legacyProjectWebhookStatus(prismaClient, config, now = new Date()) {
  const sunset = config.projectWebhookLegacySunset instanceof Date ? config.projectWebhookLegacySunset.toISOString() : null;
  if (!prismaClient.usageCounter) return { status: 'UNAVAILABLE', sunset };
  try {
    const rows = await prismaClient.usageCounter.findMany({
      where: { kind: COUNTER_KINDS.LEGACY_PROJECT_WEBHOOK_DAY, periodStart: { gte: new Date(now.getTime() - 90 * DAY_MS) } },
      select: { periodStart: true, count: true },
      orderBy: { periodStart: 'desc' }
    });
    const since30 = now.getTime() - 30 * DAY_MS;
    const last30Days = rows.filter(row => row.periodStart.getTime() >= since30).reduce((sum, row) => sum + row.count, 0);
    const lastUsedDay = rows.find(row => row.count > 0)?.periodStart.toISOString() ?? null;
    return {
      status: last30Days > 0 ? 'IN_USE' : 'IDLE',
      currentPath: '/api/webhooks/v1/projects',
      legacyPath: '/api/webhooks/projects',
      last30Days,
      lastUsedDay,
      sunset
    };
  } catch (error) {
    return { status: 'UNAVAILABLE', sunset, error: error?.code || 'read-failed' };
  }
}
