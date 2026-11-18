import env from '../../config/env.js';
import { sendMail } from '../mailer.js';

// Canal de e-mail para alertas operacionais (erros 5xx, falhas de processo e de
// jobs, status operacional). O controle de repetição é em memória, por
// processo: cada processo (API e worker) envia no máximo um e-mail por
// "impressão digital" de erro dentro da janela configurada.

const MAX_TRACKED_FINGERPRINTS = 500;
const MAX_SUBJECT_DETAIL = 120;
const MAX_MESSAGE_LINE = 300;
const MAX_STACK_FRAMES = 15;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CPF_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Campos de contexto que podem ir para o e-mail. Qualquer outro campo do
// contexto (ex.: dados enviados pelo cliente) fica de fora.
const EMAIL_CONTEXT_FIELDS = [
  ['method', 'Método'],
  ['path', 'Rota'],
  ['statusCode', 'Status HTTP'],
  ['requestId', 'Request id'],
  ['userId', 'Usuário (id)'],
  ['job', 'Job'],
  ['process', 'Processo']
];

export function alertEmailRecipients(config = env) {
  return Array.isArray(config.operationsAlertEmails) ? config.operationsAlertEmails : [];
}

export function redactPersonalData(value) {
  return String(value ?? '')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(CPF_PATTERN, '[cpf]');
}

function normalizeForFingerprint(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(UUID_PATTERN, ':uuid')
    .replace(/\d+/g, '#')
    .slice(0, 200);
}

export function errorFingerprint(payload = {}) {
  const context = payload.context || {};
  const where = context.job || context.path || context.process || '';
  return [
    payload.source,
    payload.name,
    normalizeForFingerprint(firstLine(payload.message)),
    normalizeForFingerprint(where)
  ].join('|');
}

export function createAlertThrottle({
  windowMs = env.operationsAlertEmailThrottleMs,
  nowFn = () => Date.now(),
  maxEntries = MAX_TRACKED_FINGERPRINTS
} = {}) {
  const entries = new Map();
  return {
    take(fingerprint) {
      const now = nowFn();
      const entry = entries.get(fingerprint);
      if (entry && now - entry.lastSentAt < windowMs) {
        entry.suppressed += 1;
        return { send: false, suppressed: entry.suppressed };
      }
      const suppressed = entry?.suppressed || 0;
      entries.delete(fingerprint);
      entries.set(fingerprint, { lastSentAt: now, suppressed: 0 });
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
      return { send: true, suppressed };
    },
    forget(fingerprint) {
      entries.delete(fingerprint);
    },
    size() {
      return entries.size;
    }
  };
}

const defaultThrottle = createAlertThrottle();

function firstLine(value) {
  return String(value ?? '').split('\n')[0].trim();
}

function truncate(value, maxLength) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

// A mensagem de alguns erros (ex.: validação do Prisma) traz os argumentos da
// consulta, que podem conter dados pessoais. No e-mail vai só a primeira linha
// da mensagem e as linhas "at ..." da pilha.
function safeStackFrames(stack) {
  return String(stack || '')
    .split('\n')
    .filter(line => /^\s+at\s/.test(line))
    .slice(0, MAX_STACK_FRAMES)
    .map(line => redactPersonalData(line.trim()));
}

function environmentLabel(config) {
  return config.nodeEnv || 'unknown';
}

export function operationalErrorEmailMessage(payload, { suppressed = 0, throttleMs, config = env } = {}) {
  const message = redactPersonalData(truncate(firstLine(payload.message), MAX_MESSAGE_LINE));
  const name = redactPersonalData(truncate(payload.name || 'Error', 120));
  const context = payload.context || {};
  const lines = [
    'Erro operacional capturado no filtroAPP.',
    '',
    `Erro: ${name}: ${message}`,
    `Origem: ${payload.source || 'backend'}`,
    `Quando: ${payload.occurredAt}`,
    `Ambiente: ${environmentLabel(config)}`,
    `Versão: ${payload.version || 'unknown'}`
  ];
  for (const [field, label] of EMAIL_CONTEXT_FIELDS) {
    const value = context[field];
    if (value === undefined || value === null || value === '') continue;
    lines.push(`${label}: ${redactPersonalData(truncate(value, 300))}`);
  }
  if (suppressed > 0) {
    const minutes = Math.round((throttleMs ?? config.operationsAlertEmailThrottleMs) / 60000);
    lines.push('', `Ocorrências iguais suprimidas desde o último e-mail: ${suppressed} (janela de ${minutes} min).`);
  }
  const frames = safeStackFrames(payload.stack);
  if (frames.length) {
    lines.push('', 'Pilha:', ...frames);
  }
  lines.push('', 'Detalhes completos ficam no log do container. Este e-mail não inclui dados enviados pelo usuário.');

  return {
    subject: `[filtroAPP ${environmentLabel(config)}] Erro: ${truncate(`${name}: ${message}`, MAX_SUBJECT_DETAIL)}`,
    text: lines.join('\n')
  };
}

function deliveryResult(result) {
  if (result?.skipped) return { sent: false, reason: 'outbound-disabled' };
  return { sent: true };
}

export async function sendOperationalErrorEmail(payload, {
  recipients = alertEmailRecipients(),
  throttle = defaultThrottle,
  sendMailFn = sendMail,
  logger = console,
  config = env
} = {}) {
  if (!recipients.length) return { sent: false, reason: 'not-configured' };

  const fingerprint = errorFingerprint(payload);
  const decision = throttle.take(fingerprint);
  if (!decision.send) return { sent: false, reason: 'throttled', suppressed: decision.suppressed };

  const message = operationalErrorEmailMessage(payload, { suppressed: decision.suppressed, config });
  try {
    const result = deliveryResult(await sendMailFn({
      to: recipients.join(', '),
      subject: message.subject,
      text: message.text
    }));
    if (!result.sent) throttle.forget(fingerprint);
    return result;
  } catch (error) {
    // Libera a impressão digital para que a próxima ocorrência tente de novo.
    throttle.forget(fingerprint);
    logger.warn?.('Falha ao enviar e-mail de alerta operacional.', error?.message || error);
    return { sent: false, reason: 'send-error' };
  }
}

export async function sendOperationalStatusEmail({ subject, text }, {
  recipients = alertEmailRecipients(),
  sendMailFn = sendMail,
  logger = console
} = {}) {
  if (!recipients.length) return { sent: false, reason: 'not-configured' };
  try {
    return deliveryResult(await sendMailFn({ to: recipients.join(', '), subject, text }));
  } catch (error) {
    logger.warn?.('Falha ao enviar e-mail de status operacional.', error?.message || error);
    return { sent: false, reason: 'send-error' };
  }
}
