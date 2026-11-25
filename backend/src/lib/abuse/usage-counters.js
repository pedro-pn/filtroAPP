import prisma from '../prisma.js';

// Contadores por período na tabela UsageCounter (pilar 10). Compartilhados entre
// API e worker e preservados entre deploys, ao contrário dos limitadores em memória.

export const ABUSE_BUCKET_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Dia e mês do teto da OpenAI seguem o horário de Brasília (UTC−3, sem horário de verão).
const BRASILIA_OFFSET_MS = 3 * 60 * 60 * 1000;

export const ABUSE_RETENTION_DAYS = 30;
export const OPENAI_USAGE_RETENTION_DAYS = 400;

export const COUNTER_KINDS = Object.freeze({
  LOGIN_FAILURE: 'abuse.login-failure',
  RATE_LIMITED: 'abuse.rate-limited',
  OPENAI_TOKENS_DAY: 'openai.tokens.day',
  OPENAI_TOKENS_MONTH: 'openai.tokens.month',
  OPENAI_CALLS_DAY: 'openai.calls.day'
});

export function abuseBucketStart(now = new Date()) {
  const time = now instanceof Date ? now.getTime() : Number(now);
  return new Date(Math.floor(time / ABUSE_BUCKET_MS) * ABUSE_BUCKET_MS);
}

export function brasiliaDayStart(now = new Date()) {
  const shifted = now.getTime() - BRASILIA_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS + BRASILIA_OFFSET_MS);
}

export function brasiliaMonthStart(now = new Date()) {
  const shifted = new Date(now.getTime() - BRASILIA_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) + BRASILIA_OFFSET_MS);
}

// Upsert atômico (INSERT ... ON CONFLICT DO UPDATE): processos concorrentes somam
// no mesmo registro sem perder incrementos.
export async function incrementUsageCounter({ kind, subject = 'global', periodStart, count = 0, tokens = 0 }, {
  prismaClient = prisma
} = {}) {
  const safeCount = Math.max(0, Math.trunc(Number(count) || 0));
  const safeTokens = Math.max(0, Math.trunc(Number(tokens) || 0));
  return prismaClient.usageCounter.upsert({
    where: { kind_subject_periodStart: { kind, subject: String(subject).slice(0, 200), periodStart } },
    create: { kind, subject: String(subject).slice(0, 200), periodStart, count: safeCount, tokens: safeTokens },
    update: { count: { increment: safeCount }, tokens: { increment: safeTokens } }
  });
}

export async function readUsageCounter({ kind, subject = 'global', periodStart }, { prismaClient = prisma } = {}) {
  const row = await prismaClient.usageCounter.findUnique({
    where: { kind_subject_periodStart: { kind, subject, periodStart } },
    select: { count: true, tokens: true }
  });
  return { count: row?.count ?? 0, tokens: row?.tokens ?? 0 };
}

// Soma por (kind, subject) desde `since`, opcionalmente só para alguns subjects.
export async function sumUsageCounters({ kinds, since, subjects = null }, { prismaClient = prisma } = {}) {
  const rows = await prismaClient.usageCounter.groupBy({
    by: ['kind', 'subject'],
    where: {
      kind: { in: kinds },
      periodStart: { gte: since },
      ...(subjects ? { subject: { in: subjects } } : {})
    },
    _sum: { count: true, tokens: true }
  });
  return rows.map(row => ({
    kind: row.kind,
    subject: row.subject,
    count: row._sum?.count ?? 0,
    tokens: row._sum?.tokens ?? 0
  }));
}

// Linhas de abuso guardam IP: 30 dias (ROPA, "Auditoria e segurança"). Uso da OpenAI
// (sem dado pessoal): 400 dias. `webhook.*` só limpa linhas do webhook de projetos já
// removido (2026-11), até não restar nenhuma.
export async function pruneUsageCounters({ prismaClient = prisma, now = new Date() } = {}) {
  const abuseCutoff = new Date(now.getTime() - ABUSE_RETENTION_DAYS * DAY_MS);
  const openaiCutoff = new Date(now.getTime() - OPENAI_USAGE_RETENTION_DAYS * DAY_MS);
  const [abuse, openai, webhook] = await Promise.all([
    prismaClient.usageCounter.deleteMany({ where: { kind: { startsWith: 'abuse.' }, periodStart: { lt: abuseCutoff } } }),
    prismaClient.usageCounter.deleteMany({ where: { kind: { startsWith: 'openai.' }, periodStart: { lt: openaiCutoff } } }),
    prismaClient.usageCounter.deleteMany({ where: { kind: { startsWith: 'webhook.' }, periodStart: { lt: openaiCutoff } } })
  ]);
  return { abuse: abuse.count, openai: openai.count, webhook: webhook.count };
}
