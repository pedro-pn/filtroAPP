import env from '../../config/env.js';
import prisma from '../prisma.js';
import { sendThrottledAlertEmail } from '../operations/alert-email.js';
import {
  COUNTER_KINDS,
  abuseBucketStart,
  incrementUsageCounter,
  pruneUsageCounters,
  sumUsageCounters
} from './usage-counters.js';

// Detecção de abuso (pilar 10.3). Os eventos (falha de login, resposta 429) ficam
// num buffer em memória e são gravados no banco a cada ABUSE_MONITOR_FLUSH_MS, em
// lote: um ataque com milhares de requisições não vira milhares de escritas. A
// soma da janela é lida do banco, então API e reinícios enxergam o mesmo total.

const MAX_BUFFERED_KEYS = 5000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

const buffer = new Map();
let lastPruneAt = 0;

function bufferKey(kind, subject, periodStart) {
  return `${kind}\u0000${subject}\u0000${periodStart.toISOString()}`;
}

function bufferEvent(kind, subject, now = new Date()) {
  const periodStart = abuseBucketStart(now);
  const key = bufferKey(kind, subject, periodStart);
  const current = buffer.get(key);
  if (current) {
    current.count += 1;
    return;
  }
  if (buffer.size >= MAX_BUFFERED_KEYS) {
    // Muitos IPs distintos: preserva o total global e descarta o detalhe extra.
    if (subject !== 'global') return;
  }
  buffer.set(key, { kind, subject, periodStart, count: 1 });
}

function normalizeIp(ip) {
  const value = String(ip || 'unknown').trim();
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

/**
 * Falha de login. `userId` só quando o usuário digitado corresponde a uma conta
 * existente; nomes inexistentes viram "user:unknown" (nunca guardamos o texto
 * digitado, que pode ser um dado pessoal qualquer).
 */
export function recordLoginFailure({ ip, userId = null, now = new Date() } = {}) {
  bufferEvent(COUNTER_KINDS.LOGIN_FAILURE, 'global', now);
  bufferEvent(COUNTER_KINDS.LOGIN_FAILURE, `ip:${normalizeIp(ip)}`, now);
  bufferEvent(COUNTER_KINDS.LOGIN_FAILURE, userId ? `user:${userId}` : 'user:unknown', now);
}

export function recordRateLimitHit({ name, now = new Date() } = {}) {
  bufferEvent(COUNTER_KINDS.RATE_LIMITED, String(name || 'unnamed').slice(0, 120), now);
}

export function bufferedAbuseEventCount() {
  return buffer.size;
}

export function clearAbuseBuffer() {
  buffer.clear();
}

export function abuseThresholds(config = env) {
  return {
    windowMs: config.abuseWindowMs,
    loginFailuresTotal: config.abuseLoginFailuresTotal,
    loginFailuresPerIp: config.abuseLoginFailuresPerIp,
    loginFailuresPerAccount: config.abuseLoginFailuresPerAccount,
    rateLimitHits: config.abuseRateLimitHits
  };
}

/** Compara as somas da janela com os limites. Função pura: usada pelo monitor e pelo status. */
export function detectAbuse(rows, thresholds) {
  const findings = [];
  for (const row of rows) {
    if (row.kind === COUNTER_KINDS.LOGIN_FAILURE) {
      if (row.subject === 'global' && row.count >= thresholds.loginFailuresTotal) {
        findings.push({ type: 'login-failures-total', subject: 'global', count: row.count, threshold: thresholds.loginFailuresTotal });
      } else if (row.subject.startsWith('ip:') && row.count >= thresholds.loginFailuresPerIp) {
        findings.push({ type: 'login-failures-ip', subject: row.subject, count: row.count, threshold: thresholds.loginFailuresPerIp });
      } else if (row.subject.startsWith('user:') && row.subject !== 'user:unknown'
        && row.count >= thresholds.loginFailuresPerAccount) {
        findings.push({ type: 'login-failures-account', subject: row.subject, count: row.count, threshold: thresholds.loginFailuresPerAccount });
      }
    } else if (row.kind === COUNTER_KINDS.RATE_LIMITED && row.count >= thresholds.rateLimitHits) {
      findings.push({ type: 'rate-limited', subject: row.subject, count: row.count, threshold: thresholds.rateLimitHits });
    }
  }
  return findings.sort((a, b) => b.count - a.count);
}

export async function readAbuseWindow({ prismaClient = prisma, now = new Date(), config = env } = {}) {
  const since = new Date(now.getTime() - config.abuseWindowMs);
  return sumUsageCounters({
    kinds: [COUNTER_KINDS.LOGIN_FAILURE, COUNTER_KINDS.RATE_LIMITED],
    since: abuseBucketStart(since)
  }, { prismaClient });
}

const FINDING_LABELS = {
  'login-failures-total': 'Falhas de login em todas as contas',
  'login-failures-ip': 'Falhas de login vindas de um mesmo IP',
  'login-failures-account': 'Falhas de login numa mesma conta',
  'rate-limited': 'Requisições bloqueadas por limite (HTTP 429)'
};

export function abuseFindingLabel(finding) {
  return FINDING_LABELS[finding.type] || finding.type;
}

async function describeSubject(subject, prismaClient) {
  if (subject.startsWith('user:')) {
    const userId = subject.slice(5);
    const user = await prismaClient.user?.findUnique?.({ where: { id: userId }, select: { username: true } }).catch(() => null);
    return user?.username ? `conta ${user.username}` : 'conta interna';
  }
  if (subject.startsWith('ip:')) return `IP ${subject.slice(3)}`;
  if (subject === 'global') return 'todas as contas';
  return `limitador ${subject}`;
}

export function abuseAlertMessage(finding, subjectLabel, { windowMs, environment = env.nodeEnv } = {}) {
  const minutes = Math.round(windowMs / 60000);
  const label = abuseFindingLabel(finding);
  return {
    subject: `[filtroAPP ${environment || 'unknown'}] Abuso: ${label} (${subjectLabel})`,
    text: [
      'Uso fora do normal detectado no filtroAPP.',
      '',
      `Sinal: ${label}`,
      `Origem: ${subjectLabel}`,
      `Ocorrências nos últimos ${minutes} min: ${finding.count} (limite de alerta: ${finding.threshold})`,
      '',
      'Os limitadores já devolvem HTTP 429 a quem passa do limite. Se o padrão continuar,',
      'siga docs/RUNBOOK_INCIDENTES.md ("Alerta de abuso"): bloquear o IP no firewall/Caddy,',
      'desativar ou trocar a senha da conta-alvo e conferir os logs.',
      '',
      'Este e-mail não inclui senhas nem o texto digitado no login.'
    ].join('\n')
  };
}

export async function flushAbuseEvents({
  prismaClient = prisma,
  now = new Date(),
  config = env,
  sendAlert = sendThrottledAlertEmail,
  logger = console
} = {}) {
  const entries = [...buffer.values()];
  buffer.clear();
  if (!entries.length) return { written: 0, findings: [] };

  let written = 0;
  for (const entry of entries) {
    try {
      await incrementUsageCounter(entry, { prismaClient });
      written += 1;
    } catch (error) {
      logger.warn?.('Falha ao gravar contador de abuso.', error?.code || error?.message || error);
    }
  }

  let findings = [];
  try {
    const touched = new Set(entries.map(entry => `${entry.kind}\u0000${entry.subject}`));
    const rows = (await readAbuseWindow({ prismaClient, now, config }))
      .filter(row => touched.has(`${row.kind}\u0000${row.subject}`));
    findings = detectAbuse(rows, abuseThresholds(config));
    for (const finding of findings) {
      const subjectLabel = await describeSubject(finding.subject, prismaClient);
      logger.warn?.(JSON.stringify({ evento: 'abuso_detectado', tipo: finding.type, origem: finding.subject, ocorrencias: finding.count }));
      await sendAlert({
        fingerprint: `abuse|${finding.type}|${finding.subject}`,
        ...abuseAlertMessage(finding, subjectLabel, { windowMs: config.abuseWindowMs, environment: config.nodeEnv })
      });
    }
  } catch (error) {
    logger.warn?.('Falha ao avaliar sinais de abuso.', error?.code || error?.message || error);
  }

  if (now.getTime() - lastPruneAt >= PRUNE_INTERVAL_MS) {
    lastPruneAt = now.getTime();
    await pruneUsageCounters({ prismaClient, now }).catch(error => {
      logger.warn?.('Falha ao limpar contadores antigos.', error?.code || error?.message || error);
    });
  }
  return { written, findings };
}

export function startAbuseMonitor({ intervalMs = env.abuseMonitorFlushMs, logger = console } = {}) {
  const timer = setInterval(() => {
    flushAbuseEvents({ logger }).catch(error => logger.warn?.('Falha no monitor de abuso.', error?.message || error));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
