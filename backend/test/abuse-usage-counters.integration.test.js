import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

// Banco descartável com as migrations aplicadas; nunca roda contra o banco do app.
test('UsageCounter: incrementos concorrentes, teto da OpenAI e limpeza no PostgreSQL', {
  skip: !process.env.USAGE_COUNTERS_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.USAGE_COUNTERS_TEST_DATABASE_URL);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const counters = await import('../src/lib/abuse/usage-counters.js');
  const { reserveOpenAiCall, recordOpenAiTokens, openAiUsageSummary } = await import('../src/lib/abuse/openai-budget.js');

  const suffix = randomUUID().slice(0, 8);
  // Período bem antigo e único por execução: não colide com dados de outras suítes.
  const now = new Date(Date.UTC(2001, 0, 15, 15, 0, 0) + Math.floor(Math.random() * 1000) * 86_400_000);
  t.after(async () => {
    await prisma.usageCounter.deleteMany({ where: { OR: [{ subject: { contains: suffix } }, { periodStart: { lt: new Date('2010-01-01') } }] } });
    await prisma.$disconnect();
  });

  // 1. Incrementos concorrentes no mesmo registro não se perdem (upsert atômico).
  const periodStart = counters.abuseBucketStart(now);
  await Promise.all(Array.from({ length: 25 }, () => counters.incrementUsageCounter({
    kind: counters.COUNTER_KINDS.LOGIN_FAILURE, subject: `ip:test-${suffix}`, periodStart, count: 1
  })));
  const row = await counters.readUsageCounter({ kind: counters.COUNTER_KINDS.LOGIN_FAILURE, subject: `ip:test-${suffix}`, periodStart });
  assert.equal(row.count, 25);

  // 2. Limite por usuário e teto diário persistem no banco (sobrevivem a reinícios).
  const config = {
    nodeEnv: 'test', openaiDailyTokenBudget: 5000, openaiMonthlyTokenBudget: 50_000,
    openaiUserDailyCalls: 2, openaiBudgetAlertPercent: 80, openaiUsdPerMillionTokens: 0
  };
  const sendAlert = async () => ({ sent: false });
  const userId = `u-${suffix}`;
  await reserveOpenAiCall({ userId, now, config, sendAlert });
  await reserveOpenAiCall({ userId, now, config, sendAlert });
  await assert.rejects(reserveOpenAiCall({ userId, now, config, sendAlert }), e => e.codigo === 'LIMITE_DIARIO');
  await Promise.all([1, 2, 3].map(() => recordOpenAiTokens({ tokens: 2000, now, config, sendAlert, logger: { warn() {} } })));
  const summary = await openAiUsageSummary({ now, config });
  assert.equal(summary.day.tokens, 6000);
  assert.equal(summary.day.calls, 3);
  await assert.rejects(reserveOpenAiCall({ userId: `outro-${suffix}`, now, config, sendAlert }), e => e.codigo === 'ORCAMENTO_DIARIO');

  // 3. Limpeza: abuso com mais de 30 dias sai; uso da OpenAI com menos de 400 dias fica.
  const later = new Date(now.getTime() + 40 * 86_400_000);
  const pruned = await counters.pruneUsageCounters({ now: later });
  assert.ok(pruned.abuse >= 1);
  const afterPrune = await counters.readUsageCounter({ kind: counters.COUNTER_KINDS.LOGIN_FAILURE, subject: `ip:test-${suffix}`, periodStart });
  assert.equal(afterPrune.count, 0);
  assert.equal((await openAiUsageSummary({ now, config })).day.tokens, 6000);
});
