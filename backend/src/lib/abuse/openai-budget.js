import env from '../../config/env.js';
import prisma from '../prisma.js';
import { sendThrottledAlertEmail } from '../operations/alert-email.js';
import {
  COUNTER_KINDS,
  brasiliaDayStart,
  brasiliaMonthStart,
  incrementUsageCounter,
  readUsageCounter
} from './usage-counters.js';

// Teto de gasto da OpenAI no sistema (pilar 10.2): tokens por dia e por mês somando
// todos os usuários, e chamadas por usuário por dia. Fica no banco, então um deploy
// não zera a contagem. O teto no painel da OpenAI continua necessário: este é o
// controle do lado do sistema e não substitui o limite do provedor.

function budgetError(status, message, codigo) {
  return Object.assign(new Error(message), { status, codigo });
}

export function estimatedUsd(tokens, config = env) {
  if (!config.openaiUsdPerMillionTokens) return null;
  return Math.round((tokens / 1_000_000) * config.openaiUsdPerMillionTokens * 100) / 100;
}

export async function openAiUsageSummary({ prismaClient = prisma, now = new Date(), config = env } = {}) {
  const dayStart = brasiliaDayStart(now);
  const monthStart = brasiliaMonthStart(now);
  const [day, month] = await Promise.all([
    readUsageCounter({ kind: COUNTER_KINDS.OPENAI_TOKENS_DAY, periodStart: dayStart }, { prismaClient }),
    readUsageCounter({ kind: COUNTER_KINDS.OPENAI_TOKENS_MONTH, periodStart: monthStart }, { prismaClient })
  ]);
  return {
    day: {
      periodStart: dayStart.toISOString(),
      calls: day.count,
      tokens: day.tokens,
      budget: config.openaiDailyTokenBudget || null,
      estimatedUsd: estimatedUsd(day.tokens, config)
    },
    month: {
      periodStart: monthStart.toISOString(),
      calls: month.count,
      tokens: month.tokens,
      budget: config.openaiMonthlyTokenBudget || null,
      estimatedUsd: estimatedUsd(month.tokens, config)
    },
    userDailyCalls: config.openaiUserDailyCalls || null,
    alertPercent: config.openaiBudgetAlertPercent
  };
}

function reached(tokens, budget) {
  return Boolean(budget) && tokens >= budget;
}

/**
 * Confere os tetos ANTES de chamar a OpenAI e já conta a chamada do usuário.
 * Lança erro 429 com código próprio quando algum teto foi atingido.
 */
export async function reserveOpenAiCall({ userId, prismaClient = prisma, now = new Date(), config = env, sendAlert = sendThrottledAlertEmail } = {}) {
  const summary = await openAiUsageSummary({ prismaClient, now, config });
  if (reached(summary.month.tokens, summary.month.budget)) {
    await alertBudget('month', summary, { sendAlert, config });
    throw budgetError(429, 'O limite mensal de uso da adequação por IA foi atingido. Avise o administrador.', 'ORCAMENTO_MENSAL');
  }
  if (reached(summary.day.tokens, summary.day.budget)) {
    await alertBudget('day', summary, { sendAlert, config });
    throw budgetError(429, 'O limite diário de uso da adequação por IA foi atingido. Tente novamente amanhã.', 'ORCAMENTO_DIARIO');
  }
  if (config.openaiUserDailyCalls && userId) {
    const dayStart = brasiliaDayStart(now);
    const subject = `user:${userId}`;
    const current = await readUsageCounter({ kind: COUNTER_KINDS.OPENAI_CALLS_DAY, subject, periodStart: dayStart }, { prismaClient });
    if (current.count >= config.openaiUserDailyCalls) {
      throw budgetError(429, 'Limite diário de adequações atingido. Tente novamente amanhã.', 'LIMITE_DIARIO');
    }
    await incrementUsageCounter({ kind: COUNTER_KINDS.OPENAI_CALLS_DAY, subject, periodStart: dayStart, count: 1 }, { prismaClient });
  }
  return summary;
}

/** Soma os tokens de uma chamada concluída e avisa quando o uso passa do percentual de alerta. */
export async function recordOpenAiTokens({ tokens, prismaClient = prisma, now = new Date(), config = env, sendAlert = sendThrottledAlertEmail, logger = console } = {}) {
  const amount = Math.max(0, Math.trunc(Number(tokens) || 0));
  try {
    await Promise.all([
      incrementUsageCounter({ kind: COUNTER_KINDS.OPENAI_TOKENS_DAY, periodStart: brasiliaDayStart(now), count: 1, tokens: amount }, { prismaClient }),
      incrementUsageCounter({ kind: COUNTER_KINDS.OPENAI_TOKENS_MONTH, periodStart: brasiliaMonthStart(now), count: 1, tokens: amount }, { prismaClient })
    ]);
    const summary = await openAiUsageSummary({ prismaClient, now, config });
    for (const period of ['day', 'month']) {
      const { tokens: used, budget } = summary[period];
      if (budget && used >= (budget * config.openaiBudgetAlertPercent) / 100) {
        await alertBudget(period, summary, { sendAlert, config });
      }
    }
  } catch (error) {
    // Falha ao contar não pode derrubar a resposta que o usuário já recebeu.
    logger.warn?.('Falha ao registrar uso da OpenAI.', error?.code || error?.message || error);
  }
}

async function alertBudget(period, summary, { sendAlert, config }) {
  const data = summary[period];
  const label = period === 'day' ? 'diário' : 'mensal';
  const percent = data.budget ? Math.round((data.tokens / data.budget) * 100) : 0;
  const cost = data.estimatedUsd !== null ? ` (≈ US$ ${data.estimatedUsd.toFixed(2)})` : '';
  try {
    await sendAlert({
    // Um alerta por período (dia/mês) e por faixa: aviso e teto atingido.
    fingerprint: `openai-budget|${period}|${data.periodStart}|${percent >= 100 ? 'reached' : 'warning'}`,
    subject: `[filtroAPP ${config.nodeEnv || 'unknown'}] OpenAI: ${percent}% do teto ${label} de tokens`,
    text: [
      `O uso da OpenAI chegou a ${percent}% do teto ${label} configurado no filtroAPP.`,
      '',
      `Tokens usados: ${data.tokens.toLocaleString('pt-BR')}${cost}`,
      `Teto ${label}: ${data.budget.toLocaleString('pt-BR')} tokens`,
      `Chamadas no período: ${data.calls}`,
      '',
      percent >= 100
        ? 'A adequação por IA está bloqueada até o próximo período. Para liberar antes, aumente o teto no .env.production e recrie o backend.'
        : 'A adequação continua funcionando até o teto. Confira em docs/RUNBOOK_INCIDENTES.md se o uso é esperado.',
      'Lembre-se: o limite no painel da OpenAI também precisa estar configurado.'
    ].join('\n')
    });
  } catch {
    // O alerta é melhor esforço; o bloqueio já foi aplicado.
  }
}
